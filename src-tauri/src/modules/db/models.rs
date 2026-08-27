use crate::ssh::SshConfig;
use serde::{Deserialize, Serialize};
use serde_json::Value;

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

/// What the header shows about a server: its version, and the machine it runs on.
///
/// One struct for all four drivers, which each declared their own. They differ only in how the
/// two strings are found — a MySQL variable, a Mongo `buildInfo`, a Redis `INFO` section — and
/// that difference belongs to the four `server_info` functions, not to the shape they return.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub version: String,
    pub os: String,
}

/// What one statement of a script did.
///
/// Shared by the MySQL and PostgreSQL runners, which reported the same nine fields separately. The
/// two fields that mean different things per server say so here rather than in two copies of the
/// struct — the frontend reads one shape whichever server answered.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementResult {
    /// The statement this came from, as the user wrote it.
    pub statement: String,
    pub verb: String,
    /// How the result is to be read: `rows` for a result set, `affected` for a write that changed
    /// rows, `ok` for a statement whose only outcome is that it succeeded.
    pub kind: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    /// Set when the result set was longer than the runner's cap and the rest was left unread.
    pub truncated: bool,
    pub rows_affected: u64,
    /// The AUTO_INCREMENT value the statement generated, when it generated one.
    ///
    /// Always `None` from PostgreSQL, which has no per-statement generated key to report: a
    /// sequence is asked for `currval()` by name, and an `INSERT` that wants its new row back says
    /// `RETURNING`.
    pub last_insert_id: Option<u64>,
    pub duration_ms: u64,
    pub error: Option<String>,
}

/// Something wrong with a statement, as the checker found it.
///
/// Also shared by the two runners. `number` is MySQL's alone — PostgreSQL identifies an error by a
/// five-character SQLSTATE — but the field stays rather than becoming an enum: the editor draws
/// one squiggle per problem whichever server reported it, and a shape that changed per server
/// would put the difference in the frontend instead of leaving it here.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlProblem {
    /// The server's own words, untranslated — rewording them would only make them harder to
    /// search for.
    pub message: String,
    /// MySQL's error number, e.g. 1064 for a syntax error. Zero when the failure carried none, and
    /// always zero from PostgreSQL.
    pub number: u16,
    /// The 1-based line *within the statement* the server pointed at, when it pointed at one.
    /// PostgreSQL gives a character offset instead, which its runner counts back into a line.
    pub line: Option<u32>,
    /// `error` for text the server cannot parse at all; `warning` for everything else, which is
    /// anything that might only be wrong from where the check is standing.
    pub severity: String,
}
