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

/**
 * A request nobody has put anything into.
 *
 * Pressing New opens a request that is already in the list — that is what makes every edit land
 * without a Save button. The cost is that changing your mind leaves a husk behind, and a sidebar
 * of them is what a hundred second thoughts look like. One is dropped when its tab closes and any
 * left over are swept on load, so the two paths that can strand one both clear up after
 * themselves.
 *
 * The bar is deliberately low: a method other than the GET it was born as, a row half typed, a
 * body that exists at all, or one press of Send is enough to keep it. Only a request identical to
 * a brand new one goes.
 */
export function isBlank(request: RestRequest): boolean {
  const untouched = (rows: KeyValue[]) => rows.every((row) => row.key === "" && row.value === "");
  return (
    request.name === "" &&
    request.url.trim() === "" &&
    request.method === "GET" &&
    untouched(request.params) &&
    untouched(request.headers) &&
    request.body.kind === "none" &&
    request.auth.kind === "none" &&
    // Sending stamps this; a request that has been used is a request, whatever is left in it.
    request.lastUsedAt === request.createdAt
  );
}

/** The lists with the husks taken out, or the lists themselves when there are none — so a load
 *  that changes nothing does not look like a change. */
export function sweepBlank(lists: RequestLists): RequestLists {
  const saved = lists.saved.filter((r) => !isBlank(r));
  const recent = lists.recent.filter((r) => !isBlank(r));
  if (saved.length === lists.saved.length && recent.length === lists.recent.length) return lists;
  return { saved, recent };
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
  return sweepBlank({ saved: stored?.saved ?? [], recent: stored?.recent ?? [] });
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
