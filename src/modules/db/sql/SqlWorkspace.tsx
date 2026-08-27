import { useCallback, useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useSqlApi, useSqlDialect } from "./context";
import { onTransferProgress, type TransferProgress } from "../transfer";
import { filterRowFor } from "../filters";
import type { FilterOperator } from "./filters";
import { invalidateSchemaOutline } from "./schemaCache";
import Select from "../../../components/Select";
import ConfirmDialog from "../../../components/ConfirmDialog";
import DatabaseActions from "../components/DatabaseActions";
import type { DatabaseChange } from "../components/DatabaseActions";
import DatabaseDialog from "../components/DatabaseDialog";
import DatabaseStats from "../components/DatabaseStats";
import type { StatsCache } from "../components/DatabaseStats";
import TransferOverlay from "../components/TransferOverlay";
import ErrorBanner from "../../../components/ErrorBanner";
import DisconnectTab from "../components/DisconnectTab";
import TunnelBanner from "../components/TunnelBanner";
import { useWorkspaceError } from "../workspaceError";
import Input from "../../../components/Input";
import NameDialog from "../../../components/NameDialog";
import SqlTable from "../components/SqlTable";
import type { FilterCache, TableCache } from "../components/SqlTable";
import QueryEditor from "../components/QueryEditor";
import TableDialog from "../components/TableDialog";
import TableStructure from "../components/TableStructure";
import type { StructureCache } from "../components/TableStructure";
import ActionBar from "../../../components/ActionBar";
import ItemList from "../../../components/ItemList";
import type { ItemAction } from "../../../components/ItemList";
import itemListStyles from "../../../components/ItemList/ItemList.module.css";
import { PlusIcon, ReloadIcon } from "../../../icons";
import { useSidebarKeyboard } from "../../../core/sidebarKeyboard";
import { useTranslation } from "../../../i18n";
import { errorMessage } from "../../../core/errors";
import type { SqlCollation } from "../types";

interface Props {
  /** Whether this connection's tab is the one on show. Passed straight through to the content
   *  panes, which take `Ctrl+R` for their own reload only while the user is looking at them. */
  active: boolean;
  connectionId: string;
  initialDatabase?: string;
  status: string;
  error: string;
  /**
   * Connection này đi qua SSH tunnel.
   *
   * Chỉ để biết ai kể chuyện mất kết nối: có tunnel thì TunnelBanner kể, và ErrorBanner im — xem
   * {@link useWorkspaceError}.
   */
  tunnelled: boolean;
  onDisconnect: () => void;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
  /**
   * The saved connection is marked as one nothing is written to.
   *
   * Everything that would change the server is turned off, not merely the Query tab: the tables in
   * the sidebar cannot be created, renamed or dropped, the database tools are closed, rows in the
   * Data tab do not open for editing, and the Structure tab sends no `ALTER`. A flag that guarded
   * only one of the four would be worse than none — it reads as a promise about the connection.
   *
   * What still works is everything that reads. That is the point of the flag.
   */
  readOnly?: boolean;
  /** The saved connection's own id, as opposed to the session's. What the Query tab files its
   *  draft and its history under, so both survive the app closing. */
  profileId?: string;
}

/** Which of the header's tabs the content area is showing: the selected table's rows, the same
 * table's columns and indexes, what every table in the database weighs, or a SQL editor over the
 * connection as a whole. */
type ContentMode = "data" | "structure" | "stats" | "query";

