use crate::error::AppError;
use russh::client::{self};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio::time::timeout;

/// How to prove who you are to the SSH server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SshAuth {
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
}

/// The server to tunnel through. Config of this layer rather than of whatever is at the far end,
/// which is why it lives here and not with any one module's models: a terminal opened over SSH
/// wants the same four fields a tunnelled database connection does.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const CHANNEL_OPEN_TIMEOUT: Duration = Duration::from_secs(10);

/// How much a channel may have in flight before the peer has to wait for the receiver to catch up.
///
/// russh defaults to 2MB, which is less than a distant link holds in flight: at 25MB/s and 100ms
/// of round trip there is 2.5MB in the air at any moment, so the sender spends part of its time
/// stopped, waiting for credit that is still travelling back. A dump is the one thing in the app
/// that runs long enough for that to be worth the memory.
const WINDOW_SIZE: u32 = 8 * 1024 * 1024;

/// The buffer each direction of a forwarded connection copies through.
///
/// 8KB — what this used to read into — is a syscall and a wakeup per 8KB, which caps a forward
/// well below what the link can carry. The cost of the larger buffer is that every connection held
/// open through the tunnel keeps two of these, so it is sized to be past the point of diminishing
/// returns rather than as large as possible.
const BRIDGE_BUFFER: usize = 128 * 1024;

/// Where the fingerprint of every SSH server MixDB has connected to is remembered, keyed by
/// `host:port`. Its own file rather than OpenSSH's `~/.ssh/known_hosts`: that file is the user's,
/// written in a format with its own hashing and wildcard rules, and an app that only ever appends
/// to it has no business rewriting it.
fn known_hosts_file(app_data: &Path) -> PathBuf {
    app_data.join("known_hosts.json")
}

fn load_known_hosts(path: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn remember_host(path: &Path, endpoint: &str, fingerprint: &str) -> Result<(), AppError> {
    let mut known = load_known_hosts(path);
    known.insert(endpoint.to_string(), fingerprint.to_string());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| err!("error.cannotCreateDirectory", path = parent.display(), message = e))?;
    }
    let text = serde_json::to_string_pretty(&known)
        .map_err(|e| err!("error.cannotSaveKnownHost", message = e))?;
    std::fs::write(path, text).map_err(|e| err!("error.cannotSaveKnownHost", message = e))
}

/// A running port forward, torn down as soon as this is dropped.
///
/// The task cannot be held as a bare `JoinHandle`: dropping one of those detaches the task rather
/// than stopping it. Every connection attempt that failed *after* the tunnel came up — a mistyped
/// database password, say — would then leave an authenticated SSH session and a bound local port
/// running for the life of the process, with nothing left holding a handle to either.
pub struct Tunnel {
    task: JoinHandle<()>,
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Checks the server's key against what MixDB saw the last time it connected to this address.
///
/// Trust on first use: a server never seen before is accepted and its fingerprint written down,
/// and from then on a *different* key is refused. That is the half of host-key checking worth
/// having here — the first connection is taken on faith either way, but the tunnel can no longer
/// be quietly stood in front of afterwards, which is the whole reason a database is reached
/// through SSH rather than over the open network.
struct TunnelHandler {
    /// `host:port`, which is what a fingerprint is remembered under.
    endpoint: String,
    known_hosts: PathBuf,
    /// Why the key was refused, kept for the caller: `check_server_key` may only say yes or no,
    /// and "no" reaches the user as russh's own unspecific error otherwise.
    refused: Arc<Mutex<Option<AppError>>>,
}

impl client::Handler for TunnelHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key
            .fingerprint(russh::keys::HashAlg::Sha256)
            .to_string();

        match load_known_hosts(&self.known_hosts).get(&self.endpoint) {
            Some(known) if known == &fingerprint => Ok(true),
            Some(known) => {
                *self.refused.lock().unwrap() = Some(err!(
                    "error.sshHostKeyChanged",
                    endpoint = &self.endpoint,
                    fingerprint = fingerprint,
                    known = known,
                    file = self.known_hosts.display(),
                ));
                Ok(false)
            }
            // First sight of this server: take it on faith, and hold it to that key from now on.
            None => {
                if let Err(e) = remember_host(&self.known_hosts, &self.endpoint, &fingerprint) {
                    *self.refused.lock().unwrap() = Some(e);
                    return Ok(false);
                }
                Ok(true)
            }
        }
    }
}

