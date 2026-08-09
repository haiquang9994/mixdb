import { useCallback, useEffect, useRef, useState } from "react";
import {
  mysqlCollations,
  mysqlCreateDatabase,
  mysqlCreateTable,
  mysqlDropTable,
  mysqlListDatabases,
  mysqlListTables,
  mysqlRenameTable,
  mysqlServerInfo,
} from "./api";
import Select from "../components/Select";
import ConfirmDialog from "../components/ConfirmDialog";
import DatabaseActions from "../components/DatabaseActions";
import type { DatabaseChange } from "../components/DatabaseActions";
import DatabaseDialog from "../components/DatabaseDialog";
import DatabaseStats from "../components/DatabaseStats";
import LoadingOverlay from "../components/LoadingOverlay";
import ErrorBanner from "../components/ErrorBanner";
import Input from "../components/Input";
import NameDialog from "../components/NameDialog";
import SqlTable from "../components/SqlTable";
import QueryEditor from "../components/QueryEditor";
import TableDialog from "../components/TableDialog";
import TableStructure from "../components/TableStructure";
import ActionBar from "../components/ActionBar";
import ItemList from "../components/ItemList";
import type { ItemAction } from "../components/ItemList";
import itemListStyles from "../components/ItemList/ItemList.module.css";
import { PlusIcon, ReloadIcon } from "../icons";
import { useTranslation } from "../i18n";
import type { MysqlCollation } from "../types";

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
 * table's columns and indexes, what every table in the database weighs, or a SQL editor over the
 * connection as a whole. */
type ContentMode = "data" | "structure" | "stats" | "query";

/** The tabs in the order they are shown, each with the key that names it. */
const CONTENT_TABS: {
  mode: ContentMode;
  labelKey: "mysql.dataTab" | "mysql.structureTab" | "mysql.statsTab" | "mysql.queryTab";
}[] = [
  { mode: "data", labelKey: "mysql.dataTab" },
  { mode: "structure", labelKey: "mysql.structureTab" },
  { mode: "stats", labelKey: "mysql.statsTab" },
  { mode: "query", labelKey: "mysql.queryTab" },
];

/** The database picker's first entry, which opens the create dialog instead of selecting anything.
 * MySQL allows no `/` in a database name, so this can never collide with a real one. */
const NEW_DATABASE = "/new";

/** The picker's last entry, which re-reads the list instead of selecting anything. A database
 * created or dropped elsewhere is otherwise only picked up by reconnecting. */
const RELOAD_DATABASES = "/reload";

const DEFAULT_SIDEBAR_WIDTH = 200;
const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 480;

