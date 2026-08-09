use crate::models::ConnectionConfig;
use std::collections::HashMap;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

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
    /// Keeps the SSH port-forward task alive; aborted on disconnect/drop.
    pub tunnel: Option<JoinHandle<()>>,
}

impl Drop for ActiveConnection {
    fn drop(&mut self) {
        if let Some(task) = &self.tunnel {
            task.abort();
        }
    }
}

#[derive(Default)]
pub struct AppState {
    pub connections: Mutex<HashMap<String, ActiveConnection>>,
}
