use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow, MySqlSslMode};
use sqlx::{Column, MySqlPool, Row, TypeInfo};
use std::collections::BTreeMap;

pub async fn connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: Option<&str>,
    use_ssl: Option<bool>,
) -> Result<MySqlPool, String> {
    let mut opts = MySqlConnectOptions::new()
        .host(host)
        .port(port)
        .username(username)
        .ssl_mode(if use_ssl == Some(false) {
            MySqlSslMode::Disabled
        } else {
            MySqlSslMode::Preferred
        });
    // sqlx only skips the auth-response scramble (as required for a truly
    // passwordless MySQL account) when the options' password is `None`.
    // Calling `.password("")` sets `Some("")`, which still runs SHA1("")
    // through the scramble algorithm and sends a bogus 20-byte response —
    // rejected by the server as "using password: YES" even though the user
    // typed nothing.
    if !password.is_empty() {
        opts = opts.password(password);
    }
    if let Some(db) = database.filter(|d| !d.is_empty()) {
        opts = opts.database(db);
    }
    MySqlPoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .map_err(|e| e.to_string())
}

pub async fn query(
    pool: &MySqlPool,
    sql: &str,
    database: Option<&str>,
) -> Result<Vec<Map<String, Value>>, String> {
    // Querying a &Pool directly requires 'static query text (sqlx's Executor
    // impl for &Pool boxes the acquire+execute future); acquiring a connection
    // first lets us run borrowed, non-'static SQL text instead.
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    if let Some(db) = database.filter(|d| !d.is_empty()) {
        let use_sql = format!("USE {}", quote_ident(db));
        sqlx::query(sqlx::AssertSqlSafe(use_sql))
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    }
    // AssertSqlSafe opts out of sqlx's SQL-injection speed bump: this client
    // runs arbitrary, user-authored SQL by design, not app-embedded queries.
    let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(row_to_json).collect())
}

/// Backtick-quotes an identifier (database/table name) for interpolation into
/// SQL text, doubling embedded backticks — MySQL's own escaping rule.
fn quote_ident(ident: &str) -> String {
    format!("`{}`", ident.replace('`', "``"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub version: String,
    pub os: String,
}

pub async fn server_info(pool: &MySqlPool) -> Result<ServerInfo, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query(
        "SHOW VARIABLES WHERE Variable_name IN ('version', 'version_compile_os')",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut version = String::new();
    let mut os = String::new();
    for row in &rows {
        let name: String = row.get("Variable_name");
        let value: String = row.get("Value");
        match name.as_str() {
            "version" => version = value,
            "version_compile_os" => os = value,
            _ => {}
        }
    }
    Ok(ServerInfo { version, os })
}

pub async fn list_databases(pool: &MySqlPool) -> Result<Vec<String>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SHOW DATABASES")
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(|r| r.get::<String, _>(0)).collect())
}

pub async fn list_tables(pool: &MySqlPool, database: &str) -> Result<Vec<String>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let sql = format!("SHOW TABLES FROM {}", quote_ident(database));
    let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(|r| r.get::<String, _>(0)).collect())
}

/// What `SHOW COLUMNS` knows about one column beyond its name — everything a new row has to
/// respect: the type it is written as, whether it may be left NULL, and what it falls back to
/// when an INSERT leaves it out.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    /// The declared type as MySQL spells it, e.g. `varchar(255)` or `int unsigned`.
    pub data_type: String,
    pub nullable: bool,
    /// The column's DEFAULT, or `None` when it has none. An expression default
    /// (`CURRENT_TIMESTAMP`, `(uuid())`) is reported here too, unquoted and by itself
    /// indistinguishable from a literal — `extra` is what tells the two apart.
    pub default_value: Option<String>,
    /// `SHOW COLUMNS`' Extra: `auto_increment`, `DEFAULT_GENERATED`, `STORED GENERATED`, ...
    pub extra: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TablePage {
    pub columns: Vec<String>,
    /// Keyed by column name; `columns` is what carries their order.
    pub column_meta: BTreeMap<String, ColumnMeta>,
    pub primary_key: Vec<String>,
    /// The AUTO_INCREMENT column, if the table has one. Only such a table has a
    /// counter worth offering to reset after a delete.
    pub auto_increment_column: Option<String>,
    pub rows: Vec<Map<String, Value>>,
    pub total: i64,
}

