use redis::aio::MultiplexedConnection;
use redis::Value as RedisValue;
use serde_json::Value;

pub async fn connect(
    host: &str,
    port: u16,
    password: Option<&str>,
    db: i64,
) -> Result<MultiplexedConnection, String> {
    let url = match password.filter(|p| !p.is_empty()) {
        Some(pw) => format!("redis://:{pw}@{host}:{port}/{db}"),
        None => format!("redis://{host}:{port}/{db}"),
    };
    let client = redis::Client::open(url).map_err(|e| e.to_string())?;
    client
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| e.to_string())
}

pub async fn run_command(
    conn: &mut MultiplexedConnection,
    args: Vec<String>,
) -> Result<Value, String> {
    let Some((name, rest)) = args.split_first() else {
        return Err("Empty command".to_string());
    };
    let mut cmd = redis::cmd(name);
    for a in rest {
        cmd.arg(a);
    }
    let reply: RedisValue = cmd.query_async(conn).await.map_err(|e| e.to_string())?;
    Ok(redis_value_to_json(reply))
}

fn redis_value_to_json(value: RedisValue) -> Value {
    match value {
        RedisValue::Nil => Value::Null,
        RedisValue::Int(i) => Value::from(i),
        RedisValue::Double(d) => serde_json::Number::from_f64(d)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        RedisValue::Boolean(b) => Value::Bool(b),
        RedisValue::BulkString(bytes) => Value::String(String::from_utf8_lossy(&bytes).to_string()),
        RedisValue::SimpleString(s) => Value::String(s),
        RedisValue::Okay => Value::String("OK".to_string()),
        RedisValue::Array(items) | RedisValue::Set(items) => {
            Value::Array(items.into_iter().map(redis_value_to_json).collect())
        }
        RedisValue::Map(pairs) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in pairs {
                let key = match redis_value_to_json(k) {
                    Value::String(s) => s,
                    other => other.to_string(),
                };
                obj.insert(key, redis_value_to_json(v));
            }
            Value::Object(obj)
        }
        other => Value::String(format!("{other:?}")),
    }
}
