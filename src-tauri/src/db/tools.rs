//! Finding — and, when they are nowhere to be found, fetching — the command-line tools that dump
//! and restore a database: `mysqldump`/`mysql` and `mongodump`/`mongorestore`.
//!
//! They are not bundled with the app. `mysqldump` is GPL, the MongoDB tools are another 60MB, and
//! most machines that talk to a database already have one set or the other installed — so the app
//! looks for what is there first, and only downloads a copy of its own when asked to.
//!
//! A downloaded copy lives under the app's data directory and is never put on `PATH`: it belongs
//! to MixDB rather than to the machine.

use crate::error::AppError;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// One program this module knows how to find.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    MysqlDump,
    MysqlClient,
    MongoDump,
    MongoRestore,
}

/// The download a tool comes from, when it has to be downloaded: the two tools of a suite arrive
/// in the same archive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Suite {
    Mysql,
    Mongo,
}

impl Suite {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "mysql" => Ok(Self::Mysql),
            "mongo" => Ok(Self::Mongo),
            other => Err(err!("error.unknownToolSuite", suite = other)),
        }
    }

    fn slug(self) -> &'static str {
        match self {
            Self::Mysql => "mysql",
            Self::Mongo => "mongo",
        }
    }

    /// The tools that have to be present for the suite to count as installed.
    pub fn tools(self) -> [Tool; 2] {
        match self {
            Self::Mysql => [Tool::MysqlDump, Tool::MysqlClient],
            Self::Mongo => [Tool::MongoDump, Tool::MongoRestore],
        }
    }

    /// Where a downloaded copy of this suite lives. One directory each, so removing a suite is
    /// removing its directory and cannot take the other's files with it.
    fn dir(self, tools_dir: &Path) -> PathBuf {
        tools_dir.join(self.slug())
    }
}

impl Tool {
    /// Every tool, in the order the settings screen lists them.
    pub const ALL: [Tool; 4] = [
        Tool::MysqlDump,
        Tool::MysqlClient,
        Tool::MongoDump,
        Tool::MongoRestore,
    ];

    pub fn parse(value: &str) -> Result<Self, AppError> {
        Self::ALL
            .into_iter()
            .find(|tool| tool.stem() == value)
            .ok_or_else(|| err!("error.unknownTool", tool = value))
    }

    pub fn stem(self) -> &'static str {
        match self {
            Self::MysqlDump => "mysqldump",
            Self::MysqlClient => "mysql",
            Self::MongoDump => "mongodump",
            Self::MongoRestore => "mongorestore",
        }
    }

    fn file_name(self) -> String {
        if cfg!(windows) {
            format!("{}.exe", self.stem())
        } else {
            self.stem().to_string()
        }
    }

    pub fn suite(self) -> Suite {
        match self {
            Self::MysqlDump | Self::MysqlClient => Suite::Mysql,
            Self::MongoDump | Self::MongoRestore => Suite::Mongo,
        }
    }
}

/// Where a tool was found, which is what the settings screen offers to change.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// A path the user picked themselves, which wins over everything else.
    Custom,
    /// The copy MixDB downloaded.
    Downloaded,
    /// Something already on this machine — on PATH, or in a usual install directory.
    System,
}

/// One tool as the settings screen shows it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    /// `mysqldump`, `mysql`, `mongodump` or `mongorestore`.
    pub name: &'static str,
    pub suite: &'static str,
    /// Where the tool is, or `None` when it is nowhere to be found.
    pub path: Option<String>,
    pub source: Option<Source>,
}

/// The file the user's own choices of tool are remembered in.
fn overrides_file(tools_dir: &Path) -> PathBuf {
    tools_dir.join("paths.json")
}

