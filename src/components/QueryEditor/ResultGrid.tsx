import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./QueryEditor.module.css";

/** How one value reads in the result grid. The same rendering the data grid uses: an absent value
 * is spelled out as NULL, and a structured one (a JSON column) as the JSON it came from. */
function displayValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "NULL";
  return typeof raw === "object" ? JSON.stringify(raw) : String(raw);
}

/** How long a cell value has to be before it is worth a tooltip. Cells are cut off at 320px, which
 * no value this short reaches at the grid's font size. */
const TOOLTIP_FROM = 24;

/** Where handing the browser the whole set stops being the cheap thing to do.
 *
 * Below this the rows are rendered as they always were — the table sizes its own columns, and a
 * few dozen rows cost nothing. Above it the window below takes over: a set of five hundred rows
 * across twenty columns is ten thousand cells, and the layout of every one of them is redone from
 * scratch every time the tab is shown again, since a tab behind another one is `display: none`
 * and has no layout to keep. That is the lag: not the scrolling, but the switching. */
const VIRTUAL_FROM = 60;

/** Rows kept either side of the visible window, so a flick of the wheel lands on rows that are
 *  already there rather than on a blank strip waiting for the next render. */
const OVERSCAN = 8;

/** The window's edges are rounded out to a multiple of this many rows.
 *
 * Without it every pixel of scrolling produces a different window, and the pane re-renders on every
 * frame of every scroll — which over a tall pane (the expanded view is the whole window) is fifty
 * rows across twenty columns reconciled per frame, and reads as a stutter. Rounded, the window only
 * changes once per block of rows scrolled past: most frames of a scroll now find the window they
 * already have and do nothing at all. */
const BLOCK = 16;

/**
 * How tall a row in a virtualised grid is — stated, not measured.
 *
 * This is the number that makes the whole thing sound, and it was the source of every scrolling
 * fault this grid has had. A window of rows only works if the rows outside it can be stood in for
 * by a spacer of the right height, and *the right height* has to be exact: the drawn rows carry
 * their real height while the spacers carry this one, so any gap between the two makes the table's
 * total height depend on where it happens to be scrolled. A table that changes height as you scroll
 * is a scrollbar that shifts under the hand — the end of the set walks away as you approach it, and
 * the size of the error scales with the set, which is why a hundred rows, five hundred and ten
 * thousand each failed differently and each looked like a new bug.
 *
 * Measuring cannot close that gap; it can only make it small, and small times ten thousand is not
 * small. So the height is not measured at all. It is declared here, handed to the stylesheet as
 * `--row-h`, and the stylesheet pins every cell to it (see `.gridFixed` in the module). The drawn
 * rows and the spacers then carry the same number by construction, the table is exactly
 * `rows × ROW_HEIGHT` tall wherever it is scrolled, and the arithmetic below is exact for every
 * size of result there is.
 *
 * It is 31px because that is what a row of this grid has always come to: a 24px line, 3px of
 * padding above and below, and the 1px rule underneath. Changing the grid's font or padding means
 * changing this with them.
 */
export const ROW_HEIGHT = 31;

/** The most rows the window will ever hold, however tall the box claims to be.
 *
 * A backstop rather than a working limit: nothing in a real pane comes near it (a full-screen
 * expanded view is some seventy rows). It is here so that a viewport measured wrong — a box that
 * has not been laid out yet, a stale height read during a transition — costs a few hundred rows
 * rather than every row in the set, which for ten thousand rows would be the freeze this whole
 * file exists to avoid. */
const MAX_WINDOW = 400;

/** How many rows are rendered before anything has been measured, which is the case for the first
 *  frame and for a result that arrives in a tab nobody is looking at. Enough to fill a pane at any
 *  height it can be dragged to, so the rows are already there in the frame the tab comes back —
 *  and enough for the row height itself to have something to be measured from. */
const BLIND_ROWS = 48;

/** What a cell spends on itself before any text goes in it: the padding either side, and the rule
 *  down its right edge. A width handed to a `<col>` is the whole column, chrome included — while
 *  what the canvas below measures is the text alone — so every measured width has to carry this or
 *  the column comes out exactly this much too narrow. That is the whole of it: forget it and a
 *  three-digit row number has room for one digit and an ellipsis. */
