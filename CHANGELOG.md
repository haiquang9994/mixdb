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

- Redis: right-clicking a group in the key sidebar offers "List keys to delete". The keys under
  that prefix open on the right with a tickbox each, a filter box and a Delete button, so a whole
  namespace can go in one pass — after seeing exactly which keys it is about to take. Redis cannot
  drop a prefix in one call, so the list is the names themselves; if the keyspace scan stopped
  short, the pane says the group may hold more than it is showing.
- Redis: the key sidebar has a key limit picker beside the grouping character, remembered per
  connection. It says how much of the keyspace to read before the scan stops.

### Changed

- Redis: the key sidebar reads the whole keyspace up front instead of a page per press of Load
  more. The list is sorted by key name, and sorting only settles once every name is in hand — so
  loading more used to drop keys into groups that had already been scrolled past. Now the list
  only ever grows downwards.
- Redis: the key sidebar's footer stays put at the bottom instead of sitting under the end of a
  long list, and says how many keys have been read. While a scan is still running, folder counts
  are marked `12+` rather than passing a partial count off as a total.

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
