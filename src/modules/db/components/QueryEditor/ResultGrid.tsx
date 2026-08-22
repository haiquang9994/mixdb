import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  displayValue,
  gridStyle,
  measureColumns,
  useVirtualRows,
  widestValues,
} from "../../../../core/virtualRows";
import ContextMenu from "../../../../components/ContextMenu";
import Input from "../../../../components/Input";
import { copyText } from "../../../../core/clipboard";
import { errorMessage } from "../../../../core/errors";
import { csvText, jsonText, tsvText } from "../../../../core/gridText";
import { useTranslation } from "../../../../i18n";
import {
  cutOut,
  moveSelection,
  rectOf,
  selectAll,
  spanIn,
  stepSelection,
  // Shadows the DOM's own `Selection` inside this file. Nothing here calls `window.getSelection()`,
  // so nothing is lost, and renaming it would leave this the one file that calls it something else.
  type Selection,
} from "./resultSelection";
import { nextSort, viewIndexes, type Sort } from "./resultView";
import CellDialog from "./CellDialog";
import styles from "./QueryEditor.module.css";

/** How long a cell value has to be before it is worth a tooltip. Cells are cut off at 320px, which
 * no value this short reaches at the grid's font size. */
const TOOLTIP_FROM = 24;

/** Where handing the browser the whole set stops being the cheap thing to do.
 *
 * Below this the rows are rendered as they always were — the table sizes its own columns, and a
 * few dozen rows cost nothing. Above it the window takes over: a set of five hundred rows across
 * twenty columns is ten thousand cells, and the layout of every one of them is redone from scratch
 * every time the tab is shown again, since a tab behind another one is `display: none` and has no
 * layout to keep. That is the lag: not the scrolling, but the switching. */
const VIRTUAL_FROM = 60;

/** How many rows a result needs before the filter box is worth its row of height.
 *
 * Below this the whole set is on the screen or one flick of the wheel away, and a box for narrowing
 * it down is furniture — it costs a line of the pane whether or not anyone types in it. */
const FIND_FROM = 20;

/**
 * How tall a row of this grid is — stated, never measured. See `virtualRows.ts` for why that
 * distinction is the whole of what makes a window of rows sound.
 *
 * It is 31px because that is what a row here has always come to: a 24px line, 3px of padding above
 * and below, and the 1px rule underneath. Changing the grid's font or padding means changing this
 * with them, and the stylesheet pins the rows to it (`.gridRows` in the module).
 */
export const ROW_HEIGHT = 31;

/** What a cell of this grid spends on itself: 8px of padding either side, and the 1px rule down its
 *  right edge. */
const CELL_CHROME = 17;

/** The band a column is kept inside, chrome included. */
const MIN_COLUMN = 48;
const MAX_COLUMN = 320;

/** The column widths the grid is pinned to, and the total they add up to. */
interface GridLayout {
  /** The `#` column, which holds the last row's number and nothing else ever. */
  numberWidth: number;
  /** One per result column, in order. */
  widths: number[];
  /** What the table is set to, since a fixed layout only obeys the columns when the table itself
   *  has a width of its own to divide. */
  total: number;
}

function measureLayout(
  table: HTMLTableElement,
  columns: string[],
  rows: unknown[][]
): GridLayout | null {
  const sizing = { chrome: CELL_CHROME, min: MIN_COLUMN, max: MAX_COLUMN };
  const widths = measureColumns(
    table,
    columns,
    widestValues(rows, columns.length, (row, c) => row[c]),
    sizing
  );
  if (!widths) return null;
  // Measured on its own and with a floor of nothing: the `#` column holds a row number, and giving
  // it the same floor as a column of real values would waste the width on every result.
  const number = measureColumns(table, ["#"], [[String(rows.length)]], { ...sizing, min: 0 });
  if (!number) return null;
  const numberWidth = number[0];
  return { numberWidth, widths, total: widths.reduce((sum, w) => sum + w, numberWidth) };
}

