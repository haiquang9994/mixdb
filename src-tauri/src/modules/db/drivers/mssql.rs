//! SQL Server, over TDS rather than through sqlx — see
//! `docs/superpowers/specs/2026-09-05-mssql-support-design.md` (D1..D15).
//!
//! Closest to `postgres.rs` in shape, since both put a schema between the database and its tables
//! and so name a table `schema.table`; closest to `mysql.rs` in connection model, since both reach
//! every database of the server over one pool rather than dialing again per database.

use crate::error::AppError;
use crate::modules::db::models::ServerInfo;
use deadpool::managed::{Manager as ManagerTrait, Metrics, Pool as DeadPool, RecycleError, RecycleResult};
use tiberius::{AuthMethod, Client, Config, EncryptionLevel};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

/// The schema whose tables are named without a prefix, here and in the sidebar. `dbo` is the
/// default schema every new user is given, so it plays the part `public` plays on PostgreSQL: its
/// tables are also what an unqualified name in a query means.
pub const DEFAULT_SCHEMA: &str = "dbo";

/// Brackets an identifier for interpolation into SQL text, doubling an embedded closing bracket —
/// SQL Server's own escaping rule.
///
/// The one engine here whose quote is not a single symmetric character: `[` opens and `]` closes,
/// and only `]` is escaped. An opening bracket inside a name means nothing, because the name is
/// already open by the time it is read.
pub(super) fn quote_ident(ident: &str) -> String {
    format!("[{}]", ident.replace(']', "]]"))
}

/// How a table is named everywhere outside this module: in the sidebar, in the frontend's state,
/// and back down in every command that takes a table.
///
/// A table in `dbo` is named by itself, since that is the schema an unqualified name already
/// resolves to — so a database that only uses `dbo`, which is most of them, reads exactly as a
/// MySQL one does. Anything else carries its schema.
///
/// The bracketing is what makes this reversible by [`resolve`]: a name holding a `.` or a `]`
/// would otherwise render to something that reads as a different pair.
pub fn qualify(schema: &str, table: &str) -> String {
    let table = if needs_quoting(table) {
        quote_ident(table)
    } else {
        table.to_string()
    };
    if schema == DEFAULT_SCHEMA {
        return table;
    }
    let schema = if needs_quoting(schema) {
        quote_ident(schema)
    } else {
        schema.to_string()
    };
    format!("{schema}.{table}")
}

/// Whether a name would be misread if it were written plainly — the characters [`qualify`] builds
/// its result out of.
fn needs_quoting(name: &str) -> bool {
    name.contains('.') || name.contains(']') || name.contains('[')
}

/// The schema and table a [`qualify`]ed name stands for. An unqualified name is a table of
/// [`DEFAULT_SCHEMA`], which is what `qualify` leaves the prefix off for.
///
/// Nothing calls this yet: the commands that take a table name — reading a page, reading a
/// structure — arrive with the reads in Plan 2. It is written and tested here rather than there
/// because it is the half of [`qualify`] that proves `qualify` reversible, and a round-trip test
/// needs both halves in one place.
#[allow(dead_code)]
pub fn resolve(qualified: &str) -> (String, String) {
    let (schema, table) = split_qualified(qualified);
    (unquote_ident(schema), unquote_ident(table))
}

/// Splits at the dot that separates the two halves, leaving both still bracketed as they were. A
/// bracketed first half is scanned to its closing bracket first, so a dot inside it is not the
/// split.
///
/// Unlike PostgreSQL's, this cannot toggle a flag on one character: `[` and `]` are different, and
/// a doubled `]]` inside a name is an escaped bracket rather than a close followed by an open.
fn split_qualified(qualified: &str) -> (&str, &str) {
    let bytes = qualified.as_bytes();
    let mut i = 0;
    let mut bracketed = false;
    while i < bytes.len() {
        match bytes[i] {
            b'[' if !bracketed => bracketed = true,
            b']' if bracketed => {
                // A doubled `]` is an escaped bracket, still inside the name.
                if bytes.get(i + 1) == Some(&b']') {
                    i += 2;
                    continue;
                }
                bracketed = false;
            }
            b'.' if !bracketed => return (&qualified[..i], &qualified[i + 1..]),
            _ => {}
        }
        i += 1;
    }
    (DEFAULT_SCHEMA, qualified)
}

