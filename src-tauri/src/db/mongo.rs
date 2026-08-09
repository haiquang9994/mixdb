use super::filters::{split_list_parts, unquote, ListItem};
use base64::Engine;
use futures_util::TryStreamExt;
use mongodb::bson::spec::BinarySubtype;
use mongodb::bson::{
    doc, oid::ObjectId, Binary, Bson, DateTime as BsonDateTime, Decimal128, Document, Regex,
    Timestamp,
};
use mongodb::options::{ClientOptions, ServerAddress};
use mongodb::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::str::FromStr;

/// The first host a connection string points at. A tunnel needs a concrete address to forward
/// to, and with a URI that address is only knowable after parsing â€” a `mongodb+srv://` string
/// doesn't even contain it literally, it resolves to its hosts over DNS during the parse.
pub async fn first_endpoint(uri: &str) -> Result<(String, u16), String> {
    let opts = ClientOptions::parse(uri).await.map_err(|e| e.to_string())?;
    match opts.hosts.first() {
        Some(ServerAddress::Tcp { host, port }) => Ok((host.clone(), port.unwrap_or(27017))),
        _ => Err("Connection string names no TCP host to tunnel to".to_string()),
    }
}

/// `endpoint`, when given, replaces the host the URI names: an SSH tunnel listens on a local
/// port, so the address written in the connection string is no longer the one to dial.
pub async fn connect(uri: &str, endpoint: Option<(String, u16)>) -> Result<Client, String> {
    let mut opts = ClientOptions::parse(uri).await.map_err(|e| e.to_string())?;
    opts.app_name = Some("MixDB".to_string());
    if let Some((host, port)) = endpoint {
        opts.hosts = vec![ServerAddress::Tcp { host, port: Some(port) }];
        // Only that one host is forwarded, so topology discovery would hand back the replica
        // set's own addresses â€” unreachable from this machine. Talk to the tunneled node
        // directly instead.
        opts.direct_connection = Some(true);
        opts.repl_set_name = None;
    }
    let client = Client::with_options(opts).map_err(|e| e.to_string())?;
    // Fail fast on bad credentials/host instead of only failing on first query.
    client
        .database("admin")
        .run_command(doc! { "ping": 1 })
        .await
        .map_err(|e| e.to_string())?;
    Ok(client)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub version: String,
    pub os: String,
}

/// Reads what the header shows about the server. `hostInfo` describes the machine the
/// server actually runs on â€” distribution, release and architecture, the same detail Redis
/// reports â€” but it needs a privilege managed deployments often withhold, so a server that
/// refuses it falls back to `buildInfo`, which only knows what the server was built for.
pub async fn server_info(client: &Client) -> Result<ServerInfo, String> {
    let admin = client.database("admin");
    let build = admin
        .run_command(doc! { "buildInfo": 1 })
        .await
        .map_err(|e| e.to_string())?;

    let version = build.get_str("version").unwrap_or_default().to_string();
    let os = admin
        .run_command(doc! { "hostInfo": 1 })
        .await
        .ok()
        .and_then(|host| host_os(&host))
        .unwrap_or_else(|| build_os(&build));

    Ok(ServerInfo { version, os })
}

/// "Ubuntu 22.04 x86_64" out of `hostInfo`. Every part is optional, and a reply naming none
/// of them counts as no answer at all so the build environment can still fill the gap.
fn host_os(info: &Document) -> Option<String> {
    let os = info.get_document("os").ok();
    let parts: Vec<&str> = [
        os.and_then(|os| os.get_str("name").ok()),
        os.and_then(|os| os.get_str("version").ok()),
        info.get_document("system")
            .ok()
            .and_then(|system| system.get_str("cpuArch").ok()),
    ]
    .into_iter()
    .flatten()
    .filter(|part| !part.is_empty())
    .collect();

    (!parts.is_empty()).then(|| parts.join(" "))
}

/// The OS the server was built for, out of `buildInfo` â€” "linux x86_64". The same pair MySQL
/// reports as `version_compile_os` and `version_compile_machine`.
fn build_os(info: &Document) -> String {
    let env = info.get_document("buildEnvironment").ok();
    let parts: Vec<&str> = [
        env.and_then(|env| env.get_str("target_os").ok()),
        env.and_then(|env| env.get_str("target_arch").ok()),
    ]
    .into_iter()
    .flatten()
    .filter(|part| !part.is_empty())
    .collect();

    parts.join(" ")
}

pub async fn list_databases(client: &Client) -> Result<Vec<String>, String> {
    client.list_database_names().await.map_err(|e| e.to_string())
}

