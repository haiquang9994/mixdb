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

use super::filters::{escape_like, split_list};
use crate::error::AppError;
use crate::modules::db::models::ServerInfo;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

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
/// `FORMAT JSON` also carries a `meta` array — the columns' names and types of *this* result —
/// which nothing here reads: a column's type is always looked up from `system.columns` before a
/// `SELECT` naming it is built (see [`table_columns`]), because the decision `is_decodable` makes
/// has to be baked into that `SELECT`'s own text, not read back after the fact from a query that
/// already assumed an answer.
#[derive(Debug, Deserialize)]
pub struct QueryResult {
    #[serde(default)]
    pub data: Vec<Map<String, Value>>,
}

/// Sends one statement with no parameters — see [`query_with_params`], which this calls with none.
pub async fn query(conn: &Connection, sql: &str) -> Result<QueryResult, AppError> {
    query_with_params(conn, sql, &[]).await
}

/// Sends one statement and reads back whatever it returns, decoded as JSON.
///
/// `params` are ClickHouse's own parameterized-query values: the statement names each one as
/// `{name:Type}` and the value is sent as `param_name=value` on the URL, never interpolated into
/// the SQL text. This is what keeps a filter value the user typed from being SQL — the same job
/// `sqlx`'s `.bind()` does for the other engines, done here by hand because there is no `sqlx`
/// driver for this one to lean on.
///
/// `FORMAT JSON` is appended on a line of its own rather than asked for as a query parameter, so
/// that a statement ending in its own `-- comment` does not swallow it. Credentials go as headers
/// (`X-ClickHouse-User` / `X-ClickHouse-Key`) instead of Basic Auth in the URL, so they never sit
/// on a request line any HTTP logging in between would keep.
pub async fn query_with_params(
    conn: &Connection,
    sql: &str,
    params: &[(String, String)],
) -> Result<QueryResult, AppError> {
    let mut url = url::Url::parse(&conn.base_url).map_err(map_error)?;
    if !params.is_empty() {
        let mut pairs = url.query_pairs_mut();
        for (name, value) in params {
            pairs.append_pair(&format!("param_{name}"), value);
        }
    }
    let body = format!("{sql}\nFORMAT JSON");
    let mut request = conn.client.post(url).body(body);
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

/// Backtick-quotes an identifier for interpolation into SQL text, backslash-escaping an embedded
/// backtick.
///
/// Backslash rather than doubling — unlike MySQL's own `quote_ident` — because that is what
/// ClickHouse's lexer actually does with one: checked against the test server, `` SELECT 1 AS
/// `a``b` `` is refused (400) while `` SELECT 1 AS `a\`b` `` parses and names the column `` a`b ``.
pub(super) fn quote_ident(ident: &str) -> String {
    format!("`{}`", ident.replace('\\', "\\\\").replace('`', "\\`"))
}

/// A database and table addressed together, both quoted — how a table is written into SQL text.
fn qualified(database: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(database), quote_ident(table))
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

/// Every database on the server that can be connected to — everything but the three ClickHouse
/// keeps for itself, the same exclusion `clickhouse::isClickhouseSystemDatabase` makes on the
/// frontend.
pub async fn list_databases(conn: &Connection) -> Result<Vec<String>, AppError> {
    let result = query(
        conn,
        "SELECT name FROM system.databases \
         WHERE name NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA') \
         ORDER BY name",
    )
    .await?;
    Ok(result
        .data
        .iter()
        .filter_map(|row| row.get("name").and_then(Value::as_str).map(str::to_string))
        .collect())
}

/// Every table and view of `database`, alphabetically.
pub async fn list_tables(conn: &Connection, database: &str) -> Result<Vec<String>, AppError> {
    let result = query_with_params(
        conn,
        "SELECT name FROM system.tables WHERE database = {database:String} ORDER BY name",
        &[("database".to_string(), database.to_string())],
    )
    .await?;
    Ok(result
        .data
        .iter()
        .filter_map(|row| row.get("name").and_then(Value::as_str).map(str::to_string))
        .collect())
}

/// Whether a column of this type can be trusted to decode as `FORMAT JSON` writes it, rather than
/// needing `toString()` wrapped around it in the `SELECT` list — see the plan's D7.
///
/// `Nullable(X)` is unwrapped first, since it is `X` the question is really about. Everything not
/// matched here — `Array`, `Map`, `Tuple`, `Nested`, `LowCardinality`, `IPv4`/`IPv6`, and the
/// `AggregateFunction`/`SimpleAggregateFunction` states a materialized view rolls up — is read as
/// text instead: the grid draws flat cells, and none of those has one JSON shape worth trusting
/// blind.
fn is_decodable(type_name: &str) -> bool {
    let inner = type_name
        .strip_prefix("Nullable(")
        .and_then(|s| s.strip_suffix(')'))
        .unwrap_or(type_name);
    let head = inner.split('(').next().unwrap_or(inner);
    matches!(
        head,
        "UInt8" | "UInt16" | "UInt32" | "UInt64" | "UInt128" | "UInt256"
            | "Int8" | "Int16" | "Int32" | "Int64" | "Int128" | "Int256"
            | "Float32" | "Float64"
            | "String" | "FixedString"
            | "Date" | "Date32" | "DateTime" | "DateTime64"
            | "Decimal" | "Decimal32" | "Decimal64" | "Decimal128" | "Decimal256"
            | "UUID" | "Enum8" | "Enum16" | "Bool"
    )
}

/// One column of a table, as `system.columns` reports it.
struct TableColumn {
    name: String,
    type_name: String,
}

async fn table_columns(
    conn: &Connection,
    database: &str,
    table: &str,
) -> Result<Vec<TableColumn>, AppError> {
    let result = query_with_params(
        conn,
        "SELECT name, type FROM system.columns \
         WHERE database = {database:String} AND table = {table:String} \
         ORDER BY position",
        &[
            ("database".to_string(), database.to_string()),
            ("table".to_string(), table.to_string()),
        ],
    )
    .await?;
    Ok(result
        .data
        .iter()
        .filter_map(|row| {
            let name = row.get("name")?.as_str()?.to_string();
            let type_name = row.get("type")?.as_str()?.to_string();
            Some(TableColumn { name, type_name })
        })
        .collect())
}

/// What is known about one column beyond its name — the shape the Structure tab and the grid both
/// read. `foreign_key` is always `None`: ClickHouse has no foreign keys to report.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub extra: String,
    pub foreign_key: Option<Value>,
}