const CELL_CHROME = 17;

/** The band a measured column is kept inside, chrome and all. The ceiling is where a cell stops
 *  being worth widening: past it the text is cut off with an ellipsis either way, and all a wider
 *  column buys is more sideways scrolling to reach the next one. */
const MIN_COLUMN = 48;
const MAX_COLUMN = 320;

/** How many of a column's values are actually measured. The longest string is not always the widest
 *  one — a proportional font makes `WWW` wider than `iiiiii` — so the few longest by length are all
 *  measured and the widest of them wins. */
const WIDTH_SAMPLES = 3;

/** The length at which a column is certainly going to hit {@link MAX_COLUMN} whatever else is in
 *  it, and so has nothing left to learn from the rows below.
 *
 * This is what makes measuring every row affordable. A column of long text — a JSON document, a
 * description — is the expensive one to scan, and it is also the one that reaches its ceiling in
 * the first few rows; past that it is skipped entirely. Short columns are the cheap ones to scan
 * and are the reason to scan at all, since an `id` that gains a digit in row nine thousand has to
 * be measured in row nine thousand.
 *
 * Deliberately far beyond where the ceiling actually falls: at the grid's size no font puts 96
 * characters inside 320px, so a column stopped here was always going to be capped. */
const SATURATED_CHARS = 96;

/** A hair of slack on every measured column, for the difference between what a canvas says a string
 *  is worth and what the text renderer finally lays out — hinting, ligatures and letter-spacing all
 *  land on the layout side of that line. Four pixels a column is invisible; an ellipsis on a value
 *  that would have fitted is not. */
const WIDTH_SLACK = 4;

/** The column widths the grid is pinned to, and the total they add up to. Every width is a whole
 *  column — {@link CELL_CHROME} included — since that is what a `<col>` is given. */
interface GridLayout {
  /** The `#` column, which holds nothing longer than the last row's number. */
  numberWidth: number;
  /** One per result column, in order. */
  widths: number[];
  /** What the table is set to, since a fixed layout only obeys the columns when the table itself
   *  has a width of its own to divide. */
  total: number;
}

/** The one canvas the app measures text with. Kept between calls: creating one per result would be
 *  the expensive half of the measuring. */
let pen: CanvasRenderingContext2D | null = null;