/// Takes the brackets off an identifier that carries them, undoubling what is inside.
fn unquote_ident(ident: &str) -> String {
    let trimmed = ident.trim();
    match trimmed.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
        Some(inner) => inner.replace("]]", "]"),
        None => trimmed.to_string(),
    }
}

/// One TDS connection, as the rest of this file uses it.
///
/// `Compat` because tiberius reads and writes through the `futures` traits while tokio has its
/// own: the wrapper is the whole of the adaptation, and `tokio-util`'s `compat` feature is carried
/// for it.
pub type Connection = Client<Compat<TcpStream>>;

/// What a whole SQL Server connection is.
///
/// One pool for the server, not one per database — a TDS session moves between databases with
/// `USE` or a three-part name, the way MySQL can and PostgreSQL cannot. So `database` in every
/// command below names a database to reach into, never a pool to pick (D2).
pub type Pool = DeadPool<Manager>;

/// What the pool opens a connection with. Holds the whole `Config` rather than the parts, since a
/// tiberius connection is built from one.
pub struct Manager {
    config: Config,
}

impl ManagerTrait for Manager {
    type Type = Connection;
    type Error = AppError;

    async fn create(&self) -> Result<Connection, AppError> {
        dial(&self.config).await
    }

    /// A pooled connection is handed back only if it still answers. `SELECT 1` is the cheapest
    /// thing that proves a TDS session is alive; one that fails is dropped and a fresh connection
    /// dialed, which is what makes a tunnel that went down and came back usable again without
    /// reconnecting the whole thing by hand.
    async fn recycle(&self, client: &mut Connection, _: &Metrics) -> RecycleResult<AppError> {
        client
            .simple_query("SELECT 1")
            .await
            .map_err(|e| RecycleError::Backend(map_error(e)))?;
        Ok(())
    }
}

/// Opens one connection and settles the session-wide setting every read below depends on.
async fn dial(config: &Config) -> Result<Connection, AppError> {
    let tcp = TcpStream::connect(config.get_addr())
        .await
        .map_err(|e| err!("error.mssql", message = e))?;
    // Nagle off: TDS is request/response, and holding a small request back behind a 40ms timer is
    // the wrong trade for every query this app sends.
    tcp.set_nodelay(true).ok();
    let mut client = Client::connect(config.clone(), tcp.compat_write())
        .await
        .map_err(map_error)?;

    /* Waiting forever on a lock is the one way SQL Server can hang this app that the other three
       engines cannot: its default READ COMMITTED takes locks rather than reading a snapshot, so a
       table someone else is mid-transaction on blocks a plain SELECT with no error and no timeout
       — a spinner that never stops. Five seconds is long enough for a short transaction to pass
       and short enough that the user reads it as a failure rather than a freeze. See D13. */
    client
        .simple_query("SET LOCK_TIMEOUT 5000")
        .await
        .map_err(map_error)?;
    Ok(client)
}

/// Turns a driver error into one the frontend can show, keeping the server's own words — the
/// counterpart of `postgres::map_error`.
pub(super) fn map_error(e: tiberius::error::Error) -> AppError {
    err!("error.mssql", message = e)
}

