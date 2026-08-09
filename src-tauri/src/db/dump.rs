//! Backing up and restoring a whole database, by driving the vendors' own command-line tools:
//! `mysqldump`/`mysql` and `mongodump`/`mongorestore`. Where those tools come from is
//! {@link super::tools}' business; this module is what runs them.
//!
//! Writing a dump by hand would mean reimplementing every corner of the two servers' output —
//! definers, triggers, routines, BSON types — and being wrong about one of them is a restore that
//! silently differs from the original.
//!
//! Nothing in here interpolates a password into a command line: on most systems the arguments of a
//! running process are readable by any other process of the same user, so MySQL's credentials go
//! through a temporary option file that only this user can read. MongoDB's have nowhere else to go
//! — its tools take a URI and nothing else — which is a limitation of those tools.

use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// What of a MySQL database is to be written out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DumpMode {
    /// The table definitions, routines and triggers, with no rows.
    Structure,
    /// The rows alone, to be loaded into a database that already has the tables.
    Data,
    /// Both, which is what makes the dump able to rebuild the database on its own.
    All,
}

impl DumpMode {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "structure" => Ok(Self::Structure),
            "data" => Ok(Self::Data),
            "all" => Ok(Self::All),
            other => Err(format!("Unknown dump mode `{other}`")),
        }
    }
}

/// A MySQL option file holding the credentials, deleted when this goes out of scope.
///
/// The alternative is `--password=` on the command line, which every other process on the machine
/// can read out of the process list for as long as the dump runs.
struct OptionFile {
    path: PathBuf,
}

impl OptionFile {
    fn new(host: &str, port: u16, user: &str, password: &str) -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("mixdb-{}.cnf", uuid::Uuid::new_v4()));
        let mut file = File::create(&path).map_err(|e| format!("Cannot write {path:?}: {e}"))?;
        // Values are double-quoted, which is the one form of an option file value that may hold
        // `#`, spaces or a leading digit — with `\` and `"` escaped so the quoting holds.
        let quoted = |value: &str| format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""));
        let body = format!(
            "[client]\nhost={}\nport={port}\nuser={}\npassword={}\n",
            quoted(host),
            quoted(user),
            quoted(password)
        );
        file.write_all(body.as_bytes())
            .map_err(|e| format!("Cannot write {path:?}: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(Self { path })
    }
}

impl Drop for OptionFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Runs a tool to completion, with its output wired to the given files, and turns anything but a
/// clean exit into the error the caller reports.
///
/// Blocking on purpose — every caller is a `spawn_blocking`, because a dump takes as long as it
/// takes and has no business holding an async worker (or the connection lock) while it does.
fn run(
    tool: &Path,
    args: &[String],
    stdin: Option<File>,
    stdout: Option<File>,
    what: &str,
) -> Result<(), String> {
    let mut command = Command::new(tool);
    command
        .args(args)
        .stdin(stdin.map_or_else(Stdio::null, Stdio::from))
        .stdout(stdout.map_or_else(Stdio::null, Stdio::from))
        .stderr(Stdio::piped());
    // Without this a console window flashes up over the app for every tool run.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .spawn()
        .map_err(|e| format!("Cannot run {}: {e}", tool.display()))?
        .wait_with_output()
        .map_err(|e| format!("{what} could not be waited for: {e}"))?;

    if output.status.success() {
        return Ok(());
    }
    // These tools report the real cause on stderr and only a number through the exit status, so
    // the message is what matters; the last lines of it are the ones that say why.
    let stderr = String::from_utf8_lossy(&output.stderr);
    let tail = stderr
        .lines()
        .filter(|line| !line.trim().is_empty())
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    Err(if tail.is_empty() {
        format!("{what} failed ({})", output.status)
    } else {
        format!("{what} failed ({}):\n{tail}", output.status)
    })
}

fn create_file(path: &str) -> Result<File, String> {
    File::create(path).map_err(|e| format!("Cannot write {path}: {e}"))
}

