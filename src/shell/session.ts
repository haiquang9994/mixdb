import { MODULES } from "./registry";
import type { TabInfo } from "./tabs";

/**
 * Which tabs were open when the app was last closed, and which of them was in front.
 *
 * Only what the tab bar itself draws: a tab's id, the module it holds, and the name it was
 * carrying. Nothing about what was *inside* it — no connection, no request, no shell. A restored
 * tab is a place on the strip, and the module behind it starts from its own front door the moment
 * the tab is first looked at. That is the whole of the promise this file makes, and saying so here
 * is what keeps the next person from reading more into a stored title than it means.
 *
 * Badges are left out because they cannot be stored: a badge holds a React element. They come back
 * the moment the module mounts and reports them, which is the only time anything knows what they
 * should say.
 *
 * `localStorage`, like `shell/theme.ts` — this is a handful of strings about the window, read once
 * on the way up and written as it changes, and a file on disk read through an async plugin would
 * mean an empty tab bar for the first frame of every launch.
 */

const STORAGE_KEY = "mixdb-session";

/** One tab as it is stored. A subset of {@link TabInfo}, and deliberately not that type: adding a
 *  field there must not silently start writing it to disk. */
export interface StoredTab {
  id: string;
  moduleId: string;
  title: string;
}

export interface StoredSession {
  tabs: StoredTab[];
  /** One of `tabs`, already checked. The tab the user was looking at, and the only one the app
   *  brings up on launch. */
  activeId: string;
}

function isStoredTab(value: unknown, knownModuleIds: string[]): value is StoredTab {
  if (typeof value !== "object" || value === null) return false;
  const tab = value as Record<string, unknown>;
  return (
    typeof tab.id === "string" &&
    tab.id !== "" &&
    typeof tab.title === "string" &&
    typeof tab.moduleId === "string" &&
    // A module that has been renamed or taken out leaves tabs nothing can render. They are dropped
    // rather than shown as an error: the user did not ask for a tab of a module that no longer
    // exists, and `moduleById` throws on one.
    knownModuleIds.includes(tab.moduleId)
  );
}

/**
 * What was stored, read defensively, or `null` when there is nothing usable there.
 *
 * Pure, and takes the module ids rather than reading the registry, so what it does with a stored
 * module nobody recognises can be tested without one. Everything that arrives here is a string
 * some older version of the app wrote, so nothing in it is trusted: a half-written file, a shape
 * from three versions ago and a hand-edited one all have to come out as `null` or as a list of
 * tabs that can actually be drawn.
 */
export function parseSession(raw: string | null, knownModuleIds: string[]): StoredSession | null {
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const session = parsed as Record<string, unknown>;
  if (!Array.isArray(session.tabs)) return null;

  const tabs = session.tabs
    .filter((tab): tab is StoredTab => isStoredTab(tab, knownModuleIds))
    .map(({ id, moduleId, title }) => ({ id, moduleId, title }));
  if (tabs.length === 0) return null;

  // A dropped module can take the active tab with it, and a session with no valid active tab is
  // still a session — the last tab on the strip is where the app opens instead.
  const stored = session.activeId;
  const activeId =
    typeof stored === "string" && tabs.some((tab) => tab.id === stored)
      ? stored
      : tabs[tabs.length - 1].id;

  return { tabs, activeId };
}

/** The session as stored, or `null` on the first launch — and on any launch after one that wrote
 *  something this version cannot read. */
export function readSession(): StoredSession | null {
  return parseSession(
    localStorage.getItem(STORAGE_KEY),
    MODULES.map((m) => m.id),
  );
}

export function writeSession(tabs: TabInfo[], activeId: string): void {
  const session: StoredSession = {
    tabs: tabs.map(({ id, moduleId, title }) => ({ id, moduleId, title })),
    activeId,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}
