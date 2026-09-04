//! ClickHouse, read side: connecting over its HTTP interface and reading what is on it.
//!
//! No sqlx driver exists for ClickHouse, so this module talks the HTTP interface directly through
//! `reqwest` — already in the tree for the REST module — rather than adding a client crate built
//! around rows of a fixed, compile-time shape. `clickhouse` (the crate ClickHouse Inc. publishes)
//! is exactly that: it wants a Rust struct per table, which is the wrong shape for a browser that
//! opens a table it has never seen before. Every query here is sent as the request body with
//! `FORMAT JSON` appended; the response carries its own column names and types in `meta` and the
//! rows as JSON objects in `data`, which is already the shape `row_to_json` builds by hand for
//! MySQL and PostgreSQL.
//!
//! v1 is read-only throughout — see the plan this was built from
//! (`docs/superpowers/plans/2026-09-04-clickhouse-db-kind.md`). Nothing in this module writes.

use crate::error::AppError;
use crate::modules::db::models::ServerInfo;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{Map, Value};

/// One live ClickHouse connection: the server's base URL and the credentials sent with every
/// request. Cheap to clone — `reqwest::Client` is an `Arc` inside, and the rest is two short
/// strings — which is what lets `commands::handle` hand it out without holding the connection map.
#[derive(Clone)]
pub struct Connection {
    client: Client,
    base_url: String,
    user: String,
    password: String,
}

/// Turns a failed request or a response the server refused into the one error code every caller
/// reports through — the counterpart of `mysql::map_error`, without a "lost connection" case:
/// there is no session to lose, only a request that either lands or does not.
fn map_error(message: impl std::fmt::Display) -> AppError {
    err!("error.clickhouse", message = message)
}

/// Opens a connection, and proves it: `SELECT 1` is run here rather than left for the first real
/// query, so that a wrong password or an unreachable host is reported by the Connect button and
/// not by the sidebar a moment later — the same reasoning as `postgres::connect`.
///
/// `use_ssl` chooses the scheme outright — `Some(true)` for `https://`, anything else for
/// `http://` — rather than the "try TLS, fall back to plaintext" MySQL and PostgreSQL do. Those
/// two negotiate TLS *inside* one TCP connection, so a server that turns out not to offer it can
/// still be reached in plaintext. HTTP and HTTPS are two different endpoints from the first byte;
/// there is no connection to fall back within, so leaving `use_ssl` unset defaults to the scheme
/// the box on the connection form itself defaults to — plain HTTP.
pub async fn connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    use_ssl: Option<bool>,
) -> Result<Connection, AppError> {
    let scheme = if use_ssl == Some(true) { "https" } else { "http" };
    let base_url = format!("{scheme}://{host}:{port}/");
    let client = Client::builder().build().map_err(map_error)?;
    let conn = Connection {
        client,
        base_url,
        user: username.to_string(),
        password: password.to_string(),
    };
    query(&conn, "SELECT 1").await?;
    Ok(conn)
}

/// What one call to the server answers back, in the shape `FORMAT JSON` always gives: the rows it
/// found, each one already a JSON object keyed by column name, since that is what `FORMAT JSON`
/// writes them as.
///
/// `FORMAT JSON` also carries a `meta` array — the columns' names and types — which nothing reads
/// yet: nothing above `connect`/`server_info` runs in this app until `table_data` needs it to
/// decide which columns can be decoded as they stand (see the plan's D7). `#[serde(default)]` on
/// `data` and serde's own default of ignoring unknown fields mean this type does not have to name
/// every field of the response to parse it.
#[derive(Debug, Deserialize)]
pub struct QueryResult {
    #[serde(default)]
    pub data: Vec<Map<String, Value>>,
}

/// Sends one statement and reads back whatever it returns, decoded as JSON.
///
/// `FORMAT JSON` is appended on a line of its own rather than asked for as a query parameter, so
/// that a statement ending in its own `-- comment` does not swallow it. Credentials go as headers
/// (`X-ClickHouse-User` / `X-ClickHouse-Key`) instead of Basic Auth in the URL, so they never sit
/// on a request line any HTTP logging in between would keep.
pub async fn query(conn: &Connection, sql: &str) -> Result<QueryResult, AppError> {
    let body = format!("{sql}\nFORMAT JSON");
    let mut request = conn.client.post(&conn.base_url).body(body);
    if !conn.user.is_empty() {
        request = request
            .header("X-ClickHouse-User", &conn.user)
            .header("X-ClickHouse-Key", &conn.password);
    }
    let response = request.send().await.map_err(map_error)?;
    let status = response.status();
    let text = response.text().await.map_err(map_error)?;
    if !status.is_success() {
        // ClickHouse's own error text ("Code: 516. DB::Exception: ... Authentication failed") is
        // plain text on a failure, not JSON — the same words the CLI client would show.
        return Err(map_error(text.trim()));
    }
    serde_json::from_str(&text).map_err(map_error)
}

/// What the header shows about the server: its version, and the machine it runs on.
///
/// `hostName()` rather than `system.uname` — the latter is not on every version this app can meet
/// (missing outright on the 26.8 test server this was built against), where `hostName()` is a
/// plain SQL function and has been since ClickHouse could be clustered at all.
pub async fn server_info(conn: &Connection) -> Result<ServerInfo, AppError> {
    let version = scalar(conn, "SELECT version()").await?;
    let os = scalar(conn, "SELECT hostName()").await.unwrap_or_default();
    Ok(ServerInfo { version, os })
}

/// The one value a single-row, single-column query answers with, read as a string. ClickHouse's
/// `FORMAT JSON` already writes every scalar as the closest JSON type — including 64-bit integers
/// as JSON strings, to keep the precision an `f64` would round away — so a value already a JSON
/// string is used as it stands, and anything else is rendered rather than assumed absent.
async fn scalar(conn: &Connection, sql: &str) -> Result<String, AppError> {
    let result = query(conn, sql).await?;
    let row = result.data.first().ok_or_else(|| map_error("no rows"))?;
    let value = row.values().next().ok_or_else(|| map_error("no columns"))?;
    Ok(match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::QueryResult;

    /// `FORMAT JSON`'s own shape, exactly as the server sends it — the fixture this module's
    /// deserialization is checked against without a server in the room. `meta` and `rows` are part
    /// of that real shape and are included here even though `QueryResult` does not name them yet,
    /// so this test keeps meaning what it says once it does.
    #[test]
    fn reads_clickhouse_s_own_json_format() {
        let text = r#"{
            "meta": [
                {"name": "id", "type": "UInt64"},
                {"name": "name", "type": "String"}
            ],
            "data": [
                {"id": "1", "name": "a"},
                {"id": "2", "name": "b"}
            ],
            "rows": 2
        }"#;
        let result: QueryResult = serde_json::from_str(text).unwrap();
        assert_eq!(result.data.len(), 2);
        assert_eq!(result.data[1]["name"], "b");
    }

    /// A statement that returns nothing — `CREATE TABLE`, or a `SELECT` with no rows — still
    /// parses: `data` is `#[serde(default)]` for exactly this.
    #[test]
    fn reads_a_result_with_no_rows() {
        let text = r#"{"meta": [{"name": "id", "type": "UInt64"}], "data": [], "rows": 0}"#;
        let result: QueryResult = serde_json::from_str(text).unwrap();
        assert!(result.data.is_empty());
    }
}
