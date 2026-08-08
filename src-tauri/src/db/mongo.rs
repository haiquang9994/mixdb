use base64::Engine;
use futures_util::TryStreamExt;
use mongodb::bson::spec::BinarySubtype;
use mongodb::bson::{
    doc, oid::ObjectId, Binary, Bson, DateTime as BsonDateTime, Decimal128, Document, Regex,
    Timestamp,
};
use mongodb::options::ClientOptions;
use mongodb::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::str::FromStr;

pub async fn connect(uri: &str) -> Result<Client, String> {
    let mut opts = ClientOptions::parse(uri).await.map_err(|e| e.to_string())?;
    opts.app_name = Some("MixDB".to_string());
    let client = Client::with_options(opts).map_err(|e| e.to_string())?;
    // Fail fast on bad credentials/host instead of only failing on first query.
    client
        .database("admin")
        .run_command(doc! { "ping": 1 })
        .await
        .map_err(|e| e.to_string())?;
    Ok(client)
}

pub async fn list_databases(client: &Client) -> Result<Vec<String>, String> {
    client.list_database_names().await.map_err(|e| e.to_string())
}

pub async fn list_collections(client: &Client, db: &str) -> Result<Vec<String>, String> {
    client
        .database(db)
        .list_collection_names()
        .await
        .map_err(|e| e.to_string())
}

