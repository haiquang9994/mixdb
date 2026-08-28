//! Where a saved connection's passwords live: the operating system's own credential store —
//! Windows Credential Manager, the macOS Keychain, the Secret Service on Linux.
//!
//! Everything else about a saved connection (host, port, user, the sidebar width) stays in
//! `connections.json`, which is plain text by design: it is a list of what you connect to, and it
//! is useful to be able to read and copy it. What must not be in there is the credentials, which
//! is what this module keeps out of it.
//!
//! One entry per connection rather than one per field: a connection's secrets are written and
//! forgotten together, and a single JSON object is one prompt on the platforms that ask.

use crate::platform::in_background;
use crate::error::AppError;
use keyring::Entry;
use std::collections::HashMap;

/// Stands in for a secret wherever a `Debug` line would otherwise print one.
///
/// Prints as `"***"`, and through `Option` as `Some("***")` or `None` — so a redacted line still
/// says whether there was a password at all, which is nearly always the actual question.
///
/// Holds nothing on purpose: a type that carried the secret in order to hide it would only be one
/// stray `.0` away from printing it.
pub struct Redacted;

impl std::fmt::Debug for Redacted {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("\"***\"")
    }
}

/// The name MixDB's entries appear under in the OS credential store.
const SERVICE: &str = "MixDB";

/// The secrets of one saved connection, keyed by the field they belong to (`password`, `uri`,
/// `sshPassword`, `sshPassphrase`). The frontend decides what goes in; this side only carries it.
pub type Secrets = HashMap<String, String>;

fn entry(id: &str) -> Result<Entry, AppError> {
    Entry::new(SERVICE, id).map_err(|e| err!("error.credentialStoreUnreachable", message = e))
}

/// Writes the connection's secrets, replacing whatever was there. An empty set deletes the entry
/// rather than storing `{}` — a connection with nothing to hide should leave nothing behind.
pub fn save(id: &str, secrets: &Secrets) -> Result<(), AppError> {
    if secrets.is_empty() {
        return delete(id);
    }
    let json = serde_json::to_string(secrets).map_err(|e| err!("error.cannotSavePassword", message = e))?;
    entry(id)?
        .set_password(&json)
        .map_err(|e| err!("error.cannotSavePassword", message = e))
}

/// The connection's secrets, or an empty set when it has none — which is also what a connection
/// saved before MixDB used the credential store looks like, and what one whose entry the user
/// deleted from the OS store looks like.
pub fn load(id: &str) -> Result<Secrets, AppError> {
    match entry(id)?.get_password() {
        Ok(json) => serde_json::from_str(&json).map_err(|e| err!("error.cannotReadPassword", message = e)),
        Err(keyring::Error::NoEntry) => Ok(Secrets::new()),
        Err(e) => Err(err!("error.cannotReadPassword", message = e)),
    }
}

/// Forgets everything stored for the connection. Deleting what is not there is not a failure: it
/// is what removing a connection saved before the credential store existed looks like.
pub fn delete(id: &str) -> Result<(), AppError> {
    match entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(err!("error.cannotRemovePassword", message = e)),
    }
}


/// Writes a saved connection's secrets to the OS credential store, replacing what was there.
#[tauri::command]
pub async fn secrets_save(id: String, secrets: Secrets) -> Result<(), AppError> {
    in_background(move || save(&id, &secrets)).await
}

/// A saved connection's secrets, or nothing when it has none stored.
#[tauri::command]
pub async fn secrets_load(id: String) -> Result<Secrets, AppError> {
    in_background(move || load(&id)).await
}

/// Forgets a saved connection's secrets, for when the connection itself is deleted.
#[tauri::command]
pub async fn secrets_delete(id: String) -> Result<(), AppError> {
    in_background(move || delete(&id)).await
}

#[cfg(test)]
mod tests {
    use super::{delete, load, save, Secrets};

    /// Ignored by default: it writes to the machine's real credential store, which a headless
    /// Linux CI box has no running Secret Service for. Run it by hand with
    /// `cargo test -- --ignored` on a desktop to check the store is actually reachable.
    #[test]
    #[ignore]
    fn secrets_survive_a_round_trip_through_the_os_store() {
        let id = format!("mixdb-test-{}", uuid::Uuid::new_v4());

        // A connection with nothing stored reads as empty rather than as a failure.
        assert!(load(&id).unwrap().is_empty());

        let mut secrets = Secrets::new();
        secrets.insert("password".to_string(), "hunter2".to_string());
        secrets.insert("sshPassphrase".to_string(), "let me in".to_string());
        save(&id, &secrets).unwrap();
        assert_eq!(load(&id).unwrap(), secrets);

        // Saving nothing removes the entry instead of storing an empty object.
        save(&id, &Secrets::new()).unwrap();
        assert!(load(&id).unwrap().is_empty());

        // Deleting what is already gone is not a failure.
        delete(&id).unwrap();
    }
}