async fn authenticate(
    ssh: &SshConfig,
    app_data: &Path,
) -> Result<client::Handle<TunnelHandler>, AppError> {
    match timeout(CONNECT_TIMEOUT, authenticate_inner(ssh, app_data)).await {
        Ok(result) => result,
        Err(_) => Err(err!(
            "error.sshTimeout",
            host = &ssh.host,
            port = ssh.port,
            seconds = CONNECT_TIMEOUT.as_secs(),
        )),
    }
}

async fn authenticate_inner(
    ssh: &SshConfig,
    app_data: &Path,
) -> Result<client::Handle<TunnelHandler>, AppError> {
    let config = Arc::new(client::Config {
        // Nagle's algorithm holds a small write back waiting for more to go with it, which is
        // exactly wrong under a forward: what is being delayed is usually a database's reply, and
        // nothing else is coming until the client has seen it. russh leaves it on by default.
        nodelay: true,
        window_size: WINDOW_SIZE,
        ..client::Config::default()
    });
    let refused: Arc<Mutex<Option<AppError>>> = Arc::new(Mutex::new(None));
    let handler = TunnelHandler {
        endpoint: format!("{}:{}", ssh.host, ssh.port),
        known_hosts: known_hosts_file(app_data),
        refused: Arc::clone(&refused),
    };
    let mut session = match client::connect(config, (ssh.host.as_str(), ssh.port), handler).await {
        Ok(session) => session,
        // A refused key fails the handshake, and what russh reports for that says nothing about
        // the key — the reason the handler wrote down is the one worth showing.
        Err(e) => {
            let refused = refused.lock().unwrap().take();
            return Err(refused.unwrap_or_else(|| err!("error.sshConnectFailed", message = e)));
        }
    };

    let authenticated = match &ssh.auth {
        SshAuth::Password { password } => session
            .authenticate_password(&ssh.username, password)
            .await
            .map_err(|e| err!("error.sshAuthFailed", message = e))?,
        SshAuth::PrivateKey { key_path, passphrase } => {
            let key_data = std::fs::read_to_string(key_path)
                .map_err(|e| err!("error.cannotReadPrivateKey", message = e))?;
            let key_pair = russh::keys::decode_secret_key(&key_data, passphrase.as_deref())
                .map_err(|e| err!("error.invalidPrivateKey", message = e))?;
            session
                .authenticate_publickey(
                    &ssh.username,
                    // `None` maps to the legacy `ssh-rsa` (SHA-1) signature for
                    // RSA keys, which most modern servers (OpenSSH >= 8.8)
                    // reject outright. Request SHA-256 instead; russh ignores
                    // this for non-RSA key types.
                    russh::keys::PrivateKeyWithHashAlg::new(
                        Arc::new(key_pair),
                        Some(russh::keys::HashAlg::Sha256),
                    ),
                )
                .await
                .map_err(|e| err!("error.sshAuthFailed", message = e))?
        }
    };

    match authenticated {
        russh::client::AuthResult::Success => Ok(session),
        russh::client::AuthResult::Failure {
            remaining_methods,
            partial_success,
        } => {
            // The most common cause of a "rejected" auth isn't a wrong
            // password, it's that the tried method isn't one the server
            // offers at all (e.g. server only allows keyboard-interactive
            // or publickey). Surfacing what it *does* accept saves a lot of
            // guessing.
            let accepted: Vec<&str> = remaining_methods.iter().map(<&str>::from).collect();
            Err(err!(
                "error.sshAuthRejected",
                partialSuccess = partial_success,
                methods = accepted.join(", "),
            ))
        }
    }
}

/// Authenticates against the SSH server without opening any port forward.
/// Used by the UI's "Test tunnel" action to validate credentials/connectivity
/// independently of the database connection itself.
pub async fn test_connection(ssh: &SshConfig, app_data: &Path) -> Result<(), AppError> {
    let session = authenticate(ssh, app_data).await?;
    let _ = session.disconnect(russh::Disconnect::ByApplication, "", "English").await;
    Ok(())
}

