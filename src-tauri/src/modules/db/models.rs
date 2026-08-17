use crate::ssh::SshConfig;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    Mysql,
    Postgres,
    Mongo,
    Redis,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub kind: DbKind,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    /// Database name (MySQL/PostgreSQL/Mongo) or numeric DB index as string (Redis).
    ///
    /// PostgreSQL is the one kind this is not merely a starting point for: a connection there is
    /// bound to one database and cannot see into another, so browsing a second one opens a second
    /// pool rather than switching this. Left empty, `postgres` is dialed.
    pub database: Option<String>,
    /// MongoDB only, and the only endpoint it uses: a full `mongodb://` / `mongodb+srv://`
    /// connection string, which carries host, port, credentials and options in one value —
    /// so `host`/`port`/`username`/`password` are ignored for that kind.
    pub uri: Option<String>,
    pub ssh: Option<SshConfig>,
    /// MySQL and PostgreSQL. `None`/`Some(true)` tries SSL and falls back to plaintext
    /// if the server doesn't advertise it; `Some(false)` skips SSL entirely
    /// (useful when already tunneled over SSH, or against servers with SSL
    /// configs too old for any modern TLS backend to negotiate).
    pub use_ssl: Option<bool>,
}