fn load_overrides(tools_dir: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(overrides_file(tools_dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Remembers where the user said a tool is, or forgets it when given no path.
pub fn set_path(tool: Tool, path: Option<&str>, tools_dir: &Path) -> Result<(), AppError> {
    let mut overrides = load_overrides(tools_dir);
    match path.map(str::trim).filter(|path| !path.is_empty()) {
        Some(path) => {
            if !Path::new(path).is_file() {
                return Err(err!("error.noFileAt", path = path));
            }
            overrides.insert(tool.stem().to_string(), path.to_string());
        }
        None => {
            overrides.remove(tool.stem());
        }
    }
    std::fs::create_dir_all(tools_dir)
        .map_err(|e| err!("error.cannotCreateDirectory", path = tools_dir.display(), message = e))?;
    let text = serde_json::to_string_pretty(&overrides)
        .map_err(|e| err!("error.cannotSaveToolPath", message = e))?;
    std::fs::write(overrides_file(tools_dir), text)
        .map_err(|e| err!("error.cannotSaveToolPath", message = e))
}

/// The MySQL client version downloaded. An 8.0 client talks to 5.5 and up, so one build covers
/// every server the app is likely to meet — what a 5.x server needs beyond that is
/// `--column-statistics=0`, which the dump adds when it sees one.
const MYSQL_VERSION: &str = "8.0.40";
const MONGO_TOOLS_VERSION: &str = "100.17.0";

/// Directories searched beyond `PATH`, since a database installed from an installer rather than a
/// package manager routinely leaves its `bin` off `PATH` entirely.
///
/// A `*` stands for one level of subdirectory, which is how the version-numbered install roots
/// (`MySQL Server 8.0`, `Tools/100`) are reached.
#[cfg(windows)]
const EXTRA_DIRS: &[&str] = &[
    r"C:\Program Files\MySQL\*\bin",
    r"C:\Program Files (x86)\MySQL\*\bin",
    r"C:\Program Files\MariaDB *\bin",
    r"C:\Program Files\MongoDB\Tools\*\bin",
    r"C:\Program Files\MongoDB\Server\*\bin",
    r"C:\xampp\mysql\bin",
    r"C:\laragon\bin\mysql\*\bin",
    r"C:\wamp64\bin\mysql\*\bin",
];

#[cfg(not(windows))]
const EXTRA_DIRS: &[&str] = &[
    "/usr/bin",
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/local/mysql/bin",
    "/opt/local/bin",
];

/// Every directory an entry of {@link EXTRA_DIRS} stands for, with its `*` expanded against what
/// is actually on disk.
fn expand_dir(pattern: &str) -> Vec<PathBuf> {
    let Some((head, tail)) = pattern.split_once('*') else {
        return vec![PathBuf::from(pattern)];
    };
    // The `*` may be a whole path segment (`Tools\*\bin`) or only part of one (`MariaDB *`), so
    // the directory to list is the last complete segment before it, and what remains of that
    // segment is a prefix its children must start with.
    let head_path = Path::new(head);
    let (parent, prefix) = match head_path.file_name() {
        Some(name) if !head.ends_with(['/', '\\']) => (
            head_path.parent().unwrap_or(Path::new("")).to_path_buf(),
            name.to_string_lossy().into_owned(),
        ),
        _ => (head_path.to_path_buf(), String::new()),
    };
    let tail = tail.trim_start_matches(['/', '\\']);
    let Ok(entries) = std::fs::read_dir(&parent) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
        .map(|entry| {
            if tail.is_empty() {
                entry.path()
            } else {
                entry.path().join(tail)
            }
        })
        .collect()
}

/// Where `tool` is and how it got there: the path the user chose first, then the copy MixDB
/// downloaded, then whatever this machine already had. `None` when it is nowhere.
pub fn locate(tool: Tool, tools_dir: &Path) -> Option<(PathBuf, Source)> {
    if let Some(chosen) = load_overrides(tools_dir).get(tool.stem()) {
        let path = PathBuf::from(chosen);
        // A path that has since been moved or deleted falls through to the search rather than
        // making the tool unavailable — the choice is a preference, not a promise.
        if path.is_file() {
            return Some((path, Source::Custom));
        }
    }

    let name = tool.file_name();
    let downloaded = tool.suite().dir(tools_dir).join(&name);
    if downloaded.is_file() {
        return Some((downloaded, Source::Downloaded));
    }

    let path_dirs = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .unwrap_or_default();
    path_dirs
        .into_iter()
        .chain(EXTRA_DIRS.iter().flat_map(|pattern| expand_dir(pattern)))
        .map(|dir| dir.join(&name))
        .find(|candidate| candidate.is_file())
        .map(|path| (path, Source::System))
}

pub fn find(tool: Tool, tools_dir: &Path) -> Option<PathBuf> {
    locate(tool, tools_dir).map(|(path, _)| path)
}

/// Every tool and where it stands, for the settings screen.
pub fn status(tools_dir: &Path) -> Vec<ToolStatus> {
    Tool::ALL
        .into_iter()
        .map(|tool| {
            let found = locate(tool, tools_dir);
            ToolStatus {
                name: tool.stem(),
                suite: tool.suite().slug(),
                path: found
                    .as_ref()
                    .map(|(path, _)| path.display().to_string()),
                source: found.map(|(_, source)| source),
            }
        })
        .collect()
}

/// Deletes the copy MixDB downloaded. Anything found on the machine itself is left alone — it was
/// never MixDB's to remove.
pub fn uninstall(suite: Suite, tools_dir: &Path) -> Result<(), AppError> {
    let dir = suite.dir(tools_dir);
    if !dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir)
        .map_err(|e| err!("error.cannotRemoveDirectory", path = dir.display(), message = e))
}

/// Where `tool` is, or the error the caller shows: the frontend asks whether a suite is present
/// before running anything, so reaching this message means it went missing in between.
pub fn require(tool: Tool, tools_dir: &Path) -> Result<PathBuf, AppError> {
    find(tool, tools_dir).ok_or_else(|| match tool.suite() {
        Suite::Mysql => err!("error.mysqlToolNotFound", tool = tool.stem()),
        Suite::Mongo => err!("error.mongoToolNotFound", tool = tool.stem()),
    })
}

/// Whether every tool of the suite can be found.
pub fn installed(suite: Suite, tools_dir: &Path) -> bool {
    suite
        .tools()
        .iter()
        .all(|tool| find(*tool, tools_dir).is_some())
}

/// Where the suite's archive is downloaded from for this platform, and the SHA-256 it has to hash
/// to. `None` for a platform whose vendor publishes nothing that can be unpacked without an
/// installer — the tools are still used there, they just have to come from the package manager.
///
/// The checksums are pinned rather than fetched alongside the download: one taken from the same
/// server as the file it describes only says that the two arrived together, which is no answer to
/// the question worth asking about a binary that is about to be run with the user's database
/// credentials. They come from MongoDB's own release manifest
/// (<https://downloads.mongodb.org/tools/db/release.json>) and — MySQL publishing only an MD5 —
/// from the archive whose MD5 matched the one MySQL publishes for it.
fn archive_source(suite: Suite) -> Option<(String, &'static str)> {
    let windows = cfg!(windows);
    let macos = cfg!(target_os = "macos");
    let arm = cfg!(target_arch = "aarch64");
    match suite {
        // Only the Windows build is published as a plain archive; the macOS one is a .dmg and the
        // Linux ones are distribution packages, both of which want an installer to open them.
        Suite::Mysql if windows => Some((
            format!("https://dev.mysql.com/get/Downloads/MySQL-8.0/mysql-{MYSQL_VERSION}-winx64.zip"),
            "7c3f1c09ba1b4a82df32a8d889533fceaf2692383e386a04ee708a12de66f129",
        )),
        Suite::Mysql => None,
        Suite::Mongo => {
            let (platform, extension, sha256) = match (windows, macos, arm) {
                (true, _, _) => (
                    "windows-x86_64",
                    "zip",
                    "07b8fca56272397490102051edad4aeadc79369365ffdcda4ff70b4549512c5b",
                ),
                (_, true, true) => (
                    "macos-arm64",
                    "zip",
                    "099691c9059b25504a1b318bc31b3b9bd965ff78ce6b9f629090f89b25539dac",
                ),
                (_, true, false) => (
                    "macos-x86_64",
                    "zip",
                    "b488e12a3e2399f8ee3ba0abf6da54dbac1bda678c230963edaa7c435887ae99",
                ),
                (_, _, true) => (
                    "ubuntu2204-arm64",
                    "tgz",
                    "59d4475a767c75d319d120189ecd853e017038874a01dc985610938b330391c1",
                ),
                _ => (
                    "ubuntu2204-x86_64",
                    "tgz",
                    "f30d0b3115cc31b1f360af2341a794d890c74ceb41e5a4931d3b945efeeb628e",
                ),
            };
            Some((
                format!(
                    "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-{platform}-{MONGO_TOOLS_VERSION}.{extension}"
                ),
                sha256,
            ))
        }
    }
}

/// Checks a downloaded archive against the checksum pinned for it.
///
/// A mismatch means the file is not the one this build of MixDB was made to unpack: a release
/// withdrawn or rebuilt under the same name, a download that came back truncated, or something
/// between here and the vendor handing over a different file. None of those should be unpacked
/// and then run with the credentials of every database the user connects to.
fn verify_sha256(path: &Path, expected: &str) -> Result<(), AppError> {
    use sha2::{Digest, Sha256};

    let mut file = std::fs::File::open(path)
        .map_err(|e| err!("error.cannotReadDownload", message = e))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)
        .map_err(|e| err!("error.cannotReadDownload", message = e))?;
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        return Err(err!("error.checksumMismatch", actual = actual, expected = expected));
    }
    Ok(())
}

