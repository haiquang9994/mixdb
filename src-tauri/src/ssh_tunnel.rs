use crate::models::{SshAuth, SshConfig};
use russh::client::{self};
use russh::ChannelMsg;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio::time::timeout;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const CHANNEL_OPEN_TIMEOUT: Duration = Duration::from_secs(10);

struct TunnelHandler;

impl client::Handler for TunnelHandler {
    type Error = russh::Error;

    // Accepts any host key. This is an MVP tradeoff: production use should
    // verify against a known_hosts store instead of trusting on first use.
    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

async fn authenticate(ssh: &SshConfig) -> Result<client::Handle<TunnelHandler>, String> {
    match timeout(CONNECT_TIMEOUT, authenticate_inner(ssh)).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "SSH connection to {}:{} timed out after {}s — check host/port/firewall",
            ssh.host,
            ssh.port,
            CONNECT_TIMEOUT.as_secs()
        )),
    }
}

async fn authenticate_inner(ssh: &SshConfig) -> Result<client::Handle<TunnelHandler>, String> {
    let config = Arc::new(client::Config::default());
    let mut session = client::connect(config, (ssh.host.as_str(), ssh.port), TunnelHandler)
        .await
        .map_err(|e| format!("SSH connect failed: {e}"))?;

    let authenticated = match &ssh.auth {
        SshAuth::Password { password } => session
            .authenticate_password(&ssh.username, password)
            .await
            .map_err(|e| format!("SSH auth failed: {e}"))?,
        SshAuth::PrivateKey { key_path, passphrase } => {
            let key_data = std::fs::read_to_string(key_path)
                .map_err(|e| format!("Cannot read private key file: {e}"))?;
            let key_pair = russh::keys::decode_secret_key(&key_data, passphrase.as_deref())
                .map_err(|e| format!("Invalid private key: {e}"))?;
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
                .map_err(|e| format!("SSH auth failed: {e}"))?
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
            Err(format!(
                "SSH authentication was rejected by the server (partial_success={partial_success}). Server accepts: {}",
                if accepted.is_empty() { "none advertised".to_string() } else { accepted.join(", ") }
            ))
        }
    }
}

/// Authenticates against the SSH server without opening any port forward.
/// Used by the UI's "Test tunnel" action to validate credentials/connectivity
/// independently of the database connection itself.
pub async fn test_connection(ssh: &SshConfig) -> Result<(), String> {
    let session = authenticate(ssh).await?;
    let _ = session.disconnect(russh::Disconnect::ByApplication, "", "English").await;
    Ok(())
}

/// Opens an SSH connection and a direct-tcpip channel to (remote_host, remote_port),
/// bridged to a freshly bound local TCP port. Returns the local port to connect to
/// instead of the real database host, plus the background task handle bridging it.
pub async fn open_tunnel(
    ssh: &SshConfig,
    remote_host: &str,
    remote_port: u16,
) -> Result<(u16, JoinHandle<()>), String> {
    let session = authenticate(ssh).await?;

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| format!("Cannot bind local tunnel port: {e}"))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    let remote_host = remote_host.to_string();
    let task: JoinHandle<()> = tokio::spawn(async move {
        loop {
            let (mut local_stream, _) = match listener.accept().await {
                Ok(pair) => pair,
                Err(_) => break,
            };
            let opened = timeout(
                CHANNEL_OPEN_TIMEOUT,
                session.channel_open_direct_tcpip(
                    remote_host.clone(),
                    remote_port as u32,
                    "127.0.0.1",
                    0,
                ),
            )
            .await;
            let mut channel = match opened {
                Ok(Ok(c)) => c,
                // Either the SSH server rejected/never answered the forward
                // request (e.g. it can't reach remote_host:remote_port itself,
                // or AllowTcpForwarding/PermitOpen blocks it). Drop this local
                // connection so the DB client sees a closed socket instead of
                // hanging indefinitely, and wait for the next attempt.
                Ok(Err(_)) | Err(_) => continue,
            };

            let mut buf = [0u8; 8192];
            loop {
                tokio::select! {
                    result = local_stream.read(&mut buf) => {
                        match result {
                            Ok(0) => { let _ = channel.eof().await; break; }
                            Ok(n) => { if channel.data(&buf[..n]).await.is_err() { break; } }
                            Err(_) => break,
                        }
                    }
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { data }) => {
                                if local_stream.write_all(&data).await.is_err() { break; }
                            }
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                            _ => {}
                        }
                    }
                }
            }
        }
    });

    Ok((local_port, task))
}
