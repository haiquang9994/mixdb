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

### Added

- A connection over an SSH tunnel now heals itself: the tunnel keeps its session alive and opens a new one behind the same local port when it drops.
- REST requests take `{{variables}}` from an environment picked at the end of the tab strip, with values marked secret kept in the OS credential store instead of on disk.
- REST requests carry credentials: a bearer token, basic auth, or an API key sent as a header or a query parameter.
- REST bodies can now be a form, a multipart upload with files from disk, or a single file sent as it is.
- A connection that dropped now says so plainly instead of repeating the driver's own words about bytes at EOF.
- A read that died with the connection is run again once, after the tunnel has been opened back up. Writes are never repeated.

## [0.0.13] - 2026-08-19

### Added

- REST client tabs: compose a request, send it, and read the response as a preview, a tree or raw bytes.
- Pasting a cURL command into a REST tab fills a request in — method, URL, headers and body — and right-clicking a request copies it back out as one.
- Pasted REST requests collect in the sidebar's Recent group, which holds ten and can pin one to Saved.
- Settings has a Shortcuts pane listing every Ctrl/Cmd shortcut in the app.
- Ctrl/Cmd+1 opens a Database tab and Ctrl/Cmd+2 a REST tab.

## [0.0.12] - 2026-08-15

### Added

- The Structure tab searches a table's columns by name.
- The Statistics tab searches a database's tables by name, and totals what the search leaves.

### Changed

- The Structure tab marks a default the server evaluates, such as `uuid()`, with an `f(x)` badge, so it no longer reads as stored text.

### Fixed

- Dumping a MariaDB database no longer fails as soon as it starts.
- Column defaults read correctly on MariaDB, which showed them quoted and made every nullable column look as though it defaulted to NULL.
- MariaDB's `uca1400_*` collations say which character sets they cover instead of showing a blank.
- A new row on MariaDB no longer stores the text of an expression default, such as `uuid()`, as the value itself.
- A `varchar` column left with an empty length box is created with the 255 the box suggests, instead of refusing to save.

## [0.0.11] - 2026-08-14

### Added

- Connect to PostgreSQL: browse and edit its rows, change tables and indexes, run queries with completion, and dump or restore with pg_dump and psql — which MixDB can now download for you on Windows and macOS, or find wherever PostgreSQL is already installed.

### Changed

- Saved connections, the connection form and the open tabs show each engine's own logo instead of a lettered badge.

## [0.0.10] - 2026-08-13

### Added

- A right-click menu on MySQL rows: copy a cell, copy the selected rows as `INSERT` statements, as
  TSV or as CSV, follow a foreign key to the row it points at, and reload.
  Following a key leaves the table search alone and pins the table it opened at the top of the
  list, until another table is chosen.
- A Redis connection to another machine with no password now warns that the server's protected mode
  will refuse it, instead of leaving you with "Redis: broken pipe".
- `Ctrl+F` on a MySQL table puts the caret in the filter bar's first value box, adding a row if
  there is none.
- Settings › Appearance can turn the layers that float over your data — menus, dropdowns, tooltips,
  the update toast, the loading pill and the dialogs — to liquid glass, which frosts and bends what
  is behind them. A grid's pinned header and totals frost the rows sliding under them, and the page,
  the tab bar and the controls take the same material. Off by default.
- Opening a MySQL or MongoDB database puts the caret in the sidebar's search box, and `↓` from there
  hands the keyboard to the list: the arrows walk the tables or collections, Enter opens the one they
  are on, and `↑` off the top row goes back to the search box.

### Changed

- Marking a connection read-only now works for every kind, not only MySQL. On MongoDB the
  collections cannot be created, renamed or dropped, the dump tools are closed, and documents
  neither open for editing nor take an insert, a clone or a delete; on Redis, keys cannot be
  deleted from either the value pane or a group. Everything that reads works as before.
- A MySQL table opens where you left it — same page, order, filters, scroll and rows — as do its
  structure and its database's statistics. Only a reload, `Ctrl+R`, or a change you made yourself
  asks the server again, and a change to one table costs only that table.
- MongoDB works the same way: a collection opens on the page, filters and scroll it was left at,
  and the Statistics tab keeps what it read for each database. Moving to the Statistics tab and
  back no longer re-reads the documents. Creating, renaming or dropping a collection does.
- A `CREATE`, `ALTER` or `DROP` run in the Query tab refreshes the table list and the other tabs
  with it, the same as making the change from the sidebar.
- Inserting or deleting rows or documents moves the statistics too.
- A right-click no longer opens the browser's own menu. The app's menus, and cut, copy and paste in
  a text field, are unchanged.
- A right-click menu no longer holds the rest of the window: the click that dismisses it also does
  what it was aimed at, and scrolling closes it.
- `Ctrl+A` on a MySQL table's Data tab selects every row on the page without clicking the grid
  first. In a text box it still selects the text.
- A MySQL table now shows 1000 rows a page by default, and 5000 is offered alongside the other
  sizes.
- Tab reaches a sidebar list as one stop rather than one per table or collection; the arrows walk
  it from there.
- Reloading a MySQL table or a MongoDB collection goes back to the top of the first page. An insert
  or a delete still refetches the page it was made on.

### Fixed

- On macOS every shortcut is now `⌘` rather than `Ctrl` — reload, new and close tab, select all,
  format, and click-to-open in the Query tab — leaving `Ctrl+Click` to the context menu it has
  always opened. Shortcuts on screen are written the way the platform writes them.
- Scrolling the Query tab sideways no longer runs the script over its own line numbers.
- Colour and edge fixes in the MySQL Data grid, whose rules were drawn in a fixed light grey that
  stayed light on the dark theme, and whose frame had square corners.

## [0.0.9] - 2026-08-12

### Added

- The MySQL dump tools can now be downloaded on macOS and on Linux x86-64, not only on Windows.

### Changed

- Where there is no download to be had — Linux on ARM — the Download button is replaced by a line
  saying to install mysql-client from the package manager, rather than failing when pressed.

## [0.0.8] - 2026-08-12

### Changed

- A `SELECT` written without a `LIMIT` of its own is now sent with a ceiling of ten thousand rows
  rather than five hundred, and that ceiling is no longer a setting.
- Moving between a connection's tabs no longer re-reads anything: Data comes back to the page,
  filters and selection it was left on, and Structure to the columns and indexes it had.
- Dialogs, menus and tooltips now fade in and out instead of appearing and vanishing outright.
- A connection marked read-only now says so before you touch anything: its row in the connection
  list carries a Read-only badge, and once it is open, its tab shows a lock and an amber bar along
  the top in place of the usual accent.
- The wait shown over a panel that is loading is now a larger pill with a turning ring, rather than
  a small grey line easily taken for part of the table under it.

### Fixed

- A grid of more than a few dozen rows no longer slows the app down — the Query tab's results, the
  Data tab, Structure and Statistics each build only the rows on screen, so ten thousand rows cost
  what a screenful costs. Selecting, sorting and editing in place work exactly as before.
- The Query tab's results no longer show a scrollbar when the one result in the column already
  fits.
- The update panel now lists what a new version changed, instead of showing the word "Added".

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