pub async fn find(
    client: &Client,
    db: &str,
    collection: &str,
    filter_json: &str,
    limit: i64,
) -> Result<Vec<Value>, String> {
    let filter: Document = if filter_json.trim().is_empty() {
        doc! {}
    } else {
        let parsed: Value = serde_json::from_str(filter_json).map_err(|e| e.to_string())?;
        mongodb::bson::to_document(&parsed).map_err(|e| e.to_string())?
    };

    let coll = client.database(db).collection::<Document>(collection);
    let mut cursor = coll
        .find(filter)
        .limit(limit)
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    while let Some(doc) = cursor.try_next().await.map_err(|e| e.to_string())? {
        out.push(serde_json::to_value(&doc).map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Wraps an ambiguous BSON scalar as `{"$type": tag, "$value": repr}`. Types
/// with an unambiguous native JSON shape (String/Boolean/Null/Array/Document)
/// are never wrapped — the frontend tells them apart from typed scalars by
/// checking for this `$type`/`$value` pair, so leaving them bare keeps that
/// check simple and avoids colliding with a real field literally named
/// `$type` (astronomically unlikely, same caveat as MongoDB's own Extended
/// JSON).
fn wrap(tag: &str, value: Value) -> Value {
    json!({ "$type": tag, "$value": value })
}

/// Converts one BSON value into this app's typed-JSON shape (see `wrap`).
/// This is a from-scratch converter rather than `serde_json::to_value` on the
/// BSON document directly: we need full, explicit control over which shape
/// each ambiguous type takes (e.g. distinguishing Int32/Int64/Double, all of
/// which are plain numbers in JSON) so `json_to_bson` can invert it exactly.
pub fn bson_to_json(bson: &Bson) -> Value {
    match bson {
        Bson::Double(f) if f.is_finite() => wrap("Double", json!(f)),
        Bson::Double(f) => wrap("Double", Value::String(f.to_string())), // NaN/Infinity
        Bson::String(s) => Value::String(s.clone()),
        Bson::Array(arr) => Value::Array(arr.iter().map(bson_to_json).collect()),
        Bson::Document(doc) => {
            Value::Object(doc.iter().map(|(k, v)| (k.clone(), bson_to_json(v))).collect())
        }
        Bson::Boolean(b) => Value::Bool(*b),
        Bson::Null => Value::Null,
        Bson::Int32(i) => wrap("Int32", json!(i)),
        Bson::Int64(i) => wrap("Int64", json!(i.to_string())),
        Bson::Decimal128(d) => wrap("Decimal128", json!(d.to_string())),
        Bson::DateTime(dt) => wrap(
            "Date",
            json!(dt
                .try_to_rfc3339_string()
                .unwrap_or_else(|_| dt.timestamp_millis().to_string())),
        ),
        Bson::Timestamp(ts) => wrap("Timestamp", json!({ "t": ts.time, "i": ts.increment })),
        Bson::Binary(bin) => wrap(
            "Binary",
            json!({
                "base64": base64::engine::general_purpose::STANDARD.encode(&bin.bytes),
                "subType": u8::from(bin.subtype),
            }),
        ),
        Bson::ObjectId(oid) => wrap("ObjectId", json!(oid.to_hex())),
        Bson::RegularExpression(re) => {
            wrap("RegExp", json!({ "pattern": re.pattern.as_str(), "options": re.options.as_str() }))
        }
        Bson::JavaScriptCode(code) => wrap("JavaScript", json!(code)),
        Bson::JavaScriptCodeWithScope(c) => wrap(
            "JavaScriptWithScope",
            json!({ "code": c.code, "scope": bson_to_json(&Bson::Document(c.scope.clone())) }),
        ),
        Bson::Symbol(s) => wrap("Symbol", json!(s)),
        Bson::Undefined => wrap("Undefined", Value::Null),
        Bson::MaxKey => wrap("MaxKey", Value::Null),
        Bson::MinKey => wrap("MinKey", Value::Null),
        // DbPointer's fields are pub(crate) in the bson crate — there is no
        // way to reconstruct one from outside the crate, so it is rendered
        // for display only; json_to_bson rejects writing this type back.
        Bson::DbPointer(dbp) => wrap("DbPointer", json!(format!("{dbp:?}"))),
    }
}

/// Inverse of `bson_to_json`. Recognizes the `{"$type","$value"}` shape for
/// ambiguous scalars; a plain JSON object with no `$type` key is treated as
/// a BSON subdocument.
pub fn json_to_bson(value: &Value) -> Result<Bson, String> {
    match value {
        Value::Null => Ok(Bson::Null),
        Value::Bool(b) => Ok(Bson::Boolean(*b)),
        Value::String(s) => Ok(Bson::String(s.clone())),
        Value::Array(arr) => arr
            .iter()
            .map(json_to_bson)
            .collect::<Result<_, _>>()
            .map(Bson::Array),
        Value::Number(n) => n
            .as_i64()
            .map(|i| {
                if i32::try_from(i).is_ok() {
                    Bson::Int32(i as i32)
                } else {
                    Bson::Int64(i)
                }
            })
            .or_else(|| n.as_f64().map(Bson::Double))
            .ok_or_else(|| "Invalid number".to_string()),
        Value::Object(map) => match (map.get("$type"), map.get("$value")) {
            (Some(Value::String(tag)), Some(inner)) => decode_typed(tag, inner),
            _ => {
                let mut d = Document::new();
                for (k, v) in map {
                    d.insert(k.clone(), json_to_bson(v)?);
                }
                Ok(Bson::Document(d))
            }
        },
    }
}

fn decode_typed(tag: &str, v: &Value) -> Result<Bson, String> {
    match tag {
        "ObjectId" => v
            .as_str()
            .ok_or_else(|| "ObjectId: expected hex string".to_string())
            .and_then(|s| ObjectId::parse_str(s).map_err(|e| format!("ObjectId: {e}")))
            .map(Bson::ObjectId),
        "Int32" => v
            .as_i64()
            .and_then(|n| i32::try_from(n).ok())
            .map(Bson::Int32)
            .ok_or_else(|| "Int32: out of range".to_string()),
        "Int64" => v
            .as_str()
            .and_then(|s| s.parse::<i64>().ok())
            .or_else(|| v.as_i64())
            .map(Bson::Int64)
            .ok_or_else(|| "Int64: invalid".to_string()),
        "Double" => v
            .as_f64()
            .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
            .map(Bson::Double)
            .ok_or_else(|| "Double: invalid".to_string()),
        "Decimal128" => v
            .as_str()
            .and_then(|s| Decimal128::from_str(s).ok())
            .map(Bson::Decimal128)
            .ok_or_else(|| "Decimal128: invalid".to_string()),
        "Date" => v
            .as_str()
            .and_then(|s| BsonDateTime::parse_rfc3339_str(s).ok())
            .map(Bson::DateTime)
            .ok_or_else(|| "Date: invalid RFC3339".to_string()),
        "Binary" => {
            let b64 = v
                .get("base64")
                .and_then(Value::as_str)
                .ok_or("Binary: missing base64")?;
            let sub = v
                .get("subType")
                .and_then(Value::as_u64)
                .ok_or("Binary: missing subType")? as u8;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| e.to_string())?;
            Ok(Bson::Binary(Binary {
                subtype: BinarySubtype::from(sub),
                bytes,
            }))
        }
        "RegExp" => {
            let pattern = v
                .get("pattern")
                .and_then(Value::as_str)
                .ok_or("RegExp: missing pattern")?;
            let options = v.get("options").and_then(Value::as_str).unwrap_or("");
            Ok(Bson::RegularExpression(Regex {
                pattern: pattern.into(),
                options: options.into(),
            }))
        }
        "Timestamp" => {
            let t = v
                .get("t")
                .and_then(Value::as_u64)
                .ok_or("Timestamp: missing t")? as u32;
            let i = v
                .get("i")
                .and_then(Value::as_u64)
                .ok_or("Timestamp: missing i")? as u32;
            Ok(Bson::Timestamp(Timestamp { time: t, increment: i }))
        }
        "JavaScript" => v
            .as_str()
            .map(|s| Bson::JavaScriptCode(s.to_string()))
            .ok_or_else(|| "JavaScript: expected string".to_string()),
        "Symbol" => v
            .as_str()
            .map(|s| Bson::Symbol(s.to_string()))
            .ok_or_else(|| "Symbol: expected string".to_string()),
        "Undefined" => Ok(Bson::Undefined),
        "MinKey" => Ok(Bson::MinKey),
        "MaxKey" => Ok(Bson::MaxKey),
        "JavaScriptWithScope" | "DbPointer" => Err(format!("{tag}: read-only type, cannot write")),
        other => Err(format!("Unknown type tag: {other}")),
    }
}

#[derive(Debug, Default, Deserialize)]
pub struct DocUpdateOps {
    #[serde(default)]
    pub set: Map<String, Value>,
    #[serde(default)]
    pub unset: Vec<String>,
    #[serde(default)]
    pub rename: std::collections::HashMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionPage {
    pub documents: Vec<Value>,
    pub total: i64,
}

pub async fn collection_page(
    client: &Client,
    db: &str,
    collection: &str,
    page: i64,
    page_size: i64,
) -> Result<CollectionPage, String> {
    let coll = client.database(db).collection::<Document>(collection);
    let page_size = page_size.clamp(1, 1000);
    let skip = (page.max(0) * page_size) as u64;

    let total = coll
        .count_documents(doc! {})
        .await
        .map_err(|e| e.to_string())? as i64;
    let mut cursor = coll
        .find(doc! {})
        .skip(skip)
        .limit(page_size)
        .await
        .map_err(|e| e.to_string())?;

    let mut documents = Vec::new();
    while let Some(d) = cursor.try_next().await.map_err(|e| e.to_string())? {
        documents.push(bson_to_json(&Bson::Document(d)));
    }
    Ok(CollectionPage { documents, total })
}

/// Applies a `$set`/`$unset`/`$rename` update to exactly one document,
/// identified by its (unchanging) `_id`. Unlike MySQL rows, Mongo documents
/// always have a natural single-field key, so no primary-key-discovery
/// fallback is needed.
pub async fn update_document(
    client: &Client,
    db: &str,
    collection: &str,
    doc_id: &Value,
    ops: &DocUpdateOps,
) -> Result<(), String> {
    if ops.set.is_empty() && ops.unset.is_empty() && ops.rename.is_empty() {
        return Ok(());
    }
    let coll = client.database(db).collection::<Document>(collection);
    let filter = doc! { "_id": json_to_bson(doc_id)? };

    let mut set_doc = Document::new();
    for (path, v) in &ops.set {
        set_doc.insert(path.clone(), json_to_bson(v)?);
    }
    let mut unset_doc = Document::new();
    for path in &ops.unset {
        unset_doc.insert(path.clone(), Bson::Int32(1));
    }
    let mut rename_doc = Document::new();
    for (old, new) in &ops.rename {
        rename_doc.insert(old.clone(), Bson::String(new.clone()));
    }

    let mut update = Document::new();
    if !set_doc.is_empty() {
        update.insert("$set", set_doc);
    }
    if !unset_doc.is_empty() {
        update.insert("$unset", unset_doc);
    }
    if !rename_doc.is_empty() {
        update.insert("$rename", rename_doc);
    }

    let result = coll
        .update_one(filter, update)
        .await
        .map_err(|e| e.to_string())?;
    if result.matched_count != 1 {
        return Err(format!(
            "Expected to match exactly 1 document, matched {}",
            result.matched_count
        ));
    }
    Ok(())
}
