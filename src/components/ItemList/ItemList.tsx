import { useCallback, useEffect, useState } from "react";
import ContextMenu from "../ContextMenu";
import styles from "./ItemList.module.css";

/** One entry of the menu an item opens on right-click. */
export interface ItemAction {
  /** Distinguishes this entry from the others in the menu. */
  key: string;
  label: string;
  /** Paints the entry as destructive. For actions that lose data, not merely risky ones. */
  danger?: boolean;
  /** Greys the entry out and stops it being chosen. Shown rather than hidden, so what the menu
   * offers stays the same wherever it is opened and the missing one is not read as a bug. */
  disabled?: boolean;
  /** Why it is greyed out, as the entry's tooltip — a disabled entry with no reason is a dead end. */
  disabledHint?: string;
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
  const closeMenu = useCallback(() => setMenu(null), []);

  // The list this menu was opened over can be replaced under it — a reload, another database —
  // and an entry then acts on something no longer there.
  useEffect(() => {
    setMenu((open) => (open && items.includes(open.item) ? open : null));
  }, [items]);

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
      {menu !== null && actions !== undefined && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className={action.danger ? "context-menu-delete" : undefined}
              disabled={action.disabled}
              title={action.disabled ? action.disabledHint : undefined}
              onClick={() => {
                setMenu(null);
                action.onSelect(menu.item);
              }}
            >
              {action.label}
            </button>
          ))}
        </ContextMenu>
      )}
    </div>
  );
}

export default ItemList;