pub async fn list_collections(client: &Client, db: &str) -> Result<Vec<String>, String> {
    let mut names = client
        .database(db)
        .list_collection_names()
        .await
        .map_err(|e| e.to_string())?;
    names.sort_by(|a, b| {
        a.to_lowercase()
            .cmp(&b.to_lowercase())
            .then_with(|| a.cmp(b))
    });
    Ok(names)
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
/// are never wrapped â€” the frontend tells them apart from typed scalars by
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
        // Always three fractional digits, the way JS `toISOString()` writes them. RFC3339 lets a
        // whole-second instant drop the fraction entirely, and that shorter spelling round-trips
        // through the editor as a different string, making an untouched date look edited.
        Bson::DateTime(dt) => wrap(
            "Date",
            json!(chrono::DateTime::from_timestamp_millis(dt.timestamp_millis())
                .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
                .unwrap_or_else(|| dt.timestamp_millis().to_string())),
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
        // DbPointer's fields are pub(crate) in the bson crate â€” there is no
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

/// One condition on the documents a page is cut out of â€” the list's filter bar sends a list of
/// these, and they are ANDed together. `field` is a field path, dotted to reach into a
/// subdocument, and is spelled `column` on the wire so the bar can send the same shape whichever
/// database is behind it. `value` carries whatever the user typed, as text: the operator is what
/// says how to read it (a single value, a comma-separated list, a pair), and operators like
/// `exists` ignore it entirely.
#[derive(Debug, Deserialize)]
pub struct Filter {
    #[serde(rename = "column")]
    pub field: String,
    pub operator: String,
    #[serde(default)]
    pub value: Option<String>,
}

/// Escapes the metacharacters out of text that is about to become part of a regex, so a value
/// with a `.` or a `*` in it is matched as itself. Only for the operators that build the pattern
/// (contains/starts with/ends with) â€” `regexp` hands the user's own pattern through untouched.
fn escape_regex(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        if "\\^$.|?*+()[]{}/".contains(ch) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Reads the user's own regex out of the text box. `/pattern/flags` is understood â€” it is how a
/// regex is written everywhere else, and the only way to ask for one of Mongo's flags from a
/// single box â€” and anything else is taken as a bare pattern. Unknown flags are dropped rather
/// than passed on, so a `g` carried over from JavaScript habit doesn't have the server reject the
/// whole query.
fn parse_regex(raw: &str) -> Regex {
    if let Some(rest) = raw.strip_prefix('/') {
        if let Some(end) = rest.rfind('/') {
            let (pattern, flags) = rest.split_at(end);
            return Regex {
                pattern: pattern.to_string(),
                options: flags[1..].chars().filter(|c| "imsxu".contains(*c)).collect(),
            };
        }
    }
    Regex {
        pattern: raw.to_string(),
        options: String::new(),
    }
}

/// Reads a BSON value out of the text a filter row holds.
///
/// This is the one thing a Mongo filter has to do that a SQL one doesn't. MySQL takes every value
/// as a bound string and coerces it against the column's own type; Mongo has no column type to
/// coerce against, and matches by exact BSON type â€” `{_id: "5"}` finds nothing in a collection
/// keyed by the number 5, and nothing at all in one keyed by ObjectIds. So the text is read for
/// what it looks like:
///
/// - `null`, `true`, `false` â€” those three values
/// - a whole number, else a decimal one
/// - 24 hex characters â€” an ObjectId, which is what `_id` usually holds
/// - an RFC 3339 timestamp â€” a date
/// - anything else â€” a string
///
/// Wrapping the value in quotes (`'5'`) turns all of that off and takes what is inside them as a
/// string, which is the way to reach a field that really does hold `"5"` as text.
fn parse_value(raw: &str) -> Bson {
    if let Some(text) = unquote(raw) {
        return Bson::String(text.to_string());
    }
    let trimmed = raw.trim();
    match trimmed {
        "null" => return Bson::Null,
        "true" => return Bson::Boolean(true),
        "false" => return Bson::Boolean(false),
        _ => {}
    }
    // A number has to have a digit in it: `inf` and `NaN` parse as f64, and nobody typing either
    // one into a filter box means the floating-point value.
    if trimmed.chars().any(|c| c.is_ascii_digit()) {
        if let Ok(i) = trimmed.parse::<i64>() {
            return match i32::try_from(i) {
                Ok(small) => Bson::Int32(small),
                Err(_) => Bson::Int64(i),
            };
        }
        if let Ok(f) = trimmed.parse::<f64>() {
            return Bson::Double(f);
        }
    }
    if trimmed.len() == 24 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        if let Ok(oid) = ObjectId::from_str(trimmed) {
            return Bson::ObjectId(oid);
        }
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(trimmed) {
        return Bson::DateTime(BsonDateTime::from_millis(dt.timestamp_millis()));
    }
    // As typed, not trimmed: a value that reached here is text, and the spaces around text are
    // part of it. The quoted form is there for when that is not what was meant.
    Bson::String(raw.to_string())
}

/// {@link parse_value} for one item of an `IN`/`BETWEEN` list, whose quotes were already taken
/// off during the split â€” the flag is all that is left of them.
fn parse_item(item: &ListItem) -> Bson {
    if item.quoted {
        Bson::String(item.text.clone())
    } else {
        parse_value(&item.text)
    }
}

/// Turns the filter rows into the query document the page is read through â€” one clause per row,
/// gathered under `$and` so that two conditions on the same field both survive (an object can
/// only hold one entry per key, and `{age: {...}, age: {...}}` would silently be one of them).
///
/// A row whose operator wants a value it wasn't given is dropped rather than matched literally:
/// the bar's opening `_id =` row must not become `{_id: ""}` before anything is typed into it.
fn build_filter(filters: &[Filter]) -> Result<Document, String> {
    let mut clauses: Vec<Document> = Vec::new();

    for filter in filters {
        let field = filter.field.trim();
        if field.is_empty() {
            continue;
        }
        // A leading `$` would make the field name read as a query operator, which is not a
        // document this bar has any way to mean.
        if field.starts_with('$') {
            return Err(format!("Invalid filter field `{field}`"));
        }
        let raw = filter.value.as_deref().unwrap_or("");
        let operator = filter.operator.as_str();

        let condition: Bson = match operator {
            "eq" => doc! { "$eq": parse_value(raw) }.into(),
            "ne" => doc! { "$ne": parse_value(raw) }.into(),
            "gt" => doc! { "$gt": parse_value(raw) }.into(),
            "gte" => doc! { "$gte": parse_value(raw) }.into(),
            "lt" => doc! { "$lt": parse_value(raw) }.into(),
            "lte" => doc! { "$lte": parse_value(raw) }.into(),
            // Case-insensitive on purpose, so these read the same way as their SQL counterparts:
            // MySQL's default collation makes LIKE case-insensitive, and a filter bar that
            // matched differently depending on the workspace would be a trap. `regexp` below is
            // exempt â€” the user writing the pattern is the one who decides.
            "contains" | "notContains" | "startsWith" | "endsWith" => {
                let escaped = escape_regex(raw);
                let pattern = match operator {
                    "startsWith" => format!("^{escaped}"),
                    "endsWith" => format!("{escaped}$"),
                    _ => escaped,
                };
                let regex = Bson::RegularExpression(Regex {
                    pattern,
                    options: "i".to_string(),
                });
                if operator == "notContains" {
                    doc! { "$not": regex }.into()
                } else {
                    regex
                }
            }
            "regexp" => Bson::RegularExpression(parse_regex(raw)),
            "notRegexp" => doc! { "$not": Bson::RegularExpression(parse_regex(raw)) }.into(),
            "in" | "notIn" => {
                let items: Vec<Bson> = split_list_parts(raw).iter().map(parse_item).collect();
                if items.is_empty() {
                    continue;
                }
                let key = if operator == "in" { "$in" } else { "$nin" };
                doc! { key: items }.into()
            }
            "between" | "notBetween" => {
                let items = split_list_parts(raw);
                // Two bounds or nothing â€” one of them alone says nothing about a range.
                if items.len() < 2 {
                    continue;
                }
                let range = doc! { "$gte": parse_item(&items[0]), "$lte": parse_item(&items[1]) };
                if operator == "between" {
                    range.into()
                } else {
                    doc! { "$not": range }.into()
                }
            }
            // `$type` takes an alias (`string`, `int`, `date`) or the BSON type number; whichever
            // was typed is passed along, and the server is left to reject a name it doesn't know.
            "type" => {
                let alias = raw.trim();
                let wanted = match alias.parse::<i32>() {
                    Ok(n) => Bson::Int32(n),
                    Err(_) => Bson::String(alias.to_string()),
                };
                doc! { "$type": wanted }.into()
            }
            "exists" => doc! { "$exists": true }.into(),
            "notExists" => doc! { "$exists": false }.into(),
            // `{field: null}` would match the documents missing the field as well, which is the
            // opposite of what a schemaless collection needs to be able to ask.
            "isNull" => doc! { "$type": "null" }.into(),
            "isNotNull" => doc! { "$exists": true, "$not": { "$type": "null" } }.into(),
            "isEmpty" => doc! { "$eq": "" }.into(),
            "isNotEmpty" => doc! { "$exists": true, "$ne": "" }.into(),
            other => return Err(format!("Unknown filter operator `{other}`")),
        };

        let mut clause = Document::new();
        clause.insert(field, condition);
        clauses.push(clause);
    }

    if clauses.is_empty() {
        return Ok(doc! {});
    }
    Ok(doc! { "$and": clauses })
}

/// Reads one page of a collection. `filters` narrows it down first, ANDed together; `total`
/// counts what is left after them, so the pager measures the filtered collection rather than the
/// whole one.
pub async fn collection_page(
    client: &Client,
    db: &str,
    collection: &str,
    page: i64,
    page_size: i64,
    filters: &[Filter],
) -> Result<CollectionPage, String> {
    let coll = client.database(db).collection::<Document>(collection);
    let page_size = page_size.clamp(1, 1000);
    let skip = (page.max(0) * page_size) as u64;
    let query = build_filter(filters)?;

    let total = coll
        .count_documents(query.clone())
        .await
        .map_err(|e| e.to_string())? as i64;
    let mut cursor = coll
        .find(query)
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

/// Ids to prefill the `_id` of `count` new documents with.
///
/// Mongo has no auto-increment to read off: the id of a document that does not exist yet is
/// whatever the writer decides, and what every driver decides â€” including this one, when an
/// insert names no `_id` â€” is a freshly minted ObjectId. So that is the answer here too, and it
/// is a real "next id": an ObjectId leads with its creation timestamp, so the ones handed out
/// now sort after everything already in the collection.
///
/// The exception worth honouring is a collection keyed by numbers. Those are counted by hand
/// somewhere, and the only sensible next value is the highest plus one â€” so the highest `_id`
/// is read first, and its type decides. Anything else (strings, compound keys, an empty
/// collection) falls back to ObjectIds, since no scheme can be inferred from them.
pub async fn next_ids(
    client: &Client,
    db: &str,
    collection: &str,
    count: i64,
) -> Result<Vec<Value>, String> {
    let count = count.clamp(1, 100) as usize;
    let coll = client.database(db).collection::<Document>(collection);
    // Descending `_id` is the highest one under BSON's own type ordering, where every number
    // sorts below every string and ObjectId. In a numerically keyed collection that is exactly
    // the largest number; in a mixed one it is something else, and the fallback takes over.
    let highest = coll
        .find_one(doc! {})
        .sort(doc! { "_id": -1 })
        .projection(doc! { "_id": 1 })
        .await
        .map_err(|e| e.to_string())?
        .and_then(|d| d.get("_id").cloned());

    let ids: Vec<Bson> = match highest {
        Some(Bson::Int32(n)) => (1..=count)
            .map(|i| Bson::Int32(n.saturating_add(i as i32)))
            .collect(),
        Some(Bson::Int64(n)) => (1..=count)
            .map(|i| Bson::Int64(n.saturating_add(i as i64)))
            .collect(),
        Some(Bson::Double(n)) => (1..=count).map(|i| Bson::Double(n + i as f64)).collect(),
        _ => (0..count).map(|_| Bson::ObjectId(ObjectId::new())).collect(),
    };
    Ok(ids.iter().map(bson_to_json).collect())
}

/// Writes new documents into a collection, in the order given.
///
/// Ordered rather than atomic: a transaction needs a replica set, which a standalone server is
/// not, so a failure partway through leaves the documents before it inserted. The caller is
/// expected to refetch the page afterwards â€” on failure as much as on success â€” so what landed
/// is what is on screen.
pub async fn insert_documents(
    client: &Client,
    db: &str,
    collection: &str,
    documents: &[Value],
) -> Result<usize, String> {
    if documents.is_empty() {
        return Ok(0);
    }
    let mut docs = Vec::with_capacity(documents.len());
    for (i, value) in documents.iter().enumerate() {
        // Built field by field rather than through `json_to_bson`, which would read a document
        // whose only keys are `$type` and `$value` as a wrapped scalar rather than as itself.
        let map = value
            .as_object()
            .ok_or_else(|| format!("Document {}: expected an object", i + 1))?;
        let mut d = Document::new();
        for (k, v) in map {
            d.insert(k.clone(), json_to_bson(v).map_err(|e| format!("Document {}: {e}", i + 1))?);
        }
        docs.push(d);
    }

    let coll = client.database(db).collection::<Document>(collection);
    let result = coll.insert_many(docs).await.map_err(|e| e.to_string())?;
    Ok(result.inserted_ids.len())
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

/// Deletes exactly one document, identified by its `_id`.
pub async fn delete_document(
    client: &Client,
    db: &str,
    collection: &str,
    doc_id: &Value,
) -> Result<(), String> {
    let coll = client.database(db).collection::<Document>(collection);
    let filter = doc! { "_id": json_to_bson(doc_id)? };

    let result = coll.delete_one(filter).await.map_err(|e| e.to_string())?;
    if result.deleted_count != 1 {
        return Err(format!(
            "Expected to delete exactly 1 document, deleted {}",
            result.deleted_count
        ));
    }
    Ok(())
}
