import { useCallback, useEffect, useRef, useState } from "react";
import { mysqlListDatabases, mysqlListTables, mysqlServerInfo } from "./api";
import Select from "../components/Select";
import ErrorBanner from "../components/ErrorBanner";
import Input from "../components/Input";
import SqlTable from "../components/SqlTable";

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
  const [serverInfo, setServerInfo] = useState<{ version: string; os: string } | null>(null);

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
        setSelectedDb((prev) => (prev && dbs.includes(prev) ? prev : ""));
      })
      .catch((e) => setLocalError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  useEffect(() => {
    let cancelled = false;
    setServerInfo(null);
    mysqlServerInfo(connectionId)
      .then((info) => {
        if (!cancelled) setServerInfo(info);
      })
      .catch(() => {
        // Non-critical display info — silently omit it on failure.
      });
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

  function selectTable(table: string) {
    setSelectedTable(table);
  }

  const reloadTables = useCallback(() => {
    if (!selectedDb) return;
    setTablesLoading(true);
    mysqlListTables(connectionId, selectedDb)
      .then((t) => setTables(t))
      .catch((e) => setLocalError(String(e)))
      .finally(() => setTablesLoading(false));
  }, [connectionId, selectedDb]);

  const filteredTables = tableFilter.trim()
    ? tables.filter((t) => t.toLowerCase().includes(tableFilter.trim().toLowerCase()))
    : tables;

  return (
    <div className="mysql-workspace">
      <div className="mysql-header">
        <div className="mysql-header-left">
          {serverInfo && (
            <span className="mysql-server-info">
              {serverInfo.os} · MySQL {serverInfo.version}
            </span>
          )}
        </div>
        <label className="mysql-db-select">
          Database{" "}
          <Select
            value={selectedDb}
            onChange={(db) => {
              setSelectedDb(db);
              setSelectedTable(null);
            }}
            placeholder="(none)"
            size="normal"
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
        <ErrorBanner message={error || localError} onDismiss={() => setLocalError("")} />
      )}

      <div className="mysql-body">
        <aside className="mysql-sidebar" style={{ flexBasis: width }}>
          <Input
            size="normal"
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
          {contentMode === "data" && selectedDb && selectedTable && (
            <SqlTable
              connectionId={connectionId}
              selectedDb={selectedDb}
              selectedTable={selectedTable}
              onError={setLocalError}
              layoutWidth={width}
            />
          )}
        </section>
      </div>
    </div>
  );
}

export default MysqlWorkspace;
