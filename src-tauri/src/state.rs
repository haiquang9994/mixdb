use crate::models::ConnectionConfig;
use crate::ssh::Tunnel;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// A live connection to one server, in the form its driver hands out.
///
/// Cloning one is cheap by construction — a pool, a driver client, or an `Arc` — because that is
/// how a command gets hold of a connection without holding the connection map while it runs: see
/// `commands::handle`.
#[derive(Clone)]
pub enum DbHandle {
    /// The pool, and whether the server it reaches is MariaDB rather than MySQL. The flavour
    /// travels with the pool because it is a property of that one server and is read once, when
    /// the connection is opened — see `db::mysql::detect_mariadb`.
    Mysql {
        pool: sqlx::MySqlPool,
        mariadb: bool,
    },
    /// One pool per database rather than one for the server: a PostgreSQL connection is bound to
    /// the database it was opened on, so selecting another in the sidebar dials again. Behind an
    /// `Arc` because the set of them grows as databases are opened — see `db::postgres::Pools`.
    Postgres(Arc<crate::db::postgres::Pools>),
    Mongo(mongodb::Client),
    /// Behind a lock of its own: unlike the others, a Redis connection is used through `&mut`,
    /// and selecting a database replaces it outright.
    Redis(Arc<Mutex<crate::db::redis::Connection>>),
}

pub struct ActiveConnection {
    pub handle: DbHandle,
    /// What the connection was opened with. Kept because the dump and restore tools dial the
    /// server themselves rather than borrowing the pool, and so need the credentials again.
    pub config: ConnectionConfig,
    /// The address actually dialed: the tunnel's local end when there is one, and the configured
    /// host and port when there is not. `None` for a MongoDB connection with no tunnel, whose
    /// address is whatever its URI says.
    pub endpoint: Option<(String, u16)>,
    /// Keeps the SSH port forward open. Never read, and not meant to be: holding it here is the
    /// whole point, since dropping this connection drops the tunnel with it and that is what tears
    /// the forward down — see {@link Tunnel}.
    #[allow(dead_code)]
    pub tunnel: Option<Tunnel>,
}

#[derive(Default)]
pub struct AppState {
    /// Every open connection, by the id handed to the frontend.
    ///
    /// The lock guards the map and nothing else. It is taken to look a connection up and released
    /// again before anything is run on what was found — a query awaited while holding it would
    /// stop every other command in the app, in every tab, for as long as it took.
    pub connections: Mutex<HashMap<String, ActiveConnection>>,
    /// The server-side id of the session each connection is running a script on, while it runs
    /// one — MySQL's thread id, or PostgreSQL's backend pid. It is what `KILL QUERY` and
    /// `pg_cancel_backend` name, and so the only thing that lets the Cancel button reach a
    /// statement already in flight.
    ///
    /// A blocking lock rather than an async one: nothing is awaited while it is held, and it has
    /// to be usable from the plain closure `mysql_script::run` announces the id through.
    pub running_queries: std::sync::Mutex<HashMap<String, u64>>,
}
