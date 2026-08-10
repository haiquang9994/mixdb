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

- The Query tab is a real SQL editor. MySQL syntax is coloured as it is typed, brackets and quotes
  are matched and closed, lines are numbered, and `Ctrl+F` searches and replaces inside the script.
- The Query tab completes table and column names from the database itself. Typing after `FROM` or
  `JOIN` offers its tables; typing a column offers the ones the tables in the statement actually
  have, alias and all, each with its type beside it and an arrow to what a foreign key points at.
  Keywords and MySQL's own functions complete throughout. The list is read once per database and
  refreshed whenever something in the app changes that database's shape.
- The Query tab runs one statement at a time. `Ctrl+Enter` runs the statement the caret is in —
  which is marked in the margin, so it is clear before pressing anything which one that is — and
  `Ctrl+Shift+Enter` runs the whole script. Selecting text still runs exactly the selection.
- The Query tab has a Format button (`Ctrl+Shift+F`) that lays the script out, keywords upper-cased
  and clauses on their own lines. With text selected it reformats only the selection.
- The Query tab checks the script as it is written. A quote or a bracket left open is underlined in
  red straight away; a table or column name the database has never heard of is underlined in amber,
  with the closest real name offered as a one-press fix. A moment later MySQL itself is asked what
  it makes of the statement being typed — it is prepared and the plan thrown away, so nothing runs
  — and its own words appear against the line it named. `F8` walks the problems.
- An `UPDATE`, `DELETE` or `TRUNCATE` that says nothing about which rows now asks first, naming the
  table it is about to rewrite in full. A `WHERE` inside a string or a comment does not count as
  one, which is the case that catches people out. A `DROP` asks too, in its own words — rows come
  back from a backup, a dropped table's triggers and grants do not — as does an `ALTER` that drops
  a column, a partition or a key. An `ALTER` that only adds something runs without a question. A
  statement opening with `WITH` is judged by what it leads into, so a common table expression in
  front of a `DELETE` does not slip it past the question.
- A `SELECT` written without a `LIMIT` is sent with one — five hundred rows by default, changeable
  in Settings and switchable off. It is said above the results whenever it happens, and a `LIMIT`
  you write yourself is always left alone — as is a locking read such as `SELECT ... FOR UPDATE`,
  which MySQL will not accept a `LIMIT` after.
- A saved connection can be marked read-only from the sidebar's right-click menu, and then nothing
  in the whole workspace will change the server. The Query tab refuses to send anything but a read
  and says which word it stopped at — including the two that open with a reading word and write
  anyway: a `WITH` leading into an `UPDATE`, and a `SELECT ... INTO OUTFILE`, which leaves a file on
  the server. Tables cannot be created, renamed or dropped, the dump and restore tools are closed,
  rows in the Data tab do not open for editing, and the Structure tab changes no columns or indexes.
  Everything that reads works exactly as it did. It is a reminder about which server this is, not a
  permission — what the server allows is still the login's business.
- The Query tab keeps the script it was left with, per connection and database, and puts it back
  when the tab is next opened.
- The Query tab remembers what has been run on each connection. The History button lists it newest
  first with the time, the database, how long it took and what came back; the box at the top
  searches the queries themselves, and picking one puts it back in the editor.
- A query can be saved under a name from the Query tab, and typing that name offers it back in the
  same completion list the tables come from. The Snippets button lists what has been kept: click one
  to put it back in the editor, or drop one that has outlived its usefulness.
- Resting the pointer on a name in the Query tab says what it is. A table shows its columns and
  their types; a column shows its type, whether it may be empty, which key it leads and what its
  foreign key points at — under the alias it was written with, so `u.id` reads as `users.id`. A
  MySQL function shows its signature, which is where the argument you were unsure of is written
  down.
- `Ctrl+Click` a table name in the Query tab to open that table's rows. Holding the key underlines
  every name it would follow, so it is clear before clicking which ones lead anywhere. That click no
  longer drops a second cursor, which is what it used to do — but only on an underlined name, so
  `Ctrl+Click` anywhere else in the script still adds a cursor as before.
- Redis: right-clicking a group in the key sidebar offers "List keys to delete". The keys under
  that prefix open on the right with a tickbox each, a filter box and a Delete button, so a whole
  namespace can go in one pass — after seeing exactly which keys it is about to take. Redis cannot
  drop a prefix in one call, so the list is the names themselves; if the keyspace scan stopped
  short, the pane says the group may hold more than it is showing.
- Redis: the key sidebar has a key limit picker beside the grouping character, remembered per
  connection. It says how much of the keyspace to read before the scan stops.
- A saved connection can be pinned from the sidebar's right-click menu. Pinned connections are held
  at the top of the list, marked with a pin.

### Changed

- The connection list is ordered by name rather than by when each entry was saved, pinned ones
  first. Accented names file beside their plain spelling instead of after every unaccented one, and
  `db2` comes before `db10`.
- The connection form is drawn at the same control size as the rest of the app instead of an
  oversized one, so it takes noticeably less height, and its name field no longer sits flush
  against the top edge.
- The SSH tunnel test answers in colour — green when the tunnel came up, red with the server's own
  words when it didn't — and its button stays disabled until the host, the user and whichever
  credential the chosen auth method needs have been filled in.
- Everything that goes through an SSH tunnel moves faster — dumps and restores most visibly, but
  ordinary queries too. The forward used to carry 8KB at a time, one direction at a time, and left
  each small write waiting a moment for company; a dump through it ran at about two thirds of the
  speed the same machine managed with `ssh -L`. It now carries both directions at once, in much
  larger pieces, and sends each piece the moment it has it.
- Redis: the key sidebar reads the whole keyspace up front instead of a page per press of Load
  more. The list is sorted by key name, and sorting only settles once every name is in hand — so
  loading more used to drop keys into groups that had already been scrolled past. Now the list
  only ever grows downwards.
- Redis: the key sidebar's footer stays put at the bottom instead of sitting under the end of a
  long list, and says how many keys have been read. While a scan is still running, folder counts
  are marked `12+` rather than passing a partial count off as a total.
- A mouse wheel spun quickly now carries further. Windows moves a fixed three lines per notch
  however fast the wheel turns, so crossing a few thousand rows meant spinning it a hundred times.
  Notches arriving in quick succession stretch to as much as four times as far, and a pause drops
  straight back to a single notch, so careful scrolling still lands where it was aimed. Touchpads
  scroll as they always did — their own driver already lengthens a fast flick.

### Fixed

- Typing in the Query tab is no longer slow once a large result is on screen. Every keystroke used
  to redraw the whole result grid — a thousand rows is tens of thousands of cells, each one
  formatted again from scratch — so editing above one lagged seconds behind the keyboard. The grid
  is now redrawn when the results change and not when the script does.
- Running a script that holds nothing but comments says so, instead of leaving the results pane
  blank. It ran, successfully, and there was simply nothing in it to run.
- Saving, renaming or deleting a connection in one tab now shows in every other open tab. Each tab
  used to read the connection list for itself and keep its own copy, so the rest only caught up
  when the app was restarted.
- A new connection tab no longer opens with a narrow sidebar that widens a beat later and shoves
  the form sideways. The list is read once for the whole app rather than once per tab, so a tab
  opened after the first has nothing left to wait for.
- Updating a saved connection keeps the rest of what is remembered about it — whether it is pinned,
  the sidebar width, Redis's key limit. Those were being cleared on every update.

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
