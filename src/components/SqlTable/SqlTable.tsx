import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { mysqlTableData, mysqlUpdateRow } from "../../mysql/api";
import Pagination from "../Pagination";
import styles from "./SqlTable.module.css";

interface EditingCell {
  rowIndex: number;
  col: string;
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

interface TableColumnsInfo {
  columns: string[];
  columnTypes: Record<string, string>;
  primaryKey: string[];
}

interface Props {
  connectionId: string;
  selectedDb: string;
  selectedTable: string;
  onError: (message: string) => void;
  layoutWidth?: number;
}

const PAGE_SIZES = [100, 200, 500, 1000];

function SqlTable({ connectionId, selectedDb, selectedTable, onError, layoutWidth }: Props) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  const [primaryKey, setPrimaryKey] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
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
    setPage(0);
    const cached = columnsCacheRef.current.get(tableCacheKey(selectedDb, selectedTable));
    if (cached) {
      setColumns(cached.columns);
      setColumnTypes(cached.columnTypes);
      setPrimaryKey(cached.primaryKey);
    } else {
      setColumns([]);
      setColumnTypes({});
      setPrimaryKey([]);
    }
  }, [selectedDb, selectedTable]);

  useEffect(() => {
    const db = selectedDb;
    const table = selectedTable;
    let cancelled = false;
    setLoading(true);
    mysqlTableData(connectionId, db, table, page, pageSize)
      .then((result) => {
        if (cancelled) return;
        columnsCacheRef.current.set(tableCacheKey(db, table), {
          columns: result.columns,
          columnTypes: result.columnTypes,
          primaryKey: result.primaryKey,
        });
        setRows(result.rows);
        setColumns(result.columns);
        setColumnTypes(result.columnTypes);
        setPrimaryKey(result.primaryKey);
        setTotal(result.total);
      })
      .catch((e) => onError(String(e)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedDb, selectedTable, page, pageSize]);

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
      onError(String(e));
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

  async function moveEditTo(rowIndex: number, col: string) {
    const leavingRow = editingCellRef.current?.rowIndex;
    commitEditingCell();
    if (leavingRow !== undefined && leavingRow !== rowIndex) {
      await flushPendingRow();
    }
    setEditingCell({ rowIndex, col });
    setEditValue(displayValue(rows[rowIndex]?.[col]));
  }

  function handleCellMouseDown(e: React.MouseEvent<HTMLTableCellElement>, rowIndex: number, col: string) {
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

  if (columns.length === 0) {
    return <p className="muted">Loading...</p>;
  }

  return (
    <div className={styles.sqlTable}>
      <div className={styles.scroll} ref={scrollRef}>
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  ref={(el) => {
                    if (el) thRefs.current.set(c, el);
                    else thRefs.current.delete(c);
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => {
                  const isEditing = editingCell?.rowIndex === i && editingCell.col === c;
                  if (isEditing) {
                    const multiline = isMultilineType(columnTypes[c]);
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
        {loading && <p className="muted">Loading...</p>}
        {!loading && rows.length === 0 && <p className="muted">No rows.</p>}
      </div>
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
  );
}

export default SqlTable;
