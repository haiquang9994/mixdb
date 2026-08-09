import { useCallback, useEffect, useRef, useState } from "react";
import { mysqlListDatabases, mysqlListTables, mysqlServerInfo } from "./api";
import Select from "../components/Select";
import ErrorBanner from "../components/ErrorBanner";
import Input from "../components/Input";
import SqlTable from "../components/SqlTable";
import QueryEditor from "../components/QueryEditor";
import TableStructure from "../components/TableStructure";
import ActionBar from "../components/ActionBar";
import ItemList from "../components/ItemList";
import itemListStyles from "../components/ItemList/ItemList.module.css";
import { ReloadIcon } from "../icons";
import { useTranslation } from "../i18n";

interface Props {
  connectionId: string;
  initialDatabase?: string;
  status: string;
  error: string;
  onDisconnect: () => void;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
}

/** Which of the header's tabs the content area is showing: the selected table's rows, the same
 * table's columns and indexes, or a SQL editor over the connection as a whole. */
type ContentMode = "data" | "structure" | "query";

/** The tabs in the order they are shown, each with the key that names it. */
const CONTENT_TABS: { mode: ContentMode; labelKey: "mysql.dataTab" | "mysql.structureTab" | "mysql.queryTab" }[] = [
  { mode: "data", labelKey: "mysql.dataTab" },
  { mode: "structure", labelKey: "mysql.structureTab" },
  { mode: "query", labelKey: "mysql.queryTab" },
];

const DEFAULT_SIDEBAR_WIDTH = 200;
const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 480;

function MysqlWorkspace({ connectionId, initialDatabase, error, sidebarWidth, onSidebarWidthChange }: Props) {
  const { t } = useTranslation();
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
    probe.className = itemListStyles.item;
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

  const tablesEmptyMessage =
    tables.length === 0 ? t("mysql.noTables") : filteredTables.length === 0 ? t("mysql.noMatchingTables") : undefined;

  return (
    <div className="mysql-workspace">
      <div className="mysql-header">
        <div className="mysql-header-left">
          {serverInfo && (
            <span className="mysql-server-info">
              {t("mysql.serverInfo", { os: serverInfo.os, version: serverInfo.version })}
            </span>
          )}
        </div>
        <label className="mysql-db-select">
          {t("mysql.databaseLabel")}{" "}
          <Select
            value={selectedDb}
            onChange={(db) => {
              setSelectedDb(db);
              setSelectedTable(null);
            }}
            placeholder={t("mysql.databasePlaceholder")}
            size="normal"
            searchable
            searchPlaceholder={t("mysql.searchDatabasesPlaceholder")}
            options={databases.map((db) => ({ value: db, label: db }))}
          />
        </label>
        <div className="method-tabs mysql-content-tabs" role="tablist">
          {CONTENT_TABS.map(({ mode, labelKey }) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={contentMode === mode}
              className={`method-tab${contentMode === mode ? " method-tab-active" : ""}`}
              onClick={() => setContentMode(mode)}
            >
              {t(labelKey)}
            </button>
          ))}
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
            placeholder={t("mysql.searchTablesPlaceholder")}
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
          />
          <ItemList
            items={filteredTables}
            selectedItem={selectedTable}
            onSelect={selectTable}
            emptyMessage={tablesEmptyMessage}
          />
          <ActionBar
            className="mysql-sidebar-actions"
            actions={[
              {
                key: "reload",
                icon: ReloadIcon,
                label: t("mysql.reloadTables"),
                disabled: !selectedDb || tablesLoading,
                busy: tablesLoading,
                onClick: reloadTables,
              },
            ]}
          />
        </aside>

        <div
          className="mysql-sidebar-resizer"
          onMouseDown={handleResizeStart}
          onDoubleClick={handleResizeDoubleClick}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("mysql.resizeSidebar")}
          title={t("mysql.resizeSidebarTooltip")}
        />

        <section className="mysql-content">
          {contentMode === "data" && !selectedTable && (
            <p className="muted">{t("mysql.selectTablePrompt")}</p>
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
          {contentMode === "structure" && !selectedTable && (
            <p className="muted">{t("mysql.selectTableStructurePrompt")}</p>
          )}
          {contentMode === "structure" && selectedDb && selectedTable && (
            <TableStructure
              connectionId={connectionId}
              selectedDb={selectedDb}
              selectedTable={selectedTable}
              onError={setLocalError}
            />
          )}
          {/* Kept mounted while the other tabs are up, and hidden rather than unmounted: a script
              being written and the results it has produced so far must survive a look at the data
              or the structure it is being written against. */}
          <div className={contentMode === "query" ? "mysql-panel" : "mysql-panel-hidden"}>
            <QueryEditor connectionId={connectionId} database={selectedDb} />
          </div>
        </section>
      </div>
    </div>
  );
}

export default MysqlWorkspace;
