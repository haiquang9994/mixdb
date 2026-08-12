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

use crate::error::AppError;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

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
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "structure" => Ok(Self::Structure),
            "data" => Ok(Self::Data),
            "all" => Ok(Self::All),
            other => Err(err!("error.unknownDumpMode", mode = other)),
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
    fn new(host: &str, port: u16, user: &str, password: &str) -> Result<Self, AppError> {
        let path = std::env::temp_dir().join(format!("mixdb-{}.cnf", uuid::Uuid::new_v4()));
        let mut file = File::create(&path)
            .map_err(|e| err!("error.cannotWriteFile", path = path.display(), message = e))?;
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
            .map_err(|e| err!("error.cannotWriteFile", path = path.display(), message = e))?;
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

/// What the caller of [`run`] is shown while the tool runs: every line the tool writes to its
/// standard error as it arrives, and nothing at all every quarter second — so a caller watching
/// something other than the tool's own words, such as the size of the file it is writing, still has
/// somewhere to look from.
enum Tick<'a> {
    Line(&'a str),
    Idle,
}

/// A file to be poured into a tool's standard input, counting what has gone in.
///
/// The count is the whole of a restore's progress: the mysql client has no idea how far through
/// the file it is, but the file is of a known size and every byte of it has to be handed over.
struct Fed {
    file: File,
    /// Where the file came from, for the error a file that cannot be read through has to raise.
    path: String,
    /// How much of it the tool has been given, read by the caller's ticks from another thread.
    sent: Arc<AtomicU64>,
}

impl Fed {
    fn pour_into(self, mut sink: std::process::ChildStdin) -> Result<(), AppError> {
        let Self { mut file, path, sent } = self;
        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|e| err!("error.cannotReadFile", path = path.as_str(), message = e))?;
            if read == 0 {
                break;
            }
            // A tool that has stopped reading has died, and the reason will be in its status and on
            // its standard error — which say far more than this end of the pipe can.
            if sink.write_all(&buffer[..read]).is_err() {
                break;
            }
            sent.fetch_add(read as u64, Ordering::Relaxed);
        }
        // Closing it is what tells the tool there is no more to come; without this it would sit
        // waiting for input that will never arrive.
        drop(sink);
        Ok(())
    }
}

/// The last few lines of a tool's standard error, kept in case it fails.
///
/// mysqldump's `--verbose` commentary is held apart from the rest: it is chatter this module asked
/// for, and it would otherwise crowd out the one line that says what went wrong — which these tools
/// write last. It is still kept, for a failure that leaves nothing else to show.
#[derive(Default)]
struct Tail {
    said: VecDeque<String>,
    everything: VecDeque<String>,
}

impl Tail {
    fn push(&mut self, line: String) {
        if line.trim().is_empty() {
            return;
        }
        if !line.starts_with("--") {
            Self::keep(&mut self.said, line.clone());
        }
        Self::keep(&mut self.everything, line);
    }

    fn keep(lines: &mut VecDeque<String>, line: String) {
        lines.push_back(line);
        if lines.len() > 8 {
            lines.pop_front();
        }
    }

    fn message(&self) -> String {
        let lines = if self.said.is_empty() { &self.everything } else { &self.said };
        lines.iter().cloned().collect::<Vec<_>>().join("\n")
    }
}

/// One line of a tool's standard error, with its line ending off — and `None` once there are no
/// more of them.
///
/// Read as bytes and made into text afterwards rather than through `BufRead::lines`, which hands
/// back an error for a line that is not valid UTF-8. These tools write their errors in whatever
/// character set the connection is using, and a dump's is the database's own — so a `latin1`
/// database whose error mentions a name with an accent in it is a line `lines` would refuse. That
/// refusal would end the reading there and take the rest of the failure with it, which is the one
/// thing standard error is being kept for.
fn next_line(source: &mut impl BufRead, buffer: &mut Vec<u8>) -> Option<String> {
    buffer.clear();
    match source.read_until(b'\n', buffer) {
        Ok(0) | Err(_) => None,
        // Takes the `\r` of a CRLF ending with it, which is what these tools write on Windows.
        Ok(_) => Some(String::from_utf8_lossy(buffer).trim_end().to_string()),
    }
}

