use serde_json::{Map, Value};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow, MySqlSslMode};
use sqlx::{Column, MySqlPool, Row};

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

pub async fn query(pool: &MySqlPool, sql: &str) -> Result<Vec<Map<String, Value>>, String> {
    // Querying a &Pool directly requires 'static query text (sqlx's Executor
    // impl for &Pool boxes the acquire+execute future); acquiring a connection
    // first lets us run borrowed, non-'static SQL text instead.
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    // AssertSqlSafe opts out of sqlx's SQL-injection speed bump: this client
    // runs arbitrary, user-authored SQL by design, not app-embedded queries.
    let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(row_to_json).collect())
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
fn column_value(row: &MySqlRow, i: usize) -> Value {
    if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
        return v.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
        return v.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
        return v
            .and_then(|n| serde_json::Number::from_f64(n).map(Value::Number))
            .unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<chrono::NaiveDateTime>, _>(i) {
        return v
            .map(|d| Value::String(d.to_string()))
            .unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<chrono::NaiveDate>, _>(i) {
        return v
            .map(|d| Value::String(d.to_string()))
            .unwrap_or(Value::Null);
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
