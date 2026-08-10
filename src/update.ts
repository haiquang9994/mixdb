/**
 * Checking GitHub for a newer MixDB, and remembering what the user decided about it.
 *
 * MixDB does not install its own updates: it says a new version is out and opens the release page,
 * where the installers are and where the notes explain what Windows and macOS will say about an
 * app that carries no signing certificate. Everything here is therefore read-only — one GET to the
 * releases API, and three small keys in localStorage beside the theme and the language.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

const REPO = "haiquang9994/mixdb";

/** The one endpoint this asks for. Never returns a draft or a pre-release. */
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

/** Where the user is sent to download, when a release carries no page of its own. */
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

/** The version the user asked not to be told about again. */
const SKIPPED_KEY = "mixdb-skipped-version";

/** When the last check finished, so Settings can say how fresh its answer is. */
const LAST_CHECK_KEY = "mixdb-update-checked-at";

/**
 * How long after launch the startup check runs.
 *
 * The first seconds belong to the connection form: a user opening MixDB is going somewhere, and a
 * panel sliding in over that is an interruption rather than news. By the time this fires they have
 * either connected or are reading the form, and either way a corner of the window is free.
 */
export const STARTUP_CHECK_DELAY_MS = 6000;

/** A release as this app cares about it — the GitHub payload has some eighty other fields. */
export interface Release {
  /** The tag with any leading `v` taken off, e.g. `0.2.0`. */
  version: string;
  /** What the release is called, falling back to the tag when it is untitled. */
  name: string;
  /** The release notes, as written on GitHub. Markdown, shown as plain text. */
  notes: string;
  /** The release's own page, which is where the installers are. */
  url: string;
  /** ISO 8601, or an empty string when GitHub did not say. */
  publishedAt: string;
}

/** What the check is doing, or what it found. */
export type UpdateStatus = "idle" | "checking" | "upToDate" | "available" | "error";

interface GithubRelease {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

/**
 * Splits `1.2.3-beta.4` into its three numbers and its pre-release tag.
 *
 * Anything that is not a version — a tag naming a branch, a release named after a codename —
 * returns null, and a null is treated as "nothing to report" rather than as an update.
 */
function parseVersion(text: string): { core: number[]; pre: string } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(text.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ?? "",
  };
}

/** Compares two dot-separated pre-release tags the way semver does: numbers by value, the rest by
 *  letter, and a shorter tag ahead of a longer one that starts the same. */