function MysqlWorkspace({ connectionId, initialDatabase, error, sidebarWidth, onSidebarWidthChange }: Props) {
  const { t } = useTranslation();
  const [databases, setDatabases] = useState<string[]>([]);
  const [databasesLoading, setDatabasesLoading] = useState(false);
  const [selectedDb, setSelectedDb] = useState(initialDatabase ?? "");
  const [tables, setTables] = useState<string[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tableFilter, setTableFilter] = useState("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [contentMode, setContentMode] = useState<ContentMode>("data");
  const [localError, setLocalError] = useState("");
  const [serverInfo, setServerInfo] = useState<{ version: string; os: string } | null>(null);
  const [collations, setCollations] = useState<MysqlCollation[]>([]);
  const [creatingDatabase, setCreatingDatabase] = useState(false);
  const [creatingTable, setCreatingTable] = useState(false);
  /** The table the context menu's rename is open on, and the one its drop is asking about. */
  const [renamingTable, setRenamingTable] = useState<string | null>(null);
  const [droppingTable, setDroppingTable] = useState<string | null>(null);
  /** What the dump/restore tools are doing, if anything — shown over the whole workspace. */
  const [transferStatus, setTransferStatus] = useState("");

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

  /** Reads the database list, keeping the selection when the server still lists it — a database
   * dropped from under us leaves nothing to stay on. Also what the picker's reload entry calls. */
  const loadDatabases = useCallback(async () => {
    setDatabasesLoading(true);
    try {
      const dbs = await mysqlListDatabases(connectionId);
      setDatabases(dbs);
      setSelectedDb((prev) => (prev && dbs.includes(prev) ? prev : ""));
    } catch (e) {
      setLocalError(String(e));
    } finally {
      setDatabasesLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void loadDatabases();
  }, [loadDatabases]);

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

  // A property of the server rather than of any one database, so one read per connection covers
  // every table created on it.
  useEffect(() => {
    let cancelled = false;
    mysqlCollations(connectionId)
      .then((result) => {
        if (!cancelled) setCollations(result);
      })
      // Not worth an error banner over: without a list the dialog falls back to a text box.
      .catch(() => {
        if (!cancelled) setCollations([]);
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

  /** What a restore or a drop of the whole database leaves to be caught up with: a restore has
   * replaced the tables under the list, and a drop has taken the database itself away. */
  async function databaseChanged(change: DatabaseChange) {
    if (change === "restored") {
      reloadTables();
      return;
    }
    setSelectedDb("");
    setSelectedTable(null);
    setTables([]);
    await loadDatabases();
  }

  /** Creates the database and switches to it, empty. Errors reject back into the dialog, which is
   * what shows them and stays open. */
  async function createDatabase(name: string, collation: string | null) {
    await mysqlCreateDatabase(connectionId, name, collation);
    setCreatingDatabase(false);
    setSelectedDb(name);
    setSelectedTable(null);
    // Re-listed rather than appended, so the picker keeps the order the server lists them in.
    await loadDatabases();
  }

  /** Creates the table and leaves it selected, so the columns it still needs are one tab away.
   * Errors reject back into the dialog, which is what shows them and stays open. */
  async function createTable(name: string, collation: string | null) {
    await mysqlCreateTable(connectionId, selectedDb, name, collation);
    setCreatingTable(false);
    // Cleared so the new table is visible whatever was being searched for when it was made.
    setTableFilter("");
    setSelectedTable(name);
    reloadTables();
  }

  /** Renames the table and follows it: whatever was open on it stays open, under the new name.
   * Errors reject back into the dialog, which is what shows them and stays open. */
  async function renameTable(table: string, newName: string) {
    await mysqlRenameTable(connectionId, selectedDb, table, newName);
    setRenamingTable(null);
    setTableFilter("");
    if (selectedTable === table) setSelectedTable(newName);
    reloadTables();
  }

  /** Drops the table the confirmation was asking about. Nothing is left open on it afterwards. */
  async function dropTable(table: string) {
    setDroppingTable(null);
    try {
      await mysqlDropTable(connectionId, selectedDb, table);
      if (selectedTable === table) setSelectedTable(null);
      reloadTables();
    } catch (e) {
      setLocalError(String(e));
    }
  }

  const tableActions: ItemAction[] = [
    { key: "rename", label: t("mysql.renameTable"), onSelect: setRenamingTable },
    { key: "drop", label: t("mysql.dropTable"), danger: true, onSelect: setDroppingTable },
  ];

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
              if (db === NEW_DATABASE) {
                setCreatingDatabase(true);
                return;
              }
              if (db === RELOAD_DATABASES) {
                void loadDatabases();
                return;
              }
              setSelectedDb(db);
              setSelectedTable(null);
            }}
            placeholder={t("mysql.databasePlaceholder")}
            size="normal"
            searchable
            searchPlaceholder={t("mysql.searchDatabasesPlaceholder")}
            options={[
              {
                value: NEW_DATABASE,
                label: t("mysql.createDatabase"),
                optionLabel: <span className="select-new-option">+ {t("mysql.createDatabase")}</span>,
              },
              ...databases.map((db) => ({ value: db, label: db })),
              {
                value: RELOAD_DATABASES,
                label: t("mysql.reloadDatabases"),
                // The menu stays open behind it: the reloaded list is the whole point of the
                // click, and closing would hide it until the picker is opened again.
                keepOpen: true,
                disabled: databasesLoading,
                optionLabel: (
                  <span className="select-reload-option">
                    <ReloadIcon
                      size="1em"
                      className={databasesLoading ? "select-reload-option-spinning" : undefined}
                    />
                    {t("mysql.reloadDatabases")}
                  </span>
                ),
              },
            ]}
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
            actions={tableActions}
          />
          <div className="mysql-sidebar-actions">
            <ActionBar
              actions={[
                {
                  key: "reload",
                  icon: ReloadIcon,
                  label: t("mysql.reloadTables"),
                  disabled: !selectedDb || tablesLoading,
                  busy: tablesLoading,
                  onClick: reloadTables,
                },
                {
                  key: "add",
                  icon: PlusIcon,
                  label: t("mysql.addTable"),
                  disabled: !selectedDb || tablesLoading,
                  onClick: () => setCreatingTable(true),
                },
              ]}
            />
            {/* The database as a whole, kept at the far end: these act on everything the list
                above is showing rather than on anything in it. */}
            <DatabaseActions
              kind="mysql"
              connectionId={connectionId}
              database={selectedDb}
              disabled={tablesLoading}
              onError={setLocalError}
              onChanged={databaseChanged}
              onBusyChange={setTransferStatus}
            />
          </div>
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
          {contentMode === "stats" && !selectedDb && (
            <p className="muted">{t("mysql.selectDatabaseStatsPrompt")}</p>
          )}
          {/* Kept mounted while the other tabs are up, for the same reason the editor below is:
              the figures it has read stay read, so coming back to the tab costs nothing. */}
          {selectedDb && (
            <div className={contentMode === "stats" ? "mysql-panel" : "mysql-panel-hidden"}>
              <DatabaseStats
                kind="mysql"
                connectionId={connectionId}
                database={selectedDb}
                active={contentMode === "stats"}
                onError={setLocalError}
              />
            </div>
          )}
          {/* Kept mounted while the other tabs are up, and hidden rather than unmounted: a script
              being written and the results it has produced so far must survive a look at the data
              or the structure it is being written against. */}
          <div className={contentMode === "query" ? "mysql-panel" : "mysql-panel-hidden"}>
            <QueryEditor connectionId={connectionId} database={selectedDb} />
          </div>
        </section>
      </div>

      {transferStatus !== "" && <LoadingOverlay label={transferStatus} />}

      {creatingDatabase && (
        <DatabaseDialog
          collations={collations}
          onCancel={() => setCreatingDatabase(false)}
          onSubmit={createDatabase}
        />
      )}

      {creatingTable && selectedDb && (
        <TableDialog
          database={selectedDb}
          collations={collations}
          onCancel={() => setCreatingTable(false)}
          onSubmit={createTable}
        />
      )}

      {renamingTable !== null && (
        <NameDialog
          title={t("mysql.renameTableTitle", { table: renamingTable })}
          ariaLabel={renamingTable}
          label={t("renameDialog.name")}
          initialName={renamingTable}
          emptyError={t("renameDialog.errorName")}
          submitLabel={t("renameDialog.submit")}
          savingLabel={t("renameDialog.saving")}
          onCancel={() => setRenamingTable(null)}
          onSubmit={(newName) => renameTable(renamingTable, newName)}
        />
      )}

      {droppingTable !== null && (
        <ConfirmDialog
          title={t("mysql.dropTableTitle")}
          message={t("mysql.dropTableMessage", { table: droppingTable })}
          confirmLabel={t("common.delete")}
          danger
          onConfirm={() => void dropTable(droppingTable)}
          onCancel={() => setDroppingTable(null)}
        />
      )}
    </div>
  );
}

export default MysqlWorkspace;
