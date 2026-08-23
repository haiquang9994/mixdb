/** Which edge of the tab under the pointer the dragged one would land against. */
export type DropSide = "before" | "after";

/**
 * Moving one tab along a strip, worked out on the list rather than on the strip.
 *
 * Kept away from the drag itself — {@link useTabReorder} is the drag — because every strip stores
 * its order differently: the shell keeps a list of tabs, the REST module keeps a list of ids, and
 * a pane strip has an order that is written down in its own source. What they share is the
 * arithmetic, which is the one part of a reorder that is easy to get subtly wrong.
 *
 * Like the rest of `shell/tabs.ts`, a move that changes nothing hands back **the array it was
 * given** — a drop that lands a tab back where it started must not make React redraw the strip,
 * and must not make the shell write a new session file.
 */

/**
 * Where the lifted tab goes back in, counted in the list it has been lifted *out* of, or `null`
 * when it would land where it already is.
 *
 * The two indices are into the original list, which is why this cannot simply be `to`: removing
 * the tab first shifts everything after it down by one.
 */
function landingIndex(from: number, to: number, side: DropSide): number | null {
  if (from < 0 || to < 0 || from === to) return null;
  // `to` after the removal.
  const target = from < to ? to - 1 : to;
  const at = side === "before" ? target : target + 1;
  return at === from ? null : at;
}

function reorder<T>(items: T[], from: number, to: number, side: DropSide): T[] {
  const at = landingIndex(from, to, side);
  if (at === null) return items;
  const rest = items.filter((_, i) => i !== from);
  return [...rest.slice(0, at), items[from], ...rest.slice(at)];
}

/** The move over a list of ids — what a strip that stores only ids reorders. */
export function moveId(ids: string[], fromId: string, toId: string, side: DropSide): string[] {
  return reorder(ids, ids.indexOf(fromId), ids.indexOf(toId), side);
}

/** The same move over a list of things that carry their own id. */
export function moveTab<T extends { id: string }>(
  tabs: T[],
  fromId: string,
  toId: string,
  side: DropSide,
): T[] {
  const index = (id: string) => tabs.findIndex((t) => t.id === id);
  return reorder(tabs, index(fromId), index(toId), side);
}

/**
 * One tab as the strip is laid out right now: its id, and where it sits.
 *
 * Measured in the strip's own content — `offsetLeft`, not a rectangle on the window. A tab that is
 * mid-slide is being *drawn* somewhere its rectangle would report and its layout box is not, and
 * aiming a drag at where a tab is sliding *from* is how a live reorder starts oscillating.
 */
export interface TabBox {
  id: string;
  left: number;
  width: number;
}

/** A tab to sit against, and which of its edges. `null` is "nowhere worth moving to". */
export interface DropTarget {
  id: string;
  side: DropSide;
}

/**
 * How much of a tab the carried one has to cover before it takes its place.
 *
 * Two thirds, and the two ends of that range are both wrong for the same reason. A whole tab — the
 * dragged one sitting exactly on top of its neighbour — is a tab's width of travel before anything
 * happens, which reads as a strip that will not budge. Half a tab is the other way: a tab that has
 * just changed places is a hair from changing back, and the strip flickers between two orders as
 * the hand shakes. What is left over above two thirds is the room a tab has to be brought back
 * through before the move undoes itself.
 */
const COVER = 2 / 3;

/**
 * Where the tab being carried belongs, from where it is drawn and the strip as it stands.
 *
 * A tab takes another's place once it covers {@link COVER} of it. Which is the thing the eye is
 * already watching — one tab moving in over another — and so needs nothing drawn to explain it.
 *
 * Measured on the carried tab and not on the pointer: the two part company the moment the tab is
 * up against either end of the strip, and again whenever it is taken hold of near one of its own
 * edges. It is the tab that is being watched.
 *
 * `left` is where the carried tab's left edge is *drawn*, in the strip's own content — the same
 * space as {@link TabBox}. Its width comes from its own box, because the strip goes on laying it
 * out at full size in the place it was lifted from.
 *
 * Hands back `null` when nothing is covered enough, which is most of a drag — a tab at rest in its
 * own place covers nobody. That is also what makes applying the same answer twice harmless: "put
 * `a` after `c`", asked of a strip where `a` is already after `c`, moves nothing. Which matters,
 * because a drag can outrun React by a frame.
 *
 * Numbers rather than elements, so the rule can be read and tested without a DOM.
 */
export function dropTargetAt(left: number, boxes: TabBox[], draggedId: string): DropTarget | null {
  const from = boxes.findIndex((b) => b.id === draggedId);
  // Nothing on the strip is being carried — a drag left over from a tab that has since closed.
  if (from < 0) return null;
  const right = left + boxes[from].width;
  let at = -1;
  for (let i = 0; i < boxes.length; i++) {
    if (i === from) continue;
    const b = boxes[i];
    const covered = Math.min(right, b.left + b.width) - Math.max(left, b.left);
    if (covered < b.width * COVER) continue;
    /* The furthest one covered, not the nearest. A drag can outrun a frame and clear two tabs at
       once, by which point the nearer of them is behind it and covered by nothing; and a wide tab
       carried over two narrow ones covers both at the same time. */
    if (at < 0 || Math.abs(i - from) > Math.abs(at - from)) at = i;
  }
  if (at < 0) return null;
  return { id: boxes[at].id, side: at > from ? "after" : "before" };
}