/** The tabs in the order they are shown, each with the key that names it. */
const CONTENT_TABS: {
  mode: ContentMode;
  labelKey: "sql.dataTab" | "sql.structureTab" | "sql.statsTab" | "sql.queryTab";
}[] = [
  { mode: "data", labelKey: "sql.dataTab" },
  { mode: "structure", labelKey: "sql.structureTab" },
  { mode: "stats", labelKey: "sql.statsTab" },
  { mode: "query", labelKey: "sql.queryTab" },
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

function SqlWorkspace({
  active,
  connectionId,
  initialDatabase,
  error,
  tunnelled,
  onDisconnect,
  sidebarWidth,
  onSidebarWidthChange,
  readOnly = false,
  profileId = "",
}: Props) {
  const { t } = useTranslation();
  const api = useSqlApi();
  const dialect = useSqlDialect();
  const [databases, setDatabases] = useState<string[]>([]);
  const [databasesLoading, setDatabasesLoading] = useState(false);
  const [selectedDb, setSelectedDb] = useState(initialDatabase ?? "");
  const [tables, setTables] = useState<string[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tableFilter, setTableFilter] = useState("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  /**
   * A table held above the sidebar's list, put there by following a foreign key out of the grid.
   *
   * The list itself is left exactly as it was — the search box especially, which is very often what
   * the user was in the middle of when a key took them somewhere else, and clearing it would lose
   * the search they will want back. The table they were sent to is instead shown on its own row at
   * the top, in reach whatever the list underneath is filtered down to, until they pick another
   * table — which is the moment they no longer need a way back to this one.
   */
  const [pinnedTable, setPinnedTable] = useState<string | null>(null);
  const [contentMode, setContentMode] = useState<ContentMode>("data");
  const [localError, setLocalError] = useWorkspaceError(tunnelled);
  const [serverInfo, setServerInfo] = useState<{ version: string; os: string } | null>(null);
  const [collations, setCollations] = useState<SqlCollation[]>([]);
  const [creatingDatabase, setCreatingDatabase] = useState(false);
  const [creatingTable, setCreatingTable] = useState(false);
  /** The table the context menu's rename is open on, and the one its drop is asking about. */
  const [renamingTable, setRenamingTable] = useState<string | null>(null);
  const [droppingTable, setDroppingTable] = useState<string | null>(null);
  /** What the dump/restore tools are doing, if anything — shown over the whole workspace. */
  const [transferStatus, setTransferStatus] = useState("");
  /** How far the dump or restore behind that overlay has got — dropping a database has nothing to
   * report. Null until the first reading arrives, and again once the overlay goes. */
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);

  /** The sidebar's search box and the list under it — see {@link useSidebarKeyboard}. */
  const sidebarKeys = useSidebarKeyboard(active, selectedDb);

  /** What each table's filter bar was carrying when it was last left — a filter is often typed out
   * to look something up, and looking it up is exactly what sends the user off to another table or
   * to the Structure tab. Kept out here because either move unmounts the grid, and kept for as
   * long as this connection's tab is open. */
  const filterCache = useRef<FilterCache>(new Map()).current;

  /** The same idea, for everything else the panes have read: the rows of each table, its shape, and
   * what the database as a whole weighs. All three live out here rather than inside the pane that
   * reads them, so that leaving a table — or leaving the database it is in — is something to come
   * back from rather than something to be read all over again.
   *
   * Nothing in here expires on its own. What is shown is what was last read, and the reload each
   * pane carries (and `Ctrl+R`) is what says otherwise — a client that quietly re-read behind the
   * user's back would be the thing that made a slow server unusable. The one thing that is not
   * waited on is a change this app made itself: see {@link forgetTable}. */
  const tableCache = useRef<TableCache>(new Map()).current;
  const structureCache = useRef<StructureCache>(new Map()).current;
  const statsCache = useRef<StatsCache>(new Map()).current;

  /**
   * How many times this app has changed the shape of something in this connection, counted per
   * thing changed: a single table under `db :: table`, a whole database under its own name.
   *
   * Two counts rather than one so that altering a table does not cost every other table in the
   * database the page of rows already read for it. Nothing that happens to one table can change
   * what was read for the one beside it; what a restore or a drop does, on the other hand, reaches
   * all of them at once, and that is what the database's own count is for.
   */
  const [schemaTokens, setSchemaTokens] = useState<Record<string, number>>({});

  /** What the Data and Structure panes watch, for the table they are showing: the two counts added,
   * so that either one moving is a change they have to notice. Both only ever go up, so their sum
   * does too — which is all the panes ask of it, since they only compare it against the one their
   * own entry was filed under. */
  const schemaToken =
    (schemaTokens[selectedDb] ?? 0) +
    (selectedTable === null ? 0 : (schemaTokens[`${selectedDb} :: ${selectedTable}`] ?? 0));

  /** What the Statistics pane watches. Counted apart from the above, and not merely under another
   * key in it, because the figures answer to something different: they are about the database as a
   * whole, so a single table altered moves them just as a restore does — and because a database
   * with a table actually named `stats` must not be able to collide with them. */
  const [statsTokens, setStatsTokens] = useState<Record<string, number>>({});
  const statsToken = statsTokens[selectedDb] ?? 0;

  /** Moves the count against each of `keys`, and the one the figures are read under. Every path
   * below ends here: whatever changed, the database now weighs something else. */
  const bumpTokens = useCallback((database: string, keys: string[]) => {
    setSchemaTokens((tokens) => {
      const next = { ...tokens };
      for (const key of keys) next[key] = (next[key] ?? 0) + 1;
      return next;
    });
    setStatsTokens((tokens) => ({ ...tokens, [database]: (tokens[database] ?? 0) + 1 }));
  }, []);

  /**
   * Everything remembered about one table, let go, because this app has just changed it — created,
   * renamed, dropped, or a column altered. Both names are given for a rename, since the table has
   * left one and arrived at the other.
   *
   * Waiting for the user to press reload is right for a change somebody else made on the server;
   * it is wrong for one made from in here, where what is on screen is knowably about a table that
   * no longer exists in that form. A name is the sharp end of it: a table dropped and made again
   * under the same name is a different table, and the entry filed under that name would otherwise
   * be handed to it.
   *
   * The counts are bumped as well as the entries dropped, and it has to be both. Dropping alone
   * does not reach the panes — a Map is the same object before and after, so nothing re-renders off
   * it, and the grid on screen is holding its own copy of the rows in state and would file them
   * straight back on the way out. The counts are what the panes actually watch; the entries are
   * dropped so that a table nobody returns to is not left holding a page of rows for the rest of
   * the session.
   */
  const forgetTable = useCallback(
    (...tables: string[]) => {
      if (!selectedDb) return;
      // The Query tab completes from its own copy of the shape, kept per connection and database.
      invalidateSchemaOutline(connectionId, selectedDb);
      const keys = tables.map((table) => `${selectedDb} :: ${table}`);
      for (const key of keys) {
        tableCache.delete(key);
        structureCache.delete(key);
        // The filter bar goes with them: its conditions name columns, and a column renamed or
        // dropped turns the next read into `Unknown column` rather than into rows. Conditions the
        // user typed are their own work, which is why only the table actually changed loses them.
        filterCache.delete(key);
      }
      bumpTokens(selectedDb, keys);
    },
    [connectionId, selectedDb, bumpTokens],
  );

  /**
   * The same, for a change no single table can be named for — a dump restored over the database, or
   * the database itself dropped — and for the sidebar's reload, which is the plainest way for the
   * user to say "forget what you were told about this database".
   */
  const forgetDatabase = useCallback(() => {
    if (!selectedDb) return;
    invalidateSchemaOutline(connectionId, selectedDb);
    const prefix = `${selectedDb} :: `;
    for (const key of tableCache.keys()) if (key.startsWith(prefix)) tableCache.delete(key);
    for (const key of structureCache.keys()) if (key.startsWith(prefix)) structureCache.delete(key);
    for (const key of filterCache.keys()) if (key.startsWith(prefix)) filterCache.delete(key);
    bumpTokens(selectedDb, [selectedDb]);
  }, [connectionId, selectedDb, bumpTokens]);

  /**
   * Rows written rather than the shape of something changed — an insert, a delete, an `UPDATE` from
   * the Query tab.
   *
   * Nothing remembered about a table is wrong for this: the columns are where they were, and the pane
   * that did the writing has read its own page again already. What has moved is what the database
   * holds, and that is the one thing the figures on the Statistics tab are — so only their count is
   * bumped, and a session spent editing rows never costs a re-read of anything else.
   */
  const rowsChanged = useCallback(() => {
    if (!selectedDb) return;
    setStatsTokens((tokens) => ({ ...tokens, [selectedDb]: (tokens[selectedDb] ?? 0) + 1 }));
  }, [selectedDb]);

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
    const sidebarPadding = 4; // .sql-sidebar's own right padding, plus a little breathing room
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
      const dbs = await api.listDatabases(connectionId);
      setDatabases(dbs);
      setSelectedDb((prev) => (prev && dbs.includes(prev) ? prev : ""));
    } catch (e) {
      setLocalError(errorMessage(t, e));
    } finally {
      setDatabasesLoading(false);
    }
  }, [api, connectionId]);

  useEffect(() => {
    void loadDatabases();
  }, [loadDatabases]);

  // Only while the overlay is up, which is the only time there is anywhere to show a reading. The
  // listener is registered as the transfer begins rather than kept for the life of the tab: what it
  // is listening for happens a few times in a session and reports four times a second while it does.
  useEffect(() => {
    if (transferStatus === "") {
      setTransferProgress(null);
      return;
    }
    let stop: UnlistenFn | null = null;
    let cancelled = false;
    void onTransferProgress(connectionId, setTransferProgress).then((unlisten) => {
      // The transfer ended before the listener was in place; there is nothing left to hear.
      if (cancelled) void unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [transferStatus, connectionId]);

  useEffect(() => {
    let cancelled = false;
    setServerInfo(null);
    api.serverInfo(connectionId)
      .then((info) => {
        if (!cancelled) setServerInfo(info);
      })
      .catch(() => {
        // Non-critical display info — silently omit it on failure.
      });
    return () => {
      cancelled = true;
    };
  }, [api, connectionId]);

  // A property of the server rather than of any one database, so one read per connection covers
  // every table created on it.
  useEffect(() => {
    let cancelled = false;
    api.collations(connectionId)
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
  }, [api, connectionId]);

  /* Which read of the table list is the current one.
     Three things start one — this effect on a database change, the reload button, and every change
     that lands on the list — and any of their answers can come back after the database has been
     changed underneath it. A number and not a flag apiece, because they have to invalidate each
     other and not only themselves: a `listTables` still out when the database changes is answering
     about the database the user has just left. */
  const tablesRun = useRef(0);

  useEffect(() => {
    setTableFilter("");
    const mine = ++tablesRun.current;
    // Whatever the sidebar was reading is over, and its `finally` will no longer be the current
    // run's — so the spinner is put out here rather than left on for good.
    setTablesLoading(false);
    if (!selectedDb) {
      setTables([]);
      setSelectedTable(null);
      setPinnedTable(null);
      return;
    }
    setSelectedTable(null);
    setPinnedTable(null);
    api.listTables(connectionId, selectedDb)
      .then((list) => {
        if (tablesRun.current === mine) setTables(list);
      })
      .catch((e) => {
        if (tablesRun.current === mine) setLocalError(errorMessage(t, e));
      });
    return () => {
      tablesRun.current += 1;
    };
  }, [api, connectionId, selectedDb]);

  // A table the list no longer holds — dropped from in here, or gone from the server by the time it
  // was read again — has nothing left to pin above it.
  useEffect(() => {
    setPinnedTable((pinned) => (pinned === null || tables.includes(pinned) ? pinned : null));
  }, [tables]);

  /** A table chosen from the sidebar — either row of it. Choosing anything other than the pinned
   * table takes the pin down: it was a way back from a key that has now been followed away from,
   * and one that outstayed that would just be a row nobody asked for. */
  function selectTable(table: string) {
    if (table !== pinnedTable) setPinnedTable(null);
    setSelectedTable(table);
  }

  /** Opens a table named somewhere other than the sidebar — what `Ctrl+Click` on a table in the
   * Query tab's script does. The filter is cleared, or the table just selected could be one the
   * list is not currently showing, and the Data tab is what comes up: someone following a name out
   * of a script is going to read rows rather than column definitions. */
  const openTable = useCallback((table: string) => {
    setTableFilter("");
    setPinnedTable(null);
    setSelectedTable(table);
    setContentMode("data");
  }, []);

  /**
   * Follows a foreign key out of the data grid: the referenced table opened on the Data tab, its
   * filter bar already asking for the row the key points at.
   *
   * The conditions are written straight into the cache rather than handed down as a prop, because
   * that is where the grid reads its bar from as it swaps to another table — which is the very
   * render `openTable` below causes. They are filed under the token *that* table is judged by, not
   * the one the table being left from is, or the grid would take them for conditions written
   * against a shape the database no longer has and drop them.
   *
   * What was remembered of the target's own grid goes, and it has to: an entry restored alongside
   * these conditions would put the grid back on the page, the order and the scroll position it was
   * last left at, and the row being looked up is on the first page of the filtered read, not the
   * fifth page of an unfiltered one.
   *
   * The sidebar is not touched beyond {@link pinnedTable}: unlike `openTable` above, this is a
   * short trip — a value looked up, then back to where the user was — and the search they had typed
   * in the box is part of where they were.
   */
  const openRelated = useCallback(
    (table: string, column: string, value: string) => {
      const key = `${selectedDb} :: ${table}`;
      tableCache.delete(key);
      filterCache.set(key, {
        rows: [filterRowFor<FilterOperator>(column, "eq", value)],
        applied: [{ column, operator: "eq", value }],
        schemaToken: (schemaTokens[selectedDb] ?? 0) + (schemaTokens[key] ?? 0),
      });
      setPinnedTable(table);
      setSelectedTable(table);
      setContentMode("data");
    },
    [selectedDb, schemaTokens],
  );

  /** Reads the sidebar's list of tables again, and nothing else. What follows a table created,
   * renamed or dropped: the list is out of date, but every other table in the database was read
   * just as truthfully a moment ago, and the one that changed has already been let go of by name. */
  const listTables = useCallback(() => {
    if (!selectedDb) return;
    const mine = ++tablesRun.current;
    setTablesLoading(true);
    api.listTables(connectionId, selectedDb)
      .then((list) => {
        // The database changed while this was out: the list belongs to the one the user left.
        if (tablesRun.current === mine) setTables(list);
      })
      .catch((e) => {
        if (tablesRun.current === mine) setLocalError(errorMessage(t, e));
      })
      .finally(() => {
        if (tablesRun.current === mine) setTablesLoading(false);
      });
  }, [api, connectionId, selectedDb]);

  /** The sidebar's reload button, and what a restore leaves behind: the list read again, and
   * everything remembered about the database let go with it. */
  const reloadTables = useCallback(() => {
    forgetDatabase();
    listTables();
  }, [forgetDatabase, listTables]);

  /** What a restore or a drop of the whole database leaves to be caught up with: a restore has
   * replaced the tables under the list, and a drop has taken the database itself away. */
  async function databaseChanged(change: DatabaseChange) {
    if (change === "restored") {
      reloadTables();
      return;
    }
    // The database itself has gone; nothing read from it is worth keeping, and a database made
    // again under the same name later is not the one these entries are about.
    forgetDatabase();
    setSelectedDb("");
    setSelectedTable(null);
    setTables([]);
    await loadDatabases();
  }

  /** Creates the database and switches to it, empty. Errors reject back into the dialog, which is
   * what shows them and stays open. */
  async function createDatabase(name: string, collation: string | null) {
    await api.createDatabase(connectionId, name, collation);
    setCreatingDatabase(false);
    setSelectedDb(name);
    setSelectedTable(null);
    // Re-listed rather than appended, so the picker keeps the order the server lists them in.
    await loadDatabases();
  }

  /** Creates the table and leaves it selected, so the columns it still needs are one tab away.
   * Errors reject back into the dialog, which is what shows them and stays open. */
  async function createTable(name: string, collation: string | null) {
    await api.createTable(connectionId, selectedDb, name, collation);
    setCreatingTable(false);
    // Cleared so the new table is visible whatever was being searched for when it was made.
    setTableFilter("");
    setSelectedTable(name);
    // Under this name there may be an older table of the same one, dropped earlier in the session
    // and remembered still; what was read for it is not what this one holds.
    forgetTable(name);
    listTables();
  }

  /** Renames the table and follows it: whatever was open on it stays open, under the new name.
   * Errors reject back into the dialog, which is what shows them and stays open. */
  async function renameTable(table: string, newName: string) {
    await api.renameTable(connectionId, selectedDb, table, newName);
    setRenamingTable(null);
    setTableFilter("");
    if (selectedTable === table) setSelectedTable(newName);
    // The pinned row follows the rename rather than being dropped by the check above: it is the
    // same table, and it is still the way back to where the user came from.
    if (pinnedTable === table) setPinnedTable(newName);
    // Both ends of the move: the name it has left, and the name it has arrived at — which may have
    // been another table's until it was dropped.
    forgetTable(table, newName);
    listTables();
  }

  /** Drops the table the confirmation was asking about. Nothing is left open on it afterwards. */
  async function dropTable(table: string) {
    setDroppingTable(null);
    try {
      await api.dropTable(connectionId, selectedDb, table);
      if (selectedTable === table) setSelectedTable(null);
      forgetTable(table);
      listTables();
    } catch (e) {
      setLocalError(errorMessage(t, e));
    }
  }

  /** A database the server keeps for itself: its tables are read here like any other, but nothing
   * in it may be created, renamed or dropped, nor anything done to it as a whole. */
  const systemDatabase = selectedDb !== "" && dialect.isSystemDatabase(selectedDb);

  /** The two reasons this workspace refuses to change anything, and the one worth saying first.
   * Read-only is a decision someone made about the connection; a system database is a fact about
   * the server, and the one they are more likely to already know. */
  const noWrites = readOnly || systemDatabase;
  const noWritesHint = readOnly
    ? t("common.readOnlyConnection")
    : t("sql.systemTable", { database: selectedDb });

  const tableActions: ItemAction[] = [
    {
      key: "rename",
      label: t("sql.renameTable"),
      disabled: noWrites,
      disabledHint: noWritesHint,
      onSelect: setRenamingTable,
    },
    {
      key: "drop",
      label: t("sql.dropTable"),
      danger: true,
      disabled: noWrites,
      disabledHint: noWritesHint,
      onSelect: setDroppingTable,
    },
  ];

  const filteredTables = tableFilter.trim()
    ? tables.filter((t) => t.toLowerCase().includes(tableFilter.trim().toLowerCase()))
    : tables;

  const tablesEmptyMessage =
    tables.length === 0 ? t("sql.noTables") : filteredTables.length === 0 ? t("sql.noMatchingTables") : undefined;

  return (
    <div className="sql-workspace">
      <div className="sql-header">
        <div className="sql-header-left">
          {serverInfo && (
            <span className="sql-server-info">
              {t("sql.serverInfo", {
                os: serverInfo.os,
                // Named rather than assumed: the header used to read "MySQL" whatever it was
                // connected to.
                engine: t(dialect.kind === "postgres" ? "connection.kindPostgres" : "connection.kindMysql"),
                version: serverInfo.version,
              })}
            </span>
          )}
        </div>
        <label className="sql-db-select">
          {t("sql.databaseLabel")}{" "}
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
            placeholder={t("sql.databasePlaceholder")}
            size="normal"
            searchable
            searchPlaceholder={t("sql.searchDatabasesPlaceholder")}
            options={[
              {
                value: NEW_DATABASE,
                label: t("sql.createDatabase"),
                // Shown rather than hidden, so the picker offers the same thing wherever it is
                // opened and the missing entry is not read as a bug.
                disabled: readOnly,
                optionLabel: <span className="select-new-option">+ {t("sql.createDatabase")}</span>,
              },
              ...databases.map((db) => ({ value: db, label: db })),
              {
                value: RELOAD_DATABASES,
                label: t("sql.reloadDatabases"),
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
                    {t("sql.reloadDatabases")}
                  </span>
                ),
              },
            ]}
          />
        </label>
        <div className="method-tabs sql-content-tabs" role="tablist">
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
          <DisconnectTab onDisconnect={onDisconnect} />
        </div>
      </div>

      <TunnelBanner connectionId={connectionId} onDisconnect={onDisconnect} />

      {(error || localError) && (
        <ErrorBanner message={error || localError} onDismiss={() => setLocalError("")} />
      )}

      <div className="sql-body">
        <aside className="sql-sidebar" style={{ flexBasis: width }}>
          <Input
            ref={sidebarKeys.searchRef}
            size="normal"
            className="sql-sidebar-search"
            placeholder={t("sql.searchTablesPlaceholder")}
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            onKeyDown={sidebarKeys.onSearchKeyDown}
          />
          <ItemList
            ref={sidebarKeys.listRef}
            items={filteredTables}
            selectedItem={selectedTable}
            onSelect={selectTable}
            emptyMessage={tablesEmptyMessage}
            actions={tableActions}
            pinnedItem={pinnedTable}
            pinnedHint={t("sql.followedTableHint")}
            // The way back: `ArrowUp` off the top row is the search box again, caret and all.
            onLeaveTop={sidebarKeys.focusSearch}
          />
          <div className="sql-sidebar-actions">
            <ActionBar
              actions={[
                {
                  key: "reload",
                  icon: ReloadIcon,
                  label: t("sql.reloadTables"),
                  disabled: !selectedDb || tablesLoading,
                  busy: tablesLoading,
                  onClick: reloadTables,
                },
                {
                  key: "add",
                  icon: PlusIcon,
                  label: systemDatabase
                    ? t("sql.addTableSystem", { database: selectedDb })
                    : t("sql.addTable"),
                  disabled: !selectedDb || tablesLoading || noWrites,
                  // Only for read-only: the system-database case already says so in its label.
                  disabledHint: readOnly ? t("common.readOnlyConnection") : undefined,
                  onClick: () => setCreatingTable(true),
                },
              ]}
            />
            {/* The database as a whole, kept at the far end: these act on everything the list
                above is showing rather than on anything in it. */}
            {/* Dump, restore and drop. A dump only reads, but restore and drop are here too and
                the component takes one `disabled` for all three — closing the lot is the right way
                round: a read-only connection losing its dump button is a nuisance, and keeping its
                restore button is the thing the flag was set to prevent. */}
            <DatabaseActions
              kind={dialect.kind}
              connectionId={connectionId}
              database={selectedDb}
              disabled={tablesLoading || readOnly}
              onError={setLocalError}
              onChanged={databaseChanged}
              onBusyChange={setTransferStatus}
            />
          </div>
        </aside>

        <div
          className="sql-sidebar-resizer"
          onMouseDown={handleResizeStart}
          onDoubleClick={handleResizeDoubleClick}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("sql.resizeSidebar")}
          title={t("sql.resizeSidebarTooltip")}
        />

        <section className="sql-content">
          {contentMode === "data" && !selectedTable && (
            <p className="muted">{t("sql.selectTablePrompt")}</p>
          )}
          {/* Kept mounted while the other tabs are up, the same as the two below: the page of rows
              read, what is selected in it and the conditions in the filter bar all outlive a look
              at the structure or a query written against it. A table picked while this is hidden
              costs nothing until the tab is looked at again. */}
          {selectedDb && selectedTable && (
            <div className={contentMode === "data" ? "sql-panel" : "sql-panel-hidden"}>
              <SqlTable
                active={active && contentMode === "data"}
                connectionId={connectionId}
                selectedDb={selectedDb}
                selectedTable={selectedTable}
                onError={setLocalError}
                layoutWidth={width}
                filterCache={filterCache}
                tableCache={tableCache}
                schemaToken={schemaToken}
                onRowsChanged={rowsChanged}
                onOpenRelated={openRelated}
                readOnly={readOnly}
              />
            </div>
          )}
          {contentMode === "structure" && !selectedTable && (
            <p className="muted">{t("sql.selectTableStructurePrompt")}</p>
          )}
          {/* Kept mounted for the same reason: the columns and indexes already read are still there
              on the way back, rather than being asked for again. */}
          {selectedDb && selectedTable && (
            <div className={contentMode === "structure" ? "sql-panel" : "sql-panel-hidden"}>
              <TableStructure
                active={active && contentMode === "structure"}
                connectionId={connectionId}
                selectedDb={selectedDb}
                selectedTable={selectedTable}
                onError={setLocalError}
                structureCache={structureCache}
                schemaToken={schemaToken}
                onSchemaChanged={() => forgetTable(selectedTable)}
                readOnly={readOnly}
              />
            </div>
          )}
          {contentMode === "stats" && !selectedDb && (
            <p className="muted">{t("sql.selectDatabaseStatsPrompt")}</p>
          )}
          {/* Kept mounted while the other tabs are up, for the same reason the editor below is:
              the figures it has read stay read, so coming back to the tab costs nothing. */}
          {selectedDb && (
            <div className={contentMode === "stats" ? "sql-panel" : "sql-panel-hidden"}>
              <DatabaseStats
                kind={dialect.kind}
                connectionId={connectionId}
                database={selectedDb}
                active={active && contentMode === "stats"}
                onError={setLocalError}
                statsCache={statsCache}
                schemaToken={statsToken}
              />
            </div>
          )}
          {/* Kept mounted while the other tabs are up, and hidden rather than unmounted: a script
              being written and the results it has produced so far must survive a look at the data
              or the structure it is being written against. */}
          <div className={contentMode === "query" ? "sql-panel" : "sql-panel-hidden"}>
            <QueryEditor
              connectionId={connectionId}
              database={selectedDb}
              active={active && contentMode === "query"}
              readOnly={readOnly}
              profileId={profileId}
              onOpenTable={openTable}
              // A script that changed the shape of the database is the sidebar's reload, arrived at
              // from the other direction: the list of tables may be out of date, and so is everything
              // read from any table in it — the statement could have named any of them, or several.
              // Rows written are only the figures.
              onDatabaseChanged={(change) => (change === "schema" ? reloadTables() : rowsChanged())}
            />
          </div>
        </section>
      </div>

      {transferStatus !== "" && (
        <TransferOverlay label={transferStatus} progress={transferProgress} />
      )}

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
          title={t("sql.renameTableTitle", { table: renamingTable })}
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
          title={t("sql.dropTableTitle")}
          message={t("sql.dropTableMessage", { table: droppingTable })}
          confirmLabel={t("common.delete")}
          danger
          onConfirm={() => void dropTable(droppingTable)}
          onCancel={() => setDroppingTable(null)}
        />
      )}
    </div>
  );
}

export default SqlWorkspace;
