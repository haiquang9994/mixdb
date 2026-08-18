import { useEffect, useSyncExternalStore } from "react";
import { Store } from "@tauri-apps/plugin-store";

/**
 * How the REST workspace is laid out, kept between sessions.
 *
 * The shell remembers no tabs, so nothing here is about which requests were open — only about
 * the furniture, which is the same in every REST tab and so belongs to the app rather than to one
 * of them. Phase 4 adds `lastEnvId` here and Phase 5 the send settings.
 */

export interface Workspace {
  sidebarWidth: number;
  /** The request pane's share of the width between the two. */
  splitRatio: number;
}

export const DEFAULT_SIDEBAR_WIDTH = 260;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 520;
export const DEFAULT_SPLIT_RATIO = 0.5;
export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;

const FILE = "rest-workspace.json";
const KEY = "workspace";
const DEFAULTS: Workspace = {
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  splitRatio: DEFAULT_SPLIT_RATIO,
};

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(FILE);
  return storePromise;
}

let snapshot: Workspace = DEFAULTS;
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Workspace) {
  snapshot = next;
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
      .then(async (store) => publish({ ...DEFAULTS, ...(await store.get<Workspace>(KEY)) }))
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

function write(next: Workspace): void {
  publish(next);
  void getStore()
    .then(async (store) => {
      await store.set(KEY, next);
      await store.save();
    })
    .catch(() => {});
}

export function useWorkspace(): Workspace {
  useEffect(() => {
    ensureLoaded().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function setSidebarWidth(sidebarWidth: number): void {
  write({ ...snapshot, sidebarWidth });
}

export function setSplitRatio(splitRatio: number): void {
  write({ ...snapshot, splitRatio });
}