/// Opens an SSH connection and a direct-tcpip channel to (remote_host, remote_port),
/// bridged to a freshly bound local TCP port. Returns the local port to connect to
/// instead of the real database host, plus the {@link Tunnel} keeping the bridge alive —
/// dropping that is what closes the forward again.
pub async fn open_tunnel(
    ssh: &SshConfig,
    remote_host: &str,
    remote_port: u16,
    app_data: &Path,
) -> Result<(u16, Tunnel), AppError> {
    let session = authenticate(ssh, app_data).await?;

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| err!("error.cannotBindTunnelPort", message = e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| err!("error.cannotBindTunnelPort", message = e))?
        .port();

    let remote_host = remote_host.to_string();
    let session = Arc::new(session);
    let task: JoinHandle<()> = tokio::spawn(async move {
        loop {
            let (local_stream, _) = match listener.accept().await {
                Ok(pair) => pair,
                Err(_) => break,
            };
            // A DB connection pool (or multiple in-flight queries) can hold
            // several physical connections open at once, so each accepted
            // local connection gets its own bridging task instead of being
            // handled inline — an inline loop would block `accept()` for as
            // long as that one connection stays open, starving every other
            // connection the pool tries to establish through this tunnel.
            let session = Arc::clone(&session);
            let remote_host = remote_host.clone();
            tokio::spawn(async move {
                bridge_connection(&session, local_stream, &remote_host, remote_port).await;
            });
        }
    });

    Ok((local_port, Tunnel { task }))
}

async fn bridge_connection(
    session: &client::Handle<TunnelHandler>,
    mut local_stream: tokio::net::TcpStream,
    remote_host: &str,
    remote_port: u16,
) {
    let opened = timeout(
        CHANNEL_OPEN_TIMEOUT,
        session.channel_open_direct_tcpip(remote_host.to_string(), remote_port as u32, "127.0.0.1", 0),
    )
    .await;
    let channel = match opened {
        Ok(Ok(c)) => c,
        // Either the SSH server rejected/never answered the forward request
        // (e.g. it can't reach remote_host:remote_port itself, or
        // AllowTcpForwarding/PermitOpen blocks it). Drop this local
        // connection so the DB client sees a closed socket instead of
        // hanging indefinitely.
        Ok(Err(_)) | Err(_) => return,
    };

    // The same reasoning as the SSH socket's `nodelay`, for the hop between the app and whatever
    // the local end of the forward is: a driver's query has nothing following it, so there is
    // never anything to be gained by holding it back.
    let _ = local_stream.set_nodelay(true);

    // Both directions at once, rather than a `select!` that could only ever be carrying one of
    // them: a dump is one long download whose acknowledgements travel the other way, and a restore
    // is the same in reverse. Copying them in turn made each wait on the other.
    //
    // The copy also ends the way the hand-written loop did — one side reaching EOF shuts the other
    // side's write half down, which is the SSH channel's EOF, and the transfer in the other
    // direction is allowed to finish before the channel is dropped.
    let mut remote_stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional_with_sizes(
        &mut local_stream,
        &mut remote_stream,
        BRIDGE_BUFFER,
        BRIDGE_BUFFER,
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::{known_hosts_file, load_known_hosts, remember_host};

    /// What the handler reads and writes between connections. The handshake around it needs a real
    /// SSH server to exercise; this is the part that decides whether a key is the one seen before.
    #[test]
    fn a_remembered_host_is_read_back_and_can_be_replaced() {
        let dir = std::env::temp_dir().join(format!("mixdb-test-{}", uuid::Uuid::new_v4()));
        let file = known_hosts_file(&dir);

        // Nothing remembered yet — a first connection has nothing to check against.
        assert!(load_known_hosts(&file).is_empty());

        remember_host(&file, "db.example:22", "SHA256:aaa").unwrap();
        remember_host(&file, "other.example:2222", "SHA256:bbb").unwrap();
        let known = load_known_hosts(&file);
        assert_eq!(known.get("db.example:22").map(String::as_str), Some("SHA256:aaa"));
        assert_eq!(known.len(), 2);

        // Each host stands on its own: accepting a rebuilt server's new key leaves the others be.
        remember_host(&file, "db.example:22", "SHA256:ccc").unwrap();
        let known = load_known_hosts(&file);
        assert_eq!(known.get("db.example:22").map(String::as_str), Some("SHA256:ccc"));
        assert_eq!(known.get("other.example:2222").map(String::as_str), Some("SHA256:bbb"));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// A file that has been corrupted (or written by a future version) reads as "nothing known"
    /// rather than failing every SSH connection the app makes.
    #[test]
    fn an_unreadable_store_is_treated_as_empty() {
        let dir = std::env::temp_dir().join(format!("mixdb-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = known_hosts_file(&dir);
        std::fs::write(&file, "not json").unwrap();

        let known = load_known_hosts(&file);
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(known.is_empty());
    }
}