/// Runs a tool to completion, with its output wired to the given files, and turns anything but a
/// clean exit into the error the caller reports.
///
/// `tick` is called as the tool talks and, failing that, four times a second; a caller with nothing
/// to watch passes a closure that does nothing.
///
/// Blocking on purpose — every caller is a `spawn_blocking`, because a dump takes as long as it
/// takes and has no business holding an async worker (or the connection lock) while it does.
fn run(
    tool: &Path,
    args: &[String],
    stdin: Option<Fed>,
    stdout: Option<File>,
    what: &str,
    mut tick: impl FnMut(Tick),
) -> Result<(), AppError> {
    let mut command = Command::new(tool);
    command
        .args(args)
        // Poured in by this side rather than handed over as a file, which is what lets the bytes be
        // counted on their way past.
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(stdout.map_or_else(Stdio::null, Stdio::from))
        .stderr(Stdio::piped());
    // Without this a console window flashes up over the app for every tool run.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| err!("error.cannotRunTool", tool = tool.display(), message = e))?;

    let feeder = stdin
        .zip(child.stdin.take())
        .map(|(fed, sink)| std::thread::spawn(move || fed.pour_into(sink)));

    // Read on a thread of its own rather than after the wait: a tool that fills the pipe while this
    // side waits for it to exit would deadlock, and the lines are wanted as they are written rather
    // than once there are no more of them.
    let (sender, lines) = mpsc::channel();
    let reader = child.stderr.take().map(|stderr| {
        std::thread::spawn(move || {
            let mut stderr = BufReader::new(stderr);
            let mut buffer = Vec::new();
            while let Some(line) = next_line(&mut stderr, &mut buffer) {
                if sender.send(line).is_err() {
                    break;
                }
            }
        })
    });

    let mut tail = Tail::default();
    loop {
        match lines.recv_timeout(Duration::from_millis(250)) {
            Ok(line) => {
                tick(Tick::Line(&line));
                tail.push(line);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => tick(Tick::Idle),
            // Standard error is closed, which the tool does by exiting.
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    if let Some(reader) = reader {
        let _ = reader.join();
    }

    let status = child
        .wait()
        .map_err(|e| err!("error.toolWaitFailed", tool = what, message = e))?;
    if !status.success() {
        // These tools report the real cause on stderr and only a number through the exit status, so
        // the message is what matters; the last lines of it are the ones that say why.
        return Err(err!("error.toolFailed", tool = what, status = status, message = tail.message()));
    }
    // Asked after the status and not before, because a tool that failed says why and a broken pipe
    // only says that it did. But a file that could not be read through is not allowed to pass as a
    // restore that worked: the tool would have been fed a piece of a dump and made no complaint.
    if let Some(Err(unread)) = feeder.map(|feeder| feeder.join().unwrap_or(Ok(()))) {
        return Err(unread);
    }
    Ok(())
}

fn create_file(path: &str) -> Result<File, AppError> {
    File::create(path).map_err(|e| err!("error.cannotWriteFile", path = path, message = e))
}

fn open_file(path: &str) -> Result<File, AppError> {
    File::open(path).map_err(|e| err!("error.cannotReadFile", path = path, message = e))
}

/// How far a transfer has got.
///
/// `percent` deliberately never reaches 100: the command returning is what says the work is
/// finished, and one fact should have one teller. A dump's figure is an estimate — see [`Tracker`]
/// for what it is made of — where a restore's is a count of the bytes actually handed over.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// 0 to 99, or `None` when there is no honest percentage to give — the bar shows movement
    /// instead of a number.
    pub percent: Option<u8>,
    /// What is being written out at this moment, for the line under the bar — a table of a MySQL
    /// database, a collection of a MongoDB one. A restore has none: what it is replaying is a
    /// stream, not a list of anything.
    pub part: Option<String>,
    /// Which of them that is, counted from one — the one in hand rather than the ones behind it,
    /// since "table 1 of 12" is what a reader takes "12 tables, working" to mean. Zero when there
    /// is none to be on, which is a restore and the moment before a dump reaches its first.
    pub at_part: u32,
    pub parts: u32,
}

/// Where a transfer says how far it has got, four times a second.
pub struct Watch<'a> {
    pub report: &'a dyn Fn(Progress),
}

/// The line `mysqldump --verbose` writes as it reaches each table, and the whole of the signal the
/// count below is built on.
const TABLE_LINE: &str = "-- Retrieving table structure for table ";

/// The table mysqldump has just reached, out of one line of its commentary — and `None` for every
/// other thing it has to say, which is most of them.
///
/// The most brittle thing here: a future mysqldump that words this differently says nothing this
/// recognises, and the dump then runs with a bar that moves without a number.
fn reached_table(line: &str) -> Option<&str> {
    line.strip_prefix(TABLE_LINE)?.strip_suffix("...")
}

/// How many bytes of file a byte of table is assumed to turn into, until any actually have.
///
/// `DATA_LENGTH` counts whole pages, including the room InnoDB leaves for rows to grow into, so a
/// table's share of the file usually comes out somewhat smaller than its share of the server's
/// disk. Only ever used to move the bar *within* a table that has not finished yet, and replaced by
/// the observed figure as soon as one has.
const ASSUMED_RATIO: f64 = 0.8;

/// How big a table or collection has to be before what it wrote is worth learning the ratio from.
///
/// A table's weight is rounded up to whole pages and never reads as less than one, so an empty
/// table weighs 16KB and writes a line and a half of SQL. Left in, those are what the ratio would
/// mostly be made of — and one of them, seen first, would put every table after it at eleven times
/// its true share.
const CALIBRATE_FROM: u64 = 1 << 20;

/// A dump tool's commentary and the growing file, turned into a percentage.
///
/// Neither mysqldump nor mongodump reports progress in a form worth reading — the one says nothing
/// at all unless told to be verbose, the other draws a bar every three seconds. What both will do
/// is name each table or collection as they reach it, so the ones behind are known; and weighing
/// each by what its rows or documents take on the server makes that a percentage rather than a
/// count, which would jump a third of the way along at a table holding a thousandth of the rows.
///
/// That alone would sit still through the one huge table most databases have, so the size of the
/// file being written is read as well and used to place the dump inside the one it is on.
struct Tracker {
    /// What each table or collection weighs, by name.
    weights: HashMap<String, u64>,
    total: u64,
    /// Where the dump is being written, read for its size to see inside the current part.
    path: PathBuf,
    /// Whether that reading means anything: a structure-only dump writes much the same few hundred
    /// bytes per table however many rows it has, so there the count is the whole story.
    rows: bool,
    /// What the parts already written weighed.
    done: u64,
    /// The part being written: its name, its weight, and how big the file was when it began.
    current: Option<(String, u64, u64)>,
    parts_done: u32,
    parts: u32,
    /// The bytes written for the parts that have finished, against what those weighed — the
    /// observed form of [`ASSUMED_RATIO`].
    written: u64,
    weighed: u64,
    /// Never allowed to fall. The estimate is revised as the ratio settles, and a bar that goes
    /// backwards reads as a mistake rather than as a correction.
    percent: f64,
}

impl Tracker {
    fn new(parts: &[(String, u64)], path: &str, rows: bool) -> Self {
        let mut weights: HashMap<String, u64> = parts.iter().cloned().collect();
        let mut total: u64 = weights.values().sum();
        let rows = rows && total > 0;
        // Two dumps have no use for what the rows weigh: one that is not writing any, and one whose
        // tables are all empty — which weigh nothing between them and would leave the bar with
        // nothing to fill against. Both fall back to counting the parts, which is coarse but is
        // the whole of the work in either case.
        if !rows {
            for weight in weights.values_mut() {
                *weight = 1;
            }
            total = weights.len() as u64;
        }
        let parts = weights.len() as u32;
        Self {
            weights,
            total,
            path: PathBuf::from(path),
            rows,
            done: 0,
            current: None,
            parts_done: 0,
            parts,
            written: 0,
            weighed: 0,
            percent: 0.0,
        }
    }

    fn size(&self) -> u64 {
        std::fs::metadata(&self.path).map(|meta| meta.len()).unwrap_or(0)
    }

    /// The tool has reached `part`, which is also to say it has finished the one before it.
    fn reached(&mut self, part: &str) {
        let size = self.size();
        if let Some((_, weight, from)) = self.current.take() {
            self.done += weight;
            self.parts_done += 1;
            if weight >= CALIBRATE_FROM {
                self.written += size.saturating_sub(from);
                self.weighed += weight;
            }
        }
        // A view weighs nothing and is in no list of tables, being no table: let the total grow
        // rather than report a dump that has passed more of them than it has.
        self.parts = self.parts.max(self.parts_done + 1);
        let weight = self.weights.get(part).copied().unwrap_or(0);
        self.current = Some((part.to_string(), weight, size));
    }

    fn progress(&mut self) -> Progress {
        // Nothing was known about what the database holds, so there is nothing to be a fraction of.
        if self.total == 0 {
            return Progress {
                percent: None,
                part: self.current.as_ref().map(|(name, ..)| name.clone()),
                at_part: self.at_part(),
                parts: self.parts,
            };
        }

        let mut done = self.done as f64;
        if let Some((_, weight, from)) = &self.current {
            if !self.rows {
                // Counting parts: reaching one is as good as finishing it, since what a
                // structure-only dump writes for a table is a few hundred bytes and gone before the
                // next reading. Left out, a two-table dump would end at half.
                done += *weight as f64;
            } else if *weight > 0 {
                let ratio = if self.weighed > 0 {
                    // Held to a band either side of the assumption: one table that compresses or
                    // expands like nothing else in the database should move the estimate, not
                    // become it.
                    (self.written as f64 / self.weighed as f64).clamp(0.2, 4.0)
                } else {
                    ASSUMED_RATIO
                };
                // Never past the part's own share, however far off the ratio turns out to be.
                done += ((self.size().saturating_sub(*from) as f64) / ratio).min(*weight as f64);
            }
        }
        self.percent = self
            .percent
            .max((done / self.total as f64 * 100.0).clamp(0.0, 99.0));

        Progress {
            percent: (self.parts_done > 0 || self.current.is_some())
                .then_some(self.percent.round() as u8),
            part: self.current.as_ref().map(|(name, ..)| name.clone()),
            at_part: self.at_part(),
            parts: self.parts,
        }
    }

    /// The part in hand, counted from one — the ones behind it plus the one it is on.
    fn at_part(&self) -> u32 {
        self.parts_done + u32::from(self.current.is_some())
    }
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
///
/// `tables` is every base table of the database against what its rows weigh on the server, which
/// is what the progress reported through `watch` is worked out from; see [`Tracker`]. Empty when
/// the server would not say, which costs the dump nothing but its percentage.
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
    tables: &[(String, u64)],
    watch: &Watch<'_>,
) -> Result<(), AppError> {
    let options = OptionFile::new(host, port, user, password)?;

    let mut args = vec![
        // Must come first: mysqldump reads its option files before anything else on the line.
        format!("--defaults-extra-file={}", options.path.display()),
        format!("--default-character-set={charset}"),
        // Names each table on standard error as it reaches it, which is the only account mysqldump
        // gives of how far along it is. It goes nowhere near the dump itself, which is standard
        // output.
        "--verbose".to_string(),
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
    let mut tracker = Tracker::new(tables, path, mode != DumpMode::Structure);
    run(tool, &args, None, Some(out), "mysqldump", |tick| {
        if let Tick::Line(line) = tick {
            // Everything else it says — connecting, savepoints, the rows of a table already
            // counted — leaves the reckoning where it was, and is not worth a reading of its own.
            let Some(table) = reached_table(line) else { return };
            tracker.reached(table);
        }
        (watch.report)(tracker.progress());
    })
}

/// Replays a SQL file through the `mysql` client.
///
/// `database` is where the file's statements land, since a dump written by this app names no
/// database of its own. A file from elsewhere that does carry a `USE` still overrides this — the
/// client cannot refuse a statement in the file it is given.
///
/// Progress is the plainest of any of these: the file is fed to the client by this side rather
/// than handed over, so what is reported through `watch` is the share of it actually sent. It runs
/// a little ahead of the truth at the end — the last statements are still being executed when the
/// last bytes have gone — which is why the figure stops short of 100.
#[allow(clippy::too_many_arguments)]
pub fn mysql_restore(
    tool: &Path,
    host: &str,
    port: u16,
    user: &str,
    password: &str,
    database: &str,
    path: &str,
    watch: &Watch<'_>,
) -> Result<(), AppError> {
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

    let file = open_file(path)?;
    // A file whose size cannot be read is still restored, just without a percentage to go with it.
    let total = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let sent = Arc::new(AtomicU64::new(0));
    let counted = Arc::clone(&sent);
    let fed = Fed { file, path: path.to_string(), sent };

    run(tool, &args, Some(fed), None, "mysql", |_| {
        (watch.report)(Progress {
            percent: share(counted.load(Ordering::Relaxed), total),
            ..Progress::default()
        });
    })
}

/// How much of a file has gone into the tool, as a percentage — and `None` for a file whose size
/// could not be read, which is a restore that runs without a number rather than one that refuses.
///
/// Stops at 99 however much has been sent: the client is still executing the last of what it was
/// given long after the last byte of it has been handed over.
fn share(sent: u64, total: u64) -> Option<u8> {
    if total == 0 {
        return None;
    }
    Some(((sent as f64 / total as f64) * 100.0).min(99.0) as u8)
}

/// Splits a MongoDB URI into the parts this module rewrites: what is before the host list, the
/// host list itself, the `/database` path, and the `?options`.
fn split_uri(uri: &str) -> Result<(String, String, String, String), AppError> {
    let (scheme, rest) = uri
        .split_once("://")
        .ok_or_else(|| err!("error.notMongoUri"))?;
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
fn tool_uri(uri: &str, endpoint: Option<(&str, u16)>) -> Result<String, AppError> {
    let (head, hosts, _path, query) = split_uri(uri)?;
    let Some((host, port)) = endpoint else {
        return Ok(format!("{head}{hosts}/{query}"));
    };
    if head.starts_with("mongodb+srv://") {
        return Err(err!("error.srvOverTunnel"));
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
///
/// `documents` is what `$collStats` says the database's documents weigh, and is where the progress
/// reported through `watch` comes from — see [`archive_share`]. Zero when the server would not say,
/// which costs the dump nothing but its percentage.
pub fn mongo_dump(
    tool: &Path,
    uri: &str,
    endpoint: Option<(&str, u16)>,
    database: &str,
    path: &str,
    documents: u64,
    watch: &Watch<'_>,
) -> Result<(), AppError> {
    let args = vec![
        format!("--uri={}", tool_uri(uri, endpoint)?),
        format!("--db={database}"),
        format!("--archive={path}"),
    ];
    let archive = PathBuf::from(path);
    run(tool, &args, None, None, "mongodump", |_| {
        let written = std::fs::metadata(&archive).map(|meta| meta.len()).unwrap_or(0);
        (watch.report)(Progress {
            percent: archive_share(written, documents),
            ..Progress::default()
        });
    })
}

/// How big a mongodump archive comes out against what the documents in it weigh.
///
/// One, as near as makes no difference: an archive is those documents' own BSON, which is exactly
/// what `$collStats` measures, and the headers around them are a few hundred bytes per namespace.
/// Measured against this server twice — 200,066,402 bytes of archive for 200,065,450 of documents,
/// and 50,018,402 for 50,017,450. Named rather than left implicit because it is an assumption about
/// a file format, and the one place to correct if a future mongodump stops holding to it.
const ARCHIVE_PER_DOCUMENT: f64 = 1.0;

/// How far through the archive a dump is, from the bytes on disk against what the documents weigh.
///
/// This is the whole of mongodump's progress, and it is deliberately not read out of what mongodump
/// says. Its own account is a bar drawn every three seconds, and it dumps four collections at once
/// unless told otherwise — so the collection it names is one of several in flight, and counting
/// them would report a dump further along than it is. The file on disk is under no such doubt.
///
/// It does arrive in steps rather than smoothly: mongodump holds about 16MB back before writing,
/// so a 200MB dump climbs in a dozen jumps and a small one in two or three. The bigger the dump the
/// less that shows, which is the right way round — a dump small enough for the steps to be coarse
/// is over in seconds.
fn archive_share(written: u64, documents: u64) -> Option<u8> {
    if documents == 0 {
        return None;
    }
    share(written, (documents as f64 * ARCHIVE_PER_DOCUMENT) as u64)
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
fn archive_database(path: &str) -> Result<String, AppError> {
    use mongodb::bson::Document;
    use std::io::Read;

    let mut file = open_file(path)?;
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)
        .map_err(|e| err!("error.cannotReadFile", path = path, message = e))?;
    if u32::from_le_bytes(magic) != ARCHIVE_MAGIC {
        return Err(err!("error.notMongoArchive", path = path));
    }
    let unreadable =
        |e: mongodb::bson::de::Error| err!("error.archiveDatabaseUnreadable", path = path, message = e);
    // The header, which carries versions rather than namespaces.
    Document::from_reader(&mut file).map_err(unreadable)?;
    let metadata = Document::from_reader(&mut file).map_err(unreadable)?;
    metadata
        .get_str("db")
        .map(str::to_string)
        .map_err(|_| err!("error.archiveNamesNoDatabase", path = path))
}

/// Restores a mongodump archive into `database`, whatever database it was dumped from.
///
/// The rename is what makes the choice in the sidebar mean something: without it the documents go
/// back where they came from, which for an archive from another server is rarely where they are
/// wanted.
///
/// The archive is poured into mongorestore rather than named to it — `--archive` with no value is
/// how it is told to read one from its standard input. That costs nothing, since it reads the
/// archive from end to end either way, and it is what makes the progress reported through `watch` a
/// count of bytes actually handed over rather than anything inferred.
pub fn mongo_restore(
    tool: &Path,
    uri: &str,
    endpoint: Option<(&str, u16)>,
    database: &str,
    path: &str,
    watch: &Watch<'_>,
) -> Result<(), AppError> {
    let mut args = vec![
        format!("--uri={}", tool_uri(uri, endpoint)?),
        "--archive".to_string(),
    ];
    let source = archive_database(path)?;
    if source != database {
        // Every collection of the one database, and only that database: an archive holding more
        // than the dump wrote would otherwise have the rest restored under their own names.
        args.push(format!("--nsInclude={source}.*"));
        args.push(format!("--nsFrom={source}.*"));
        args.push(format!("--nsTo={database}.*"));
    }

    let file = open_file(path)?;
    // A file whose size cannot be read is still restored, just without a percentage to go with it.
    let total = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let sent = Arc::new(AtomicU64::new(0));
    let counted = Arc::clone(&sent);
    let fed = Fed { file, path: path.to_string(), sent };

    run(tool, &args, Some(fed), None, "mongorestore", |_| {
        (watch.report)(Progress {
            percent: share(counted.load(Ordering::Relaxed), total),
            ..Progress::default()
        });
    })
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

    /// Real lines from `mysqldump --verbose`, of which exactly one kind says a table has been
    /// reached. Everything else it says is chatter the count must not move for.
    #[test]
    fn reads_the_table_out_of_the_commentary() {
        assert_eq!(
            super::reached_table("-- Retrieving table structure for table orders..."),
            Some("orders")
        );
        assert_eq!(super::reached_table("-- Retrieving rows..."), None);
        assert_eq!(super::reached_table("-- Rolling back to savepoint sp..."), None);
        assert_eq!(super::reached_table("-- Connecting to 192.168.1.1..."), None);
        assert_eq!(
            super::reached_table("mysqldump: Got error: 1049: Unknown database 'shop'"),
            None
        );
    }

    /// A dump's failure has to be readable through the commentary this module asked for: the lines
    /// mysqldump writes about its own progress are held back, and the one that says what went wrong
    /// is what the error carries.
    #[test]
    fn keeps_the_error_out_of_the_commentary() {
        let mut tail = super::Tail::default();
        for line in [
            "-- Connecting to db.example...",
            "-- Retrieving table structure for table orders...",
            "",
            "mysqldump: Got error: 1044: Access denied for user 'app'@'%'",
        ] {
            tail.push(line.to_string());
        }
        assert_eq!(
            tail.message(),
            "mysqldump: Got error: 1044: Access denied for user 'app'@'%'"
        );

        // A failure with nothing but commentary to show still has to say something.
        let mut nothing_else = super::Tail::default();
        nothing_else.push("-- Connecting to db.example...".to_string());
        assert_eq!(nothing_else.message(), "-- Connecting to db.example...");
    }

    /// A tool's standard error is not promised to be UTF-8: these tools write what the server told
    /// them in whatever character set the connection is using, and a dump's is the database's own.
    /// The line that says what went wrong comes last, so it only survives if a line that will not
    /// decode is stepped over rather than treated as the end of the output.
    #[test]
    fn reads_past_a_line_that_will_not_decode() {
        let mut stderr = b"-- Connecting to db.example...\n".to_vec();
        // A table name with an accent in it, from a latin1 database.
        stderr.extend_from_slice(b"-- Retrieving table structure for table h\xf3a_don...\n");
        stderr.extend_from_slice(b"mysqldump: Got error: 1044: Access denied\r\n");

        let mut source = &stderr[..];
        let mut buffer = Vec::new();
        let mut lines = Vec::new();
        while let Some(line) = super::next_line(&mut source, &mut buffer) {
            lines.push(line);
        }

        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], "-- Connecting to db.example...");
        // The byte that would not decode is stood in for, and the rest of its line is still there.
        assert!(lines[1].ends_with("_don..."));
        // The one this is all for: it comes after the line that would not decode.
        assert_eq!(lines[2], "mysqldump: Got error: 1044: Access denied");
    }

    /// One temporary file, grown to order, standing in for the dump being written.
    struct Written(std::path::PathBuf);

    impl Written {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("mixdb-test-{}.sql", uuid::Uuid::new_v4()));
            std::fs::write(&path, b"").unwrap();
            Self(path)
        }

        fn grow_to(&self, bytes: usize) {
            std::fs::write(&self.0, vec![b'x'; bytes]).unwrap();
        }

        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for Written {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    /// The reckoning behind the bar: a table's share is what its rows weigh on the server, and
    /// where the dump has got to inside the table it is on is read from the file it is writing.
    #[test]
    fn weighs_each_table_by_what_its_rows_take() {
        const MB: u64 = 1 << 20;
        let file = Written::new();
        let tables = vec![("small".to_string(), 4 * MB), ("large".to_string(), 12 * MB)];
        let mut tracker = super::Tracker::new(&tables, &file.path(), true);

        // Nothing written yet, and the first table only just reached.
        tracker.reached("small");
        let start = tracker.progress();
        assert_eq!(start.percent, Some(0));
        assert_eq!(start.part.as_deref(), Some("small"));
        assert_eq!((start.at_part, start.parts), (1, 2));

        // Halfway through the first table's bytes, at the ratio assumed before any are known: half
        // of a table that is a quarter of the database.
        file.grow_to((2 * MB) as usize * 4 / 5);
        assert_eq!(tracker.progress().percent, Some(12));

        // The whole of it, and the next table begun — the first table's share, and no more, however
        // much of the file it turned out to take.
        file.grow_to((6 * MB) as usize);
        tracker.reached("large");
        let second = tracker.progress();
        assert_eq!(second.percent, Some(25));
        assert_eq!((second.at_part, second.parts), (2, 2));

        // A third of the way through the larger table — measured at the ratio the first one turned
        // out to have, six bytes of file to four of table, rather than at the assumed one.
        file.grow_to((12 * MB) as usize);
        assert_eq!(tracker.progress().percent, Some(50));

        // A table that overruns what it was thought to weigh does not take the bar past its share,
        // and 100 is never claimed: the command returning is what says the dump is finished.
        file.grow_to((400 * MB) as usize);
        assert_eq!(tracker.progress().percent, Some(99));
    }

    /// A view weighs nothing and is in no list of tables — mysqldump writes one out all the same,
    /// and the count has to make room for it rather than report five tables of four.
    #[test]
    fn makes_room_for_what_it_was_not_told_about() {
        let file = Written::new();
        let tables = vec![("orders".to_string(), 1 << 20)];
        let mut tracker = super::Tracker::new(&tables, &file.path(), true);

        tracker.reached("orders");
        tracker.reached("recent_orders");
        let progress = tracker.progress();
        assert_eq!(progress.part.as_deref(), Some("recent_orders"));
        assert_eq!((progress.at_part, progress.parts), (2, 2));
    }

    /// A structure-only dump writes much the same for a table whatever it holds, so its bar counts
    /// tables — weighing them by rows it is not writing would stall on the big one and then leap.
    ///
    /// The table it is on counts as written: a few hundred bytes go out for one and the next
    /// reading is a quarter of a second later, so waiting for the next table to say this one is
    /// done would leave a two-table dump ending at half.
    #[test]
    fn counts_the_tables_when_the_rows_are_not_being_written() {
        let file = Written::new();
        let tables = vec![("small".to_string(), 1 << 10), ("large".to_string(), 1 << 30)];
        let mut tracker = super::Tracker::new(&tables, &file.path(), false);

        tracker.reached("small");
        assert_eq!(tracker.progress().percent, Some(50));
        tracker.reached("large");
        assert_eq!(tracker.progress().percent, Some(99));
    }

    /// A restore's figure is a count rather than an estimate, and the only thing it has to be
    /// careful about is the end: the client goes on executing after the last byte has gone in.
    #[test]
    fn counts_a_restore_out_of_the_file_it_is_fed() {
        assert_eq!(super::share(0, 16), Some(0));
        assert_eq!(super::share(8, 16), Some(50));
        assert_eq!(super::share(16, 16), Some(99));
        // A file whose size could not be read: no number to give, but the restore still runs.
        assert_eq!(super::share(0, 0), None);
    }

    /// A mongodump archive is the documents' own BSON with little else in it, so what is on disk
    /// against what `$collStats` says they weigh is a fair reading of how far along the dump is.
    #[test]
    fn measures_an_archive_against_what_its_documents_weigh() {
        const MB: u64 = 1 << 20;
        assert_eq!(super::archive_share(0, 100 * MB), Some(0));
        assert_eq!(super::archive_share(50 * MB, 100 * MB), Some(50));
        // Overrunning what it was expected to come to does not take the bar past the end, and 100
        // is never claimed: the command returning is what says the dump is finished.
        assert_eq!(super::archive_share(500 * MB, 100 * MB), Some(99));
        // A server that would not say what its collections hold: no number to give, but the dump
        // still runs and the bar still moves.
        assert_eq!(super::archive_share(50 * MB, 0), None);
    }

    /// Nothing known about the database's tables — a user `information_schema` shows nothing to —
    /// leaves no honest percentage to give, but the dump still runs and still says where it is.
    #[test]
    fn gives_no_percentage_it_cannot_stand_behind() {
        let file = Written::new();
        let mut tracker = super::Tracker::new(&[], &file.path(), true);

        tracker.reached("orders");
        let progress = tracker.progress();
        assert_eq!(progress.percent, None);
        assert_eq!(progress.part.as_deref(), Some("orders"));
        assert_eq!(progress.parts, 1);
    }
}
