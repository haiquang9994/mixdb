import styles from "./ItemList.module.css";

interface ItemListProps {
  items: string[];
  selectedItem?: string | null;
  onSelect: (item: string) => void;
  emptyMessage?: string;
  className?: string;
}

function ItemList({ items, selectedItem, onSelect, emptyMessage, className }: ItemListProps) {
  return (
    <div className={`${styles.list}${className ? ` ${className}` : ""}`}>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <button
              type="button"
              className={`${styles.item}${item === selectedItem ? ` ${styles.itemActive}` : ""}`}
              onClick={() => onSelect(item)}
            >
              {item}
            </button>
          </li>
        ))}
        {items.length === 0 && emptyMessage && <li className={`muted ${styles.empty}`}>{emptyMessage}</li>}
      </ul>
    </div>
  );
}

export default ItemList;
