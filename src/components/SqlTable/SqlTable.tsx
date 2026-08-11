import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { mysqlDeleteRows, mysqlInsertRows, mysqlTableData, mysqlUpdateRow } from "../../mysql/api";
import ActionBar from "../ActionBar";
import ConfirmDialog from "../ConfirmDialog";
import FilterBar from "../FilterBar";
import InsertRowsDialog from "../InsertRowsDialog";
import LoadingOverlay from "../LoadingOverlay";
import Pagination from "../Pagination";
import Tooltip from "../Tooltip";
import { ChevronDownIcon, ChevronUpIcon, CopyIcon, PlusIcon, ReloadIcon, TrashIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import { errorMessage } from "../../errors";
import { useReloadShortcut, withReloadShortcut } from "../../reload";
import { initialFilterRows, toQueryFilters, type FilterRow } from "../../filters";
import {
  FILTER_OPERATORS,
  operatorArity,
  type FilterOperator,
  type MysqlFilter,
} from "../../mysql/filters";
import type { MysqlColumnMeta } from "../../types";
import styles from "./SqlTable.module.css";

interface EditingCell {
  rowIndex: number;
  col: string;
}

/** Which column the grid is ordered by, and which way. Only ever one at a time: clicking a header
 * replaces this rather than adding to it. `null` is the table's own order, untouched. */
interface Sort {
  column: string;
  desc: boolean;
}

/** The header click cycle: unsorted → descending → ascending → unsorted. */
function nextSort(current: Sort | null, column: string): Sort | null {
  if (current?.column !== column) return { column, desc: true };
  return current.desc ? { column, desc: false } : null;
}

function normalizeCellValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  return typeof raw === "object" ? JSON.stringify(raw) : String(raw);
}

function displayValue(raw: unknown): string {
  return normalizeCellValue(raw) ?? "NULL";
}

function isMultilineType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return t.includes("text") || t.includes("json") || t.includes("blob");
}

function tableCacheKey(db: string, table: string): string {
  return `${db} :: ${table}`;
}

/** One table's filter bar as it was left behind: the rows still being edited, and the conditions
 * that were actually running against the grid. */
export interface RememberedFilters {
  rows: FilterRow<FilterOperator>[];
  applied: MysqlFilter[];
}

/** Every table's bar, by the table it belongs to. Held by the workspace rather than here: the grid
 * is unmounted whenever the header leaves the Data tab, and a cache living inside it would go with
 * it — the conditions have to outlive a trip to Structure or Query, not just a trip to another
 * table. */
export type FilterCache = Map<string, RememberedFilters>;

interface TableColumnsInfo {
  columns: string[];
  columnMeta: Record<string, MysqlColumnMeta>;
  primaryKey: string[];
  autoIncrementColumn: string | null;
}

interface Props {
  /** Whether the connection tab this grid sits in is the one on show. Only the grid the user is
   *  looking at answers `Ctrl+R` — the others stay mounted behind their tabs. */
  active: boolean;
  connectionId: string;
  selectedDb: string;
  selectedTable: string;
  onError: (message: string) => void;
  layoutWidth?: number;
  /** Where the filter bar is kept between visits — see {@link FilterCache}. */
  filterCache: FilterCache;
  /** The saved connection is marked as one nothing is written to. The grid still reads, sorts,
   *  filters and pages exactly as it does otherwise — what goes is every door out of read mode. */
  readOnly?: boolean;
}

const PAGE_SIZES = [100, 200, 500, 1000];