interface RowProps {
  row: unknown[];
  /** Where this row sits in the result the server sent — which is what the `#` column counts, and
   *  what it goes on counting once the grid is sorted. */
  index: number;
  /** Where it sits in what is on screen. The coordinate the selection speaks in, and the one the
   *  handlers report back. */
  viewRow: number;
  columns: string[];
  /** The first and last selected column of this row, or -1 and -1 when none of it is selected.
   *  Two numbers rather than the pair `spanIn` returns: see `resultSelection.ts` — an object or an
   *  array crossing this boundary is a memo that never hits. */
  spanFrom: number;
  spanTo: number;
  /** The column the keyboard is on, when it is on this row. -1 otherwise. */
  focusCol: number;
  onPick: (viewRow: number, col: number, extend: boolean) => void;
  onOpen: (viewRow: number, col: number) => void;
  onMenu: (e: ReactMouseEvent, viewRow: number, col: number) => void;
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
const ResultRow = memo(function ResultRow({
  row,
  index,
  viewRow,
  columns,
  spanFrom,
  spanTo,
  focusCol,
  onPick,
  onOpen,
  onMenu,
}: RowProps) {
  return (
    // Marked with where it sits on screen so the keyboard can scroll it into sight while the grid
    // is short enough to size its own rows.
    <tr data-view-row={viewRow}>
      <td className={styles.rowNumber}>{index + 1}</td>
      {columns.map((_, c) => {
        const value = displayValue(row[c]);
        const isNull = row[c] === null || row[c] === undefined;
        // `spanFrom`/`spanTo` are -1 when none of this row is selected, and no column index is
        // inside that, so an untouched row needs no branch of its own.
        const picked = c >= spanFrom && c <= spanTo;
        return (
          <td
            key={c}
            className={
              [
                isNull && styles.cellNull,
                picked && styles.cellPicked,
                c === focusCol && styles.cellFocus,
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
            // Only where the cell can actually be cut short. A result of a thousand rows is tens of
            // thousands of cells, and a tooltip on every one of them is weight the grid carries for
            // nothing.
            title={value.length > TOOLTIP_FROM ? value : undefined}
            onMouseDown={(e) => {
              // Left button only, and preventDefault so a Shift+click extends the grid's rectangle
              // instead of sweeping up the browser's own text selection across it.
              if (e.button !== 0) return;
              e.preventDefault();
              onPick(viewRow, c, e.shiftKey);
            }}
            onDoubleClick={() => onOpen(viewRow, c)}
            onContextMenu={(e) => onMenu(e, viewRow, c)}
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
}

/**
 * One result set, as a grid that only ever holds the rows you can see.
 *
 * Past {@link VIRTUAL_FROM} rows the tbody is the visible window plus a spacer above and below it,
 * so a set of five hundred rows costs the browser the same as a set of forty. What that buys is not
 * mainly the scrolling — it is everything that makes the whole table lay itself out again: showing
 * the tab after a look at the data, coming back to this connection from another one, dragging the
 * divider, lifting the pane over the window.
 *
 * Below that many rows none of it applies and the table sizes itself, as it used to.
 */
function ResultGrid({ columns, rows }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  /** The measured columns, or null while the table is sizing itself — a small result, or the first
   *  frame of a large one. */
  const [layout, setLayout] = useState<GridLayout | null>(null);

  const { t } = useTranslation();
  const [sort, setSort] = useState<Sort | null>(null);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  /** The cell the dialog is open on, in view coordinates. */
  const [expanded, setExpanded] = useState<{ row: number; col: number } | null>(null);
  /** Where the right-click was, in client coordinates. */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /** A clipboard the webview refused, said out loud rather than left as a copy that did nothing. */
  const [copyFailed, setCopyFailed] = useState("");

  /** Which rows are on screen and in what order, as indexes into `rows`. See `resultView.ts` for
   *  why this is a list of indexes and never a list of rows. */
  const view = useMemo(() => viewIndexes(rows, sort, query), [rows, sort, query]);

  const total = view.length;
  const virtual = total >= VIRTUAL_FROM;
  const window = useVirtualRows(scrollRef, { total, rowHeight: ROW_HEIGHT, enabled: virtual });

  // Measured before the browser paints, so the first thing shown is already the fixed layout: a
  // frame of self-sized columns followed by a frame of measured ones would be a visible flinch.
  //
  // Measured from `rows`, not from `view`: a column is as wide as the data in it, not as wide as
  // whatever is being looked at. Measuring the view would make the columns twitch under the pointer
  // on every keystroke in the filter box added in the next task.
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
  }, [columns, rows, sort, query]);

  // A new result is a new set of columns and values, and a needle typed for the last one is very
  // likely to hide all of this one — with the box scrolled out of sight above and no way to tell
  // why the grid is empty.
  useEffect(() => {
    setQuery("");
    setSort(null);
  }, [columns, rows]);

  // Sorting, filtering or a new result moves every row out from under the rectangle. Keeping it at
  // the same coordinates would leave it highlighting cells nobody chose — worse than losing it.
  useEffect(() => {
    setSelection(null);
    setExpanded(null);
    setMenu(null);
    setCopyFailed("");
  }, [columns, rows, sort, query]);

  const rect = rectOf(selection);

  // All three take no dependencies, so their identity never changes and the memo on `ResultRow`
  // holds. Which is why each reads the state it needs through a functional update rather than
  // closing over it.
  const onPick = useCallback((viewRow: number, col: number, extend: boolean) => {
    setSelection((current) => moveSelection(current, { row: viewRow, col }, extend));
  }, []);

  const onOpen = useCallback((viewRow: number, col: number) => {
    setExpanded({ row: viewRow, col });
  }, []);

  const onMenu = useCallback((e: ReactMouseEvent, viewRow: number, col: number) => {
    e.preventDefault();
    // The selection moves onto the cell first when the click landed outside it, the way the data
    // tab's table does: every entry in the menu acts on what is highlighted, and a menu acting on
    // cells other than the highlighted ones would be read as acting on the wrong ones. A right
    // click *inside* the selection leaves it alone, which is what makes "copy these forty rows"
    // one gesture.
    setSelection((current) => {
      const area = rectOf(current);
      const inside =
        area !== null &&
        viewRow >= area.top &&
        viewRow <= area.bottom &&
        col >= area.left &&
        col <= area.right;
      return inside ? current : { anchor: { row: viewRow, col }, focus: { row: viewRow, col } };
    });
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  /** Puts text on the clipboard, and says so when the webview will not have it — a copy that
   *  quietly did nothing is the one outcome worth interrupting someone over, since they find out by
   *  pasting the wrong thing somewhere else. */
  function copy(text: string) {
    setMenu(null);
    void copyText(text)
      .then(() => setCopyFailed(""))
      .catch((e) => setCopyFailed(errorMessage(t, e)));
  }

  /** The whole result, or the rectangle in it — the two things every entry of the menu is one of.
   *
   *  The whole result goes through `view` rather than straight through `rows`: "copy the whole
   *  result" while something is sorted or filtered means what is on screen, not what the server
   *  sent. */
  function partOf(whole: boolean): { columns: string[]; rows: unknown[][] } {
    if (whole) return { columns, rows: view.map((index) => rows[index]) };
    if (rect === null) return { columns: [], rows: [] };
    return cutOut(rect, view, rows, columns);
  }

  function copyPart(whole: boolean, as: "tsv" | "csv" | "json") {
    const part = partOf(whole);
    if (part.columns.length === 0) return;
    const write = as === "csv" ? csvText : as === "json" ? jsonText : tsvText;
    copy(write(part.columns, part.rows));
  }

  /** Brings a row into sight after the keyboard has moved onto it. Two routes because there are two
   *  kinds of grid: a windowed one has every row pinned to `ROW_HEIGHT`, so where the row is can be
   *  worked out — and it has to be, since the row may not be in the DOM yet. A short one sizes its
   *  own rows, so the element is asked instead. */
  function revealRow(viewRow: number) {
    const box = scrollRef.current;
    if (!box) return;
    if (!virtual) {
      box.querySelector(`[data-view-row="${viewRow}"]`)?.scrollIntoView({ block: "nearest" });
      return;
    }
    const head = box.querySelector("thead")?.clientHeight ?? 0;
    const top = viewRow * ROW_HEIGHT;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + ROW_HEIGHT > box.scrollTop + box.clientHeight - head) {
      box.scrollTop = top + ROW_HEIGHT + head - box.clientHeight;
    }
  }

  /** The grid's keys, and only while the grid holds the keyboard: this hangs off `.gridWrap`, which
   *  takes focus when it is clicked. The SQL editor above keeps every key of its own. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelection(selectAll(view.length, columns.length));
      return;
    }
    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copyPart(false, "tsv");
      return;
    }
    if (e.key === "Escape") {
      setSelection(null);
      return;
    }
    if (e.key === "Enter" && selection !== null) {
      e.preventDefault();
      setExpanded({ row: selection.focus.row, col: selection.focus.col });
      return;
    }
    const step =
      e.key === "ArrowUp"
        ? { row: -1, col: 0 }
        : e.key === "ArrowDown"
          ? { row: 1, col: 0 }
          : e.key === "ArrowLeft"
            ? { row: 0, col: -1 }
            : e.key === "ArrowRight"
              ? { row: 0, col: 1 }
              : null;
    if (step === null) return;
    e.preventDefault();
    const next = stepSelection(selection, step, e.shiftKey, view.length, columns.length);
    setSelection(next);
    if (next !== null) revealRow(next.focus.row);
  }

  const visible = view.slice(window.first, window.last);
  const spacerSpan = columns.length + 1;

  const filtering = query.trim() !== "";
  /** Measured on the whole result, not on what is left after filtering: a box that vanished once it
   *  had done its job would take away the only way to undo it. */
  const showFind = rows.length >= FIND_FROM;

  return (
    <div className={styles.gridBox}>
      {showFind && (
        <div className={styles.gridTools}>
          <Input
            size="small"
            className={styles.findInput}
            value={query}
            placeholder={t("query.findPlaceholder")}
            aria-label={t("query.findPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
          />
          {/* Only while it is actually filtering. "1000 of 1000 rows" beside an empty box is a
              number nobody asked for. */}
          {filtering && (
            <span className={styles.findCount}>
              {t("query.findCount", { n: view.length, m: rows.length })}
            </span>
          )}
        </div>
      )}
      <div
        className={styles.gridWrap}
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={virtual ? window.onScroll : undefined}
      >
        <table
          ref={tableRef}
          // Rows pinned whenever they are windowed; columns pinned once they have been measured. Two
          // classes because they answer to different conditions — the measuring can fail in a way the
          // windowing cannot, and a windowed grid whose rows were left to size themselves is the one
          // state that must not exist.
          className={[styles.grid, virtual && styles.gridRows, layout && styles.gridFixed]
            .filter(Boolean)
            .join(" ")}
          style={virtual ? gridStyle(ROW_HEIGHT, layout?.total ?? null) : undefined}
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
              {columns.map((column, c) => {
                // Keyed by position: an arbitrary SELECT may well name the same column twice, which
                // is also why the rows are positional.
                const active = sort?.column === c ? sort.direction : null;
                const next = nextSort(sort, c);
                return (
                  <th
                    key={c}
                    className={styles.sortable}
                    aria-sort={
                      active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"
                    }
                    title={
                      next === null
                        ? t("query.sortNone")
                        : t(next.direction === "asc" ? "query.sortAsc" : "query.sortDesc", { column })
                    }
                    onClick={() => setSort(next)}
                  >
                    {column}
                    {/* Only on the column that is sorted. An arrow on every heading is twenty arrows
                        saying nothing, and the width they take is width the values do not get. */}
                    {active !== null && (
                      <span className={styles.sortMark} aria-hidden="true">
                        {active === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {virtual && (
              <tr className={styles.spacer} style={{ height: window.padTop }} aria-hidden="true">
                <td colSpan={spacerSpan} />
              </tr>
            )}
            {visible.map((index, i) => {
              const viewRow = window.first + i;
              // The tuple is pulled apart here and two numbers go on: an array crossing into a
              // memoised row is a new array on every render, and the memo would never hit.
              const [spanFrom, spanTo] = spanIn(rect, viewRow);
              return (
                // Keyed by where the row sits in the result rather than by where it sits on screen,
                // so a sort moves the rows about instead of rebuilding every one of them.
                <ResultRow
                  key={index}
                  row={rows[index]}
                  index={index}
                  viewRow={viewRow}
                  columns={columns}
                  spanFrom={spanFrom}
                  spanTo={spanTo}
                  focusCol={selection?.focus.row === viewRow ? selection.focus.col : -1}
                  onPick={onPick}
                  onOpen={onOpen}
                  onMenu={onMenu}
                />
              );
            })}
            {virtual && (
              <tr className={styles.spacer} style={{ height: window.padBottom }} aria-hidden="true">
                <td colSpan={spacerSpan} />
              </tr>
            )}
          </tbody>
        </table>
        {total === 0 && (
          <p className={styles.noRows}>
            {filtering ? t("query.noMatchingRows") : t("query.noRows")}
          </p>
        )}
      </div>
      {/* Under the grid rather than up in `.gridTools`: that strip only exists past twenty rows, and
          a clipboard the webview refused has nothing to do with how many rows came back. */}
      {copyFailed !== "" && (
        <p className={styles.copyFailed} role="alert">
          {copyFailed}
        </p>
      )}
      {menu !== null && rect !== null && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              setExpanded({ row: rect.top, col: rect.left });
            }}
          >
            {t("query.expandCell")}
          </button>
          <button type="button" onClick={() => copyPart(false, "tsv")}>
            {t("query.copySelection")}
          </button>
          <button type="button" onClick={() => copyPart(false, "csv")}>
            {t("query.copySelectionCsv")}
          </button>
          <button type="button" onClick={() => copyPart(false, "json")}>
            {t("query.copySelectionJson")}
          </button>
          <button type="button" onClick={() => copyPart(true, "tsv")}>
            {t("query.copyAll")}
          </button>
          <button type="button" onClick={() => copyPart(true, "csv")}>
            {t("query.copyAllCsv")}
          </button>
          <button type="button" onClick={() => copyPart(true, "json")}>
            {t("query.copyAllJson")}
          </button>
        </ContextMenu>
      )}
      {expanded !== null && rows[view[expanded.row]] !== undefined && (
        <CellDialog
          column={columns[expanded.col]}
          // The number the `#` column shows for that row, which is its place in the result rather
          // than its place on screen.
          rowNumber={view[expanded.row] + 1}
          value={rows[view[expanded.row]][expanded.col]}
          onClose={() => setExpanded(null)}
        />
      )}
    </div>
  );
}

export default memo(ResultGrid);
