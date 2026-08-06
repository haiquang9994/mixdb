use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    Mysql,
    Mongo,
    Redis,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SshAuth {
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub kind: DbKind,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    /// Database name (MySQL/Mongo) or numeric DB index as string (Redis).
    pub database: Option<String>,
    pub ssh: Option<SshConfig>,
    /// MySQL only. `None`/`Some(true)` tries SSL and falls back to plaintext
    /// if the server doesn't advertise it; `Some(false)` skips SSL entirely
    /// (useful when already tunneled over SSH, or against servers with SSL
    /// configs too old for any modern TLS backend to negotiate).
    pub use_ssl: Option<bool>,
}