fn open_file(path: &str) -> Result<File, String> {
    File::open(path).map_err(|e| format!("Cannot read {path}: {e}"))
}

/// Writes `database` to `path` as SQL.
///
/// `charset` is the character set the dump is transferred in — see `mysql_structure::dump_charset`
/// for how it is chosen. It matters more than it looks: mysqldump converts every string on the way
/// out to this character set and writes a matching `SET NAMES` into the file, so a wrong one is a
/// restore where the text comes back mangled.
///
/// `column_statistics` says whether the server has the `information_schema.COLUMN_STATISTICS`
/// table that an 8.0 mysqldump reads histograms from. A 5.x server has not, and asking it for one
/// is an error that stops the dump — so against those the feature is turned off.
#[allow(clippy::too_many_arguments)]
pub fn mysql_dump(
    tool: &Path,
    host: &str,
    port: u16,
    user: &str,
    password: &str,
    database: &str,
    charset: &str,
    mode: DumpMode,
    column_statistics: bool,
    path: &str,
) -> Result<(), String> {
    let options = OptionFile::new(host, port, user, password)?;

    let mut args = vec![
        // Must come first: mysqldump reads its option files before anything else on the line.
        format!("--defaults-extra-file={}", options.path.display()),
        format!("--default-character-set={charset}"),
        // Timestamps come out as they are stored rather than converted to UTC, so a restore onto
        // a server in another time zone still reads back the same wall-clock values.
        "--skip-tz-utc".to_string(),
        // The usual bundle: drop-and-create, extended inserts, quick, disable-keys, set-charset.
        "--opt".to_string(),
        "--no-autocommit".to_string(),
        // Takes the whole dump from one consistent snapshot instead of locking the tables.
        "--single-transaction".to_string(),
        "--no-tablespaces".to_string(),
        // Binary columns as hex rather than as escaped text: no character set can touch them, so
        // they come back byte for byte.
        "--hex-blob".to_string(),
        "--force".to_string(),
        // Otherwise an 8.0 mysqldump writes a `SET @@GLOBAL.GTID_PURGED` the restoring server
        // usually refuses, and which has nothing to do with the data being carried across.
        "--set-gtid-purged=OFF".to_string(),
    ];
    if !column_statistics {
        args.push("--column-statistics=0".to_string());
    }
    match mode {
        DumpMode::Structure => {
            args.push("--no-data".to_string());
            args.push("--routines".to_string());
            args.push("--events".to_string());
        }
        DumpMode::Data => {
            args.push("--no-create-info".to_string());
            // Both belong to the structure, and mysqldump writes them beside the tables they are
            // attached to — which a data-only dump has none of.
            args.push("--skip-triggers".to_string());
            args.push("--skip-routines".to_string());
        }
        DumpMode::All => {
            args.push("--routines".to_string());
            args.push("--events".to_string());
        }
    }
    // The bare name rather than `--databases`, which is what would put `CREATE DATABASE` and a
    // `USE` at the head of the file. Without them the dump names no database at all, so it
    // restores into whichever one it is pointed at — at the cost of the database's own default
    // character set, which each table carries its own copy of anyway.
    args.push(database.to_string());

    let out = create_file(path)?;
    run(tool, &args, None, Some(out), "mysqldump")
}

/// Replays a SQL file through the `mysql` client.
///
/// `database` is where the file's statements land, since a dump written by this app names no
/// database of its own. A file from elsewhere that does carry a `USE` still overrides this — the
/// client cannot refuse a statement in the file it is given.
pub fn mysql_restore(
    tool: &Path,
    host: &str,
    port: u16,
    user: &str,
    password: &str,
    database: &str,
    path: &str,
) -> Result<(), String> {
    let options = OptionFile::new(host, port, user, password)?;

    let args = vec![
        format!("--defaults-extra-file={}", options.path.display()),
        // Only the initial setting: a dump carries its own `SET NAMES`, which takes over from here.
        "--default-character-set=utf8mb4".to_string(),
        // Stop at the first statement the server rejects instead of carrying on and leaving a
        // half-restored database behind with the reason scrolled off.
        "--batch".to_string(),
        database.to_string(),
    ];

    let input = open_file(path)?;
    run(tool, &args, Some(input), None, "mysql")
}