/// Dials the server and hands back a pool that reaches every database on it.
///
/// `database` is the one a session starts on, and unlike PostgreSQL that is all it is: a command
/// naming another database reaches it over the same pool. Left empty, the server's own default for
/// the login stands, which is what every other SQL Server client does too.
pub async fn connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: Option<&str>,
    use_ssl: Option<bool>,
) -> Result<Pool, AppError> {
    let mut config = Config::new();
    config.host(host);
    config.port(port);
    config.authentication(AuthMethod::sql_server(username, password));
    if let Some(database) = database.map(str::trim).filter(|d| !d.is_empty()) {
        config.database(database);
    }

    /* Read tiberius' own words for these two rather than the names: `Off` is *"only use encryption
       for the login procedure"*, not "no encryption at all" — that one is `NotSupported`. Which is
       exactly the shape SQL Server has and the other two engines do not: the login packet is
       encrypted whatever the server's TLS setting says, so "try TLS, else plaintext" is not the
       clean binary `PgSslMode::Prefer` is. So the box off means `Off` — the login still protected,
       nothing beyond it — and the box on means `Required`. See D6. */
    config.encryption(if use_ssl == Some(false) {
        EncryptionLevel::Off
    } else {
        EncryptionLevel::Required
    });
    /* A self-signed certificate is what a self-installed SQL Server has, and refusing it would
       make the app unable to reach the servers it is most often pointed at. So the TLS box here
       means "encrypt", not "encrypt and verify the chain" — worth saying, because it is a real
       difference from what the same box means on MySQL and PostgreSQL (D6). */
    config.trust_cert();

    let pool = Pool::builder(Manager { config })
        .max_size(8)
        .build()
        .map_err(|e| err!("error.mssql", message = e))?;
    // Dial once here rather than on the first command: a wrong host or password should fail the
    // Connect button, not the first table the user opens. The connection goes straight back to the
    // pool — it is the dialing that was the point, not the object.
    drop(pool.get().await.map_err(|e| err!("error.mssql", message = e))?);
    Ok(pool)
}

/// The server's version and the machine under it, for the header.
///
/// `SERVERPROPERTY` rather than cutting the version out of `@@VERSION`, which is the
/// obvious-looking way and the wrong one: `@@VERSION` is localised to the language the server was
/// installed in, so looking for English words in it gives an empty header on any server that is
/// not English. `SERVERPROPERTY` answers in numbers whatever the language.
///
/// `@@VERSION` is still read, for the operating system alone — its tail, after " on ", is the one
/// part `SERVERPROPERTY` has no equivalent for. It failing leaves `os` empty rather than failing
/// the command: a header without the machine is still a header.
pub async fn server_info(pool: &Pool) -> Result<ServerInfo, AppError> {
    let mut client = pool
        .get()
        .await
        .map_err(|e| err!("error.mssql", message = e))?;

    let row = client
        .query(
            "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)),
                    CAST(SERVERPROPERTY('Edition') AS nvarchar(128))",
            &[],
        )
        .await
        .map_err(map_error)?
        .into_row()
        .await
        .map_err(map_error)?
        .ok_or_else(|| err!("error.mssql", message = "the server reported no version"))?;

    let product: &str = row.get(0).unwrap_or_default();
    let edition: &str = row.get(1).unwrap_or_default();
    let version = if edition.is_empty() {
        product.to_string()
    } else {
        format!("{product} ({edition})")
    };

    let os = match client.query("SELECT @@VERSION", &[]).await {
        Ok(stream) => stream
            .into_row()
            .await
            .ok()
            .flatten()
            .and_then(|row| row.get::<&str, _>(0).map(str::to_string))
            .and_then(|banner| banner.split(" on ").nth(1).map(|tail| tail.trim().to_string()))
            .unwrap_or_default(),
        Err(_) => String::new(),
    };

    Ok(ServerInfo { version, os })
}

/// Every database on the server this login can actually open, the server's own left out.
///
/// Three conditions, and the third is the one that is easy to leave off and impossible to notice
/// while testing as `sa`:
///
/// * `database_id > 4` drops `master`, `tempdb`, `model` and `msdb`, which the server rebuilds
///   from its own files and which nobody browsing their data wants to see.
/// * `state = 0` drops one that is offline, restoring, or otherwise not readable.
/// * `HAS_DBACCESS(name) = 1` drops the ones this login has no rights to. Without it an ordinary
///   login sees a database in the sidebar and is told "The server principal is not able to access
///   the database" the moment it clicks — `sa` sees everything, so the bug hides during testing.
pub async fn list_databases(pool: &Pool) -> Result<Vec<String>, AppError> {
    let mut client = pool
        .get()
        .await
        .map_err(|e| err!("error.mssql", message = e))?;
    let rows = client
        .query(
            "SELECT name FROM sys.databases
             WHERE database_id > 4 AND state = 0 AND HAS_DBACCESS(name) = 1
             ORDER BY name",
            &[],
        )
        .await
        .map_err(map_error)?
        .into_first_result()
        .await
        .map_err(map_error)?;

    Ok(rows
        .iter()
        .filter_map(|row| row.get::<&str, _>(0).map(str::to_string))
        .collect())
}

