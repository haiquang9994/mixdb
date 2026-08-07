import { useCallback, useEffect, useRef, useState } from "react";
import { mysqlListDatabases, mysqlListTables, mysqlTableData } from "./api";
import Select from "../components/Select";

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
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [contentMode, setContentMode] = useState<ContentMode>("data");
  const [localError, setLocalError] = useState("");

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [width, setWidth] = useState(sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
  const resizing = useRef(false);

  useEffect(() => {
    setWidth(sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
  }, [sidebarWidth]);

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
    if (!selectedDb || !selectedTable) {
      setRows([]);
      setColumns([]);
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

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

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

      {(error || localError) && <p className="error">{error || localError}</p>}

      <div className="mysql-body">
        <aside className="mysql-sidebar" style={{ flexBasis: width }}>
          <ul>
            {tables.map((t) => (
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
          </ul>
        </aside>

        <div
          className="mysql-sidebar-resizer"
          onMouseDown={handleResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
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
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i}>
                        {columns.map((c) => {
                          const raw = row[c];
                          const isNull = raw === null || raw === undefined;
                          const value = isNull
                            ? "NULL"
                            : typeof raw === "object"
                              ? JSON.stringify(raw)
                              : String(raw);
                          return (
                            <td key={c} title={value} className={isNull ? "mysql-cell-null" : undefined}>
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
