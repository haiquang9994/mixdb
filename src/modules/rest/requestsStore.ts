import { useEffect, useSyncExternalStore } from "react";
import {
  addSaved,
  loadRequests,
  newRequest,
  persistRequests,
  removeRequest,
  updateRequest,
} from "./requests";
import type { RequestLists, RestRequest } from "./types";

/**
 * The request list, shared by every REST tab.
 *
 * One thing on disk is one thing in memory: read once, written through here, handed to every tab
 * that asks. A request edited in one tab is the same request in the next — which matters more
 * here than for connections, because a draft lives in the request itself.
 */

const EMPTY: RequestLists = { saved: [], recent: [] };

let snapshot: RequestLists = EMPTY;
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(lists: RequestLists) {
  snapshot = lists;
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
    inFlight = loadRequests()
      .then(publish)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function useRequestLists(): RequestLists {
  useEffect(() => {
    ensureLoaded().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** What the store currently holds, for callers outside a component — the send path, which needs
 *  the request as it stands rather than as it was when a handler was made. */
export function currentLists(): RequestLists {
  return snapshot;
}

/** A fresh request at the top of Saved, returned so the caller can open a tab on it. */
export function createRequest(): RestRequest {
  const request = newRequest(crypto.randomUUID(), Date.now());
  const lists = addSaved(snapshot, request);
  publish(lists);
  persistRequests(lists);
  return request;
}

/**
 * Writes a request's new state through, wherever it lives.
 *
 * This is the whole of "saving": there is no unsaved state, no Save button and no dialog asking
 * whether to keep anything, because every edit lands here as it is made.
 */
export function saveRequest(request: RestRequest): void {
  const lists = updateRequest(snapshot, request);
  publish(lists);
  persistRequests(lists);
}

export function deleteRequest(id: string): void {
  const lists = removeRequest(snapshot, id);
  publish(lists);
  persistRequests(lists);
}
