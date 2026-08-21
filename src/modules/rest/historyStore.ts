import { useEffect, useSyncExternalStore } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { withEntry, withoutBodies, withoutEntry, type HistoryEntry } from "./history";

/**
 * Everything this app has sent, newest first, shared by every REST tab.
 *
 * Written on every send and read only when the dialog is opened — which is usually much later in a
 * session. That gap is why {@link recordSend} waits for the file: an entry added to an empty list
 * and written back would be the whole history, and every earlier session would be gone.
 */

const FILE = "rest-history.json";
const KEY = "entries";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(FILE);
  return storePromise;
}

let snapshot: HistoryEntry[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** The list every reader sees from now on. Says nothing about whether the file has been read — only
 *  {@link publish} may claim that. */
function remember(list: HistoryEntry[]) {
  snapshot = list;
  for (const listener of listeners) listener();
}

function publish(list: HistoryEntry[]) {
  loaded = true;
  remember(list);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!inFlight) {
    inFlight = getStore()
      .then(async (store) => publish((await store.get<HistoryEntry[]>(KEY)) ?? []))
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Failures are swallowed: a history that could not be written is not worth interrupting anyone's
 *  work over, and it is still right in memory. */
function persist(list: HistoryEntry[]): void {
  void getStore()
    .then(async (store) => {
      await store.set(KEY, list);
      await store.save();
    })
    .catch(() => {});
}

export function useHistory(): HistoryEntry[] {
  useEffect(() => {
    ensureLoaded().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Adds a send to the front of the list, once the file it belongs at the front of has been read. */
export function recordSend(entry: HistoryEntry): void {
  void ensureLoaded().then(
    () => {
      const list = withEntry(snapshot, entry);
      publish(list);
      persist(list);
    },
    // The file could not be read. The send is still worth showing for the rest of the session, but
    // nothing is written back: what is on disk is unknown, and writing over it would lose it.
    () => remember(withEntry(snapshot, entry)),
  );
}

export function forgetEntry(id: string): void {
  void ensureLoaded().then(
    () => {
      const list = withoutEntry(snapshot, id);
      publish(list);
      persist(list);
    },
    () => {},
  );
}

export function clearHistory(): void {
  void ensureLoaded().then(
    () => {
      publish([]);
      persist([]);
    },
    () => {},
  );
}

/**
 * Forgets every stored body, keeping the entries themselves.
 *
 * What turning *Keep response bodies* off does. Stopping there and only refusing new ones would not
 * be enough: a switch about privacy that leaves what it already wrote sitting on disk is a lie.
 */
export function dropHistoryBodies(): void {
  void ensureLoaded().then(
    () => {
      const list = withoutBodies(snapshot);
      if (list === snapshot) return;
      publish(list);
      persist(list);
    },
    () => {},
  );
}
