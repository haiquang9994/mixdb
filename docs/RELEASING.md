# Releasing MixDB

MixDB is published as GitHub releases. The app checks that page at startup and says when a newer
version is out; it never installs anything itself.

## Cutting a release

```bash
npm run set-version 0.2.0          # package.json, tauri.conf.json, Cargo.toml, Cargo.lock
git commit -am "chore(release): 0.2.0"
git push
git tag v0.2.0 && git push origin v0.2.0
```

The tag starts [`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds on
three runners in parallel — roughly 15–25 minutes for a cold cache — and attaches every installer to
a **draft** release.

Then, on GitHub: open the draft, write the `## Changes` section, and click **Publish release**.

Nothing is announced until that click. `/releases/latest` — the endpoint the in-app check reads —
skips drafts, so a build that turns out bad can simply be deleted and re-cut.

## What gets built

| Runner | Bundle | Runs on |
| --- | --- | --- |
| `macos-latest` | `.dmg`, `.app` (universal) | Apple Silicon and Intel, macOS 10.13+ |
| `windows-latest` | `.exe` (NSIS), `.msi` | Windows 10 and 11, x64 |
| `ubuntu-22.04` | `.AppImage`, `.deb` | glibc 2.35+ distributions |

No Mac is needed to build the macOS bundle: GitHub's macOS runners do it, and they are free for
public repositories.

## Code signing — what is not done, and what it costs users

MixDB ships unsigned. That is a choice with a price, and the price falls on the first launch:

- **Windows.** SmartScreen shows "Windows protected your PC" over a blue panel. The **Run anyway**
  button is behind **More info**, which is easy to miss. Nothing is blocked outright.
  Removing it needs an Authenticode certificate — an OV one is roughly $200–400 a year and still
  has to build up reputation before the warning stops; an EV one at $300–600 a year clears it
  immediately.
- **macOS.** Stricter. An unsigned, un-notarized app is refused on first open, and recent macOS
  versions word it as the app being *damaged*, which reads as a broken download rather than as a
  policy. The way through is right-click → **Open**, or `xattr -cr /Applications/MixDB.app`.
  Removing it needs the Apple Developer Program at $99 a year, a Developer ID certificate, and
  notarization as part of the build.
- **Linux.** Nothing to do beyond `chmod +x` on the AppImage.

Until certificates exist, the release notes carry those steps — the template in the workflow already
does. **The notes are the mitigation**: a user who hits an unexplained "damaged app" dialog with no
instructions in front of them concludes the download failed and does not come back.

If certificates are bought later, they go into the workflow as secrets and neither the update check
nor anything else in the app has to change.

## The update check

Implemented in [`src/update.ts`](../src/update.ts). It:

- waits 6 seconds after launch so it does not land on top of the connection form;
- GETs `https://api.github.com/repos/haiquang9994/mixdb/releases/latest` — unauthenticated, which is
  60 requests an hour per address and never close to a limit at one check per launch;
- compares the tag against the running version with a semver comparison, pre-release tags included;
- shows a panel in the corner offering **Download** (opens the release page), **Later** (comes back
  next launch) and **Skip this one** (silences that version only, and can be undone in Settings);
- lights the **MixDB** button in the tab bar for as long as an unhandled update exists, so the
  corner panel can be dismissed without the news being lost.

Two things must hold for it to work:

- `https://api.github.com` stays in the `connect-src` of both CSPs in `tauri.conf.json`;
- the version in `tauri.conf.json` is the real one — the app reports that, not `package.json`.
  This is why `npm run set-version` exists rather than editing files by hand.
