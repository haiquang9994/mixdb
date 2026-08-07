import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { mysqlListDatabases, mysqlListTables, mysqlTableData, mysqlUpdateRow } from "./api";
import Select from "../components/Select";

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

interface Props {
  connectionId: string;
  initialDatabase?: string;
  status: string;
  error: string;
  onDisconnect: () => void;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
}

type ContentMode = "data";

const PAGE_SIZES = [100, 200, 500, 1000];
const DEFAULT_SIDEBAR_WIDTH = 200;
const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 480;

function MysqlWorkspace({ connectionId, initialDatabase, error, sidebarWidth, onSidebarWidthChange }: Props) {
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState(initialDatabase ?? "");
  const [tables, setTables] = useState<string[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tableFilter, setTableFilter] = useState("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [contentMode, setContentMode] = useState<ContentMode>("data");
  const [localError, setLocalError] = useState("");

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

  const [width, setWidth] = useState(sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
  const resizing = useRef(false);

  useEffect(() => {
    setWidth(sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
  }, [sidebarWidth]);

  // Re-measure each column's rendered width whenever the data or layout that
  // could affect it changes, so the edit input/textarea can be pinned to it
  // (auto table-layout would otherwise resize the column around the input's
  // own intrinsic size, causing a visible jump when entering edit mode).
  useLayoutEffect(() => {
    measureColumnWidths();
  }, [columns, rows, width]);

  useEffect(() => {
    function onResize() {
      measureColumnWidths();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [columns]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizing.current = true;
      const startX = e.clientX;
      const startWidth = width;

      function onMouseMove(ev: MouseEvent) {
        const next = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, startWidth + (ev.clientX - startX)),
        );
        setWidth(next);
      }

      function onMouseUp(ev: MouseEvent) {
        resizing.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        const finalWidth = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, startWidth + (ev.clientX - startX)),
        );
        onSidebarWidthChange?.(finalWidth);
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [width, onSidebarWidthChange],
  );

  const handleResizeDoubleClick = useCallback(() => {
    if (tables.length === 0) {
      setWidth(DEFAULT_SIDEBAR_WIDTH);
      onSidebarWidthChange?.(DEFAULT_SIDEBAR_WIDTH);
      return;
    }
    const longest = tables.reduce((a, b) => (b.length > a.length ? b : a), "");
    const probe = document.createElement("button");
    probe.className = "mysql-table-item";
    probe.style.position = "fixed";
    probe.style.top = "-9999px";
    probe.style.left = "-9999px";
    probe.style.width = "auto";
    probe.style.whiteSpace = "nowrap";
    probe.textContent = longest;
    document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    let textWidth = probe.scrollWidth;
    if (ctx) {
      ctx.font = style.font;
      textWidth = ctx.measureText(longest).width;
    }
    const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    document.body.removeChild(probe);
    const sidebarPadding = 4; // .mysql-sidebar's own right padding, plus a little breathing room
    const target = Math.ceil(textWidth + horizontalPadding + sidebarPadding);
    const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(DEFAULT_SIDEBAR_WIDTH, target));
    setWidth(next);
    onSidebarWidthChange?.(next);
  }, [tables, onSidebarWidthChange]);

  useEffect(() => {
    let cancelled = false;
    mysqlListDatabases(connectionId)
      .then((dbs) => {
        if (cancelled) return;
        setDatabases(dbs);
        setSelectedDb((prev) => (prev && dbs.includes(prev) ? prev : dbs[0] ?? ""));
      })
      .catch((e) => setLocalError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  useEffect(() => {
    setTableFilter("");
    if (!selectedDb) {
      setTables([]);
      setSelectedTable(null);
      return;
    }
    let cancelled = false;
    setSelectedTable(null);
    mysqlListTables(connectionId, selectedDb)
      .then((t) => {
        if (!cancelled) setTables(t);
      })
      .catch((e) => setLocalError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedDb]);

  useEffect(() => {
    setEditingCell(null);
    pendingRowRef.current = null;
    if (!selectedDb || !selectedTable) {
      setRows([]);
      setColumns([]);
      setColumnTypes({});
      setPrimaryKey([]);
      setTotal(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    mysqlTableData(connectionId, selectedDb, selectedTable, page, pageSize)
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setColumns(result.columns);
        setColumnTypes(result.columnTypes);
        setPrimaryKey(result.primaryKey);
        setTotal(result.total);
      })
      .catch((e) => setLocalError(String(e)))
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

  function selectTable(table: string) {
    setSelectedTable(table);
    setPage(0);
  }

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
    if (!row || !selectedDb || !selectedTable) return;
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
      setLocalError(String(e));
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

  const reloadTables = useCallback(() => {
    if (!selectedDb) return;
    setTablesLoading(true);
    mysqlListTables(connectionId, selectedDb)
      .then((t) => setTables(t))
      .catch((e) => setLocalError(String(e)))
      .finally(() => setTablesLoading(false));
  }, [connectionId, selectedDb]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const filteredTables = tableFilter.trim()
    ? tables.filter((t) => t.toLowerCase().includes(tableFilter.trim().toLowerCase()))
    : tables;

  return (
    <div className="mysql-workspace">
      <div className="mysql-header">
        <div className="mysql-header-left"></div>
        <label className="mysql-db-select">
          Database{" "}
          <Select
            value={selectedDb}
            onChange={(db) => {
              setSelectedDb(db);
              setPage(0);
            }}
            placeholder="(none)"
            options={databases.map((db) => ({ value: db, label: db }))}
          />
        </label>
        <div className="method-tabs mysql-content-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={contentMode === "data"}
            className={`method-tab${contentMode === "data" ? " method-tab-active" : ""}`}
            onClick={() => setContentMode("data")}
          >
            Data
          </button>
        </div>
      </div>

      {(error || localError) && (
        <p className="error">
          {error || localError}
          <button
            type="button"
            className="error-dismiss"
            aria-label="Dismiss error"
            onClick={() => setLocalError("")}
          >
            ×
          </button>
        </p>
      )}

      <div className="mysql-body">
        <aside className="mysql-sidebar" style={{ flexBasis: width }}>
          <input
            type="text"
            className="mysql-sidebar-search"
            placeholder="Search tables..."
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
          />
          <div className="mysql-sidebar-list">
            <ul>
              {filteredTables.map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    className={`mysql-table-item${t === selectedTable ? " mysql-table-item-active" : ""}`}
                    onClick={() => selectTable(t)}
                  >
                    {t}
                  </button>
                </li>
              ))}
              {tables.length === 0 && <li className="muted mysql-sidebar-empty">No tables</li>}
              {tables.length > 0 && filteredTables.length === 0 && (
                <li className="muted mysql-sidebar-empty">No matching tables</li>
              )}
            </ul>
          </div>
          <div className="mysql-sidebar-actions">
            <button
              type="button"
              className="mysql-sidebar-action"
              aria-label="Reload tables"
              title="Reload tables"
              disabled={!selectedDb || tablesLoading}
              onClick={reloadTables}
            >
              <svg
                className={`mysql-sidebar-action-icon${tablesLoading ? " mysql-sidebar-action-icon-spinning" : ""}`}
                width="14"
                height="14"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path
                  d="M13.5 8a5.5 5.5 0 1 1-1.6-3.89M13.5 2v3.2h-3.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </aside>

        <div
          className="mysql-sidebar-resizer"
          onMouseDown={handleResizeStart}
          onDoubleClick={handleResizeDoubleClick}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize, double-click to fit"
        />

        <section className="mysql-content">
          {contentMode === "data" && !selectedTable && (
            <p className="muted">Select a table to view its data.</p>
          )}
          {contentMode === "data" && selectedTable && (
            <div className="mysql-table-view">
              <div className="mysql-table-scroll" ref={scrollRef}>
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
                                className="mysql-cell-editing"
                                style={cellWidth ? { width: cellWidth } : undefined}
                              >
                                {multiline ? (
                                  <textarea
                                    ref={editInputRef as React.RefObject<HTMLTextAreaElement>}
                                    value={editValue}
                                    onChange={handleEditChange}
                                    onKeyDown={handleEditKeyDown}
                                    onBlur={() => handleInputBlur(i, c)}
                                    className="mysql-cell-textarea"
                                    rows={1}
                                  />
                                ) : (
                                  <input
                                    ref={editInputRef as React.RefObject<HTMLInputElement>}
                                    type="text"
                                    value={editValue}
                                    onChange={handleEditChange}
                                    onKeyDown={handleEditKeyDown}
                                    onBlur={() => handleInputBlur(i, c)}
                                    className="mysql-cell-input"
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
                          const cellClassName = [isNull && "mysql-cell-null", isDirty && "mysql-cell-dirty"]
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
              <div className="mysql-pagination">
                <button
                  type="button"
                  className="mysql-page-btn"
                  aria-label="Previous page"
                  disabled={page <= 0 || loading}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  ‹
                </button>
                <span>
                  Page {page + 1} of {pageCount} · {total} rows
                </span>
                <button
                  type="button"
                  className="mysql-page-btn"
                  aria-label="Next page"
                  disabled={page + 1 >= pageCount || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  ›
                </button>
                <Select
                  value={pageSize}
                  onChange={(n) => {
                    setPageSize(n);
                    setPage(0);
                  }}
                  className="mysql-page-size-select"
                  optionAlign="right"
                  options={PAGE_SIZES.map((n) => ({ value: n, label: `${n} / page`, optionLabel: n }))}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default MysqlWorkspace;
