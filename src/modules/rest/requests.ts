import { Store } from "@tauri-apps/plugin-store";
import type { KeyValue, RequestLists, RestRequest } from "./types";

/**
 * The request list on disk, and the pure reducers that shape it.
 *
 * Two groups, both flat: **Saved** is what someone chose to keep, **Recent** is what pasting a
 * cURL command left behind. Only the reducers are tested; the file access around them is four
 * lines of `Store` and has nothing to get wrong.
 */

/** How many pasted requests are kept. Filling up drops the one least recently *sent* — see the
 *  spec's §5. Enforced from Phase 2, which is where anything is put in Recent at all. */
export const RECENT_LIMIT = 10;

const FILE = "rest-requests.json";
const KEY = "lists";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(FILE);
  return storePromise;
}

/** An empty row for the Params or Headers table. Ticked, because a row is typed in to be used. */
export function newRow(id: string): KeyValue {
  return { id, enabled: true, key: "", value: "" };
}

/** A request as it starts life: a GET with nothing in it. */
export function newRequest(id: string, now: number): RestRequest {
  return {
    id,
    name: "",
    method: "GET",
    url: "",
    params: [],
    headers: [],
    body: { kind: "none" },
    auth: { kind: "none" },
    origin: "manual",
    createdAt: now,
    lastUsedAt: now,
  };
}

export function findRequest(lists: RequestLists, id: string): RestRequest | undefined {
  return lists.saved.find((r) => r.id === id) ?? lists.recent.find((r) => r.id === id);
}

/** Newest first, which is where someone looks for what they just made. */
export function addSaved(lists: RequestLists, request: RestRequest): RequestLists {
  return { ...lists, saved: [request, ...lists.saved] };
}

/**
 * The list with this request's new state in it, in the group it is already in.
 *
 * Editing a Recent request does **not** promote it to Saved — pinning is the only thing that
 * does. A request in neither group is one whose row went away while a tab on it stayed open, and
 * the list is returned untouched.
 */
export function updateRequest(lists: RequestLists, request: RestRequest): RequestLists {
  const swap = (list: RestRequest[]) => list.map((r) => (r.id === request.id ? request : r));
  return { saved: swap(lists.saved), recent: swap(lists.recent) };
}

export function removeRequest(lists: RequestLists, id: string): RequestLists {
  return {
    saved: lists.saved.filter((r) => r.id !== id),
    recent: lists.recent.filter((r) => r.id !== id),
  };
}

/** What is on disk, or two empty groups. A file that cannot be read is an empty sidebar for the
 *  session, not a crash. */
export async function loadRequests(): Promise<RequestLists> {
  const store = await getStore();
  const stored = await store.get<RequestLists>(KEY);
  return { saved: stored?.saved ?? [], recent: stored?.recent ?? [] };
}

/** Writes the list as it now stands. Failures are swallowed: the list is still right in memory,
 *  and nothing here is worth interrupting someone's typing over. */
export function persistRequests(lists: RequestLists): void {
  void getStore()
    .then(async (store) => {
      await store.set(KEY, lists);
      await store.save();
    })
    .catch(() => {});
}
