import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  redisListDatabases,
  redisScanKeys,
  redisSelectDb,
  redisServerInfo,
  REDIS_FIRST_CURSOR,
  type RedisDbInfo,
  type RedisKeyInfo,
} from "./api";
import Select from "../../../components/Select";
import ErrorBanner from "../../../components/ErrorBanner";
import Input from "../../../components/Input";
import ActionBar from "../../../components/ActionBar";
import RedisGroupKeys from "../../../components/RedisGroupKeys";
import RedisKeyList from "../../../components/RedisKeyList";
import RedisValue from "../../../components/RedisValue";
import keyListStyles from "../../../components/RedisKeyList/RedisKeyList.module.css";
import { ReloadIcon } from "../../../icons";
import { useTranslation } from "../../../i18n";
import { errorMessage } from "../../../core/errors";

interface Props {
  connectionId: string;
  /** The database index the connection was opened on, as typed into the connection form. */
  initialDatabase?: string;
  status: string;
  error: string;
  onDisconnect: () => void;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
  /** The remembered key ceiling for this connection, or undefined for {@link DEFAULT_SCAN_LIMIT}. */
  scanLimit?: number;
  onScanLimitChange?: (limit: number) => void;
  /**
   * The connection is marked read-only, so nothing here may write to the server.
   *
   * Deleting is all a Redis keyspace can be changed by from in here, so that is what closes: the
   * value pane's delete button and the group pane's. Walking the keyspace, reading a value and
   * switching database are reads and stay exactly as they are.
   */
  readOnly?: boolean;
}

/** The panes the content area can show: the selected key's value, or the keys under one group of
 * the sidebar with a way to delete them. The header is a tab strip, so a third one (a command
 * console, server info, …) is a case here and a branch below rather than a reshuffle of the
 * layout — same as the other two workspaces. */
type ContentMode = "data" | "group";

const DEFAULT_SIDEBAR_WIDTH = 240;
const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 520;

/** How many keys one round of the scan asks for. A hint: `SCAN` may hand back fewer, or a few
 * more, and the cursor is what says whether anything is left. */
const KEY_PAGE_SIZE = 500;

/**
 * How many keys the sidebar reads before it stops walking the keyspace on its own.
 *
 * The list is sorted by key name, and a sort needs everything it sorts — a name that arrives
 * after the tree is drawn belongs wherever it sorts, which is usually above whatever the user is
 * reading. So the scan runs to the end of the keyspace up front, and only then is the order it
 * shows the final one. That is affordable because a Redis keyspace someone browses is small; a
 * keyspace of millions is not, and this is where the walk gives up and says so instead of
 * hanging on for a list nobody can read anyway.
 *
 * Which of these is right is a property of the server, not of the app, so the picker in the
 * sidebar chooses and the connection remembers. Every one of them is finite on purpose: the
 * ceiling exists so a keyspace can't hang the sidebar, and an unlimited entry would be a way to
 * ask for exactly that. Past the largest, the pattern box is the way through.
 */
const SCAN_LIMITS = [5000, 20000, 50000, 200000];

/** The ceiling a connection is read with until told otherwise. */
const DEFAULT_SCAN_LIMIT = 20000;

/** How often a sweep in progress hands what it has to the sidebar. Every round would be the
 * obvious thing, but each one rebuilds and re-sorts the whole tree — on a keyspace near the
 * ceiling that is dozens of rebuilds nobody reads. The first round still lands immediately. */
const SCAN_PUBLISH_INTERVAL_MS = 400;

/** What can split a key name into tree levels. Redis has no namespaces — `user:1:name` is one
 * flat key like any other — so this is purely a convention in how names are written, and which
 * character a keyspace uses is the caller's to say. `:` is what nearly everyone uses; the empty
 * string is the way out, and lists the keys whole. */
const SEPARATORS = [":", ".", "/", "-", "_", "|"];

/** The separator a keyspace is read with until told otherwise. */
const DEFAULT_SEPARATOR = ":";

/** The database picker's last entry, which re-reads the list instead of selecting anything — the
 * key counts it shows go stale as soon as anything else writes to the server. Negative, where a
 * real Redis database index never is. */
const RELOAD_DATABASES = -1;

/**
 * The Redis side of the app: a keyspace on the left, the selected key's value on the right.
 *
 * The key list grows by Load more rather than by numbered pages. That isn't a style choice —
 * `SCAN` walks the keyspace a slice at a time from an opaque cursor, and a Redis server has no
 * ordering to page through nor a key count to divide into pages. The value pane loads the same
 * way, for the same reason on the scanned types.
 */
