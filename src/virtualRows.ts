import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

/**
 * A table that only ever holds the rows you can see.
 *
 * The machinery is shared because the fault it fixes is shared: a grid that builds every row into
 * the DOM is a grid that lays every row out again on every event that touches it — and a tab behind
 * another tab is `display: none`, which keeps no layout at all, so simply coming back to it pays
 * the whole cost. A few hundred rows is where that stops being instant.
 *
 * Two things have to be true for a window of rows to work, and both are the caller's to arrange
 * (see {@link useVirtualRows} for the first and {@link measureColumns} for the second):
 *
 * - **Every row is exactly `rowHeight` tall.** The rows outside the window are stood in for by a
 *   spacer of `count × rowHeight`, so any difference between that and a drawn row's real height
 *   makes the table's total height depend on where it is scrolled — the end of the set drifts away
 *   as you scroll towards it, by an amount that scales with the set. The height is therefore
 *   *stated* and pinned by the stylesheet, never measured: measuring can only make the error small,
 *   and small times ten thousand is not small.
 * - **Every column has a width of its own.** Only a few dozen rows are in the DOM at a time, and a
 *   table left to size itself sizes itself around those — every scroll would find new widest
 *   values and shuffle the columns sideways under the pointer.
 *
 * There are two ways to give a column a width, and the grids here use both, because they hold
 * different things:
 *
 * - **Measured** ({@link measureColumns}): the text is measured against a canvas and the widths are
 *   pinned with a colgroup and `table-layout: fixed`. Cheap over any number of rows — no elements,
 *   no layout — and right for a grid whose cells are text and nothing else. It has to be told about
 *   anything that is *not* text, which is why it takes `headerExtra`.
 * - **A sizer row**: a row of no height, holding each column's widest value, left in the table for
 *   the browser's own layout to find. Nothing is measured or pinned; the table sizes itself as it
 *   always did, around a row that is always present and always the widest. That is what suits a
 *   grid whose cells hold badges, buttons and several fonts — describing all of that to a canvas is
 *   how it gets it wrong, and the browser already knows.
 */

/** Rows kept either side of the visible window, so a flick of the wheel lands on rows that are
 *  already there rather than on a blank strip waiting for the next render. */
const OVERSCAN = 8;

/** The window's edges are rounded out to a multiple of this many rows.
 *
 * Without it every pixel of scrolling produces a different window, and the grid re-renders on every
 * frame of every scroll — which over a tall pane is fifty rows across twenty columns reconciled per
 * frame, and reads as a stutter. Rounded, the window only changes once per block of rows scrolled
 * past: most frames of a scroll now find the window they already have and do nothing at all. */
const BLOCK = 16;

/** How many rows are drawn before anything has been measured, which is the case for the first frame
 *  and for a grid in a tab nobody is looking at. Enough to fill a pane at any height it can be
 *  dragged to, so the rows are already there in the frame the tab comes back. */
const BLIND_ROWS = 48;

/** The most rows the window will ever hold, however tall the box claims to be.
 *
 * A backstop rather than a working limit: nothing in a real pane comes near it (a full-screen grid
 * is some seventy rows). It is here so that a viewport measured wrong — a box read mid-transition,
 * or before it has been laid out — costs a few hundred rows rather than every row in the set. */
const MAX_WINDOW = 400;

/** Which rows a scrolled box is over: the first one in it, and one past the last. */
export interface RowWindow {
  first: number;
  last: number;
}

/**
 * The rows worth rendering, given where the box is scrolled to and how tall it is.
 *
 * Its own function, and exported, because it is the whole of the arithmetic that decides what is on
 * screen — everything else here is DOM. An off-by-one is a strip of blank rows at one end of a
 * scroll, which is the sort of thing worth pinning down in a test rather than by dragging a
 * scrollbar.
 *
 * The overscan is added first and the block rounding second, so the block is slack on top of the
 * guaranteed margin rather than instead of it.
 */
export function rowWindow(
  total: number,
  rowHeight: number,
  scrollTop: number,
  span: number
): RowWindow {
  // A box of no height belongs to a tab nobody is looking at. It can say nothing about a window, so
  // a blind pane's worth is the answer — enough to fill the box whenever it does appear.
  if (rowHeight <= 0 || span <= 0) return { first: 0, last: Math.min(total, BLIND_ROWS) };
  const from = scrollTop / rowHeight - OVERSCAN;
  const to = (scrollTop + span) / rowHeight + OVERSCAN;
  const first = Math.max(0, Math.floor(from / BLOCK) * BLOCK);
  const last = Math.min(total, first + MAX_WINDOW, Math.ceil(to / BLOCK) * BLOCK);
  return { first, last: Math.max(first, last) };
}

/** A window widened to keep one particular row in it — the row being edited, which must not be
 *  unmounted from under the input it is holding. */