pub async fn table_data(
    pool: &MySqlPool,
    database: &str,
    table: &str,
    page: i64,
    page_size: i64,
) -> Result<TablePage, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let qualified = format!("{}.{}", quote_ident(database), quote_ident(table));

    // SHOW COLUMNS gives us the column list (in table order) even when the
    // table has zero rows, which a `SELECT * ... LIMIT n` result set can't.
    let columns_sql = format!("SHOW COLUMNS FROM {qualified}");
    let column_rows = sqlx::query(sqlx::AssertSqlSafe(columns_sql))
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let columns: Vec<String> = column_rows
        .iter()
        .map(|r| r.get::<String, _>("Field"))
        .collect();
    let column_meta: BTreeMap<String, ColumnMeta> = column_rows
        .iter()
        .map(|r| {
            (
                r.get::<String, _>("Field"),
                ColumnMeta {
                    data_type: r.get::<String, _>("Type"),
                    nullable: r.get::<String, _>("Null") == "YES",
                    default_value: r.try_get::<Option<String>, _>("Default").unwrap_or(None),
                    extra: r.get::<String, _>("Extra"),
                },
            )
        })
        .collect();
    let primary_key: Vec<String> = column_rows
        .iter()
        .filter(|r| r.get::<String, _>("Key") == "PRI")
        .map(|r| r.get::<String, _>("Field"))
        .collect();
    let auto_increment_column: Option<String> = column_rows
        .iter()
        .find(|r| r.get::<String, _>("Extra").contains("auto_increment"))
        .map(|r| r.get::<String, _>("Field"));

    let count_sql = format!("SELECT COUNT(*) FROM {qualified}");
    let total: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(count_sql))
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let page_size = page_size.clamp(1, 1000);
    let offset = page.max(0) * page_size;
    let data_sql = format!("SELECT * FROM {qualified} LIMIT {page_size} OFFSET {offset}");
    let rows = sqlx::query(sqlx::AssertSqlSafe(data_sql))
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(TablePage {
        columns,
        column_meta,
        primary_key,
        auto_increment_column,
        rows: rows.iter().map(row_to_json).collect(),
        total,
    })
}

/// Binds a JSON value (always `Null` or `String` — the frontend only ever
/// sends edited text or an explicit null) as an `Option<&str>`, letting MySQL
/// coerce the text to the column's real type on write.
fn bind_value<'q>(
    query: sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments>,
    value: &'q Value,
) -> sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    match value {
        Value::String(s) => query.bind(Some(s.as_str())),
        _ => query.bind(None::<&str>),
    }
}

