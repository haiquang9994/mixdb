import { useEffect, useRef, useState } from "react";
import { mysqlListDatabases, mysqlListTables, mysqlTableData } from "./api";

interface Props {
  connectionId: string;
  initialDatabase?: string;
  status: string;
  error: string;
  onDisconnect: () => void;
}

type ContentMode = "data";

const PAGE_SIZES = [25, 50, 100, 200];

function MysqlWorkspace({ connectionId, initialDatabase, status, error, onDisconnect }: Props) {
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState(initialDatabase ?? "");
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [contentMode, setContentMode] = useState<ContentMode>("data");
  const [localError, setLocalError] = useState("");

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
        <div className="mysql-header-left">
          <button type="button" onClick={onDisconnect}>
            Disconnect
          </button>
          <span className="muted">{status}</span>
        </div>
        <label className="mysql-db-select">
          Database{" "}
          <select
            value={selectedDb}
            onChange={(e) => {
              setSelectedDb(e.target.value);
              setPage(0);
            }}
          >
            {databases.length === 0 && <option value="">(none)</option>}
            {databases.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </select>
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
        <aside className="mysql-sidebar">
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
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(0);
                  }}
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n} / page
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default MysqlWorkspace;
