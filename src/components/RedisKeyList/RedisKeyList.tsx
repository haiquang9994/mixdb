import { useEffect, useMemo, useRef, useState } from "react";
import type { RedisKeyInfo } from "../../redis/api";
import {
  ancestorPaths,
  buildKeyTree,
  flatRows,
  resolveTreeKey,
  TREE_NAV_KEYS,
  visibleRows,
} from "../../redis/keyTree";
import { ChevronDownIcon, ChevronRightIcon, FolderIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import styles from "./RedisKeyList.module.css";

interface Props {
  keys: RedisKeyInfo[];
  /** What splits a key name into levels — `:` by convention. Empty renders the flat list. */
  separator: string;
  selectedKey?: string | null;
  onSelect: (key: string) => void;
  emptyMessage?: string;
  /** Whether the keyspace scan has more to hand back. */
  hasMore: boolean;
  loadingMore?: boolean;
  onLoadMore: () => void;
  className?: string;
}

/** The types with a colour of their own; anything else falls back to the neutral badge. */
const KNOWN_TYPES = new Set(["string", "list", "set", "zset", "hash", "stream"]);

/** What the badge says. Three characters, which is what the badge column fits — the colour is
 * what tells the types apart at a glance anyway, the letters only confirm it. */
const TYPE_ABBREVIATION: Record<string, string> = {
  string: "STR",
  list: "LST",
  set: "SET",
  zset: "ZST",
  hash: "HSH",
  stream: "STM",
};

/**
 * The key list in the Redis sidebar. Unlike a table or a collection list this one is never
 * complete: `SCAN` walks the keyspace a slice at a time, so the list grows by pressing Load more
 * rather than by moving between numbered pages — there is no total to divide into pages, and the
 * scan has no way to jump to a page in the middle.
 *
 * Keys are drawn as a tree over their shared prefixes. Nothing in Redis makes `user:1:name` a
 * child of anything — the keyspace is flat, and the separator is a convention the caller picks —
 * so the tree is a reading of the names, and switching the separator re-reads the same keys.
 */
function RedisKeyList({
  keys,
  separator,
  selectedKey,
  onSelect,
  emptyMessage,
  hasMore,
  loadingMore,
  onLoadMore,
  className,
}: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(() => ancestorPaths(selectedKey, separator));
  // Which row the arrow keys move from, held by path rather than by index: loading more keys
  // re-sorts the siblings around it, and an index would then point at a different row than the
  // one the user left the focus on.
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  // A path means something else under a different separator, so what was open under the old one
  // says nothing about the new one — the tree starts closed again, reopened only down to the
  // selected key so it doesn't vanish out from under the selection. `selectedKey` is read here
  // but is deliberately not a dependency: selecting a key must not close the tree around it.
  useEffect(() => {
    setExpanded(ancestorPaths(selectedKey, separator));
  }, [separator]);

  const tree = useMemo(() => buildKeyTree(keys, separator), [keys, separator]);
  // One list of rows either way — grouped by prefix, or every key at depth 0 — so the rendering
  // below and the keyboard handling have a single shape to work on.
  const rows = useMemo(
    () => (separator ? visibleRows(tree, expanded) : flatRows(keys)),
    [separator, tree, expanded, keys],
  );

  // Where the arrows move from, and the one row in the tab order. Held by path above, but that
  // path may be gone (a rescan) or never set (nothing focused yet) — in which case the selected
  // key stands in, so the first arrow press continues from the key already open on the right
  // rather than jumping to the top of the list. The first row is the last resort.
  const focusedIndex = rows.findIndex((row) => row.node.path === focusedPath);
  const selectedIndex = rows.findIndex((row) => row.node.key?.name === selectedKey);
  const activeIndex = focusedIndex >= 0 ? focusedIndex : Math.max(0, selectedIndex);

  function setExpansion(path: string, open: boolean) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });
  }

  /** Moves the roving focus to `index`, if there is a row there. The element is focused directly
   * rather than through an effect: every move below leaves the rows themselves unchanged, so the
   * target is already mounted. */
  function moveTo(index: number) {
    const row = rows[index];
    if (!row) return;
    setFocusedPath(row.node.path);
    rowRefs.current.get(row.node.path)?.focus();
  }

  /** Arrow-key navigation. What each key means is {@link resolveTreeKey}'s; this carries it out
   * and swallows the keystroke either way, so an arrow never scrolls the sidebar out from under
   * a list that was going to handle it. */
  function onKeyDown(e: React.KeyboardEvent) {
    if (!TREE_NAV_KEYS.has(e.key)) return;
    e.preventDefault();
    const action = resolveTreeKey(e.key, rows, activeIndex);
    if (!action) return;
    if (action.kind === "move") moveTo(action.index);
    else setExpansion(action.path, action.kind === "expand");
  }

  function typeBadge(key: RedisKeyInfo) {
    return (
      <span className={`${styles.badge}${KNOWN_TYPES.has(key.type) ? ` ${styles[key.type]}` : ""}`}>
        {TYPE_ABBREVIATION[key.type] ?? key.type.slice(0, 3).toUpperCase()}
      </span>
    );
  }

  return (
    <div className={`${styles.keyList}${className ? ` ${className}` : ""}`}>
      {/* A flattened tree: the nesting lives in `aria-level` rather than in nested lists, which
          is what lets one row list serve both the grouped and the ungrouped view. */}
      <ul role="tree" aria-label={t("redis.keyTreeLabel")} onKeyDown={onKeyDown}>
        {rows.map(({ node, depth, open }, index) => {
          const isFolder = node.children.length > 0;
          const selected = node.key !== undefined && node.key.name === selectedKey;
          return (
            <li key={node.path} role="none">
              <button
                type="button"
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={selected}
                aria-expanded={isFolder ? open : undefined}
                // Exactly one row is in the tab order at a time, so Tab moves past the list
                // rather than through every key in it; the arrows move within. Which row that
                // is starts as the selected one, so Tab lands where the arrows will start.
                tabIndex={index === activeIndex ? 0 : -1}
                ref={(el) => {
                  if (el) rowRefs.current.set(node.path, el);
                  else rowRefs.current.delete(node.path);
                }}
                className={`${styles.item}${selected ? ` ${styles.itemActive}` : ""}`}
                // The row is one control rather than a row plus a chevron button: a button
                // inside a button is not valid, and a node that is both a key and a folder
                // wants both things to happen anyway.
                onClick={() => {
                  setFocusedPath(node.path);
                  if (isFolder) setExpansion(node.path, !open);
                  if (node.key) onSelect(node.key.name);
                }}
                style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
                title={node.key ? node.key.name : node.path}
              >
                <span className={styles.chevron}>
                  {isFolder && (open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />)}
                </span>
                {/* The badge slot is a fixed column, so folder rows and key rows line their
                    names up. A prefix has no type to show there — it gets the folder mark
                    instead, which is what the slot used to sit empty for. */}
                {node.key ? (
                  typeBadge(node.key)
                ) : (
                  <span className={styles.folderBadge}>
                    <FolderIcon size={16} />
                  </span>
                )}
                <span className={styles.name}>{node.label}</span>
                {isFolder && <span className={styles.count}>{node.count}</span>}
              </button>
            </li>
          );
        })}
        {keys.length === 0 && emptyMessage && (
          <li role="none" className={`muted ${styles.empty}`}>
            {emptyMessage}
          </li>
        )}
      </ul>
      {hasMore && (
        <button type="button" className={styles.loadMore} disabled={loadingMore} onClick={onLoadMore}>
          {loadingMore ? t("redis.loadingMore") : t("redis.loadMoreKeys")}
        </button>
      )}
    </div>
  );
}

export default RedisKeyList;