function comparePre(a: string, b: string): number {
  // No tag at all is the release itself, which outranks every pre-release of it.
  if (a === "" && b === "") return 0;
  if (a === "") return 1;
  if (b === "") return -1;

  const left = a.split(".");
  const right = b.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) {
      if (Number(l) !== Number(r)) return Number(l) < Number(r) ? -1 : 1;
    } else if (lNum !== rNum) {
      // Numeric identifiers always rank below alphanumeric ones.
      return lNum ? -1 : 1;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

/** -1, 0 or 1 — `a` older than, same as, or newer than `b`. Unparseable versions compare equal, so
 *  a tag this doesn't understand never passes for an update. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1;
  }
  return comparePre(left.pre, right.pre);
}

/** Whether `latest` is worth telling the user about, given what they are running. */
export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

/** The version MixDB is running, taken from the bundle rather than from package.json so it is the
 *  one the installed app actually reports. */
export function currentVersion(): Promise<string> {
  return getVersion();
}

/**
 * Asks GitHub for the newest release. Null when there is no release to speak of.
 *
 * A repo with no published release answers 404, and so does one whose only releases are drafts.
 * That is not a failure — it is "nothing newer than what you have", which is what a user of a
 * build made before the first release should be told.
 *
 * Throws on everything else: a network that is not there, or a rate limit (60 requests an hour per
 * address, which one check a launch never approaches).
 */
export async function fetchLatestRelease(signal?: AbortSignal): Promise<Release | null> {
  const response = await fetch(LATEST_RELEASE_API, {
    signal,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as GithubRelease;
  const tag = typeof data.tag_name === "string" ? data.tag_name : "";
  const parsed = parseVersion(tag);
  if (!parsed) throw new Error(`The latest release is tagged ${tag || "(nothing)"}, which is not a version.`);

  const name = typeof data.name === "string" && data.name !== "" ? data.name : tag;
  return {
    version: parsed.core.join(".") + (parsed.pre ? `-${parsed.pre}` : ""),
    name,
    notes: typeof data.body === "string" ? data.body.trim() : "",
    url: typeof data.html_url === "string" ? data.html_url : RELEASES_PAGE,
    publishedAt: typeof data.published_at === "string" ? data.published_at : "",
  };
}

/** The version the user has told MixDB to stop mentioning, if any. */
export function readSkippedVersion(): string {
  return localStorage.getItem(SKIPPED_KEY) ?? "";
}

/** Silences one version. A later one still gets announced — this is "not this one", not "never". */
export function writeSkippedVersion(version: string): void {
  localStorage.setItem(SKIPPED_KEY, version);
}

/** Undoes a skip, so Settings can offer the news back. */
export function clearSkippedVersion(): void {
  localStorage.removeItem(SKIPPED_KEY);
}

/** When the last successful check happened, or null before the first one. */
export function readLastChecked(): number | null {
  const stored = Number(localStorage.getItem(LAST_CHECK_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : null;
}

export function writeLastChecked(at: number): void {
  localStorage.setItem(LAST_CHECK_KEY, String(at));
}

/** Opens a release in the user's browser. The download and the install are theirs to do. */
export function openRelease(release: Release | null): Promise<void> {
  return openUrl(release?.url ?? RELEASES_PAGE);
}

/** The check as the app holds it: what was found, and the four things that can be done about it. */
export interface UpdateCheck {
  /** The running version, empty until the app has been asked for it. */
  current: string;
  status: UpdateStatus;
  /** The newest release, whether or not it is newer than what is running. */
  release: Release | null;
  /** Why the last check failed, in GitHub's or the network's own words. */
  error: string;
  lastChecked: number | null;
  /** Whether the newest release is one the user has told MixDB to stop mentioning. */
  skipped: boolean;
  /** A newer release the user has not skipped — what lights the button that opens Settings. */
  pending: boolean;
  /** The same, and not yet waved away — what shows the panel. */
  announcing: boolean;
  check: () => void;
  /** Hides the panel for this run, leaving the button lit. */
  dismiss: () => void;
  /** Hides the panel and the light, for this version only. */
  skip: () => void;
  /** Takes a skip back, so this version is announced again. */
  unskip: () => void;
  download: () => void;
}

/**
 * Runs the check once at launch and whenever asked, and holds what it found.
 *
 * One instance of this lives in App, which passes it to both the panel and Settings: two hooks
 * would mean two requests and two disagreeing answers about what the user has already dismissed.
 */
export function useUpdateCheck(): UpdateCheck {
  const [current, setCurrent] = useState("");
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [release, setRelease] = useState<Release | null>(null);
  const [error, setError] = useState("");
  const [lastChecked, setLastChecked] = useState<number | null>(readLastChecked);
  const [skipped, setSkipped] = useState(readSkippedVersion);
  const [dismissed, setDismissed] = useState(false);

  /** The running check, so a manual one started from Settings replaces the one in flight rather
   *  than racing it, and so unmounting stops the request. */
  const inFlight = useRef<AbortController | null>(null);
  /** The version at the time of the request, since the state is not readable from inside it. */
  const currentRef = useRef("");

  useEffect(() => {
    let alive = true;
    getVersion().then((version) => {
      if (!alive) return;
      currentRef.current = version;
      setCurrent(version);
    });
    return () => {
      alive = false;
    };
  }, []);

  const check = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setStatus("checking");
    setError("");

    (async () => {
      try {
        const found = await fetchLatestRelease(controller.signal);
        if (controller.signal.aborted) return;
        const running = currentRef.current || (await currentVersion());
        if (controller.signal.aborted) return;
        currentRef.current = running;
        const at = Date.now();
        writeLastChecked(at);
        setLastChecked(at);
        setCurrent(running);
        setRelease(found);
        setStatus(found !== null && isNewer(found.version, running) ? "available" : "upToDate");
        // A version that has appeared since the last check is news again, even if the previous one
        // was waved away in this same run.
        setDismissed(false);
      } catch (e) {
        if (controller.signal.aborted) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  /* The startup check, delayed so it does not land on top of the connection form. In development
     StrictMode mounts twice; the cleanup cancels the first timer, so only one request goes out. */
  useEffect(() => {
    const timer = window.setTimeout(check, STARTUP_CHECK_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      inFlight.current?.abort();
    };
  }, [check]);

  const version = release?.version ?? "";
  const isSkipped = version !== "" && version === skipped;
  const pending = status === "available" && !isSkipped;

  return {
    current,
    status,
    release,
    error,
    lastChecked,
    skipped: isSkipped,
    pending,
    announcing: pending && !dismissed,
    check,
    dismiss: useCallback(() => setDismissed(true), []),
    skip: useCallback(() => {
      if (version === "") return;
      writeSkippedVersion(version);
      setSkipped(version);
    }, [version]),
    unskip: useCallback(() => {
      clearSkippedVersion();
      setSkipped("");
      setDismissed(false);
    }, []),
    download: useCallback(() => {
      void openRelease(release);
    }, [release]),
  };
}
