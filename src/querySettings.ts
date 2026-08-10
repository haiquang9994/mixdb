import { useSyncExternalStore } from "react";

/**
 * What the Query tab does to a script before it sends it, as a preference.
 *
 * One setting so far, and it lives in `localStorage` alongside the theme rather than in
 * `connections.json`: it is a habit of the person, not a property of the server. The store shape is
 * the one `savedConnectionsStore` uses, so the Settings dialog and every open Query tab see the
 * same value the moment it changes.
 */

/** How many rows a `SELECT` with no `LIMIT` of its own is run with. Zero turns it off entirely. */
export type AutoLimit = number;

const AUTO_LIMIT_KEY = "mixdb-auto-limit";

/** The default ceiling. Five hundred rows is more than anyone reads and far less than a table —
 *  and it is below the thousand the backend stops decoding at, so a limited query is one the whole
 *  of which is actually on screen. */
export const DEFAULT_AUTO_LIMIT = 500;

/** The choices the settings offer. Anything typed into `localStorage` by hand still works; these
 *  are only the ones with a button. */
export const AUTO_LIMIT_CHOICES: AutoLimit[] = [0, 100, 500, 1000];

function read(): AutoLimit {
  const stored = localStorage.getItem(AUTO_LIMIT_KEY);
  // Absent is answered before the text is turned into a number, because `Number(null)` is `0` and
  // `0` is a real choice here — the one that turns the ceiling off. Read the other way round, every
  // install that had never opened the settings ran with no limit at all.
  if (stored === null || stored.trim() === "") return DEFAULT_AUTO_LIMIT;
  const limit = Number(stored);
  // Not a number, or negative: the default.
  return Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_AUTO_LIMIT;
}

let snapshot: AutoLimit = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAutoLimit(): AutoLimit {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function setAutoLimit(limit: AutoLimit): void {
  // Written out even when it is what the default happens to be: a choice someone made is a choice,
  // and storing it means a later change to `DEFAULT_AUTO_LIMIT` cannot quietly move them off it.
  localStorage.setItem(AUTO_LIMIT_KEY, String(limit));
  snapshot = limit;
  for (const listener of listeners) listener();
}
