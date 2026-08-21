import { useState } from "react";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ContextMenu from "../../../../components/ContextMenu";
import { useTranslation } from "../../../../i18n";
import type { SavedHost } from "../../types";
import styles from "./SavedHostList.module.css";

interface Props {
  hosts: SavedHost[];
  /** Host đang được nạp trong form, để tô đúng dòng. */
  selectedId: string | null;
  onSelect: (host: SavedHost) => void;
  onDelete: (id: string) => void;
  /** Bỏ form về trắng — hành động trên danh sách, không phải trên một dòng nào của nó, nên nó nằm
   *  ở đầu cột chứ không trong menu của một dòng. */
  onNew: () => void;
}

/** Menu mở ở đâu, và mở trên host nào. */
interface MenuState {
  host: SavedHost;
  x: number;
  y: number;
}

/**
 * Cột host đã lưu.
 *
 * Tự vẽ chứ không dùng `ItemList`: cái đó nói lại bằng tên, mà hai host trùng tên — chuyện thường
 * với "prod" — thì không phân biệt được. Danh sách này đi theo `id`.
 */
function SavedHostList({ hosts, selectedId, onSelect, onDelete, onNew }: Props) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirming, setConfirming] = useState<SavedHost | null>(null);

  return (
    <aside className={styles.list}>
      <div className={styles.header}>
        <h3>{t("terminal.savedHosts")}</h3>
        <button type="button" className={styles.new} onClick={onNew} title={t("terminal.newHost")}>
          +<span className="visually-hidden">{t("terminal.newHost")}</span>
        </button>
      </div>

      {hosts.length === 0 ? (
        <p className={styles.empty}>{t("terminal.noHosts")}</p>
      ) : (
        <ul>
          {hosts.map((host) => (
            <li key={host.id}>
              <button
                type="button"
                className={`${styles.item}${host.id === selectedId ? ` ${styles.itemActive}` : ""}`}
                onClick={() => onSelect(host)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ host, x: e.clientX, y: e.clientY });
                }}
              >
                <strong>{host.name}</strong>
                <span className={styles.endpoint}>
                  {host.config.username}@{host.config.host}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            type="button"
            onClick={() => {
              setConfirming(menu.host);
              setMenu(null);
            }}
          >
            {t("terminal.deleteHost")}
          </button>
        </ContextMenu>
      )}

      {confirming && (
        <ConfirmDialog
          title={t("terminal.deleteHostTitle")}
          message={t("terminal.deleteHostMessage", { name: confirming.name })}
          confirmLabel={t("terminal.deleteHost")}
          danger
          onConfirm={() => {
            onDelete(confirming.id);
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </aside>
  );
}

export default SavedHostList;