/// Runs a helper program, with its output thrown away and its complaints kept for the error.
fn run(program: &str, args: &[&str], what: &'static str) -> Result<(), AppError> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command
        .spawn()
        .map_err(|e| err!("error.helperMissing", program = program, message = e))?
        .wait_with_output()
        .map_err(|e| AppError::new(what).with("message", e))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let tail = stderr.lines().rev().take(4).collect::<Vec<_>>().join(" ");
    Err(AppError::new(what).with("message", tail))
}

/// Copies out of `dir`, recursively, every file the suite needs: the tools themselves, and — on
/// Windows — the libraries sitting beside them, which they will not start without.
fn collect(dir: &Path, suite: Suite, tools_dir: &Path) -> Result<usize, AppError> {
    let wanted: Vec<String> = suite.tools().iter().map(|tool| tool.file_name()).collect();
    let mut found = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_tool = wanted.iter().any(|want| want == &name);
            // A tool's own directory is the only place worth taking libraries from, and on
            // Windows those are what the client links against for TLS.
            let is_library = cfg!(windows)
                && name.to_lowercase().ends_with(".dll")
                && current.file_name().is_some_and(|dir| dir == "bin");
            if !is_tool && !is_library {
                continue;
            }
            std::fs::copy(&path, tools_dir.join(&name))
                .map_err(|e| err!("error.cannotCopyTool", tool = name, path = tools_dir.display(), message = e))?;
            if is_tool {
                found += 1;
            }
        }
    }
    Ok(found)
}

