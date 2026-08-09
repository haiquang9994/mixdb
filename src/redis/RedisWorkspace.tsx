import { useCallback, useEffect, useRef, useState } from "react";
import {
  redisListDatabases,
  redisScanKeys,
  redisSelectDb,
  redisServerInfo,
  REDIS_FIRST_CURSOR,
  type RedisDbInfo,
  type RedisKeyInfo,
} from "./api";
import Select from "../components/Select";
import ErrorBanner from "../components/ErrorBanner";
import Input from "../components/Input";
import ActionBar from "../components/ActionBar";
import RedisKeyList from "../components/RedisKeyList";
import RedisValue from "../components/RedisValue";
import keyListStyles from "../components/RedisKeyList/RedisKeyList.module.css";
import { ReloadIcon } from "../icons";
import { useTranslation } from "../i18n";

interface Props {
  connectionId: string;
  /** The database index the connection was opened on, as typed into the connection form. */
  initialDatabase?: string;
  status: string;
  error: string;
  onDisconnect: () => void;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
}

/** The panes the content area can show. Only the key view exists so far, but the header is
 * already a tab strip so a second one (a command console, server info, …) is a case here and a
 * branch below rather than a reshuffle of the layout — same as the other two workspaces. */
type ContentMode = "data";

const DEFAULT_SIDEBAR_WIDTH = 240;
const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 520;

/** How many keys one press of Load more asks for. A hint: `SCAN` may hand back fewer, or a few
 * more, and the cursor is what says whether anything is left. */
const KEY_PAGE_SIZE = 200;

/** What can split a key name into tree levels. Redis has no namespaces — `user:1:name` is one
 * flat key like any other — so this is purely a convention in how names are written, and which
 * character a keyspace uses is the caller's to say. `:` is what nearly everyone uses; the empty
 * string is the way out, and lists the keys whole. */
const SEPARATORS = [":", ".", "/", "-", "_", "|"];

/** The separator a keyspace is read with until told otherwise. */
const DEFAULT_SEPARATOR = ":";

/**
 * The Redis side of the app: a keyspace on the left, the selected key's value on the right.
 *
 * The key list grows by Load more rather than by numbered pages. That isn't a style choice —
 * `SCAN` walks the keyspace a slice at a time from an opaque cursor, and a Redis server has no
 * ordering to page through nor a key count to divide into pages. The value pane loads the same
 * way, for the same reason on the scanned types.
 */