/// Updates exactly one row, identified by `key` (primary key columns, or —
/// when a table has none — every column as a fallback). Runs inside a
/// transaction that first verifies the key predicate matches exactly one
/// row, so the no-PK fallback can't silently clobber a duplicate row.
pub async fn update_row(
    pool: &MySqlPool,
    database: &str,
    table: &str,
    updates: &Map<String, Value>,
    key: &Map<String, Value>,
) -> Result<(), String> {
    if updates.is_empty() {
        return Ok(());
    }
    if key.is_empty() {
        return Err("Cannot update a row without any identifying columns".to_string());
    }

    let qualified = format!("{}.{}", quote_ident(database), quote_ident(table));
    let set_clause = updates
        .keys()
        .map(|c| format!("{} = ?", quote_ident(c)))
        .collect::<Vec<_>>()
        .join(", ");
    // `<=>` is MySQL's NULL-safe equality operator, so a key column that is
    // itself NULL still matches (plain `=` never matches NULL).
    let where_clause = key
        .keys()
        .map(|c| format!("{} <=> ?", quote_ident(c)))
        .collect::<Vec<_>>()
        .join(" AND ");

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let count_sql = format!("SELECT COUNT(*) FROM {qualified} WHERE {where_clause}");
    let mut count_query = sqlx::query(sqlx::AssertSqlSafe(count_sql));
    for v in key.values() {
        count_query = bind_value(count_query, v);
    }
    let matched: i64 = count_query
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .get::<i64, _>(0);
    if matched != 1 {
        tx.rollback().await.map_err(|e| e.to_string())?;
        return Err(format!(
            "Expected to match exactly 1 row, matched {matched} — update aborted"
        ));
    }

    let update_sql = format!("UPDATE {qualified} SET {set_clause} WHERE {where_clause}");
    let mut update_query = sqlx::query(sqlx::AssertSqlSafe(update_sql));
    for v in updates.values() {
        update_query = bind_value(update_query, v);
    }
    for v in key.values() {
        update_query = bind_value(update_query, v);
    }
    update_query
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Inserts `rows`, one map per new row, all in a single transaction: if any one of them is
/// rejected, none of them land.
///
/// A row only carries the columns it has something to say about — a column left out of the map
/// is left out of that row's INSERT too, so the table's own DEFAULT (or AUTO_INCREMENT, or a
/// generated expression) is what fills it. That is also why each row is its own statement
/// rather than one multi-VALUES INSERT: rows may fill in different sets of columns, and the
/// error a rejected row produces can then say which row it was.
pub async fn insert_rows(
    pool: &MySqlPool,
    database: &str,
    table: &str,
    rows: &[Map<String, Value>],
) -> Result<(), String> {
    if rows.is_empty() {
        return Ok(());
    }

    let qualified = format!("{}.{}", quote_ident(database), quote_ident(table));
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    for (i, row) in rows.iter().enumerate() {
        // `() VALUES ()` is MySQL's way of spelling "a row that is nothing but defaults".
        let sql = if row.is_empty() {
            format!("INSERT INTO {qualified} () VALUES ()")
        } else {
            let columns = row
                .keys()
                .map(|c| quote_ident(c))
                .collect::<Vec<_>>()
                .join(", ");
            let placeholders = vec!["?"; row.len()].join(", ");
            format!("INSERT INTO {qualified} ({columns}) VALUES ({placeholders})")
        };
        let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
        for v in row.values() {
            query = bind_value(query, v);
        }
        if let Err(e) = query.execute(&mut *tx).await {
            tx.rollback().await.map_err(|e| e.to_string())?;
            return Err(format!("Row {}: {e}", i + 1));
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Deletes rows identified by `keys` (each map is one row's primary key columns,
/// or — when a table has none — every column as a fallback), or every row in the
/// table when `all` is set. `reset_auto_increment` afterwards puts the table's
/// AUTO_INCREMENT counter back to 1, so the next insert starts from 1 again.
///
/// The deletes run in one transaction: if any of them fails, none of them land.
/// Each per-row DELETE carries `LIMIT 1` so that the no-primary-key fallback can
/// only ever remove the one row the user selected, never its duplicates.
pub async fn delete_rows(
    pool: &MySqlPool,
    database: &str,
    table: &str,
    keys: &[Map<String, Value>],
    all: bool,
    reset_auto_increment: bool,
) -> Result<(), String> {
    if !all && keys.is_empty() {
        return Ok(());
    }

    let qualified = format!("{}.{}", quote_ident(database), quote_ident(table));
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    if all {
        let sql = format!("DELETE FROM {qualified}");
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    } else {
        for key in keys {
            if key.is_empty() {
                tx.rollback().await.map_err(|e| e.to_string())?;
                return Err("Cannot delete a row without any identifying columns".to_string());
            }
            // `<=>` is MySQL's NULL-safe equality operator, so a key column that
            // is itself NULL still matches (plain `=` never matches NULL).
            let where_clause = key
                .keys()
                .map(|c| format!("{} <=> ?", quote_ident(c)))
                .collect::<Vec<_>>()
                .join(" AND ");
            let sql = format!("DELETE FROM {qualified} WHERE {where_clause} LIMIT 1");
            let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
            for v in key.values() {
                query = bind_value(query, v);
            }
            query.execute(&mut *tx).await.map_err(|e| e.to_string())?;
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    // Outside the transaction on purpose: ALTER TABLE forces an implicit commit
    // in MySQL, so running it inside would end the transaction behind our back.
    if reset_auto_increment {
        let sql = format!("ALTER TABLE {qualified} AUTO_INCREMENT = 1");
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn row_to_json(row: &MySqlRow) -> Map<String, Value> {
    let mut obj = Map::new();
    for (i, col) in row.columns().iter().enumerate() {
        obj.insert(col.name().to_string(), column_value(row, i));
    }
    obj
}

// sqlx has no single "decode as any type" API, so we try common Rust types in
// order of likelihood and fall back to a lossy string/base64 representation.
//
// i64/u64 are tried before bool: sqlx-mysql's `bool::compatible()` accepts
// *any* MySQL integer column type (TINYINT, INT, BIGINT, ...), not just
// TINYINT(1), because the wire protocol doesn't distinguish them. Checking
// bool first would decode every non-zero id/FK integer column as `true`.
fn column_value(row: &MySqlRow, i: usize) -> Value {
    if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
        return v.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<u64>, _>(i) {
        return v.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
        return v.map(Value::from).unwrap_or(Value::Null);
    }
    // DECIMAL/NUMERIC is explicitly excluded from f64 by sqlx (different
    // rounding semantics) and needs its own decoder. Rendered as a string to
    // preserve exact precision instead of going through a lossy f64 roundtrip.
    if let Ok(v) = row.try_get::<Option<rust_decimal::Decimal>, _>(i) {
        return v
            .map(|d| Value::String(d.to_string()))
            .unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
        return v
            .and_then(|n| serde_json::Number::from_f64(n).map(Value::Number))
            .unwrap_or(Value::Null);
    }
    // `NaiveDateTime` only declares itself compatible with MySQL's DATETIME
    // column type, not TIMESTAMP (a distinct wire type) — so TIMESTAMP
    // columns like created_at/updated_at would fall through to Null. Decode
    // as `DateTime<Utc>` instead, which sqlx-mysql accepts for both.
    if let Ok(v) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(i) {
        return v
            .map(|d| Value::String(d.naive_utc().to_string()))
            .unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<chrono::NaiveDate>, _>(i) {
        return v
            .map(|d| Value::String(d.to_string()))
            .unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<chrono::NaiveTime>, _>(i) {
        return v
            .map(|t| Value::String(t.to_string()))
            .unwrap_or(Value::Null);
    }
    // `Json<T>::compatible()` also matches plain VARCHAR/TEXT columns (MySQL
    // has historically transmitted JSON as CHAR), so it's gated on the
    // column's actual reported type name instead of just trying it broadly —
    // otherwise a TEXT column that merely *contains* JSON-encoded text (e.g.
    // PHP's json_encode) would get silently reparsed into a structured value,
    // reordering its keys (this app's serde_json has no `preserve_order`).
    if row.column(i).type_info().name() == "JSON" {
        if let Ok(v) = row.try_get::<Option<sqlx::types::Json<Value>>, _>(i) {
            return v.map(|j| j.0).unwrap_or(Value::Null);
        }
    }
    if let Ok(v) = row.try_get::<Option<String>, _>(i) {
        return v.map(Value::String).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
        use base64::Engine;
        return v
            .map(|bytes| Value::String(base64::engine::general_purpose::STANDARD.encode(bytes)))
            .unwrap_or(Value::Null);
    }
    Value::Null
}
