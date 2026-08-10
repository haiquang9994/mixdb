/**
 * Sets MixDB's version in the four files that carry it.
 *
 *   node scripts/set-version.mjs 0.2.0
 *
 * The version has to match everywhere: `tauri.conf.json` is what the built app reports and what
 * the update check compares against, `Cargo.toml` is what the Windows installer stamps into the
 * binary, and a `Cargo.lock` left behind fails any build run with `--locked`, which CI is. Bumping
 * them by hand means one of them is eventually forgotten, and the symptom of that — an app that
 * announces an update to the version it is already running — only shows up after a release.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node scripts/set-version.mjs <version>   e.g. 0.2.0 or 0.2.0-beta.1");
  process.exit(1);
}

/** Rewrites one file, and says so. Throws when the pattern is not there, since a silent no-op is
 *  exactly the half-bumped state this script exists to prevent. */
function patch(relative, pattern, replacement) {
  const path = join(root, relative);
  const before = readFileSync(path, "utf8");
  if (!pattern.test(before)) {
    throw new Error(`Cannot find the version in ${relative} — the file's shape has changed.`);
  }
  const after = before.replace(pattern, replacement);
  if (after !== before) writeFileSync(path, after);
  console.log(`${after === before ? "already" : "set    "} ${relative}`);
}

patch("package.json", /("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
patch("src-tauri/tauri.conf.json", /("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);

// Only the `[package]` block at the top — every dependency below it has a version too.
patch("src-tauri/Cargo.toml", /(\[package\][\s\S]*?\nversion\s*=\s*)"[^"]*"/, `$1"${version}"`);

// The lock file's own entry for this crate, found by name so the dependencies are left alone.
patch(
  "src-tauri/Cargo.lock",
  /(name = "mixdb"\nversion = )"[^"]*"/,
  `$1"${version}"`,
);

console.log(`\nMixDB is now ${version}. Commit, then tag it:\n  git tag v${version} && git push origin v${version}`);