function including(window: RowWindow, row: number | null | undefined, total: number): RowWindow {
  if (row === null || row === undefined || row < 0 || row >= total) return window;
  if (row >= window.first && row < window.last) return window;
  return { first: Math.min(window.first, row), last: Math.max(window.last, row + 1) };
}

export interface VirtualRows {
  /** The slice of rows to render: `rows.slice(first, last)`. */
  first: number;
  last: number;
  /** What the spacer above and below the drawn rows must be tall. Both are always rendered, even at
   *  zero: a spacer that came and went at the end of the set would hand `tr:last-child` to a real
   *  row and take its bottom rule with it, changing the table's height at exactly the point a
   *  scroll is trying to settle. */
  padTop: number;
  padBottom: number;
  /** Put on the scrolling box. */
  onScroll: () => void;
}

export interface VirtualRowsOptions {
  total: number;
  /** The height every row is pinned to by the stylesheet. Stated, never measured — see the note at
   *  the top of this file. */
  rowHeight: number;
  /** False for a grid small enough not to need any of this, which then renders every row and sizes
   *  its own columns exactly as it always did. */
  enabled: boolean;
  /** A row that has to stay in the window whatever the scroll says — the one being edited. */
  pinned?: number | null;
}

/**
 * The window of rows a box is scrolled over, kept up to date.
 *
 * The scroll offset is read off the box rather than kept in state, and the window is only written
 * when it actually changes: React drops a state write that changes nothing, so the frames between
 * one block and the next cost a division and no render at all.
 */
export function useVirtualRows(
  scroll: RefObject<HTMLElement | null>,
  { total, rowHeight, enabled, pinned = null }: VirtualRowsOptions
): VirtualRows {
  /** How tall the scrolling box is. The one thing here still asked of the DOM, and the one thing
   *  that can be wrong without doing harm: it decides how many rows are drawn and nothing about how
   *  tall the table is. Zero until measured, and zero again whenever the tab is put away. */
  const [viewport, setViewport] = useState(0);
  const [view, setView] = useState<RowWindow>({ first: 0, last: BLIND_ROWS });

  const syncWindow = useCallback(() => {
    const el = scroll.current;
    if (!el) return;
    const span = viewport > 0 ? viewport : rowHeight * BLIND_ROWS;
    const next = rowWindow(total, rowHeight, el.scrollTop, span);
    setView((current) =>
      current.first === next.first && current.last === next.last ? current : next
    );
  }, [scroll, viewport, rowHeight, total]);

  const remeasure = useCallback(() => {
    const el = scroll.current;
    if (!el) return;
    setViewport(el.clientHeight);
    syncWindow();
  }, [scroll, syncWindow]);

  // Before paint, so a pane that has just grown is filled in the frame it grew rather than a frame
  // later, and so the first frame of a new set is the right rows rather than the last set's.
  useLayoutEffect(() => {
    syncWindow();
  }, [syncWindow]);

  // An observer rather than a one-off, because the box's height changes without the rows changing:
  // a divider is dragged, a pane is lifted over the window, the window itself is resized — and,
  // most of all, the tab comes back from behind another one, which is when its height goes from
  // zero to real.
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const observer = new ResizeObserver(remeasure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scroll, remeasure]);

  if (!enabled) {
    return { first: 0, last: total, padTop: 0, padBottom: 0, onScroll: syncWindow };
  }
  const held = including({ first: view.first, last: Math.min(view.last, total) }, pinned, total);
  return {
    first: held.first,
    last: held.last,
    padTop: held.first * rowHeight,
    padBottom: (total - held.last) * rowHeight,
    onScroll: syncWindow,
  };
}

/** How many of a column's values are actually measured. The longest string is not always the widest
 *  one — a proportional font makes `WWW` wider than `iiiiii` — so the few longest by length are all
 *  measured and the widest of them wins. */
const WIDTH_SAMPLES = 3;

/** The length at which a column is certainly going to hit its ceiling whatever else is in it, and
 *  so has nothing left to learn from the rows below.
 *
 * This is what makes measuring every row affordable. A column of long text — a JSON document, a
 * description — is the expensive one to scan, and it is also the one that reaches its ceiling in
 * the first few rows; past that it is skipped entirely. Short columns are the cheap ones to scan
 * and are the reason to scan at all, since an `id` that gains a digit in row nine thousand has to
 * be measured in row nine thousand. */
const SATURATED_CHARS = 96;

/** A hair of slack on every measured column, for the difference between what a canvas says a string
 *  is worth and what the text renderer finally lays out — hinting, ligatures and letter-spacing all
 *  land on the layout side of that line. */
const WIDTH_SLACK = 4;

/** How a value reads in a grid: an absent one is spelled out as NULL, a structured one as the JSON
 *  it came from. Both grids draw their cells this way, so both measure them this way. */
export function displayValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "NULL";
  return typeof raw === "object" ? JSON.stringify(raw) : String(raw);
}

