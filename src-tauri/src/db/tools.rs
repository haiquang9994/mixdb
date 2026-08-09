//! Finding — and, when they are nowhere to be found, fetching — the command-line tools that dump
//! and restore a database: `mysqldump`/`mysql` and `mongodump`/`mongorestore`.
//!
//! They are not bundled with the app. `mysqldump` is GPL, the MongoDB tools are another 60MB, and
//! most machines that talk to a database already have one set or the other installed — so the app
//! looks for what is there first, and only downloads a copy of its own when asked to.
//!
//! A downloaded copy lives under the app's data directory and is never put on `PATH`: it belongs
//! to MixDB rather than to the machine.

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
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "mysql" => Ok(Self::Mysql),
            "mongo" => Ok(Self::Mongo),
            other => Err(format!("Unknown tool suite `{other}`")),
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

    pub fn parse(value: &str) -> Result<Self, String> {
        Self::ALL
            .into_iter()
            .find(|tool| tool.stem() == value)
            .ok_or_else(|| format!("Unknown tool `{value}`"))
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
pub fn set_path(tool: Tool, path: Option<&str>, tools_dir: &Path) -> Result<(), String> {
    let mut overrides = load_overrides(tools_dir);
    match path.map(str::trim).filter(|path| !path.is_empty()) {
        Some(path) => {
            if !Path::new(path).is_file() {
                return Err(format!("There is no file at {path}"));
            }
            overrides.insert(tool.stem().to_string(), path.to_string());
        }
        None => {
            overrides.remove(tool.stem());
        }
    }
    std::fs::create_dir_all(tools_dir)
        .map_err(|e| format!("Cannot create {}: {e}", tools_dir.display()))?;
    let text = serde_json::to_string_pretty(&overrides).map_err(|e| e.to_string())?;
    std::fs::write(overrides_file(tools_dir), text)
        .map_err(|e| format!("Cannot remember the choice: {e}"))
}

/// The MySQL client version downloaded. An 8.0 client talks to 5.5 and up, so one build covers
/// every server the app is likely to meet — what a 5.x server needs beyond that is
/// `--column-statistics=0`, which the dump adds when it sees one.
const MYSQL_VERSION: &str = "8.0.40";
const MONGO_TOOLS_VERSION: &str = "100.10.0";

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
pub fn uninstall(suite: Suite, tools_dir: &Path) -> Result<(), String> {
    let dir = suite.dir(tools_dir);
    if !dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("Cannot remove {}: {e}", dir.display()))
}

/// Where `tool` is, or the error the caller shows: the frontend asks whether a suite is present
/// before running anything, so reaching this message means it went missing in between.
pub fn require(tool: Tool, tools_dir: &Path) -> Result<PathBuf, String> {
    find(tool, tools_dir).ok_or_else(|| {
        let suite = match tool.suite() {
            Suite::Mysql => "the MySQL client tools",
            Suite::Mongo => "the MongoDB Database Tools",
        };
        format!(
            "`{}` was not found. Install {suite}, point MixDB at a copy in Settings, or let it \
             download one.",
            tool.stem()
        )
    })
}

/// Whether every tool of the suite can be found.
pub fn installed(suite: Suite, tools_dir: &Path) -> bool {
    suite
        .tools()
        .iter()
        .all(|tool| find(*tool, tools_dir).is_some())
}

/// Where the suite's archive is downloaded from, for this platform. `None` for a platform whose
/// vendor publishes nothing that can be unpacked without an installer — the tools are still used
/// there, they just have to come from the package manager.
fn archive_url(suite: Suite) -> Option<String> {
    let windows = cfg!(windows);
    let macos = cfg!(target_os = "macos");
    let arm = cfg!(target_arch = "aarch64");
    match suite {
        // Only the Windows build is published as a plain archive; the macOS one is a .dmg and the
        // Linux ones are distribution packages, both of which want an installer to open them.
        Suite::Mysql if windows => Some(format!(
            "https://dev.mysql.com/get/Downloads/MySQL-8.0/mysql-{MYSQL_VERSION}-winx64.zip"
        )),
        Suite::Mysql => None,
        Suite::Mongo => {
            let platform = match (windows, macos, arm) {
                (true, _, _) => "windows-x86_64",
                (_, true, true) => "macos-arm64",
                (_, true, false) => "macos-x86_64",
                (_, _, true) => "ubuntu2204-aarch64",
                _ => "ubuntu2204-x86_64",
            };
            let extension = if windows || macos { "zip" } else { "tgz" };
            Some(format!(
                "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-{platform}-{MONGO_TOOLS_VERSION}.{extension}"
            ))
        }
    }
}

/// Runs a helper program, with its output thrown away and its complaints kept for the error.
fn run(program: &str, args: &[&str], what: &str) -> Result<(), String> {
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
        .map_err(|e| format!("{what} needs `{program}`, which could not be run: {e}"))?
        .wait_with_output()
        .map_err(|e| format!("{what} could not be waited for: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let tail = stderr.lines().rev().take(4).collect::<Vec<_>>().join(" ");
    Err(format!("{what} failed ({}): {tail}", output.status))
}

/// Copies out of `dir`, recursively, every file the suite needs: the tools themselves, and — on
/// Windows — the libraries sitting beside them, which they will not start without.
fn collect(dir: &Path, suite: Suite, tools_dir: &Path) -> Result<usize, String> {
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
                .map_err(|e| format!("Cannot put {name} in {}: {e}", tools_dir.display()))?;
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
pub fn install(suite: Suite, tools_dir: &Path) -> Result<(), String> {
    let url = archive_url(suite).ok_or_else(|| {
        "MySQL publishes no plain archive of its client tools for this platform — install them \
         through your package manager (they are in `mysql-client` / `mariadb-client`), and MixDB \
         will find them on PATH."
            .to_string()
    })?;

    let target = suite.dir(tools_dir);
    std::fs::create_dir_all(&target)
        .map_err(|e| format!("Cannot create {}: {e}", target.display()))?;
    let staging = tools_dir.join(format!("download-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging)
        .map_err(|e| format!("Cannot create {}: {e}", staging.display()))?;
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
            "The download",
        )?;
        let unpacked = staging.join("unpacked");
        std::fs::create_dir_all(&unpacked)
            .map_err(|e| format!("Cannot create {}: {e}", unpacked.display()))?;
        run(
            "tar",
            &[
                "-xf",
                &archive.to_string_lossy(),
                "-C",
                &unpacked.to_string_lossy(),
            ],
            "Unpacking the download",
        )?;
        let found = collect(&unpacked, suite, &target)?;
        if found < suite.tools().len() {
            return Err(
                "The download did not contain the tools it was supposed to — the version MixDB \
                 asks for may have been withdrawn."
                    .to_string(),
            );
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