function SqlTable({
  active,
  connectionId,
  selectedDb,
  selectedTable,
  onError,
  layoutWidth,
  filterCache,
  readOnly = false,
}: Props) {
  const { t } = useTranslation();
  const tableKey = tableCacheKey(selectedDb, selectedTable);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [columnMeta, setColumnMeta] = useState<Record<string, MysqlColumnMeta>>({});
  const [primaryKey, setPrimaryKey] = useState<string[]>([]);
  const [autoIncrementColumn, setAutoIncrementColumn] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<Sort | null>(null);
  // The filter bar edits `filterRows` freely; only Apply copies them into `appliedFilters`, which
  // is what the fetch below reads. Keeping the two apart is what stops a half-typed condition
  // from reloading the grid on every keystroke.
  //
  // Both start from whatever this table's bar was left carrying: the grid is mounted afresh every
  // time the header comes back to the Data tab, and a bar restored only on the way to another
  // table would come back empty from a trip to Structure or Query.
  const [filterRows, setFilterRows] = useState<FilterRow<FilterOperator>[]>(
    () => filterCache.get(tableKey)?.rows ?? []
  );
  const [appliedFilters, setAppliedFilters] = useState<MysqlFilter[]>(
    () => filterCache.get(tableKey)?.applied ?? []
  );
  // The table whose columns the bar was last seeded from. The seed needs the column list, which
  // is only known once the first fetch lands (or from the cache, when there is one).
  const filtersSeededForRef = useRef<string | null>(null);

  // What the fetch below reads — the page, the order and the conditions — is about one table, so
  // it is swapped over here, during the render that first sees a new table, rather than from an
  // effect. An effect would be too late: it and the fetch's own effect run after the same commit,
  // so the request would already have gone out naming the new table with the previous one's page,
  // sort column and filters — and a condition on a column the new table hasn't got comes back an
  // error rather than an empty result.
  const [viewTableKey, setViewTableKey] = useState(tableKey);
  if (viewTableKey !== tableKey) {
    // Put the outgoing table's bar away before its state is replaced. This is where it has to
    // happen: by the time any effect runs, `filterRows` already belongs to the new table.
    filterCache.set(viewTableKey, { rows: filterRows, applied: appliedFilters });
    setViewTableKey(tableKey);
    setPage(0);
    setSort(null);
    // The rows of the bar are put back alongside the columns they name, in the effect below.
    setAppliedFilters(filterCache.get(tableKey)?.applied ?? []);
  }

  /** The bar as it stands, for the write on the way out: a cleanup runs long after the last
   * render, so it cannot read the state itself. */
  const filterStateRef = useRef({ key: viewTableKey, rows: filterRows, applied: appliedFilters });
  useEffect(() => {
    filterStateRef.current = { key: viewTableKey, rows: filterRows, applied: appliedFilters };
  });

  // Leaving the Data tab unmounts the grid just as thoroughly as closing it would, so the bar is
  // also put away on the way out — coming back to the tab finds the conditions where they were.
  useEffect(() => {
    return () => {
      const { key, rows, applied } = filterStateRef.current;
      // Only a bar that has had its opening row is worth remembering. Before the columns land
      // there is nothing in it, and filing that away would read on the way back in as a bar
      // deliberately emptied — leaving the table with no `id =` row to start from, for good.
      if (filtersSeededForRef.current !== key) return;
      filterCache.set(key, { rows, applied });
    };
  }, [filterCache]);

  const [loading, setLoading] = useState(false);
  // Bumped by the reload action to re-run the fetch below with the page/size unchanged.
  const [reloadToken, setReloadToken] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [editingCell, setEditingCellState] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState("");
  const editingCellRef = useRef<EditingCell | null>(null);
  const pendingRowRef = useRef<{
    rowIndex: number;
    changes: Record<string, string | null>;
    original: Record<string, unknown>;
  } | null>(null);
  const editInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const currentTableRef = useRef({ db: selectedDb, table: selectedTable });
  const columnsCacheRef = useRef<Map<string, TableColumnsInfo>>(new Map());
  const thRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  // Selected rows are held as indices into the current page: selection is a
  // property of what is on screen, and every path that replaces the rows
  // (paging, reloading, switching table) clears it.
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  // Where a shift-click range starts. A ref rather than state because it is
  // only ever read from inside an event handler.
  const anchorRowRef = useRef<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteWholeTable, setDeleteWholeTable] = useState(false);
  const [resetAutoIncrement, setResetAutoIncrement] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // What the insert form opens on — a blank row, or a copy of each selected row. `null` is the
  // form being closed. The rows a clone starts from are read at render time rather than stored
  // here, so they are the ones on screen when the form mounts, staged edits included.
  const [insertMode, setInsertMode] = useState<"new" | "clone" | null>(null);

  function clearSelection() {
    setSelectedRows(new Set());
    anchorRowRef.current = null;
  }

  /** Hands the keyboard back to the grid. A dialog opened from here takes focus and leaves it on
   * the body when it closes, which would silence the grid's own shortcuts until the next click. */
  function focusGrid() {
    scrollRef.current?.focus({ preventScroll: true });
  }

  function setEditingCell(next: EditingCell | null) {
    editingCellRef.current = next;
    setEditingCellState(next);
  }

  function measureColumnWidths() {
    const widths: Record<string, number> = {};
    for (const c of columns) {
      const el = thRefs.current.get(c);
      if (el) widths[c] = el.offsetWidth;
    }
    setColumnWidths(widths);
  }

  useEffect(() => {
    currentTableRef.current = { db: selectedDb, table: selectedTable };
  }, [selectedDb, selectedTable]);

  useEffect(() => {
    const el = editInputRef.current;
    if (!editingCell || !el) return;
    el.focus();
    el.select();
  }, [editingCell]);

  useEffect(() => {
    const el = editInputRef.current;
    if (!editingCell || !(el instanceof HTMLTextAreaElement)) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editValue, editingCell]);

  // Re-measure each column's rendered width whenever the data or layout that
  // could affect it changes, so the edit input/textarea can be pinned to it
  // (auto table-layout would otherwise resize the column around the input's
  // own intrinsic size, causing a visible jump when entering edit mode).
  useLayoutEffect(() => {
    measureColumnWidths();
  }, [columns, rows, layoutWidth]);

  useEffect(() => {
    function onResize() {
      measureColumnWidths();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [columns]);

  // Runs only when the selected table itself changes (not on page/pageSize
  // changes). Applies a cached column layout immediately if we have one for
  // this table, so the header can render right away without stale rows from
  // the previous table; otherwise clears columns so the whole grid stays
  // hidden until the fetch below resolves.
  useEffect(() => {
    setEditingCell(null);
    pendingRowRef.current = null;
    setRows([]);
    setTotal(0);
    // The page, the sort and the applied filters have already been reset above, during the
    // render that saw the table change — see the note there.
    const key = tableCacheKey(selectedDb, selectedTable);
    const cached = columnsCacheRef.current.get(key);
    // A table that has been here before gets its own bar back; only a first visit is seeded with
    // the opening `id =` row.
    const remembered = filterCache.get(key);
    if (cached) {
      setColumns(cached.columns);
      setColumnMeta(cached.columnMeta);
      setPrimaryKey(cached.primaryKey);
      setAutoIncrementColumn(cached.autoIncrementColumn);
      setFilterRows(remembered?.rows ?? initialFilterRows(cached.columns, "eq"));
      filtersSeededForRef.current = key;
    } else {
      setColumns([]);
      setColumnMeta({});
      setPrimaryKey([]);
      setAutoIncrementColumn(null);
      setFilterRows(remembered?.rows ?? []);
      // Nothing is owed a seed once the bar has been restored, or the fetch would overwrite it.
      filtersSeededForRef.current = remembered ? key : null;
    }
  }, [selectedDb, selectedTable]);

  // The indices in `selectedRows` only mean anything for the rows currently on
  // screen, so any refetch — a new page, a new size, a new order, a reload, a
  // new table — drops the selection rather than carrying it onto different rows.
  useEffect(() => {
    clearSelection();
  }, [selectedDb, selectedTable, page, pageSize, sort, appliedFilters, reloadToken]);

  useEffect(() => {
    const db = selectedDb;
    const table = selectedTable;
    let cancelled = false;
    setLoading(true);
    mysqlTableData(connectionId, db, table, {
      page,
      pageSize,
      sortColumn: sort?.column ?? null,
      sortDesc: sort?.desc ?? false,
      filters: appliedFilters,
    })
      .then((result) => {
        if (cancelled) return;
        const key = tableCacheKey(db, table);
        columnsCacheRef.current.set(key, {
          columns: result.columns,
          columnMeta: result.columnMeta,
          primaryKey: result.primaryKey,
          autoIncrementColumn: result.autoIncrementColumn,
        });
        // First look at this table's columns — the bar has been waiting for them to put its
        // opening `id` row together.
        if (filtersSeededForRef.current !== key) {
          setFilterRows(initialFilterRows(result.columns, "eq"));
          filtersSeededForRef.current = key;
        }
        setRows(result.rows);
        setColumns(result.columns);
        setColumnMeta(result.columnMeta);
        setPrimaryKey(result.primaryKey);
        setAutoIncrementColumn(result.autoIncrementColumn);
        setTotal(result.total);
      })
      .catch((e) => onError(errorMessage(t, e)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedDb, selectedTable, page, pageSize, sort, appliedFilters, reloadToken]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
      scrollRef.current.scrollTop = 0;
    }
  }, [selectedTable]);

  function commitEditingCell() {
    const cell = editingCellRef.current;
    if (!cell) return;
    const { rowIndex, col } = cell;
    const row = rows[rowIndex];
    if (!row) return;
    const oldNorm = normalizeCellValue(row[col]);
    const newVal = editValue === "NULL" ? null : editValue;
    if (newVal === oldNorm) return;
    const prev = pendingRowRef.current;
    const sameRow = prev && prev.rowIndex === rowIndex;
    const changes = { ...(sameRow ? prev.changes : {}), [col]: newVal };
    const original = { ...(sameRow ? prev.original : {}) };
    if (!(col in original)) original[col] = row[col];
    pendingRowRef.current = { rowIndex, changes, original };
    // Optimistically reflect the edit in read mode immediately — the actual
    // UPDATE is still batched/deferred via pendingRowRef.
    setRows((prevRows) => prevRows.map((r, i) => (i === rowIndex ? { ...r, [col]: newVal } : r)));
  }

  async function flushPendingRow() {
    const pending = pendingRowRef.current;
    pendingRowRef.current = null;
    if (!pending || Object.keys(pending.changes).length === 0) return;
    const row = rows[pending.rowIndex];
    if (!row) return;
    const dbAtFlush = selectedDb;
    const tableAtFlush = selectedTable;
    const keyCols = primaryKey.length > 0 ? primaryKey : columns;
    const key: Record<string, string | null> = {};
    for (const c of keyCols) {
      // Key columns already optimistically edited must use their pre-edit
      // value — `row` reflects the optimistic update, not what's in MySQL yet.
      key[c] = c in pending.original ? normalizeCellValue(pending.original[c]) : normalizeCellValue(row[c]);
    }
    try {
      await mysqlUpdateRow(connectionId, dbAtFlush, tableAtFlush, pending.changes, key);
    } catch (e) {
      onError(errorMessage(t, e));
      setRows((prevRows) => {
        if (currentTableRef.current.db !== dbAtFlush || currentTableRef.current.table !== tableAtFlush) {
          return prevRows;
        }
        return prevRows.map((r, i) => (i === pending.rowIndex ? { ...r, ...pending.original } : r));
      });
    }
  }

  async function commitAndExit() {
    commitEditingCell();
    setEditingCell(null);
    await flushPendingRow();
  }

  /** Refetches the current page. Waits for a staged edit to be written first, so the rows
   * that come back include it rather than overwriting it with the pre-edit values. */
  async function reload() {
    await commitAndExit();
    setReloadToken((n) => n + 1);
  }

  // Gated on the same state the button below is: a refetch asked for while one is already out, or
  // over rows being deleted, is one the button would refuse. Not while the delete confirmation is
  // up either — it names the selected rows, and a reload underneath it would leave it naming rows
  // that are no longer the ones selected.
  useReloadShortcut(active && !confirmingDelete, () => {
    if (loading || deleting) return;
    void reload();
  });

  /** Runs the filter bar's rows against the table. Like a reload, a staged edit is written first:
   * the rows come back filtered, and the pending row index would no longer point at the row that
   * was edited. The result is a different set of rows, so the grid goes back to the first page —
   * the page the user was on need not even exist under the new conditions. */
  async function applyFilters() {
    await commitAndExit();
    // A new array every time on purpose: pressing Apply twice on the same conditions is a
    // request to refetch, and an equal-but-identical array would be a no-op.
    setAppliedFilters(toQueryFilters(filterRows, operatorArity));
    setPage(0);
  }

  /** Moves the clicked column to its next sort state. Like a reload, a staged edit is written
   * first — the rows come back in a new order, and the pending row index would no longer point
   * at the row that was edited. Reordering also reshuffles which rows land on the current page,
   * so the grid goes back to the first one. */
  async function toggleSort(column: string) {
    await commitAndExit();
    setSort((current) => nextSort(current, column));
    setPage(0);
  }

  /** The selected rows themselves, in the order they sit on screen — `selectedRows` holds their
   * indices, and a Set keeps no order of its own. */
  function selectedRowsInOrder(): Record<string, unknown>[] {
    return [...selectedRows]
      .sort((a, b) => a - b)
      .map((i) => rows[i])
      .filter((row): row is Record<string, unknown> => row !== undefined);
  }

  /** Identifies one row to the server: its primary key columns, or — when the table has none —
   * every column, the same fallback an update uses. */
  function rowKey(row: Record<string, unknown>): Record<string, string | null> {
    const keyCols = primaryKey.length > 0 ? primaryKey : columns;
    const key: Record<string, string | null> = {};
    for (const c of keyCols) key[c] = normalizeCellValue(row[c]);
    return key;
  }

  /** Opens the insert form, either on a single blank row or on a copy of each selected row —
   * a clone gets looked over, and its unique columns changed, before it is written. */
  async function openInsert(mode: "new" | "clone") {
    // Write out a staged edit first: the form is modal, and the blur that would otherwise flush
    // it never comes while it is up.
    await commitAndExit();
    setInsertMode(mode);
  }

  /** Hands the form's rows to the server. Errors are left to reject so the form can show them
   * and stay open with the typed values still in it. */
  async function submitInsert(newRows: Record<string, string | null>[]) {
    await mysqlInsertRows(connectionId, selectedDb, selectedTable, newRows);
    setInsertMode(null);
    focusGrid();
    setReloadToken((n) => n + 1);
  }

  async function openDeleteConfirm() {
    // Write out a staged edit first: it may touch a key column, which would leave the key we
    // are about to send pointing at a row that no longer looks like that.
    await commitAndExit();
    setDeleteWholeTable(false);
    setResetAutoIncrement(false);
    setConfirmingDelete(true);
  }

  async function confirmDelete() {
    const keys = selectedRowsInOrder().map(rowKey);
    const wholeTable = deleteWholeTable;
    setConfirmingDelete(false);
    focusGrid();
    setDeleting(true);
    try {
      await mysqlDeleteRows(
        connectionId,
        selectedDb,
        selectedTable,
        keys,
        wholeTable,
        canResetAutoIncrement && resetAutoIncrement,
      );
      if (wholeTable) setPage(0);
      setReloadToken((n) => n + 1);
    } catch (e) {
      onError(errorMessage(t, e));
    } finally {
      setDeleting(false);
    }
  }

  async function moveEditTo(rowIndex: number, col: string) {
    // The one door into edit mode — a double-click and a Tab both come through here — so this is
    // the one place a read-only connection has to be turned away. Nothing is said about it: a cell
    // that simply does not open reads as a grid for looking at, and the reason is on the buttons
    // below, where someone who wants to change something is already looking.
    if (readOnly) return;
    const leavingRow = editingCellRef.current?.rowIndex;
    commitEditingCell();
    if (leavingRow !== undefined && leavingRow !== rowIndex) {
      await flushPendingRow();
    }
    setEditingCell({ rowIndex, col });
    setEditValue(displayValue(rows[rowIndex]?.[col]));
  }

  /** Extends, toggles or replaces the selection the way a list does: plain click selects the one
   * row, ctrl/cmd toggles it, shift takes everything between the anchor and it. */
  function selectRow(rowIndex: number, e: React.MouseEvent) {
    const toggle = e.ctrlKey || e.metaKey;
    const anchor = anchorRowRef.current;
    if (e.shiftKey && anchor !== null) {
      const from = Math.min(anchor, rowIndex);
      const to = Math.max(anchor, rowIndex);
      setSelectedRows((prev) => {
        const next = toggle ? new Set(prev) : new Set<number>();
        for (let i = from; i <= to; i++) next.add(i);
        return next;
      });
      return;
    }
    anchorRowRef.current = rowIndex;
    if (toggle) {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        if (!next.delete(rowIndex)) next.add(rowIndex);
        return next;
      });
      return;
    }
    setSelectedRows(new Set([rowIndex]));
  }

  function handleCellMouseDown(e: React.MouseEvent<HTMLTableCellElement>, rowIndex: number, col: string) {
    if (e.button !== 0) return;
    const current = editingCellRef.current;
    if (current && current.rowIndex === rowIndex && current.col === col) {
      return;
    }
    if (e.detail >= 2) {
      e.preventDefault();
      void moveEditTo(rowIndex, col);
      return;
    }
    if (current) {
      e.preventDefault();
      void commitAndExit();
    }
    // Shift/ctrl-click means "extend the row selection" here, so the browser must not read it as
    // "extend the text selection" as well. A plain click keeps its normal text-dragging.
    if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault();
    selectRow(rowIndex, e);
    // The grid owns the ctrl+A shortcut, and a shortcut only reaches it while it holds focus.
    // Clicking a row is what tells us the user is working in the grid — but only on a single
    // click: the second click of a double-click goes to edit mode, whose input takes focus itself.
    scrollRef.current?.focus({ preventScroll: true });
  }

  function handleGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // While a cell is open for editing its input owns the keyboard: select-all takes the text,
    // and Escape backs the edit out.
    if (editingCellRef.current) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      if (rows.length === 0) return;
      setSelectedRows(new Set(rows.map((_, i) => i)));
      anchorRowRef.current = 0;
      return;
    }
    if (e.key === "Escape" && selectedRows.size > 0) {
      e.preventDefault();
      clearSelection();
      return;
    }
    // Delete/Backspace on a selection is the toolbar's delete button, down to the confirmation
    // step — so it is gated on exactly what disables that button.
    if (e.key === "Delete" || e.key === "Backspace") {
      if (readOnly || loading || deleting || selectedRows.size === 0) return;
      e.preventDefault();
      void openDeleteConfirm();
    }
  }

  function handleInputBlur(rowIndex: number, col: string) {
    const current = editingCellRef.current;
    if (!current || current.rowIndex !== rowIndex || current.col !== col) return;
    void commitAndExit();
  }

  function handleEditChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setEditValue(e.target.value);
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const cell = editingCellRef.current;
    if (!cell) return;
    if (e.key === "Escape") {
      e.preventDefault();
      const pending = pendingRowRef.current;
      if (pending && pending.rowIndex === cell.rowIndex) {
        pendingRowRef.current = null;
        setRows((prevRows) =>
          prevRows.map((r, i) => (i === pending.rowIndex ? { ...r, ...pending.original } : r)),
        );
      }
      setEditingCell(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void commitAndExit();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const colIdx = columns.indexOf(cell.col);
      const nextColIdx = colIdx + (e.shiftKey ? -1 : 1);
      if (nextColIdx < 0 || nextColIdx >= columns.length) return;
      void moveEditTo(cell.rowIndex, columns[nextColIdx]);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextRow = cell.rowIndex + (e.key === "ArrowUp" ? -1 : 1);
      if (nextRow < 0 || nextRow >= rows.length) return;
      void moveEditTo(nextRow, cell.col);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const target = e.currentTarget;
      const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
      const atEnd = target.selectionStart === target.value.length && target.selectionEnd === target.value.length;
      if (e.key === "ArrowLeft" && !atStart) return;
      if (e.key === "ArrowRight" && !atEnd) return;
      const colIdx = columns.indexOf(cell.col);
      const nextColIdx = colIdx + (e.key === "ArrowLeft" ? -1 : 1);
      if (nextColIdx < 0 || nextColIdx >= columns.length) return;
      e.preventDefault();
      void moveEditTo(cell.rowIndex, columns[nextColIdx]);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const allPageRowsSelected = rows.length > 0 && selectedRows.size === rows.length;
  // Under a filter, `total` counts the matching rows rather than the table's — and a whole-table
  // delete would still take every row, matching or not. Neither of the two shortcuts below can
  // say what it means then, so both are withheld until the filters are cleared.
  const unfiltered = appliedFilters.length === 0;
  // Only worth offering while the page is a window onto a bigger table: with a single page,
  // deleting every selected row already is deleting the whole table.
  const canDeleteWholeTable = unfiltered && allPageRowsSelected && pageCount > 1;
  // Resetting the counter only means anything when the delete leaves the table empty — with
  // rows still in it, the next insert has to keep clearing the ids that are already there.
  const canResetAutoIncrement =
    autoIncrementColumn !== null &&
    unfiltered &&
    (deleteWholeTable || (allPageRowsSelected && pageCount === 1));

  return (
    <div className={styles.sqlTable}>
      {columns.length > 0 && (
        <FilterBar
          fields={columns}
          operators={FILTER_OPERATORS}
          defaultOperator="eq"
          operatorLabel={(op) => t(`sqlTable.op.${op}`)}
          rows={filterRows}
          onChange={setFilterRows}
          onApply={() => void applyFilters()}
          applyDisabled={loading || deleting}
        />
      )}
      <div className={styles.scrollWrap}>
        <div
          className={styles.scroll}
          ref={scrollRef}
          tabIndex={-1}
          onKeyDown={handleGridKeyDown}
        >
          <table>
            <thead>
              <tr>
                {columns.map((c) => {
                  const sorted = sort?.column === c ? sort : null;
                  const foreignKey = columnMeta[c]?.foreignKey ?? null;
                  return (
                    <th
                      key={c}
                      ref={(el) => {
                        if (el) thRefs.current.set(c, el);
                        else thRefs.current.delete(c);
                      }}
                      className={styles.headerCell}
                      // `aria-sort` is what tells a screen reader the grid is ordered by this
                      // column; the chevron only says it to the eye.
                      aria-sort={sorted ? (sorted.desc ? "descending" : "ascending") : "none"}
                      onClick={() => void toggleSort(c)}
                    >
                      {/* Around the name rather than around the whole cell, and not only because a
                          hook cannot be called from this loop: the FK chip beside it has a tooltip
                          of its own, and a cell-wide one would still count as hovered while the
                          pointer sat on the chip — two bubbles at once. Side by side, entering one
                          leaves the other. */}
                      <Tooltip
                        text={t(
                          sorted
                            ? sorted.desc
                              ? "sqlTable.sortDesc"
                              : "sqlTable.sortAsc"
                            : "sqlTable.sortNone",
                          { column: c },
                        )}
                      >
                        {c}
                      </Tooltip>
                      {foreignKey && (
                        // Its own tooltip, so what the column points at is readable without having
                        // to remember the schema. Drawn by the app rather than by `title`, which
                        // would have put it in the system's font, where the `->` of the message is
                        // two characters instead of the arrow Fira Code makes of them.
                        <Tooltip
                          text={t("sqlTable.foreignKey", {
                            table: foreignKey.table,
                            column: foreignKey.column,
                          })}
                        >
                          <span className={styles.fkBadge}>FK</span>
                        </Tooltip>
                      )}
                      {/* Always rendered, empty when unsorted: the column is measured for the
                          edit input's width, and an indicator that comes and goes would change
                          that width under it. */}
                      <span className={styles.sortIcon}>
                        {sorted && (sorted.desc ? <ChevronDownIcon /> : <ChevronUpIcon />)}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className={selectedRows.has(i) ? styles.rowSelected : undefined}
                  aria-selected={selectedRows.has(i)}
                >
                  {columns.map((c) => {
                    const isEditing = editingCell?.rowIndex === i && editingCell.col === c;
                    if (isEditing) {
                      const multiline = isMultilineType(columnMeta[c]?.dataType);
                      const cellWidth = columnWidths[c];
                      return (
                        <td
                          key={c}
                          className={styles.cellEditing}
                          style={cellWidth ? { width: cellWidth } : undefined}
                        >
                          {multiline ? (
                            <textarea
                              ref={editInputRef as React.RefObject<HTMLTextAreaElement>}
                              value={editValue}
                              onChange={handleEditChange}
                              onKeyDown={handleEditKeyDown}
                              onBlur={() => handleInputBlur(i, c)}
                              className={styles.cellTextarea}
                              rows={1}
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="off"
                              spellCheck={false}
                            />
                          ) : (
                            <input
                              ref={editInputRef as React.RefObject<HTMLInputElement>}
                              type="text"
                              value={editValue}
                              onChange={handleEditChange}
                              onKeyDown={handleEditKeyDown}
                              onBlur={() => handleInputBlur(i, c)}
                              className={styles.cellInput}
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="off"
                              spellCheck={false}
                            />
                          )}
                        </td>
                      );
                    }
                    const raw = row[c];
                    const isNull = raw === null || raw === undefined;
                    const value = isNull
                      ? "NULL"
                      : typeof raw === "object"
                        ? JSON.stringify(raw)
                        : String(raw);
                    const isDirty =
                      pendingRowRef.current?.rowIndex === i &&
                      Object.prototype.hasOwnProperty.call(pendingRowRef.current.changes, c);
                    const cellClassName = [isNull && styles.cellNull, isDirty && styles.cellDirty]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <td
                        key={c}
                        title={value}
                        className={cellClassName || undefined}
                        onMouseDown={(e) => handleCellMouseDown(e, i, c)}
                      >
                        {value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && <p className="muted">{t("sqlTable.noRows")}</p>}
        </div>
        {(loading || deleting) && (
          <LoadingOverlay label={deleting ? t("sqlTable.deletingRows") : t("sqlTable.loading")} />
        )}
      </div>
      <div className={styles.footer}>
        <ActionBar
          actions={[
            {
              key: "reload",
              icon: ReloadIcon,
              label: withReloadShortcut(t("sqlTable.reloadRows")),
              disabled: loading || deleting,
              busy: loading,
              onClick: () => void reload(),
            },
            {
              key: "insert",
              icon: PlusIcon,
              label: t("sqlTable.insertRows"),
              disabled: readOnly || loading || deleting || columns.length === 0,
              disabledHint: readOnly ? t("common.readOnlyConnection") : undefined,
              onClick: () => void openInsert("new"),
            },
            {
              key: "clone",
              icon: CopyIcon,
              label: t("sqlTable.cloneRows"),
              disabled: readOnly || loading || deleting || selectedRows.size === 0,
              disabledHint: readOnly ? t("common.readOnlyConnection") : undefined,
              onClick: () => void openInsert("clone"),
            },
            {
              key: "delete",
              icon: TrashIcon,
              label: t("sqlTable.deleteRows"),
              danger: true,
              disabled: readOnly || loading || deleting || selectedRows.size === 0,
              disabledHint: readOnly ? t("common.readOnlyConnection") : undefined,
              onClick: () => void openDeleteConfirm(),
            },
          ]}
        />
        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZES}
          loading={loading}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(0);
          }}
        />
      </div>
      {insertMode !== null && (
        <InsertRowsDialog
          table={selectedTable}
          columns={columns}
          columnMeta={columnMeta}
          seedRows={insertMode === "clone" ? selectedRowsInOrder() : undefined}
          onCancel={() => {
            setInsertMode(null);
            focusGrid();
          }}
          onSubmit={submitInsert}
        />
      )}
      {confirmingDelete && (
        <ConfirmDialog
          title={t("sqlTable.deleteRowsTitle")}
          message={t("sqlTable.deleteRowsMessage", { n: selectedRows.size })}
          confirmLabel={t("common.delete")}
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            setConfirmingDelete(false);
            focusGrid();
          }}
        >
          {(canDeleteWholeTable || canResetAutoIncrement) && (
            <div className={styles.deleteOptions}>
              {canDeleteWholeTable && (
                <label className={styles.deleteOption}>
                  <input
                    type="checkbox"
                    checked={deleteWholeTable}
                    onChange={(e) => {
                      setDeleteWholeTable(e.target.checked);
                      // The reset only exists because of this option on a multi-page table;
                      // taking it back takes its follow-up with it.
                      if (!e.target.checked) setResetAutoIncrement(false);
                    }}
                  />
                  {t("sqlTable.deleteAllRowsOption", { total })}
                </label>
              )}
              {canResetAutoIncrement && (
                <label className={styles.deleteOption}>
                  <input
                    type="checkbox"
                    checked={resetAutoIncrement}
                    onChange={(e) => setResetAutoIncrement(e.target.checked)}
                  />
                  {t("sqlTable.resetAutoIncrementOption", { column: autoIncrementColumn ?? "" })}
                </label>
              )}
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

export default SqlTable;