/// One condition on the rows a page is cut out of, as the grid's filter bar sends it — the same
/// shape MySQL and PostgreSQL read, minus the two `regexp` operators: `regexpFilter: false` on the
/// dialect keeps the filter bar from ever offering them for this kind.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub column: String,
    pub operator: String,
    #[serde(default)]
    pub value: Option<String>,
}

/// Turns the filter rows into a `WHERE` clause and the parameters to bind into it, in
/// `{name:Type}` form — see [`query_with_params`].
///
/// Every comparison goes through `toString()` on the column, the value bound as `String`: the
/// frontend sends every filter value as text, and ClickHouse — unlike MySQL — does not coerce a
/// `String` parameter to compare against a `UInt64` column on its own. The ordering operators are
/// the exception, the same way they are on PostgreSQL: `toString()` on a number sorts `10` before
/// `9`, so there the column is left as it is and the parameter is typed to match instead.
fn build_where(
    filters: &[Filter],
    columns: &BTreeMap<String, String>,
) -> Result<(String, Vec<(String, String)>), AppError> {
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<(String, String)> = Vec::new();
    let mut next = 0usize;
    let mut placeholder = |params: &mut Vec<(String, String)>, ty: &str, value: String| {
        let name = format!("p{next}");
        next += 1;
        params.push((name.clone(), value));
        format!("{{{name}:{ty}}}")
    };

    for filter in filters {
        let Some(base_type) = columns.get(&filter.column) else {
            return Err(err!("error.unknownFilterColumn", column = &filter.column));
        };
        let col = format!("toString({})", quote_ident(&filter.column));
        let raw = quote_ident(&filter.column);
        let value = filter.value.as_deref().unwrap_or("");
        let operator = filter.operator.as_str();

        let clause = match operator {
            "eq" => format!("{col} = {}", placeholder(&mut params, "String", value.to_string())),
            "ne" => format!("{col} <> {}", placeholder(&mut params, "String", value.to_string())),
            "gt" => format!("{raw} > {}", placeholder(&mut params, base_type, value.to_string())),
            "gte" => format!("{raw} >= {}", placeholder(&mut params, base_type, value.to_string())),
            "lt" => format!("{raw} < {}", placeholder(&mut params, base_type, value.to_string())),
            "lte" => format!("{raw} <= {}", placeholder(&mut params, base_type, value.to_string())),
            "contains" => format!(
                "{col} LIKE {}",
                placeholder(&mut params, "String", format!("%{}%", escape_like(value)))
            ),
            "notContains" => format!(
                "{col} NOT LIKE {}",
                placeholder(&mut params, "String", format!("%{}%", escape_like(value)))
            ),
            "startsWith" => format!(
                "{col} LIKE {}",
                placeholder(&mut params, "String", format!("{}%", escape_like(value)))
            ),
            "endsWith" => format!(
                "{col} LIKE {}",
                placeholder(&mut params, "String", format!("%{}", escape_like(value)))
            ),
            "like" => format!("{col} LIKE {}", placeholder(&mut params, "String", value.to_string())),
            "notLike" => format!(
                "{col} NOT LIKE {}",
                placeholder(&mut params, "String", value.to_string())
            ),
            "in" | "notIn" => {
                let items = split_list(value);
                if items.is_empty() {
                    continue;
                }
                let placeholders = items
                    .into_iter()
                    .map(|item| placeholder(&mut params, "String", item))
                    .collect::<Vec<_>>()
                    .join(", ");
                let sql_op = if operator == "in" { "IN" } else { "NOT IN" };
                format!("{col} {sql_op} ({placeholders})")
            }
            "between" | "notBetween" => {
                let items = split_list(value);
                if items.len() < 2 {
                    continue;
                }
                let low = placeholder(&mut params, base_type, items[0].clone());
                let high = placeholder(&mut params, base_type, items[1].clone());
                let sql_op = if operator == "between" { "BETWEEN" } else { "NOT BETWEEN" };
                format!("{raw} {sql_op} {low} AND {high}")
            }
            "isNull" => format!("{raw} IS NULL"),
            "isNotNull" => format!("{raw} IS NOT NULL"),
            "isEmpty" => format!("{col} = ''"),
            "isNotEmpty" => format!("{col} <> ''"),
            other => return Err(err!("error.unknownFilterOperator", operator = other)),
        };

        clauses.push(clause);
    }

    if clauses.is_empty() {
        return Ok((String::new(), params));
    }
    Ok((format!(" WHERE {}", clauses.join(" AND ")), params))
}

