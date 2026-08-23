import { useEffect, useSyncExternalStore } from "react";
import {
  addSavedConnection,
  loadSavedConnections,
  removeSavedConnection,
  updateSavedConnection,
} from "./savedConnections";
import type { SavedConnection } from "./types";

/**
 * The saved connection list, shared by every tab.
 *
 * Each tab used to read the list for itself — `connections.json`, then one credential-store lookup
 * per connection, all of it again per tab — and then kept its own copy. Two things came of that: a
 * connection saved in one tab stayed invisible in the others until the app was restarted, and a
 * newly opened tab spent that first read showing an empty sidebar, which widens as the names
 * arrive and shoves the form sideways.
 *
 * The list is one thing on disk, so it is one thing in memory: read once, written through here,
 * and handed to every tab that asks. A tab opened later renders the finished list on its first
 * frame — there is nothing left to arrive.
 */

/** What every subscriber currently sees. Replaced wholesale, never mutated: `useSyncExternalStore`
 *  decides whether to re-render by comparing this reference with the last one it read. */
let snapshot: SavedConnection[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(list: SavedConnection[]) {
  snapshot = list;
  loaded = true;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SavedConnection[] {
  return snapshot;
}

function getLoaded(): boolean {
  return loaded;
}

/**
 * Reads the list once. The first tab to ask starts the read and every tab that mounts while it is
 * running joins the same promise rather than starting a second one.
 *
 * A failed read leaves `loaded` false and clears the promise, so the next tab to open tries again
 * — the alternative is an app that shows an empty connection list for the rest of the session
 * because one read failed.
 */
function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!inFlight) {
    inFlight = loadSavedConnections()
      .then(publish)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** The shared list, kept in step across every tab that calls this. */
export function useSavedConnections(): SavedConnection[] {
  useEffect(() => {
    // Nothing here can show a read failure — the sidebar simply stays empty, and the next tab
    // retries. Swallowed rather than left to reject so it doesn't surface as an unhandled promise.
    ensureLoaded().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Whether the read has finished.
 *
 * The list is empty before the file has been read and empty after it when nothing is saved, and
 * nothing looking only at the list can tell those two apart. Anything that treats "not in the
 * list" as "deleted" — a tab restoring the connection it had open — has to ask this first.
 */
export function useSavedConnectionsLoaded(): boolean {
  return useSyncExternalStore(subscribe, getLoaded);
}

/* Writes go through the module they always did — it owns the split between `connections.json` and
   the OS credential store — and the list it hands back becomes the new shared snapshot. */

export async function addConnection(entry: SavedConnection): Promise<void> {
  publish(await addSavedConnection(entry));
}

export async function updateConnection(entry: SavedConnection): Promise<void> {
  publish(await updateSavedConnection(entry));
}

export async function removeConnection(id: string): Promise<void> {
  publish(await removeSavedConnection(id));
}
