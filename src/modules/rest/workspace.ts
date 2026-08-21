import { useEffect, useSyncExternalStore } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { DEFAULT_SEND_SETTINGS, type SendSettings } from "./buildRequest";

/**
 * How the REST workspace is laid out, kept between sessions.
 *
 * The shell remembers no tabs, so nothing here is about which requests were open — only about
 * the furniture, which is the same in every REST tab and so belongs to the app rather than to one
 * of them — the settings pane's four switches included, since a timeout is no more one tab's than
 * a sidebar width is.
 */

export interface Workspace {
  sidebarWidth: number;
  /** The request pane's share of the width between the two. */
  splitRatio: number;
  /** Only a seed. A REST tab reads this once, when this file first arrives, and writes it whenever
   *  its own choice changes — but it never reads it again, because a second tab moving to prod is
   *  not this tab moving with it. */
  lastEnvId: string | null;
  /** Whether a response body is kept with its history entry. Turning it off also forgets the ones
   *  already kept — see `dropHistoryBodies`. */
  keepResponseBodies: boolean;
  timeoutMs: number;
  followRedirects: boolean;
  /** Off. Turning it on stops the client checking any server's certificate, on every request. */
  acceptInvalidCerts: boolean;
}

/** A timeout of nothing is a request that always fails, and one of a day is a tab that never comes
 *  back. Both ends belong to the box, not to the wire. */
export const MIN_TIMEOUT_SECONDS = 1;
export const MAX_TIMEOUT_SECONDS = 600;

export function clampTimeoutSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_SEND_SETTINGS.timeoutMs / 1000;
  return Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, Math.round(seconds)));
}

/** The three the wire asks for, out of the seven kept here. */
export function sendSettings(workspace: Workspace): SendSettings {
  return {
    timeoutMs: workspace.timeoutMs,
    followRedirects: workspace.followRedirects,
    acceptInvalidCerts: workspace.acceptInvalidCerts,
  };
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
  lastEnvId: null,
  keepResponseBodies: true,
  ...DEFAULT_SEND_SETTINGS,
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

/** Whether the file has been read yet. A tab seeds its environment from `lastEnvId` the moment
 *  this turns true, and never again — which is not something a defaulted value can be told apart
 *  from a stored one. */
export function workspaceLoaded(): boolean {
  return loaded;
}

export function setLastEnvId(lastEnvId: string | null): void {
  write({ ...snapshot, lastEnvId });
}

/** What the store holds now, for a caller that is not a component — the send path, which reads the
 *  settings as they stand rather than as they were when its handler was made. */
export function currentWorkspace(): Workspace {
  return snapshot;
}

/** A settings change. One entry point rather than a setter each: the Settings pane changes one
 *  field at a time and none of them needs anything the others do not. */
export function updateWorkspace(patch: Partial<Workspace>): void {
  write({ ...snapshot, ...patch });
}