/// Which page of a table is wanted, and what it is cut out of — the same shape MySQL and
/// PostgreSQL take.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageQuery {
    pub page: i64,
    pub page_size: i64,
    #[serde(default)]
    pub sort_column: Option<String>,
    #[serde(default)]
    pub sort_desc: bool,
    #[serde(default)]
    pub filters: Vec<Filter>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TablePage {
    pub columns: Vec<String>,
    pub column_meta: BTreeMap<String, ColumnMeta>,
    pub primary_key: Vec<String>,
    pub auto_increment_column: Option<String>,
    pub rows: Vec<Map<String, Value>>,
    pub total: i64,
}

/// Reads one page of a table. `auto_increment_column` is always `None` — v1 never writes, so
/// nothing needs to know which column a resettable counter would be on.
///
/// `primary_key` is the table's sorting key (`system.tables.sorting_key`) rather than a real
/// constraint — ClickHouse has none — split naively on `, `. For a plain list of columns, which
/// almost every `ORDER BY` is, that is exactly right; for a key built from an expression it shows
/// the expression as if it were one long column name, which is a display quirk and not a
/// correctness problem, since nothing in v1 uses this to identify a row.
pub async fn table_data(
    conn: &Connection,
    database: &str,
    table: &str,
    query: &PageQuery,
) -> Result<TablePage, AppError> {
    let table_ref = qualified(database, table);
    let column_rows = table_columns(conn, database, table).await?;
    let columns: Vec<String> = column_rows.iter().map(|c| c.name.clone()).collect();

    let column_meta: BTreeMap<String, ColumnMeta> = column_rows
        .iter()
        .map(|c| {
            (
                c.name.clone(),
                ColumnMeta {
                    data_type: c.type_name.clone(),
                    nullable: c.type_name.starts_with("Nullable("),
                    default_value: None,
                    extra: String::new(),
                    foreign_key: None,
                },
            )
        })
        .collect();

    let column_types: BTreeMap<String, String> = column_rows
        .iter()
        .map(|c| (c.name.clone(), c.type_name.clone()))
        .collect();
    let (where_clause, params) = build_where(&query.filters, &column_types)?;
    let ch_params: Vec<(String, String)> = params;

    let sorting_key_result = query_with_params(
        conn,
        "SELECT sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String}",
        &[
            ("database".to_string(), database.to_string()),
            ("table".to_string(), table.to_string()),
        ],
    )
    .await;
    let sorting_key = sorting_key_result
        .ok()
        .and_then(|result| result.data.first().and_then(|row| row.get("sorting_key")?.as_str().map(str::to_string)))
        .unwrap_or_default();
    let primary_key: Vec<String> = if sorting_key.trim().is_empty() {
        Vec::new()
    } else {
        sorting_key.split(", ").map(str::to_string).collect()
    };

    let count_sql = format!("SELECT count() AS total FROM {table_ref}{where_clause}");
    let count_result = query_with_params(conn, &count_sql, &ch_params).await?;
    let total: i64 = count_result
        .data
        .first()
        .and_then(|row| row.get("total"))
        .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_i64()))
        .unwrap_or(0);

    let page_size = query.page_size.clamp(1, 5000);
    let offset = query.page.max(0).saturating_mul(page_size);
    let order_by = query
        .sort_column
        .as_deref()
        .filter(|c| columns.iter().any(|existing| existing == c))
        .map(|c| format!(" ORDER BY {} {}", quote_ident(c), if query.sort_desc { "DESC" } else { "ASC" }))
        .unwrap_or_default();
    let select_list = column_rows
        .iter()
        .map(|c| {
            let ident = quote_ident(&c.name);
            if is_decodable(&c.type_name) {
                ident
            } else {
                format!("toString({ident}) AS {ident}")
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    let data_sql = format!(
        "SELECT {select_list} FROM {table_ref}{where_clause}{order_by} LIMIT {page_size} OFFSET {offset}"
    );
    let data_result = query_with_params(conn, &data_sql, &ch_params).await?;

    Ok(TablePage {
        columns,
        column_meta,
        primary_key,
        auto_increment_column: None,
        rows: data_result.data,
        total,
    })
}

/// One column as the Structure tab's column grid shows it — the shape MySQL and PostgreSQL report,
/// with the fields ClickHouse has nothing to say about left at their empty value rather than
/// dropped: no `ON UPDATE CURRENT_TIMESTAMP`, no per-column collation to report on a `String`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub default_is_expression: bool,
    pub auto_increment: bool,
    pub on_update_current_timestamp: bool,
    pub generated: bool,
    pub collation: Option<String>,
    pub comment: String,
    /// `PRI` for a column in the sorting key, empty otherwise — MySQL's letters, since one grid
    /// draws either. ClickHouse has no `UNI`/`MUL` to report: uniqueness is not a thing an index
    /// enforces here.
    pub key: String,
    pub extra: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexColumn {
    pub name: Option<String>,
    pub prefix_length: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableIndex {
    pub name: String,
    pub unique: bool,
    pub primary: bool,
    pub index_type: String,
    pub columns: Vec<IndexColumn>,
    pub comment: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStructure {
    pub columns: Vec<StructureColumn>,
    pub indexes: Vec<TableIndex>,
}

/// Everything the Structure tab shows about one table.
///
/// `indexes` carries at most one entry — the sorting key, shown as an index it is not, the same
/// way SQLite's rowid is. ClickHouse also has data-skipping indices (`minmax`, `set`,
/// `bloom_filter`, …), which are real named objects with their own expressions; v1 leaves them out
/// rather than showing a half-true picture of what they cover, since they index an expression far
/// more often than a bare column and this app has nowhere to show one yet.
pub async fn table_structure(
    conn: &Connection,
    database: &str,
    table: &str,
) -> Result<TableStructure, AppError> {
    let columns = structure_columns(conn, database, table).await?;
    let key_columns: Vec<String> = columns
        .iter()
        .filter(|c| c.key == "PRI")
        .map(|c| c.name.clone())
        .collect();
    let indexes = if key_columns.is_empty() {
        Vec::new()
    } else {
        vec![TableIndex {
            name: "sorting_key".to_string(),
            unique: false,
            primary: true,
            index_type: "sorting_key".to_string(),
            columns: key_columns
                .into_iter()
                .map(|name| IndexColumn { name: Some(name), prefix_length: None })
                .collect(),
            comment: String::new(),
        }]
    };
    Ok(TableStructure { columns, indexes })
}

async fn structure_columns(
    conn: &Connection,
    database: &str,
    table: &str,
) -> Result<Vec<StructureColumn>, AppError> {
    let result = query_with_params(
        conn,
        "SELECT name, type, default_kind, default_expression, comment, is_in_primary_key \
         FROM system.columns \
         WHERE database = {database:String} AND table = {table:String} \
         ORDER BY position",
        &[
            ("database".to_string(), database.to_string()),
            ("table".to_string(), table.to_string()),
        ],
    )
    .await?;

    Ok(result
        .data
        .iter()
        .filter_map(|row| {
            let name = row.get("name")?.as_str()?.to_string();
            let data_type = row.get("type")?.as_str()?.to_string();
            let default_kind = row.get("default_kind").and_then(Value::as_str).unwrap_or("");
            let default_expression =
                row.get("default_expression").and_then(Value::as_str).filter(|s| !s.is_empty());
            let is_primary = row
                .get("is_in_primary_key")
                .and_then(truthy)
                .unwrap_or(false);
            Some(StructureColumn {
                nullable: data_type.starts_with("Nullable("),
                data_type,
                default_value: default_expression.map(str::to_string),
                default_is_expression: default_expression.is_some(),
                auto_increment: false,
                on_update_current_timestamp: false,
                // MATERIALIZED and ALIAS columns are computed from the others, the closest
                // ClickHouse comes to a MySQL/PostgreSQL generated column.
                generated: default_kind == "MATERIALIZED" || default_kind == "ALIAS",
                collation: None,
                comment: row.get("comment").and_then(Value::as_str).unwrap_or("").to_string(),
                key: if is_primary { "PRI".to_string() } else { String::new() },
                extra: default_kind.to_string(),
                name,
            })
        })
        .collect())
}

/// `FORMAT JSON` writes ClickHouse's `UInt8` booleans as either `0`/`1` or `true`/`false`
/// depending on how the column arrived (a plain `UInt8` reads as a number; the handful of
/// genuinely `Bool`-typed system columns read as JSON booleans) — this reads either.
fn truthy(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(b) => Some(*b),
        Value::Number(n) => n.as_i64().map(|n| n != 0),
        Value::String(s) => Some(s == "1" || s.eq_ignore_ascii_case("true")),
        _ => None,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStats {
    pub name: String,
    pub rows: u64,
    pub data_size: u64,
    /// Always 0: ClickHouse stores a MergeTree table's data-skipping indices inline with the data
    /// parts rather than as separate files with a size of their own to report.
    pub index_size: u64,
    pub avg_record_size: u64,
}

/// What every table in `database` weighs. `total_rows`/`total_bytes` are `NULL` for an engine that
/// keeps no such count — a `Log` table, a `View` — which reads here as zero rather than as a
/// missing table.
pub async fn table_stats(conn: &Connection, database: &str) -> Result<Vec<TableStats>, AppError> {
    let result = query_with_params(
        conn,
        "SELECT name, total_rows, total_bytes FROM system.tables \
         WHERE database = {database:String} ORDER BY name",
        &[("database".to_string(), database.to_string())],
    )
    .await?;

    Ok(result
        .data
        .iter()
        .filter_map(|row| {
            let name = row.get("name")?.as_str()?.to_string();
            let rows = as_u64(row.get("total_rows")).unwrap_or(0);
            let data_size = as_u64(row.get("total_bytes")).unwrap_or(0);
            Some(TableStats {
                name,
                rows,
                data_size,
                index_size: 0,
                avg_record_size: data_size.checked_div(rows).unwrap_or(0),
            })
        })
        .collect())
}

/// A number `FORMAT JSON` may have written as a string — see `scalar`'s own note on 64-bit
/// integers — or left out as JSON `null`, which is what a `NULL` becomes.
fn as_u64(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::String(s)) => s.parse().ok(),
        Some(Value::Number(n)) => n.as_u64(),
        _ => None,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub key: String,
    /// Always `None`: ClickHouse has no foreign keys to report.
    pub references: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineTable {
    pub name: String,
    pub columns: Vec<OutlineColumn>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaOutline {
    pub database: String,
    pub tables: Vec<OutlineTable>,
}

/// What the Query tab's completion knows about `database`: every table and column of it, in one
/// read.
pub async fn schema_outline(conn: &Connection, database: &str) -> Result<SchemaOutline, AppError> {
    let result = query_with_params(
        conn,
        "SELECT table, name, type, is_in_primary_key FROM system.columns \
         WHERE database = {database:String} ORDER BY table, position",
        &[("database".to_string(), database.to_string())],
    )
    .await?;

    let mut tables: Vec<OutlineTable> = Vec::new();
    for row in &result.data {
        let (Some(table), Some(name), Some(data_type)) = (
            row.get("table").and_then(Value::as_str),
            row.get("name").and_then(Value::as_str),
            row.get("type").and_then(Value::as_str),
        ) else {
            continue;
        };
        let is_primary = row.get("is_in_primary_key").and_then(truthy).unwrap_or(false);
        let column = OutlineColumn {
            name: name.to_string(),
            nullable: data_type.starts_with("Nullable("),
            data_type: data_type.to_string(),
            key: if is_primary { "PRI".to_string() } else { String::new() },
            references: None,
        };
        match tables.last_mut() {
            Some(last) if last.name == table => last.columns.push(column),
            _ => tables.push(OutlineTable { name: table.to_string(), columns: vec![column] }),
        }
    }
    Ok(SchemaOutline { database: database.to_string(), tables })
}

#[cfg(test)]
mod tests {
    use super::{build_where, is_decodable, quote_ident, Filter, QueryResult};
    use std::collections::BTreeMap;

    /// `FORMAT JSON`'s own shape, exactly as the server sends it — the fixture this module's
    /// deserialization is checked against without a server in the room.
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

    /// Backslash, not doubling — checked against the test server, see `quote_ident`'s own doc.
    #[test]
    fn quotes_identifiers_the_way_clickhouse_does() {
        assert_eq!(quote_ident("events"), "`events`");
        assert_eq!(quote_ident("a`b"), "`a\\`b`");
    }

    #[test]
    fn scalar_types_and_their_nullable_wrapper_decode_directly() {
        for ty in ["UInt64", "String", "Float64", "DateTime64(3)", "Decimal(10, 2)", "Bool"] {
            assert!(is_decodable(ty), "{ty}");
            assert!(is_decodable(&format!("Nullable({ty})")), "Nullable({ty})");
        }
    }

    #[test]
    fn complex_types_are_read_as_text_instead() {
        for ty in [
            "Array(String)",
            "Map(String, UInt64)",
            "Tuple(UInt64, String)",
            "LowCardinality(String)",
            "AggregateFunction(sum, UInt64)",
            "SimpleAggregateFunction(sum, UInt64)",
            "IPv4",
            "IPv6",
        ] {
            assert!(!is_decodable(ty), "{ty}");
        }
    }

    fn filter(column: &str, operator: &str, value: Option<&str>) -> Filter {
        Filter {
            column: column.to_string(),
            operator: operator.to_string(),
            value: value.map(str::to_string),
        }
    }

    fn columns() -> BTreeMap<String, String> {
        [("id", "UInt64"), ("name", "String")]
            .into_iter()
            .map(|(name, ty)| (name.to_string(), ty.to_string()))
            .collect()
    }

    /// Every comparison is `toString(col) = {pN:String}` — never the raw value spliced into the
    /// text — and each placeholder gets its own name so the caller can send every value as a
    /// separate URL parameter.
    #[test]
    fn builds_a_parameterized_where_clause() {
        let filters = vec![filter("id", "eq", Some("1")), filter("name", "contains", Some("ann"))];
        let (clause, params) = build_where(&filters, &columns()).unwrap();
        assert_eq!(
            clause,
            " WHERE toString(`id`) = {p0:String} AND toString(`name`) LIKE {p1:String}"
        );
        assert_eq!(params, [("p0".to_string(), "1".to_string()), ("p1".to_string(), "%ann%".to_string())]);
    }

    /// The ordering operators compare the raw column, typed to match it — `toString()` on a number
    /// would sort `10` before `9`.
    #[test]
    fn orders_by_the_columns_own_type_rather_than_text() {
        let (clause, params) = build_where(&[filter("id", "gt", Some("5"))], &columns()).unwrap();
        assert_eq!(clause, " WHERE `id` > {p0:UInt64}");
        assert_eq!(params, [("p0".to_string(), "5".to_string())]);
    }

    #[test]
    fn a_list_operator_mints_one_placeholder_per_item() {
        let (clause, params) = build_where(&[filter("id", "in", Some("1,2,3"))], &columns()).unwrap();
        assert_eq!(clause, " WHERE toString(`id`) IN ({p0:String}, {p1:String}, {p2:String})");
        assert_eq!(params.len(), 3);
    }

    #[test]
    fn a_column_the_table_does_not_have_is_refused() {
        assert!(build_where(&[filter("nope", "eq", Some("1"))], &columns()).is_err());
    }
}