/// Downloads the suite's own tools into `tools_dir`.
///
/// `curl` and `tar` do the fetching and unpacking: both ship with Windows 10 and up and with every
/// macOS and Linux this app runs on, which is a great deal less to carry than an HTTP client and a
/// zip reader for the sake of an operation most users run once.
///
/// The archive holds an entire server distribution in MySQL's case, so it is unpacked to a
/// temporary directory, the few files that matter are taken out of it, and the rest is deleted.
pub fn install(suite: Suite, tools_dir: &Path) -> Result<(), AppError> {
    let (url, sha256) = archive_source(suite).ok_or_else(|| err!("error.noMysqlArchive"))?;

    let target = suite.dir(tools_dir);
    std::fs::create_dir_all(&target)
        .map_err(|e| err!("error.cannotCreateDirectory", path = target.display(), message = e))?;
    let staging = tools_dir.join(format!("download-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging)
        .map_err(|e| err!("error.cannotCreateDirectory", path = staging.display(), message = e))?;
    // Whatever happens next, the staging directory goes: it holds a whole unpacked server.
    let cleanup = || {
        let _ = std::fs::remove_dir_all(&staging);
    };

    let archive = staging.join("tools-archive");
    let result = (|| {
        run(
            "curl",
            &[
                "--fail",
                "--location",
                "--silent",
                "--show-error",
                "--retry",
                "2",
                "--output",
                &archive.to_string_lossy(),
                &url,
            ],
            "error.downloadFailed",
        )?;
        // Before anything is unpacked, let alone run.
        verify_sha256(&archive, sha256)?;
        let unpacked = staging.join("unpacked");
        std::fs::create_dir_all(&unpacked)
            .map_err(|e| err!("error.cannotCreateDirectory", path = unpacked.display(), message = e))?;
        run(
            "tar",
            &[
                "-xf",
                &archive.to_string_lossy(),
                "-C",
                &unpacked.to_string_lossy(),
            ],
            "error.unpackFailed",
        )?;
        let found = collect(&unpacked, suite, &target)?;
        if found < suite.tools().len() {
            return Err(err!("error.downloadIncomplete"));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for tool in suite.tools() {
                let path = target.join(tool.file_name());
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
            }
        }
        Ok(())
    })();

    cleanup();
    result
}

#[cfg(test)]
mod tests {
    use super::{expand_dir, verify_sha256};
    use std::path::{Path, PathBuf};

    /// The empty file's SHA-256, which is a fine stand-in for a real archive: what is under test is
    /// the comparison, not the hashing.
    const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    fn temp_file(contents: &[u8]) -> PathBuf {
        let path = std::env::temp_dir().join(format!("mixdb-test-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn a_download_is_only_accepted_at_the_checksum_it_was_pinned_at() {
        let path = temp_file(b"");
        let matching = verify_sha256(&path, EMPTY_SHA256);
        let mismatched = verify_sha256(&path, &"0".repeat(64));
        std::fs::remove_file(&path).unwrap();

        assert!(matching.is_ok());
        let message = mismatched.unwrap_err();
        // The message has to name both halves: which file arrived, and which was expected.
        assert_eq!(message.code, "error.checksumMismatch");
        assert_eq!(message.params.get("actual"), Some(&EMPTY_SHA256.to_string()));
    }

    #[test]
    fn a_missing_download_is_a_failure_rather_than_a_pass() {
        assert!(verify_sha256(Path::new("no-such-file"), EMPTY_SHA256).is_err());
    }

    /// A `*` in a search directory stands for one level of subdirectory, whether it is a whole
    /// path segment (`Tools\*\bin`) or only part of one (`MariaDB *`).
    #[test]
    fn a_star_expands_against_what_is_on_disk() {
        let root = std::env::temp_dir().join(format!("mixdb-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("MariaDB 11.4").join("bin")).unwrap();
        std::fs::create_dir_all(root.join("Postgres").join("bin")).unwrap();

        let whole_segment = expand_dir(&format!("{}/*/bin", root.display()));
        let partial_segment = expand_dir(&format!("{}/MariaDB */bin", root.display()));
        std::fs::remove_dir_all(&root).unwrap();

        assert_eq!(whole_segment.len(), 2);
        assert_eq!(partial_segment, vec![root.join("MariaDB 11.4").join("bin")]);
    }

    #[test]
    fn a_directory_without_a_star_stands_for_itself() {
        assert_eq!(expand_dir("/usr/local/bin"), vec![PathBuf::from("/usr/local/bin")]);
    }
}
