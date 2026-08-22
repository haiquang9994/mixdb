/**
 * The rectangle of cells the result grid has selected, and cutting that rectangle out as data.
 *
 * Cells rather than rows, which is where this parts company with the data tab's table. There the
 * unit is a row, because everything done next — copy as INSERT, delete, clone — is done to a whole
 * row, and a row of a table has an identity to be done it to. A query result has neither: an
 * arbitrary SELECT has no primary key and no table to write back to, and what someone reaches into
 * it for is usually three columns out of twenty.
 *
 * Every coordinate here is a **view** coordinate — which row down the screen, which column across —
 * not an index into the rows the server sent. The two differ the moment anything is sorted or
 * filtered, and {@link cutOut} is the single place the one is turned back into the other.
 */

/** One cell, by where it sits on screen. */
export interface Cell {
  row: number;
  col: number;
}

/**
 * A selection as the two cells that made it: where it started and where it has been dragged to.
 *
 * Kept this way round rather than as a rectangle because the anchor has to survive: Shift+click
 * and Shift+arrow both mean "from where I started to here", and a rectangle has forgotten which of
 * its corners the user actually put down.
 */
export interface Selection {
  anchor: Cell;
  focus: Cell;
}

/** The same selection with its corners the right way round, whichever way it was dragged. */
export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** What a row that has nothing selected in it reports. Two numbers, and a shared constant so no
 *  caller has to build a throwaway array to say "nothing here". */
const NOTHING: [number, number] = [-1, -1];

function clamp(value: number, last: number): number {
  return Math.min(Math.max(value, 0), last);
}

/**
 * A click landing on a cell. `extend` is Shift held: the anchor stays and the focus moves, which is
 * what draws a rectangle out of two clicks.
 *
 * There is no Ctrl+click here and no list of rectangles. One rectangle is the thing that pastes
 * into a spreadsheet as a block; several disjoint ones have no such shape, and offering a selection
 * that cannot be copied usefully is worse than not offering it.
 */
export function moveSelection(current: Selection | null, cell: Cell, extend: boolean): Selection {
  if (!extend || current === null) return { anchor: cell, focus: cell };
  return { anchor: current.anchor, focus: cell };
}

/** Every cell there is, or nothing when there are none — an empty grid has no cell to anchor on. */
export function selectAll(rowCount: number, columnCount: number): Selection | null {
  if (rowCount === 0 || columnCount === 0) return null;
  return { anchor: { row: 0, col: 0 }, focus: { row: rowCount - 1, col: columnCount - 1 } };
}

export function rectOf(selection: Selection | null): Rect | null {
  if (selection === null) return null;
  const { anchor, focus } = selection;
  return {
    top: Math.min(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    bottom: Math.max(anchor.row, focus.row),
    right: Math.max(anchor.col, focus.col),
  };
}

/**
 * Which of a row's columns are inside the rectangle: `[from, to]`, or `[-1, -1]` when the row is
 * untouched.
 *
 * Two numbers rather than an object, and the caller pulls them apart before handing them on. Every
 * row on screen asks this on every render, and a fresh object — or a fresh array — crossing into a
 * memoised row is a memo that never hits: sixty rows rebuilt for every cell the pointer crosses.
 */
export function spanIn(rect: Rect | null, viewRow: number): [number, number] {
  if (rect === null || viewRow < rect.top || viewRow > rect.bottom) return NOTHING;
  return [rect.left, rect.right];
}

/**
 * An arrow key. `step` is how far to go in each direction; `extend` is Shift held, which stretches
 * the selection from its anchor instead of moving it.
 *
 * From nothing, the first press lands on the first cell rather than one step past it — the key was
 * asking to get into the grid, not to move within it.
 */
export function stepSelection(
  current: Selection | null,
  step: Cell,
  extend: boolean,
  rowCount: number,
  columnCount: number
): Selection | null {
  if (rowCount === 0 || columnCount === 0) return null;
  if (current === null) return { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } };
  const cell = {
    row: clamp(current.focus.row + step.row, rowCount - 1),
    col: clamp(current.focus.col + step.col, columnCount - 1),
  };
  return moveSelection(current, cell, extend);
}

/**
 * The rectangle as data of its own, in the shape `gridText` takes.
 *
 * The one place view coordinates go back to being rows of the result: `view[r]` is which row the
 * server actually sent, and the order they come out in is the order they are on screen — a copy of
 * a sorted grid pastes the way the grid looks.
 */
export function cutOut(
  rect: Rect,
  view: number[],
  rows: unknown[][],
  columns: string[]
): { columns: string[]; rows: unknown[][] } {
  const picked = columns.slice(rect.left, rect.right + 1);
  const out: unknown[][] = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    const row = rows[view[r]];
    if (row === undefined) continue;
    out.push(row.slice(rect.left, rect.right + 1));
  }
  return { columns: picked, rows: out };
}
