import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./ItemList.module.css";

/** One entry of the menu an item opens on right-click. */
export interface ItemAction {
  /** Distinguishes this entry from the others in the menu. */
  key: string;
  label: string;
  /** Paints the entry as destructive. For actions that lose data, not merely risky ones. */
  danger?: boolean;
  /** Given the item the menu was opened on — the menu closes first, so this may open a dialog. */
  onSelect: (item: string) => void;
}

interface ItemListProps {
  items: string[];
  selectedItem?: string | null;
  onSelect: (item: string) => void;
  emptyMessage?: string;
  className?: string;
  /** What right-clicking an item offers. Left out, right-click does what it always does. */
  actions?: ItemAction[];
}

/** Where the menu was opened, and on what. */
interface MenuState {
  item: string;
  x: number;
  y: number;
}

function ItemList({
  items,
  selectedItem,
  onSelect,
  emptyMessage,
  className,
  actions,
}: ItemListProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  // The list this menu was opened over can be replaced under it — a reload, another database —
  // and an entry then acts on something no longer there.
  useEffect(() => {
    setMenu((open) => (open && items.includes(open.item) ? open : null));
  }, [items]);

  useEffect(() => {
    if (menu === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menu]);

  const hasMenu = actions !== undefined && actions.length > 0;

  return (
    <div className={`${styles.list}${className ? ` ${className}` : ""}`}>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <button
              type="button"
              className={`${styles.item}${item === selectedItem ? ` ${styles.itemActive}` : ""}`}
              onClick={() => onSelect(item)}
              onContextMenu={
                hasMenu
                  ? (e) => {
                      e.preventDefault();
                      setMenu({ item, x: e.clientX, y: e.clientY });
                    }
                  : undefined
              }
            >
              {item}
            </button>
          </li>
        ))}
        {items.length === 0 && emptyMessage && <li className={`muted ${styles.empty}`}>{emptyMessage}</li>}
      </ul>
      {/* Out at the body, so the sidebar's own scrolling has nothing to clip it against. */}
      {menu !== null &&
        actions !== undefined &&
        createPortal(
          <>
            <div
              className="context-menu-overlay"
              onClick={() => setMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(null);
              }}
            />
            <div className="context-menu" style={{ top: menu.y, left: menu.x }}>
              {actions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className={action.danger ? "context-menu-delete" : undefined}
                  onClick={() => {
                    setMenu(null);
                    action.onSelect(menu.item);
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

export default ItemList;
