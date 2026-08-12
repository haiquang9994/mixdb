import { useCallback, useEffect, useState } from "react";
import ContextMenu from "../ContextMenu";
import { PinIcon } from "../../icons";
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
  /**
   * An item held above the list, in reach whatever the list below is filtered down to.
   *
   * It is shown as its own row even when the list is already showing that item: the point of it is
   * that the caller sent the user here, and a row in the middle of a hundred others does not say
   * so. It takes the same menu and the same click as any other item.
   */
  pinnedItem?: string | null;
  /** The pinned row's tooltip — why it is up there, in the caller's own words. */
  pinnedHint?: string;
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
  pinnedItem = null,
  pinnedHint,
}: ItemListProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  // The list this menu was opened over can be replaced under it — a reload, another database —
  // and an entry then acts on something no longer there. The pinned row is exempt: `items` is what
  // the search box has left of the list, and the whole point of the pin is that it stays in reach
  // outside that. Judged by this list it would look gone the moment the filter no longer matched
  // it, and its menu would be closed by the next render for a table that is still there. Whether
  // the pinned name still exists at all is the caller's to answer — it is the caller that put it
  // up there — and taking the pin down closes the menu with it.
  useEffect(() => {
    setMenu((open) =>
      open && (items.includes(open.item) || open.item === pinnedItem) ? open : null,
    );
  }, [items, pinnedItem]);

  const hasMenu = actions !== undefined && actions.length > 0;

  function openMenu(e: React.MouseEvent, item: string) {
    e.preventDefault();
    setMenu({ item, x: e.clientX, y: e.clientY });
  }

  return (
    <div className={`${styles.list}${className ? ` ${className}` : ""}`}>
      {pinnedItem !== null && (
        <div className={styles.pinned}>
          <button
            type="button"
            title={pinnedHint}
            className={`${styles.item} ${styles.pinnedItem}${
              pinnedItem === selectedItem ? ` ${styles.itemActive}` : ""
            }`}
            onClick={() => onSelect(pinnedItem)}
            onContextMenu={hasMenu ? (e) => openMenu(e, pinnedItem) : undefined}
          >
            <PinIcon size="0.9em" className={styles.pinnedIcon} />
            <span className={styles.pinnedName}>{pinnedItem}</span>
          </button>
        </div>
      )}
      <ul className={styles.items}>
        {items.map((item) => (
          <li key={item}>
            <button
              type="button"
              className={`${styles.item}${item === selectedItem ? ` ${styles.itemActive}` : ""}`}
              onClick={() => onSelect(item)}
              onContextMenu={hasMenu ? (e) => openMenu(e, item) : undefined}
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