/**
 * The few longest values in every column, taken from every row.
 *
 * Every row, and that is the point: a column sized from a sample is a column that fits until the
 * sample runs out — an `id` measured over the first two thousand rows of ten thousand is measured
 * one digit short, and every row past the sample shows it.
 *
 * What makes that affordable is what the scan refuses to do. It goes down the rows once for all the
 * columns rather than once per column; it never builds a string for a value that is already one,
 * which is most of a result set; and it drops a column the moment that column's answer is settled,
 * which is what keeps a document column from being serialised ten thousand times to learn something
 * the third row had already said.
 */
export function widestValues<Row>(
  rows: readonly Row[],
  columnCount: number,
  cell: (row: Row, column: number) => unknown
): string[][] {
  const picks: string[][] = Array.from({ length: columnCount }, () => []);
  /** Columns with nothing left to learn, and how many are still worth looking at. */
  const settled = new Array<boolean>(columnCount).fill(false);
  let open = columnCount;

  for (const row of rows) {
    if (open === 0) break;
    for (let c = 0; c < columnCount; c++) {
      if (settled[c]) continue;
      const raw = cell(row, c);
      // A string is its own rendering — and strings are what most cells hold, so this is the branch
      // that keeps the scan cheap. Everything else is built the way the cell will be drawn.
      const text = typeof raw === "string" ? raw : displayValue(raw);
      const list = picks[c];
      if (list.length < WIDTH_SAMPLES) {
        list.push(text);
        list.sort((a, b) => b.length - a.length);
      } else if (text.length > list[WIDTH_SAMPLES - 1].length) {
        list[WIDTH_SAMPLES - 1] = text;
        list.sort((a, b) => b.length - a.length);
      }
      if (list[0].length >= SATURATED_CHARS) {
        settled[c] = true;
        open--;
      }
    }
  }
  return picks;
}

export interface ColumnSizing {
  /** What a cell spends on itself before any text goes in it: its padding and its rules. A width
   *  handed to a `<col>` is the whole column, chrome included, while what is measured below is the
   *  text alone — so every measured width has to carry this or the column comes out exactly this
   *  much too narrow. */
  chrome: number;
  /** The band a column is kept inside, chrome and all. The ceiling is where a cell stops being
   *  worth widening: past it the text is cut off with an ellipsis either way. */
  min: number;
  max: number;
}

/** The one canvas the app measures text with. Kept between calls: creating one per grid would be
 *  the expensive half of the measuring. */
let pen: CanvasRenderingContext2D | null = null;

function ruler(): CanvasRenderingContext2D | null {
  if (pen === null) pen = document.createElement("canvas").getContext("2d");
  return pen;
}

/**
 * How wide each column has to be, worked out without laying a single row out.
 *
 * The text is measured against a canvas in the grid's own font rather than by the layout engine,
 * which is what makes it affordable over the whole set: no elements, no layout, one pass over the
 * shortlists. The header is measured in the weight the header is drawn in, which is not the body's.
 *
 * `null` when there is no canvas to measure with, which leaves the caller to size its own columns —
 * the grid is then wrong in the old way rather than in a new one.
 */
export function measureColumns(
  grid: HTMLElement,
  headers: readonly string[],
  samples: readonly string[][],
  { chrome, min, max }: ColumnSizing,
  /** What each header carries besides its own text — a sort chevron, a key badge. Added to the
   *  header rather than to the column, since it is the header that has to hold it: a column whose
   *  values are wider than its name has room for both already. Without it a short name beside a
   *  long one is a header cut off with an ellipsis while the values under it sit in clear space. */
  headerExtra?: readonly number[]
): number[] | null {
  const ink = ruler();
  if (!ink) return null;
  /** Assembled by hand rather than read from `style.font`: the shorthand comes back empty in some
   *  engines, and every part of it is available separately. */
  const font = (style: CSSStyleDeclaration) =>
    `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

  const body = font(getComputedStyle(grid));
  // Taken from a header cell rather than assumed to be the body in bold. A `th` is bold by default
  // and a stylesheet may make it something else again, and a name measured a weight lighter than it
  // is drawn is a name with an ellipsis in a column wide enough for it.
  const headCell = grid.querySelector("thead th");
  const head = headCell ? font(getComputedStyle(headCell)) : body;

  return headers.map((name, c) => {
    ink.font = head;
    let width = ink.measureText(name).width + (headerExtra?.[c] ?? 0);
    ink.font = body;
    for (const text of samples[c] ?? []) {
      width = Math.max(width, ink.measureText(text).width);
    }
    return Math.min(Math.max(Math.ceil(width) + WIDTH_SLACK + chrome, min), max);
  });
}

/** Everything a pinned-height, pinned-width grid needs handed to its stylesheet, since neither
 *  number can be written there: the row height is what this file's arithmetic depends on, and the
 *  table's own width is what a fixed column layout divides between the columns. */
export function gridStyle(rowHeight: number, width: number | null): React.CSSProperties {
  return {
    ...(width === null ? {} : { width }),
    "--row-h": `${rowHeight}px`,
  } as React.CSSProperties;
}
