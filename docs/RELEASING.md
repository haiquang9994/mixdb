# Releasing MixDB

MixDB is published as GitHub releases, and installed copies update themselves from them: the app
checks a manifest on the newest release, downloads the bundle for its platform, verifies the
signature and — once the user says so — installs it and restarts.

## Cutting a release

```bash
npm run set-version 0.2.0          # package.json, tauri.conf.json, Cargo.toml, Cargo.lock
git commit -am "chore(release): 0.2.0"
git push
git tag v0.2.0 && git push origin v0.2.0
```

The tag starts [`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds on
three runners in parallel — roughly 15–25 minutes for a cold cache — and attaches every installer,
every `.sig`, and a merged `latest.json` to a **draft** release.

Then, on GitHub: open the draft, write the `## Changes` section, and click **Publish release**.

Nothing is announced until that click. `/releases/latest/download/latest.json` — the URL the
updater reads — skips drafts, so a build that turns out bad can simply be deleted and re-cut.

**The `## Changes` section becomes the update notes.** It is what the panel in the corner of the
app shows the first line of, so put the headline change at the top of it.

The manifest the updater reads carries those notes, and `tauri-action` writes it *during the build*
— when `## Changes` is still the empty placeholder. So
[`.github/workflows/update-notes.yml`](../.github/workflows/update-notes.yml) runs on **publish**
and on every later **edit** of the body, cuts the `## Changes` section out of it and rewrites the
`notes` field of `latest.json` on the release. It leaves the asset alone when the notes already
match, which is what keeps its own upload from setting it off again.

Nothing else in the manifest is touched — versions, URLs and signatures stay exactly as the build
left them. A release whose notes were fixed while that workflow was broken can be brought up to
date by running it by hand from the Actions tab with the tag as its input.

## What gets built

| Runner | Bundle | Runs on | Self-updates |
| --- | --- | --- | --- |
| `macos-latest` | `.dmg`, `.app` (universal) | Apple Silicon and Intel, macOS 10.13+ | yes |
| `windows-latest` | `.exe` (NSIS) | Windows 10 and 11, x64 | yes |
| `ubuntu-22.04` | `.AppImage`, `.deb` | glibc 2.35+ distributions | AppImage only |

No Mac is needed to build the macOS bundle: GitHub's macOS runners do it, and they are free for
public repositories.

The `.msi` was dropped when self-updating went in. It installs per-machine, the NSIS installer the
updater uses installs per-user, and shipping both would have left some users with two MixDBs in two
places, only one of which ever updated.

## Signing

Two different things are called signing here, and only one of them is done.

### The update key — done

A [minisign](https://jedisct1.github.io/minisign/) key pair, generated once with
`npm run tauri signer generate`. Every bundle the workflow builds is signed with the private half;
every installed copy of MixDB checks that signature against the public half before it runs a single
byte of an update.

| Half | Lives in |
| --- | --- |
| Public | `plugins.updater.pubkey` in [`tauri.conf.json`](../src-tauri/tauri.conf.json) — public by design, committed |
| Private | The `TAURI_SIGNING_PRIVATE_KEY` repository secret, and a backup off this machine |
| Its password | The `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secret |

**Losing the private key strands every copy already installed.** They will keep checking, keep
finding releases, and reject every one of them, because a new key means a new `pubkey` and the copy
in their hands has the old one. The only way back is asking every user to download and install by
hand. Back it up.

A build without those secrets still succeeds — it just produces artifacts nobody can install. If
the updater goes quiet after a release, look at the secrets first.

### Code signing — not done

MixDB ships without an Authenticode certificate or an Apple Developer ID, and the price of that
falls entirely on the **first** install:

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

Updates raise none of that again, which is the point of having them:

- Windows' SmartScreen prompt is triggered by the mark-of-the-web a **browser** attaches to a
  download. The updater fetches the installer itself, so the file carries no such mark. The NSIS
  installer runs per-user, so there is no UAC prompt either.
- macOS' Gatekeeper prompt is triggered by the quarantine attribute, which the updater does not
  set. It replaces the `.app` in place and the next launch is silent.

So the release notes still have to carry the first-launch instructions — the template in the
workflow does — but a user only reads them once.

If code-signing certificates are bought later, they go into the workflow as further secrets and
nothing in the app has to change.

## How updating works

Implemented in [`src/update.ts`](../src/update.ts), on top of Tauri's updater plugin. It:

- waits 6 seconds after launch so it does not land on top of the connection form;
- GETs `https://github.com/haiquang9994/mixdb/releases/latest/download/latest.json` and compares
  its version against the running one;
- shows a panel in the corner offering **Update now**, **Later** (comes back next launch) and
  **Skip this one** (silences that version only, and can be undone in Settings);
- on **Update now**, downloads the bundle with a progress bar while the app carries on running;
- when it is on disk, asks again before **Install and restart** — installing closes MixDB, and a
  user with a half-written query should be the one choosing when that happens;
- lights the **MixDB** button in the tab bar for as long as an unhandled update exists, so the
  corner panel can be dismissed without the news being lost. A download waved away mid-flight
  carries on behind it.

On Windows the installer is what closes and reopens the app; on macOS and Linux the files are
swapped underneath the running process, which then calls `relaunch()` itself.

Three things must hold for it to work:

- the version in `tauri.conf.json` is the real one — the app reports that, not `package.json`.
  This is why `npm run set-version` exists rather than editing files by hand;
- `bundle.createUpdaterArtifacts` stays `true`, and `includeUpdaterJson` stays on in the workflow;
- the two signing secrets are set on the repository.

Nothing about it needs the webview's CSP: the request, the signature check and the install all
happen in Rust.

## Testing an update before publishing

The updater only ever looks at the published latest release, so the honest way to test is to have
one. Publish a release one version ahead of an old build kept for the purpose, or point
`plugins.updater.endpoints` at a local file server during development.

Do not test by publishing to the real repository and deleting it afterwards — anyone who launched
MixDB in that window has already downloaded it.
