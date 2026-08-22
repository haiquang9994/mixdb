import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  displayValue,
  gridStyle,
  measureColumns,
  useVirtualRows,
  widestValues,
} from "../../../../core/virtualRows";
import Input from "../../../../components/Input";
import { useTranslation } from "../../../../i18n";
import { nextSort, viewIndexes, type Sort } from "./resultView";
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
            {visible.map((index) => (
              // Keyed by where the row sits in the result rather than by where it sits on screen, so
              // a sort moves the rows about instead of rebuilding every one of them.
              <ResultRow key={index} row={rows[index]} index={index} columns={columns} />
            ))}
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
    </div>
  );
}

export default memo(ResultGrid);
