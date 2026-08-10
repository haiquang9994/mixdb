import { useEffect, useSyncExternalStore } from "react";
import { Store } from "@tauri-apps/plugin-store";

/**
 * Named queries, saved by hand and offered back by name as the editor is typed in.
 *
 * The difference between this and the history beside it is intent: history is everything that ran,
 * kept automatically and eventually dropped off the end; a snippet is something someone decided was
 * worth keeping and gave a name to. So snippets are never evicted, and they complete — typing the
 * first letters of the name offers the whole query, in the same list the table names come from.
 *
 * Not filed per connection: the queries worth naming tend to be the ones that work anywhere.
 */

export interface QuerySnippet {
  /** What is typed to insert it. Unique, case-insensitively — saving over a name replaces it. */
  name: string;
  sql: string;
}

const FILE = "query-snippets.json";
const KEY = "snippets";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(FILE);
  return storePromise;
}

let snapshot: QuerySnippet[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(list: QuerySnippet[]) {
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

function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!inFlight) {
    inFlight = getStore()
      .then(async (store) => publish((await store.get<QuerySnippet[]>(KEY)) ?? []))
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

async function persist(list: QuerySnippet[]): Promise<void> {
  const store = await getStore();
  await store.set(KEY, list);
  await store.save();
}

/** Every snippet, in the order they will be offered — by name, so the list reads the same twice. */
export function useQuerySnippets(): QuerySnippet[] {
  useEffect(() => {
    ensureLoaded().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Saves under `name`, replacing whatever was there. Unlike the history, a failed write here is
 *  worth knowing about — the user asked for this one — so the promise is handed back. */
export async function saveSnippet(snippet: QuerySnippet): Promise<void> {
  const name = snippet.name.trim();
  if (name === "") return;
  const key = name.toLowerCase();
  const list = [...snapshot.filter((s) => s.name.toLowerCase() !== key), { ...snippet, name }].sort(
    (a, b) => a.name.localeCompare(b.name)
  );
  publish(list);
  await persist(list);
}

export async function removeSnippet(name: string): Promise<void> {
  const key = name.toLowerCase();
  const list = snapshot.filter((s) => s.name.toLowerCase() !== key);
  publish(list);
  await persist(list);
}
