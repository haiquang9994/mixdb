use std::collections::HashMap;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

/// What a client has to be built for. Neither can be changed after the client exists, and both
/// vary per request — so there is a client per combination rather than one for the app.
///
/// `(follow_redirects, accept_invalid_certs)`.
pub type ClientKey = (bool, bool);

/// Blocking locks rather than async ones: nothing is awaited while either is held. The client is
/// cloned out and the map released before anything is sent — a `reqwest::Client` is an `Arc`
/// inside, so cloning it shares the connection pool rather than copying it.
#[derive(Default)]
pub struct RestState {
    /// Kept and reused, which is what makes the second request to a host skip the TLS handshake.
    pub clients: Mutex<HashMap<ClientKey, reqwest::Client>>,
    /// Every send in flight, by the id it was given. Cancelling is looking one up and telling it.
    pub inflight: Mutex<HashMap<String, CancellationToken>>,
}
