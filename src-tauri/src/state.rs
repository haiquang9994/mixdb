use crate::models::ConnectionConfig;
use crate::ssh_tunnel::Tunnel;
use std::collections::HashMap;
use tokio::sync::Mutex;

pub enum DbHandle {
    Mysql(sqlx::MySqlPool),
    Mongo(mongodb::Client),
    Redis(redis::aio::MultiplexedConnection),
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
    pub connections: Mutex<HashMap<String, ActiveConnection>>,
}