/// Splits a MongoDB URI into the parts this module rewrites: what is before the host list, the
/// host list itself, the `/database` path, and the `?options`.
fn split_uri(uri: &str) -> Result<(String, String, String, String), String> {
    let (scheme, rest) = uri
        .split_once("://")
        .ok_or_else(|| "Connection string is not a mongodb:// URI".to_string())?;
    let (credentials, hosts_and_more) = match rest.rsplit_once('@') {
        Some((credentials, rest)) => (format!("{credentials}@"), rest),
        None => (String::new(), rest),
    };
    let (hosts_and_path, query) = match hosts_and_more.split_once('?') {
        Some((head, query)) => (head, format!("?{query}")),
        None => (hosts_and_more, String::new()),
    };
    let (hosts, path) = match hosts_and_path.split_once('/') {
        Some((hosts, path)) => (hosts, format!("/{path}")),
        None => (hosts_and_path, String::new()),
    };
    Ok((
        format!("{scheme}://{credentials}"),
        hosts.to_string(),
        path,
        query,
    ))
}

/// The URI the tools are given: the database path dropped, since the database is named separately
/// and the tools refuse to be told twice, and the host replaced when the connection is tunneled.
///
/// The `/` that stood before the dropped database stays: a URI whose options follow the host list
/// with nothing between them is one the tools refuse to parse at all.
fn tool_uri(uri: &str, endpoint: Option<(&str, u16)>) -> Result<String, String> {
    let (head, hosts, _path, query) = split_uri(uri)?;
    let Some((host, port)) = endpoint else {
        return Ok(format!("{head}{hosts}/{query}"));
    };
    if head.starts_with("mongodb+srv://") {
        return Err(
            "Dumping over an SSH tunnel needs a plain mongodb:// connection string — a \
             mongodb+srv:// one resolves its own hosts, which the tunnel does not reach."
                .to_string(),
        );
    }
    // Only the one host is forwarded, so the tools must talk to it directly rather than discover
    // the replica set's own addresses and try to reach those.
    let separator = if query.is_empty() { "?" } else { "&" };
    Ok(format!(
        "{head}{host}:{port}/{query}{separator}directConnection=true"
    ))
}

/// Writes `database` to `path` as a mongodump archive: the whole database, collections and
/// indexes, in one file rather than a directory of BSON.
pub fn mongo_dump(
    tool: &Path,
    uri: &str,
    endpoint: Option<(&str, u16)>,
    database: &str,
    path: &str,
) -> Result<(), String> {
    let args = vec![
        format!("--uri={}", tool_uri(uri, endpoint)?),
        format!("--db={database}"),
        format!("--archive={path}"),
    ];
    run(tool, &args, None, None, "mongodump")
}

/// The magic number every mongodump archive starts with.
const ARCHIVE_MAGIC: u32 = 0x8199_e26d;

/// The database a mongodump archive holds, read out of the archive itself.
///
/// An archive begins with its magic number, then a header document, then one metadata document per
/// collection — and each of those names the database it came from. Only the first is read: an
/// archive written by MixDB holds one database, being dumped with `--db`.
///
/// This is needed because `mongorestore` puts documents back into the namespaces the archive
/// names, and the only way to send them somewhere else is to tell it what to rename *from*.
fn archive_database(path: &str) -> Result<String, String> {
    use mongodb::bson::Document;
    use std::io::Read;

    let mut file = open_file(path)?;
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)
        .map_err(|e| format!("Cannot read {path}: {e}"))?;
    if u32::from_le_bytes(magic) != ARCHIVE_MAGIC {
        return Err(format!(
            "{path} is not a mongodump archive — MixDB restores the single-file archives its own \
             dump writes."
        ));
    }
    let unreadable = |e: mongodb::bson::de::Error| {
        format!("Cannot tell which database {path} holds — it may be compressed: {e}")
    };
    // The header, which carries versions rather than namespaces.
    Document::from_reader(&mut file).map_err(unreadable)?;
    let metadata = Document::from_reader(&mut file).map_err(unreadable)?;
    metadata
        .get_str("db")
        .map(str::to_string)
        .map_err(|_| format!("{path} names no database to restore from"))
}