function RedisWorkspace({
  connectionId,
  initialDatabase,
  error,
  sidebarWidth,
  onSidebarWidthChange,
  scanLimit,
  onScanLimitChange,
  readOnly = false,
}: Props) {
  const { t } = useTranslation();
  const [databases, setDatabases] = useState<RedisDbInfo[]>([]);
  const [databasesLoading, setDatabasesLoading] = useState(false);
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
  // The group the delete pane is listing, by its prefix, or null when no group has been opened.
  const [groupPrefix, setGroupPrefix] = useState<string | null>(null);
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
  // Held here rather than read straight off the prop: an unsaved connection has nowhere to
  // remember it, and even a saved one only sees the new value once the store has written it
  // back. The picker has to take effect on the press either way.
  const [keyLimit, setKeyLimit] = useState(scanLimit ?? DEFAULT_SCAN_LIMIT);
  // Bumped to rescan on the same pattern: pressing reload twice is a request to look again, and
  // an unchanged pattern alone would be a no-op.
  const [scanId, setScanId] = useState(0);

  const [width, setWidth] = useState(sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
  const resizing = useRef(false);

  useEffect(() => {
    setWidth(sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
  }, [sidebarWidth]);

  useEffect(() => {
    setKeyLimit(scanLimit ?? DEFAULT_SCAN_LIMIT);
  }, [scanLimit]);

  // A group's prefix is a reading of the key names under one separator, so it names a different
  // set of keys under another one and nothing at all under none. The pane closes rather than
  // relisting itself around whatever the new separator makes of the same string.
  useEffect(() => {
    setGroupPrefix(null);
    setContentMode("data");
  }, [separator]);

  /** Sets the ceiling and remembers it. The scan effect takes `keyLimit` as an input, so this
   * also starts the keyspace over — raising the ceiling has to go back past where the last
   * sweep stopped, and lowering it has to drop what is already past the new one. */
  function changeKeyLimit(limit: number) {
    setKeyLimit(limit);
    onScanLimitChange?.(limit);
  }

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
    setDatabasesLoading(true);
    redisListDatabases(connectionId)
      .then(setDatabases)
      .catch((e) => setLocalError(errorMessage(t, e)))
      .finally(() => setDatabasesLoading(false));
  }, [connectionId]);

  useEffect(() => loadDatabases(), [loadDatabases]);

  // The keyspace for the current database and pattern, walked to its end in one sweep rather
  // than a page per press. The sidebar sorts by name, and sorting is only meaningful over the
  // whole set: reading it a page at a time meant every press dropped keys into groups the user
  // had already scrolled past. Rounds are published as they land, so a long sweep fills the list
  // in rather than staring at a spinner; `loadedCount` in the footer says it is still going.
  useEffect(() => {
    let cancelled = false;
    setKeys([]);
    setCursor(REDIS_FIRST_CURSOR);
    setScanDone(false);
    setKeysLoading(true);

    void (async () => {
      const collected: RedisKeyInfo[] = [];
      // `SCAN` can hand the same key back on two rounds, so names are merged rather than
      // concatenated — across rounds as much as within one.
      const seen = new Set<string>();
      let next = REDIS_FIRST_CURSOR;
      let lastPublished = 0;
      try {
        for (;;) {
          const page = await redisScanKeys(connectionId, appliedPattern, next, KEY_PAGE_SIZE);
          if (cancelled) return;
          for (const key of page.keys) {
            if (seen.has(key.name)) continue;
            seen.add(key.name);
            collected.push(key);
          }
          next = page.cursor;
          const finished = page.done || collected.length >= keyLimit;
          const now = Date.now();
          if (finished || now - lastPublished >= SCAN_PUBLISH_INTERVAL_MS) {
            lastPublished = now;
            setKeys(collected.slice());
            setCursor(page.cursor);
            setScanDone(page.done);
          }
          if (finished) break;
        }
      } catch (e) {
        if (!cancelled) setLocalError(errorMessage(t, e));
      } finally {
        if (!cancelled) setKeysLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectionId, appliedPattern, selectedDb, scanId, keyLimit]);

  /** Appends one more slice of a keyspace the sweep gave up on at its ceiling. The
   * order is not settled at that point and cannot be, so this is the one path where new names
   * still land above what is on screen — which is why the list says so while it applies. */
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
      .catch((e) => setLocalError(errorMessage(t, e)))
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
    if (index === RELOAD_DATABASES) {
      loadDatabases();
      return;
    }
    try {
      await redisSelectDb(connectionId, index);
      // A key name means nothing outside the database it was read from, so the pane is closed
      // rather than carried over — and neither does a group's prefix. A rescan on the same
      // database keeps both.
      setSelectedKey(null);
      setGroupPrefix(null);
      setContentMode("data");
      setSelectedDb(index);
      loadDatabases();
    } catch (e) {
      setLocalError(errorMessage(t, e));
    }
  }

  /** Drops deleted keys from the list without rescanning: the rest of the list is still what
   * the server holds, and a rescan would lose every page loaded so far. */
  function handleKeysDeleted(names: string[]) {
    const gone = new Set(names);
    setKeys((prev) => prev.filter((k) => !gone.has(k.name)));
    setSelectedKey((prev) => (prev !== null && gone.has(prev) ? null : prev));
    loadDatabases();
  }

  /** The keys the tree groups under `groupPrefix` — the node's own key, if a key of exactly that
   * name exists, and everything below it. Read off the names already scanned, the same way the
   * tree itself is: the grouping is a reading of the keyspace, not something the server knows. */
  const groupKeys = useMemo(() => {
    if (groupPrefix === null || !separator) return [];
    const nested = `${groupPrefix}${separator}`;
    return keys.filter((k) => k.name === groupPrefix || k.name.startsWith(nested));
  }, [keys, groupPrefix, separator]);

  function closeGroup() {
    setGroupPrefix(null);
    setContentMode("data");
  }

  // An empty list is not an empty keyspace while the sweep is still running: SCAN returns a
  // slice at a time, and a selective pattern can match nothing in the first several of them.
  // Only an exhausted cursor says there is really nothing there.
  const keysEmptyMessage = keysLoading
    ? undefined
    : scanDone
      ? t("redis.noKeys")
      : t("redis.noKeysInSlice");

  // The sweep stopped short of the end of the keyspace — at its ceiling, not because it ran out.
  const scanLimitReached = !scanDone && keys.length >= keyLimit;

  // `connections.json` is meant to be readable and editable by hand, so a remembered ceiling may
  // be a number this build never offers. It is still what the keyspace is being read with, so it
  // joins the list rather than leaving the picker showing nothing.
  const limitOptions = useMemo(() => {
    const values = SCAN_LIMITS.includes(keyLimit)
      ? SCAN_LIMITS
      : [...SCAN_LIMITS, keyLimit].sort((a, b) => a - b);
    return values.map((limit) => ({
      value: limit,
      label: t("redis.scanLimitShort", { n: limit / 1000 }),
      optionLabel: t("redis.scanLimitOption", { n: limit.toLocaleString() }),
      searchText: String(limit),
    }));
  }, [keyLimit, t]);

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
            options={[
              ...databases.map((db) => ({
                value: db.index,
                label: t("redis.dbOption", { index: db.index, keys: db.keys }),
              })),
              {
                value: RELOAD_DATABASES,
                label: t("redis.reloadDatabases"),
                // The menu stays open behind it: the reloaded key counts are the whole point of
                // the click, and closing would hide them until the picker is opened again.
                keepOpen: true,
                disabled: databasesLoading,
                optionLabel: (
                  <span className="select-reload-option">
                    <ReloadIcon
                      size="1em"
                      className={databasesLoading ? "select-reload-option-spinning" : undefined}
                    />
                    {t("redis.reloadDatabases")}
                  </span>
                ),
              },
            ]}
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
          {/* Only once a group has been opened from the sidebar: an empty delete pane would be a
              tab with nothing behind it. Closing the pane takes the tab with it. */}
          {groupPrefix !== null && (
            <button
              type="button"
              role="tab"
              aria-selected={contentMode === "group"}
              className={`method-tab${contentMode === "group" ? " method-tab-active" : ""}`}
              title={groupPrefix}
              onClick={() => setContentMode("group")}
            >
              {t("redis.groupTab")}
            </button>
          )}
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
            {/* Next to the separator because both say how the keyspace is to be read, and this
                one is what the footer's notice sends the user to. Written short — 20K — since
                the row's width belongs to the pattern box; the menu spells each one out. */}
            <Select
              value={keyLimit}
              onChange={changeKeyLimit}
              size="normal"
              className="redis-limit-select"
              optionAlign="center"
              ariaLabel={t("redis.scanLimitLabel")}
              title={t("redis.scanLimitTooltip")}
              options={limitOptions}
            />
          </div>
          <RedisKeyList
            keys={keys}
            separator={separator}
            selectedKey={selectedKey}
            // Picking a key is a request to see its value, so it brings that pane back to the
            // front — the delete pane stays open behind its tab rather than swallowing the click.
            onSelect={(name) => {
              setSelectedKey(name);
              setContentMode("data");
            }}
            emptyMessage={keysEmptyMessage}
            scanning={keysLoading}
            hasMore={!scanDone}
            limitReached={scanLimitReached}
            loadedCount={keys.length}
            loadingMore={loadingMore}
            onLoadMore={loadMoreKeys}
            groupActions={[
              {
                key: "list-to-delete",
                label: t("redis.listGroupKeys"),
                onSelect: (path) => {
                  setGroupPrefix(path);
                  setContentMode("group");
                },
              },
            ]}
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
              readOnly={readOnly}
              onError={setLocalError}
              onDeleted={(name) => handleKeysDeleted([name])}
            />
          )}
          {contentMode === "group" && groupPrefix !== null && (
            <RedisGroupKeys
              // Same reason as the value pane: a prefix names different keys in another database,
              // and pointing the pane at another group starts its selection over.
              key={`${selectedDb}:${groupPrefix}`}
              connectionId={connectionId}
              prefix={groupPrefix}
              keys={groupKeys}
              partial={keysLoading || !scanDone}
              readOnly={readOnly}
              onError={setLocalError}
              onDeleted={handleKeysDeleted}
              onClose={closeGroup}
            />
          )}
        </section>
      </div>
    </div>
  );
}

export default RedisWorkspace;
