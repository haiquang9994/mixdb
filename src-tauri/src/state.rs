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
