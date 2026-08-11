# Changelog

What changed in each released version of MixDB, newest first.

This file is written for the people who *use* MixDB, not for the people who write it. A change
belongs here if someone would notice it — a new feature, a different behaviour, a fixed bug.
Refactors, CI work and dependency bumps do not go here; the git history is where those live.

## How this file is kept

Work lands in `## [Unreleased]` **as it is finished**, not at release time. That is the whole
point of the file: by the time a version is cut, nobody remembers what went into it, and the notes
end up thinner and vaguer than the work deserved.

```bash
npm run notes            # list the commits since the last tag, grouped, as a starting draft
                         # -> edit into plain sentences under ## [Unreleased]
npm run set-version 0.1.0  # cuts ## [Unreleased] into ## [0.1.0] - <today> and opens a fresh one
```

Every entry sits under one of three headings — `### Added`, `### Changed`, `### Fixed` — and is one
short line. `Fixed` is for bugs in a *released* version: repairing something still sitting unreleased
above it means editing that entry, not adding a new one. The full rules, for whoever is writing:
[.agent/conventions/changelog.md](.agent/conventions/changelog.md).

From there the release workflow reads this file: the section for the version being tagged becomes
the `## Changes` part of the draft release body, which in turn becomes the update notes every
installed copy of MixDB is shown. So what is written here is what users read — see
[docs/RELEASING.md](docs/RELEASING.md).

**Released sections are not edited or deleted.** They are the record of what shipped in which
version, which is exactly what someone three versions behind needs when deciding whether to
update. The one exception is a release that is withdrawn: once it is gone from
[Releases](https://github.com/haiquang9994/mixdb/releases) nobody can install it, so its section here
would describe a version that no longer exists. The file grows by a handful of lines per release;
if it ever gets genuinely unwieldy, the oldest versions move to `docs/changelog/` and a link goes
at the bottom — the entries survive either way.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.7] - 2026-08-11

### Added

- The Query tab has a bar along its bottom edge. Expand lifts the whole results pane out over the
  window — a script of several SELECTs no longer gives each of them a quarter of an already short
  pane — and Escape, the close button or a click outside puts it back. The button beside it puts the
  results away to get the window back for the script, and running again brings them up.
- A single run can be dropped from the Query tab's History, rather than only clearing the lot: the
  failed attempts a working query leaves behind it can go without taking the query with them.

### Changed

- `Ctrl+R` now acts on the pane you are looking at instead of reloading MixDB and dropping every
  open connection with it: it reloads MySQL's Data and Structure tabs, MongoDB's documents and the
  Statistics tab, and runs the script in the Query tab. `Ctrl+Shift+R` and `F5` do nothing.
- The Query tab has a single Run button. It runs the selected text, or the whole script when
  nothing is selected — `Ctrl+Enter`, `Ctrl+Shift+Enter` and the Run all button are gone.
- The Query tab keeps the whole window for the script until a run has something to show, and then
  the results rise into place under it. The line between the two is dragged to give either one more
  room, in place of the editor's own resize corner.

### Fixed

- A result shortened by an added `LIMIT` no longer has the bottom of its first table cut off. The
  line saying the limit was added sat inside the scrolling results and pushed them down past the
  bottom edge.
- Spacing and alignment fixes in the buttons that carry an icon beside their label.

## [0.0.6] - 2026-08-11

### Added

- The Query tab is a real SQL editor: MySQL syntax coloured as it is typed, matched brackets and
  quotes, line numbers, `Ctrl+F` to search and replace, and a Format button (`Ctrl+Shift+F`).
- Table and column names complete from the database itself — tables after `FROM` and `JOIN`,
  columns of the tables in the statement, aliases and all, with types and foreign-key targets
  beside them — alongside keywords, MySQL's functions and your saved queries.
- `Ctrl+Enter` runs the statement the caret is in, marked in the margin; `Ctrl+Shift+Enter` runs
  the whole script; a selection runs exactly the selection.
- The script is checked as it is written: an unclosed quote or bracket in red, a name the database
  has never heard of in amber with the closest real one as a one-press fix, and MySQL's own words
  about the statement being typed against the line it named. `F8` walks the problems.
- Resting the pointer on a name says what it is — a table's columns, a column's type and keys, a
  function's signature — and `Ctrl+Click` a table name opens its rows.
- An `UPDATE`, `DELETE` or `TRUNCATE` that says nothing about which rows asks first, as does a
  `DROP` or an `ALTER` that drops a column, partition or key. A statement opening with `WITH` is
  judged by what it leads into.
- A `SELECT` written without a `LIMIT` is sent with one — five hundred rows by default, changeable
  in Settings and switchable off. Your own `LIMIT` and locking reads are left alone.
- A saved connection can be marked read-only from the sidebar's right-click menu, and then nothing
  in the workspace will change the server: the Query tab refuses anything but a read and says which
  word it stopped at, and editing, dumps, restores and structure changes are closed. It is a
  reminder about which server this is, not a permission.
- The Query tab keeps its script per connection and database, remembers what has been run in a
  searchable History, and saves queries under a name in Snippets.
- Redis: right-clicking a group in the key sidebar offers "List keys to delete" — the keys under
  that prefix open on the right with a tickbox each, a filter box and a Delete button.
- Redis: a key limit picker beside the grouping character says how much of the keyspace to read
  before the scan stops, remembered per connection.
- A saved connection can be pinned from the sidebar's right-click menu and is held at the top.

### Changed

- The connection list is ordered by name, pinned first. Accented names file beside their plain
  spelling, and `db2` comes before `db10`.
- The connection form is drawn at the app's own control size, so it takes noticeably less height.
- The SSH tunnel test answers in colour, and its button stays disabled until the host, the user and
  the chosen auth method's credential have been filled in.
- Everything through an SSH tunnel moves faster — dumps and restores most visibly. The forward now
  carries both directions at once, in much larger pieces, and sends each the moment it has it.
- Redis: the key sidebar reads the whole keyspace up front instead of a page per press of Load
  more, so the sorted list only ever grows downwards. Its footer stays at the bottom, says how many
  keys have been read, and marks folder counts `12+` while a scan is still running.
- A mouse wheel spun quickly carries up to four times as far, and a pause drops straight back to a
  single notch. Touchpads scroll as they always did.

### Fixed

- Typing in the Query tab is no longer slow once a large result is on screen. The grid is redrawn
  when the results change, not when the script does.
- Running a script that holds nothing but comments says so, instead of leaving the results blank.
- Saving, renaming or deleting a connection in one tab now shows in every other open tab.
- A new connection tab no longer opens with a narrow sidebar that widens a beat later and shoves
  the form sideways.
- Updating a saved connection keeps the rest of what is remembered about it — whether it is pinned,
  the sidebar width, Redis's key limit.
- The filter bar keeps its conditions through a trip to the Structure, Stats or Query tab.

## [0.0.5] - 2026-08-10

### Added

- The window opens at 1280×800 and remembers whether it was left maximized.

### Fixed

- Update notes written on a published release are now copied into the manifest the updater reads.
  Before this, the panel in the corner of the app described every update with a placeholder.

## [0.0.4] - 2026-08-10

First published release. MySQL, MongoDB and Redis connections, optionally through an SSH tunnel,
with saved connections kept in the OS credential store rather than in a file.

MixDB updates itself from here on: it downloads a new version in the background, asks, then
installs it and restarts. Every update is checked against MixDB's signing key first.