/// Every table and view of `database`, across every schema, named as [`qualify`] names them.
///
/// Views as well as tables, because `postgres::list_tables` lists both and the sidebar is one list
/// whichever server filled it. That is why this reads `sys.objects` filtered to `U` and `V` rather
/// than `sys.tables`, which holds no views at all.
///
/// `dbo` first and the other schemas after it, alphabetically — so the tables of the schema that
/// needs no prefix are together at the top, the way they are on PostgreSQL. No system-schema
/// filter is needed: `sys.objects` in a user database holds that user's own objects.
///
/// The database is written into the query as a three-part name rather than reached with a `USE`,
/// since the pooled session may be sitting on any database at all (D2) and a `USE` would leave it
/// somewhere else for the next borrower.
pub async fn list_tables(pool: &Pool, database: &str) -> Result<Vec<String>, AppError> {
    let mut client = pool
        .get()
        .await
        .map_err(|e| err!("error.mssql", message = e))?;
    let db = quote_ident(database);
    let sql = format!(
        "SELECT s.name, o.name
         FROM {db}.sys.objects o
         JOIN {db}.sys.schemas s ON s.schema_id = o.schema_id
         WHERE o.type IN ('U', 'V')
         ORDER BY CASE WHEN s.name = '{DEFAULT_SCHEMA}' THEN 0 ELSE 1 END, s.name, o.name"
    );
    let rows = client
        .query(sql, &[])
        .await
        .map_err(map_error)?
        .into_first_result()
        .await
        .map_err(map_error)?;

    Ok(rows
        .iter()
        .filter_map(|row| {
            let schema: &str = row.get(0)?;
            let table: &str = row.get(1)?;
            Some(qualify(schema, table))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{qualify, quote_ident, resolve};

    /// SQL Server brackets an identifier rather than quoting it, and the character doubled inside
    /// is the *closing* bracket — the one asymmetry no other engine here has.
    #[test]
    fn an_identifier_is_bracketed_and_its_closing_bracket_doubled() {
        assert_eq!(quote_ident("users"), "[users]");
        assert_eq!(quote_ident("Order Details"), "[Order Details]");
        assert_eq!(quote_ident("a]b"), "[a]]b]");
        // An opening bracket needs no escape: it only opens inside a name that is already open.
        assert_eq!(quote_ident("a[b"), "[a[b]");
    }

    /// A table of `dbo` reads bare, the way a table of `public` does on PostgreSQL — that is what
    /// keeps a database using only the default schema looking the same as a MySQL one.
    #[test]
    fn a_dbo_table_is_named_without_its_schema() {
        assert_eq!(qualify("dbo", "users"), "users");
        assert_eq!(qualify("sales", "orders"), "sales.orders");
    }

    /// Only a name that would be misread gets brackets, so the common case stays readable.
    #[test]
    fn only_a_name_that_would_be_misread_is_bracketed() {
        assert_eq!(qualify("dbo", "a.b"), "[a.b]");
        assert_eq!(qualify("dbo", "a]b"), "[a]]b]");
        assert_eq!(qualify("sa les", "orders"), "sa les.orders");
    }

    /// `resolve` is `qualify` backwards: whatever the sidebar shows has to name the same table
    /// again when it comes back down.
    #[test]
    fn resolve_undoes_qualify() {
        for (schema, table) in [
            ("dbo", "users"),
            ("sales", "orders"),
            ("dbo", "a.b"),
            ("dbo", "a]b"),
            ("we ird", "a.b"),
        ] {
            let round_tripped = resolve(&qualify(schema, table));
            assert_eq!(round_tripped, (schema.to_string(), table.to_string()));
        }
    }
}
