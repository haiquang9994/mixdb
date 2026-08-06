use futures_util::TryStreamExt;
use mongodb::bson::{doc, Document};
use mongodb::options::ClientOptions;
use mongodb::Client;
use serde_json::Value;

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