function RedisWorkspace({ connectionId, initialDatabase, error, sidebarWidth, onSidebarWidthChange }: Props) {
  const { t } = useTranslation();
  const [databases, setDatabases] = useState<RedisDbInfo[]>([]);
  const [selectedDb, setSelectedDb] = useState(() => {
    const parsed = Number(initialDatabase);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  });
  const [keys, setKeys] = useState<RedisKeyInfo[]>([]);
  const [cursor, setCursor] = useState(REDIS_FIRST_CURSOR);
  const [scanDone, setScanDone] = useState(false);
  const [keysLoading, setKeysLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [contentMode, setContentMode] = useState<ContentMode>("data");
  const [localError, setLocalError] = useState("");
  const [serverInfo, setServerInfo] = useState<{ version: string; os: string } | null>(null);

  // The pattern the key list is showing. The input below edits `pattern` freely; only Enter (or
  // the reload button) copies it here — a glob is retyped a character at a time, and rescanning
  // the keyspace on every keystroke is the one thing not to do to a live server.
  const [pattern, setPattern] = useState("*");
  const [appliedPattern, setAppliedPattern] = useState("*");
  // Reading the same keys, not fetching different ones: the tree is built client-side out of the
  // names already loaded, so changing this costs nothing and needs no rescan.
  const [separator, setSeparator] = useState(DEFAULT_SEPARATOR);
  // Bumped to rescan on the same pattern: pressing reload twice is a request to look again, and
  // an unchanged pattern alone would be a no-op.
  const [scanId, setScanId] = useState(0);

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
    if (keys.length === 0) {
      setWidth(DEFAULT_SIDEBAR_WIDTH);
      onSidebarWidthChange?.(DEFAULT_SIDEBAR_WIDTH);
      return;
    }
    const longest = keys.reduce((a, b) => (b.name.length > a.length ? b.name : a), "");
    const probe = document.createElement("button");
    probe.className = keyListStyles.item;
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
    // Every row carries a chevron slot and a badge slot left of its name, both fixed widths and
    // neither part of the text just measured — so the sidebar has to fit them on top of it.
    const fixedColumns = 66;
    const sidebarPadding = 4;
    const target = Math.ceil(textWidth + horizontalPadding + fixedColumns + sidebarPadding);
    const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(DEFAULT_SIDEBAR_WIDTH, target));
    setWidth(next);
    onSidebarWidthChange?.(next);
  }, [keys, onSidebarWidthChange]);

  useEffect(() => {
    let cancelled = false;
    setServerInfo(null);
    redisServerInfo(connectionId)
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

  /** Reads the database list. Also called after a delete: the key counts in it are what the
   * selector shows, and one of them has just changed. */
  const loadDatabases = useCallback(() => {
    redisListDatabases(connectionId)
      .then(setDatabases)
      .catch((e) => setLocalError(String(e)));
  }, [connectionId]);

  useEffect(() => loadDatabases(), [loadDatabases]);

  // The first page of the keyspace, for the current database and pattern. Every later page is
  // appended by `loadMoreKeys` from the cursor this one hands back.
  useEffect(() => {
    let cancelled = false;
    setKeysLoading(true);
    redisScanKeys(connectionId, appliedPattern, REDIS_FIRST_CURSOR, KEY_PAGE_SIZE)
      .then((page) => {
        if (cancelled) return;
        setKeys(page.keys);
        setCursor(page.cursor);
        setScanDone(page.done);
      })
      .catch((e) => {
        if (!cancelled) setLocalError(String(e));
      })
      .finally(() => {
        if (!cancelled) setKeysLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, appliedPattern, selectedDb, scanId]);

  /** Appends the next slice of the keyspace. `SCAN` can return a key it has already returned, so
   * what comes back is merged by name rather than concatenated. */
  function loadMoreKeys() {
    if (scanDone || loadingMore || keysLoading) return;
    setLoadingMore(true);
    redisScanKeys(connectionId, appliedPattern, cursor, KEY_PAGE_SIZE)
      .then((page) => {
        setKeys((prev) => {
          const seen = new Set(prev.map((k) => k.name));
          return [...prev, ...page.keys.filter((k) => !seen.has(k.name))];
        });
        setCursor(page.cursor);
        setScanDone(page.done);
      })
      .catch((e) => setLocalError(String(e)))
      .finally(() => setLoadingMore(false));
  }

  /** Rescans from the top on whatever the pattern box currently holds. */
  const rescan = useCallback(() => {
    setAppliedPattern(pattern.trim() || "*");
    setScanId((n) => n + 1);
  }, [pattern]);

  /** Moves the connection to another numbered database. The selection only takes effect once
   * the server has acknowledged it — the key list read afterwards would otherwise be the old
   * database's, under the new database's heading. */
  async function changeDatabase(index: number) {
    try {
      await redisSelectDb(connectionId, index);
      // A key name means nothing outside the database it was read from, so the pane is closed
      // rather than carried over. A rescan on the same database keeps its selection.
      setSelectedKey(null);
      setSelectedDb(index);
      loadDatabases();
    } catch (e) {
      setLocalError(String(e));
    }
  }

  /** Drops a deleted key from the list without rescanning: the rest of the list is still what
   * the server holds, and a rescan would lose every page loaded so far. */
  function handleKeyDeleted(name: string) {
    setKeys((prev) => prev.filter((k) => k.name !== name));
    setSelectedKey((prev) => (prev === name ? null : prev));
    loadDatabases();
  }

  // An empty page is not an empty keyspace: SCAN returns a slice at a time, and a selective
  // pattern can match nothing in the first several of them. Only an exhausted cursor says there
  // is really nothing there.
  const keysEmptyMessage = keysLoading
    ? undefined
    : scanDone
      ? t("redis.noKeys")
      : t("redis.noKeysInSlice");

  return (
    <div className="redis-workspace">
      <div className="redis-header">
        <div className="redis-header-left">
          {serverInfo && (
            <span className="redis-server-info">
              {t("redis.serverInfo", { os: serverInfo.os, version: serverInfo.version })}
            </span>
          )}
        </div>
        <label className="redis-db-select">
          {t("redis.databaseLabel")}{" "}
          <Select
            value={selectedDb}
            onChange={changeDatabase}
            size="normal"
            searchable
            searchPlaceholder={t("redis.searchDatabasesPlaceholder")}
            options={databases.map((db) => ({
              value: db.index,
              label: t("redis.dbOption", { index: db.index, keys: db.keys }),
            }))}
          />
        </label>
        <div className="method-tabs redis-content-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={contentMode === "data"}
            className={`method-tab${contentMode === "data" ? " method-tab-active" : ""}`}
            onClick={() => setContentMode("data")}
          >
            {t("redis.dataTab")}
          </button>
        </div>
      </div>

      {(error || localError) && (
        <ErrorBanner message={error || localError} onDismiss={() => setLocalError("")} />
      )}

      <div className="redis-body">
        <aside className="redis-sidebar" style={{ flexBasis: width }}>
          <div className="redis-sidebar-search">
            <Input
              size="normal"
              className="redis-key-pattern"
              placeholder={t("redis.keyPatternPlaceholder")}
              title={t("redis.keyPatternTooltip")}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") rescan();
              }}
            />
            <Select
              value={separator}
              onChange={setSeparator}
              size="normal"
              className="redis-separator-select"
              optionAlign="center"
              ariaLabel={t("redis.separatorLabel")}
              options={[
                ...SEPARATORS.map((s) => ({
                  value: s,
                  label: s,
                  searchText: s,
                })),
                { value: "", label: t("redis.separatorFlatShort"), optionLabel: t("redis.separatorFlat") },
              ]}
            />
          </div>
          <RedisKeyList
            keys={keys}
            separator={separator}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            emptyMessage={keysEmptyMessage}
            hasMore={!scanDone}
            loadingMore={loadingMore || keysLoading}
            onLoadMore={loadMoreKeys}
          />
          <ActionBar
            className="redis-sidebar-actions"
            actions={[
              {
                key: "reload",
                icon: ReloadIcon,
                label: t("redis.reloadKeys"),
                disabled: keysLoading,
                busy: keysLoading,
                onClick: rescan,
              },
            ]}
          />
        </aside>

        <div
          className="redis-sidebar-resizer"
          onMouseDown={handleResizeStart}
          onDoubleClick={handleResizeDoubleClick}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("redis.resizeSidebar")}
          title={t("redis.resizeSidebarTooltip")}
        />

        <section className="redis-content">
          {contentMode === "data" && !selectedKey && <p className="muted">{t("redis.selectKeyPrompt")}</p>}
          {contentMode === "data" && selectedKey && (
            <RedisValue
              // The database is part of what a key name means, so switching database has to
              // rebuild the pane rather than refetch inside it.
              key={`${selectedDb}:${selectedKey}`}
              connectionId={connectionId}
              keyName={selectedKey}
              onError={setLocalError}
              onDeleted={handleKeyDeleted}
            />
          )}
        </section>
      </div>
    </div>
  );
}

export default RedisWorkspace;