function ruler(): CanvasRenderingContext2D | null {
  if (pen === null) pen = document.createElement("canvas").getContext("2d");
  return pen;
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
 * which is most of a result set; and it drops a column the moment that column's answer is settled
 * (see {@link SATURATED_CHARS}), which is what keeps a document column from being serialised ten
 * thousand times to learn something the third row had already said.
 *
 * Length is the cheap approximation and width is the answer, so a shortlist rather than a winner:
 * these are what the canvas is actually asked about, and the widest of them wins.
 */
export function widestValues(rows: unknown[][], columnCount: number): string[][] {
  const picks: string[][] = Array.from({ length: columnCount }, () => []);
  /** Columns with nothing left to learn, and how many are still worth looking at. */
  const settled = new Array<boolean>(columnCount).fill(false);
  let open = columnCount;

  for (const row of rows) {
    if (open === 0) break;
    for (let c = 0; c < columnCount; c++) {
      if (settled[c]) continue;
      const raw = row[c];
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

/**
 * How wide each column has to be, worked out without laying a single row out.
 *
 * A virtualised table has to be told its column widths: only a few dozen rows are in the DOM at any
 * moment, and a table left to size itself would size itself around *those* — every scroll would
 * find new widest values and shuffle every column sideways under the pointer.
 *
 * So the text is measured against a canvas in the grid's own font rather than by the layout engine.
 * That is what makes it affordable over the whole set: no elements, no layout, one pass over the
 * values. The header is measured in the weight the header is drawn in, which is not the body's.
 */
function measureLayout(
  table: HTMLTableElement,
  columns: string[],
  rows: unknown[][]
): GridLayout | null {
  const ink = ruler();
  if (!ink) return null;
  const style = getComputedStyle(table);
  // Assembled by hand rather than read from `style.font`: the shorthand comes back empty in some
  // engines, and every part of it is available separately.
  const body = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const head = `${style.fontStyle} 600 ${style.fontSize} ${style.fontFamily}`;

  /** A measured text width, as a column: slack, chrome, and then kept inside the band. */
  const asColumn = (text: number) =>
    Math.min(Math.max(Math.ceil(text) + WIDTH_SLACK + CELL_CHROME, MIN_COLUMN), MAX_COLUMN);

  ink.font = body;
  // Not held to `MIN_COLUMN`: the `#` column holds the last row's number and nothing else ever, and
  // giving it the same floor as a column of real values would waste the width on every result.
  const numberWidth =
    Math.ceil(ink.measureText(String(rows.length)).width) + WIDTH_SLACK + CELL_CHROME;

  const candidates = widestValues(rows, columns.length);
  const widths = columns.map((name, c) => {
    ink.font = head;
    let width = ink.measureText(name).width;
    ink.font = body;
    for (const text of candidates[c]) {
      width = Math.max(width, ink.measureText(text).width);
    }
    return asColumn(width);
  });

  const total = widths.reduce((sum, w) => sum + w, numberWidth);
  return { numberWidth, widths, total };
}

/** Which rows a scrolled box is over: the first one in it, and one past the last. */
export interface RowWindow {
  first: number;
  last: number;
}

/**
 * The rows worth rendering, given where the box is scrolled to and how tall it is.
 *
 * Its own function, and exported, because it is the whole of the arithmetic that decides what is on
 * screen — everything else in this file is DOM. An off-by-one here is a strip of blank rows at one
 * end of a scroll, which is exactly the sort of thing worth pinning down in a test rather than by
 * dragging a scrollbar.
 *
 * The overscan is added first and the block rounding second, so the block is slack on top of the
 * guaranteed margin rather than instead of it: the window always holds at least {@link OVERSCAN}
 * rows beyond the viewport, and usually rather more.
 */
export function rowWindow(
  total: number,
  rowHeight: number,
  scrollTop: number,
  span: number
): RowWindow {
  // A box of no height belongs to a tab nobody is looking at; a row of none has never been
  // measured. Neither can say anything about a window, so a blind pane's worth is the answer —
  // enough to fill the box whenever it does appear, and enough to measure a row from.
  if (rowHeight <= 0 || span <= 0) return { first: 0, last: Math.min(total, BLIND_ROWS) };
  const from = scrollTop / rowHeight - OVERSCAN;
  const to = (scrollTop + span) / rowHeight + OVERSCAN;
  const first = Math.max(0, Math.floor(from / BLOCK) * BLOCK);
  const last = Math.min(total, first + MAX_WINDOW, Math.ceil(to / BLOCK) * BLOCK);
  return { first, last: Math.max(first, last) };
}

interface RowProps {
  row: unknown[];
  /** Where this row sits in the whole set, which is what the `#` column counts. */
  index: number;
  columns: string[];
}

/**
 * One row, memoised on the three things it is drawn from.
 *
 * Which matters when the window moves: the rows either side of the change keep the same row object,
 * the same index and the same columns, so the whole of the work of a block scrolled past is the new
 * block's rows. Without this, moving the window by sixteen rows rebuilds every cell of all sixty in
 * it — a thousand-odd cells for a change of a few hundred, and the difference is visible in a tall
 * pane like the expanded view.
 */
const ResultRow = memo(function ResultRow({ row, index, columns }: RowProps) {
  return (
    <tr>
      <td className={styles.rowNumber}>{index + 1}</td>
      {columns.map((_, c) => {
        const value = displayValue(row[c]);
        const isNull = row[c] === null || row[c] === undefined;
        return (
          <td
            key={c}
            className={isNull ? styles.cellNull : undefined}
            // Only where the cell can actually be cut short. A result of a thousand rows is tens of
            // thousands of cells, and a tooltip on every one of them is weight the grid carries for
            // nothing.
            title={value.length > TOOLTIP_FROM ? value : undefined}
          >
            {value}
          </td>
        );
      })}
    </tr>
  );
});

interface Props {
  columns: string[];
  /** Positional, the way the backend sends them — an arbitrary SELECT may name the same column
   *  twice, and only a positional row keeps the two apart. */
  rows: unknown[][];
  /** What is said in place of the rows when there are none. Passed in rather than translated here,
   *  so this file has nothing to say about language. */
  emptyLabel: string;
}

/**
 * One result set, as a grid that only ever holds the rows you can see.
 *
 * Past {@link VIRTUAL_FROM} rows the tbody is the visible window plus a spacer above and below it,
 * so a set of five hundred rows costs the browser the same as a set of forty. What that buys is not
 * mainly the scrolling — it is everything that makes the whole table lay itself out again: showing
 * the tab after a look at the data, coming back to this connection from another one, dragging the
 * divider, lifting the pane over the window. All of those walk every cell in the table, and a table
 * of ten thousand cells is where they stop being instant.
 *
 * What makes the scrolling itself sound is that the table's height does not depend on where it is
 * scrolled. {@link ROW_HEIGHT} is stated rather than measured and the stylesheet pins every row to
 * it, so the drawn rows and the spacers standing in for the rest are the same number by
 * construction: the table is `rows × ROW_HEIGHT` tall at the top of the set, in the middle, and at
 * the bottom. Everything that used to go wrong here went wrong through that one gap — a scrollbar
 * that shifted as it was dragged, an end of the set that could not be reached — and every size of
 * result showed it differently, because the error was per-row and the set is the multiplier.
 *
 * Two smaller things keep it cheap rather than correct:
 *
 * - the window is rounded to blocks, so most scrolled frames change nothing and re-render nothing;
 * - the scroll offset is read from the box rather than kept in state, so a frame that changes
 *   nothing really does nothing — a state write per scroll event would re-render the pane either
 *   way.
 *
 * Below {@link VIRTUAL_FROM} rows none of this applies and the table sizes itself, as it used to.
 */
function ResultGrid({ columns, rows, emptyLabel }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  /** The measured columns, or null while the table is sizing itself — a small result, or the first
   *  frame of a large one. */
  const [layout, setLayout] = useState<GridLayout | null>(null);
  /** How tall the scrolling box is — the one thing here that still has to be asked of the DOM, and
   *  the one thing that can be wrong without doing any harm: it decides how many rows are drawn, and
   *  nothing at all about how tall the table is. Zero until it has been measured, and zero again
   *  whenever the tab holding it is put away — a hidden box has no size. */
  const [viewport, setViewport] = useState(0);
  /** The rows currently in the tbody. Held as the window rather than as a scroll offset on purpose:
   *  this is what the render actually depends on, so it is what a scroll is allowed to change. */
  const [view, setView] = useState<RowWindow>({ first: 0, last: BLIND_ROWS });

  const total = rows.length;
  const virtual = total >= VIRTUAL_FROM;

  /**
   * Works out the window from where the box is scrolled to now, and keeps it if it is the one we
   * already have.
   *
   * Returning the current object is what makes a scroll cheap: React drops a state write that
   * changes nothing, so the frames between one block and the next cost a division and no render.
   */
  const syncWindow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const span = viewport > 0 ? viewport : ROW_HEIGHT * BLIND_ROWS;
    const next = rowWindow(total, ROW_HEIGHT, el.scrollTop, span);
    setView((current) =>
      current.first === next.first && current.last === next.last ? current : next
    );
  }, [viewport, total]);

  /** How much room the box has, and the window that follows from it. The only thing still asked of
   *  the DOM, and nothing about the table's height depends on the answer. */
  const remeasure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewport(el.clientHeight);
    syncWindow();
  }, [syncWindow]);

  // Measured before the browser paints, so the first thing shown is already the fixed layout: a
  // frame of self-sized columns followed by a frame of measured ones would be a visible flinch.
  useLayoutEffect(() => {
    if (!virtual) {
      setLayout(null);
      return;
    }
    const table = tableRef.current;
    if (!table) return;
    setLayout(measureLayout(table, columns, rows));
  }, [virtual, columns, rows]);

  // A new result is a new set of rows under the same box, and whatever the last one was scrolled to
  // means nothing to it.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    remeasure();
    // `remeasure` is deliberately not a dependency: this effect is about the rows changing, and
    // re-running it whenever the box is measured again would put the scroll back to the top for a
    // resize — the pane would jump to row one every time the divider was dragged.

  }, [columns, rows]);

  // What the window was worked out from has changed under it — the box's height, or the number of
  // rows. Before paint, so a taller pane is filled in the frame it grew.
  useLayoutEffect(() => {
    syncWindow();
  }, [syncWindow]);

  // An observer rather than a one-off, because the box's height changes without the rows changing:
  // the divider is dragged, the pane is lifted over the window, the window itself is resized — and,
  // most of all, the tab comes back from behind another one, which is when its height goes from
  // zero to real.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(remeasure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [remeasure]);

  const first = virtual ? view.first : 0;
  const last = virtual ? Math.min(view.last, total) : total;
  // Exact, not approximate: the rows these stand in for are pinned to the same number by the
  // stylesheet, so the table is `total * ROW_HEIGHT` tall at every scroll position there is.
  const padTop = first * ROW_HEIGHT;
  const padBottom = (total - last) * ROW_HEIGHT;
  const visible = virtual ? rows.slice(first, last) : rows;
  const spacerSpan = columns.length + 1;

  return (
    <div className={styles.gridWrap} ref={scrollRef} onScroll={virtual ? syncWindow : undefined}>
      <table
        ref={tableRef}
        // Rows pinned whenever they are windowed; columns pinned once they have been measured. Two
        // classes because they answer to different conditions — the measuring can fail in a way the
        // windowing cannot, and a windowed grid whose rows were left to size themselves is the one
        // state that must not exist.
        className={[styles.grid, virtual && styles.gridRows, layout && styles.gridFixed]
          .filter(Boolean)
          .join(" ")}
        // Two things the stylesheet cannot know on its own. The width, because a fixed column layout
        // is only obeyed when the table has a width of its own to divide between the columns. And
        // the row height, because it is the arithmetic above that depends on it: handing it over as
        // a custom property is what makes the rows the stylesheet pins and the spacers this file
        // sizes the same number by construction rather than by agreement.
        style={
          {
            ...(layout ? { width: layout.total } : {}),
            ...(virtual ? { "--row-h": `${ROW_HEIGHT}px` } : {}),
          } as React.CSSProperties
        }
      >
        {layout && (
          <colgroup>
            <col style={{ width: layout.numberWidth }} />
            {layout.widths.map((width, c) => (
              <col key={c} style={{ width }} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr>
            <th className={styles.rowNumber}>#</th>
            {columns.map((column, c) => (
              // Keyed by position: an arbitrary SELECT may well name the same column twice, which
              // is also why the rows are positional.
              <th key={c}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* The rows outside the window, as the height they would have taken. Two elements instead
              of hundreds, and the scrollbar is the same length either way.

              Always both of them, even when one is empty: a spacer that disappeared at the end of
              the set would hand `tr:last-child` to a real row, whose bottom rule the stylesheet
              then takes away — a table a pixel shorter at the bottom than it was on the way there,
              which the scroll at that end spends its time chasing. */}
          {virtual && (
            <tr className={styles.spacer} style={{ height: padTop }} aria-hidden="true">
              <td colSpan={spacerSpan} />
            </tr>
          )}
          {visible.map((row, i) => (
            <ResultRow key={first + i} row={row} index={first + i} columns={columns} />
          ))}
          {virtual && (
            <tr className={styles.spacer} style={{ height: padBottom }} aria-hidden="true">
              <td colSpan={spacerSpan} />
            </tr>
          )}
        </tbody>
      </table>
      {total === 0 && <p className={styles.noRows}>{emptyLabel}</p>}
    </div>
  );
}

export default memo(ResultGrid);