/// Restores a mongodump archive into `database`, whatever database it was dumped from.
///
/// The rename is what makes the choice in the sidebar mean something: without it the documents go
/// back where they came from, which for an archive from another server is rarely where they are
/// wanted.
pub fn mongo_restore(
    tool: &Path,
    uri: &str,
    endpoint: Option<(&str, u16)>,
    database: &str,
    path: &str,
) -> Result<(), String> {
    let mut args = vec![
        format!("--uri={}", tool_uri(uri, endpoint)?),
        format!("--archive={path}"),
    ];
    let source = archive_database(path)?;
    if source != database {
        // Every collection of the one database, and only that database: an archive holding more
        // than the dump wrote would otherwise have the rest restored under their own names.
        args.push(format!("--nsInclude={source}.*"));
        args.push(format!("--nsFrom={source}.*"));
        args.push(format!("--nsTo={database}.*"));
    }
    run(tool, &args, None, None, "mongorestore")
}

#[cfg(test)]
mod tests {
    use super::tool_uri;

    /// The database is dropped from the path but its `/` is not: without it the tools refuse the
    /// URI outright ("must have a / before the query").
    #[test]
    fn drops_the_database_but_keeps_the_slash() {
        assert_eq!(
            tool_uri("mongodb://user:pw@db.example:27017/shop?authSource=admin", None).unwrap(),
            "mongodb://user:pw@db.example:27017/?authSource=admin"
        );
        assert_eq!(
            tool_uri("mongodb://db.example:27017", None).unwrap(),
            "mongodb://db.example:27017/"
        );
        assert_eq!(
            tool_uri("mongodb://db.example:27017/shop", None).unwrap(),
            "mongodb://db.example:27017/"
        );
    }

    /// A tunnel replaces the host list, and the one forwarded node has to be talked to directly —
    /// discovering the replica set would hand back addresses the tunnel does not reach.
    #[test]
    fn points_at_the_tunnel() {
        assert_eq!(
            tool_uri("mongodb://user:pw@db.example:27017/shop", Some(("127.0.0.1", 5001))).unwrap(),
            "mongodb://user:pw@127.0.0.1:5001/?directConnection=true"
        );
        assert_eq!(
            tool_uri("mongodb://a:27017,b:27017/?replicaSet=rs0", Some(("127.0.0.1", 5001))).unwrap(),
            "mongodb://127.0.0.1:5001/?replicaSet=rs0&directConnection=true"
        );
    }

    /// The archive layout this reads: the magic number, the header, then a metadata document per
    /// collection — the first of which names the database everything in the file came from.
    #[test]
    fn reads_the_database_out_of_an_archive() {
        use mongodb::bson::doc;

        let mut archive = super::ARCHIVE_MAGIC.to_le_bytes().to_vec();
        doc! { "concurrent_collections": 4, "version": "0.1" }
            .to_writer(&mut archive)
            .unwrap();
        doc! { "db": "pnedu_portal", "collection": "users", "size": 10_i64 }
            .to_writer(&mut archive)
            .unwrap();
        let path = std::env::temp_dir().join(format!("mixdb-test-{}.archive", uuid::Uuid::new_v4()));
        std::fs::write(&path, &archive).unwrap();

        let found = super::archive_database(&path.to_string_lossy());
        let not_an_archive = super::archive_database(file!());
        std::fs::remove_file(&path).unwrap();

        assert_eq!(found.unwrap(), "pnedu_portal");
        assert!(not_an_archive.is_err());
    }

    #[test]
    fn refuses_an_srv_uri_over_a_tunnel() {
        assert!(tool_uri("mongodb+srv://user:pw@cluster.example/shop", Some(("127.0.0.1", 5001))).is_err());
    }
}
