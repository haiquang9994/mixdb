use crate::models::ConnectionConfig;
use crate::ssh_tunnel::Tunnel;
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
    Mysql(sqlx::MySqlPool),
    Mongo(mongodb::Client),
    /// Behind a lock of its own: unlike the other two, a Redis connection is used through `&mut`,
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
    /// The MySQL session id of the script each connection is running, while it runs one. It is
    /// what `KILL QUERY` names, and so the only thing that lets the Cancel button reach a
    /// statement already in flight.
    ///
    /// A blocking lock rather than an async one: nothing is awaited while it is held, and it has
    /// to be usable from the plain closure `mysql_script::run` announces the id through.
    pub running_queries: std::sync::Mutex<HashMap<String, u64>>,
}
