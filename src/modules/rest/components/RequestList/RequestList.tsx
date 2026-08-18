import { useMemo, useState } from "react";
import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ContextMenu from "../../../../components/ContextMenu";
import Input from "../../../../components/Input";
import NameDialog from "../../../../components/NameDialog";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { shortUrl } from "../../format";
import { RECENT_LIMIT } from "../../requests";
import type { RequestLists, RestRequest } from "../../types";
import styles from "./RequestList.module.css";

interface Props {
  lists: RequestLists;
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** A request with something changed — a rename. */
  onSave: (request: RestRequest) => void;
  onDuplicate: (request: RestRequest) => void;
  onDelete: (id: string) => void;
}

interface MenuState {
  request: RestRequest;
  x: number;
  y: number;
}

/**
 * The request list: **Saved**, which is what someone chose to keep, and **Recent**, which is what
 * pasting left behind.
 *
 * Recent is empty until Phase 2 puts anything in it, and is drawn anyway: the counter is how the
 * ten-request ceiling is visible before it is hit, and an explanation reads better than a group
 * that appears out of nowhere the first time a cURL command is pasted.
 */
function RequestList({ lists, activeId, onOpen, onNew, onSave, onDuplicate, onDelete }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [openGroups, setOpenGroups] = useState({ saved: true, recent: true });
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<RestRequest | null>(null);
  const [deleting, setDeleting] = useState<RestRequest | null>(null);

  /** What a row shows: the name, else the URL cut down, else that it has neither yet. */
  const label = (request: RestRequest) =>
    request.name !== "" ? request.name : shortUrl(request.url) || t("rest.untitled");

  const match = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") return () => true;
    return (request: RestRequest) =>
      label(request).toLowerCase().includes(needle) || request.url.toLowerCase().includes(needle);
    // `label` is rebuilt each render and depends only on `t`, so the filter follows the language.
  }, [filter, t]);

  function rows(list: RestRequest[], emptyMessage: string) {
    const shown = list.filter(match);
    if (shown.length === 0) return <p className={`${styles.empty} muted`}>{emptyMessage}</p>;
    return shown.map((request) => (
      <button
        key={request.id}
        type="button"
        className={`${styles.row}${request.id === activeId ? ` ${styles.rowActive}` : ""}`}
        onClick={() => onOpen(request.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ request, x: e.clientX, y: e.clientY });
        }}
      >
        <span className={`${styles.method} ${styles[`m${request.method}`]}`}>{request.method}</span>
        <span className={styles.name}>{label(request)}</span>
      </button>
    ));
  }

  function group(key: "saved" | "recent", heading: string, list: RestRequest[], empty: string) {
    const open = openGroups[key];
    return (
      <>
        <button
          type="button"
          className={styles.groupHead}
          onClick={() => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }))}
          aria-expanded={open}
        >
          {open ? <ChevronDownIcon size="0.9em" /> : <ChevronRightIcon size="0.9em" />}
          {heading}
        </button>
        {open && rows(list, empty)}
      </>
    );
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <Button className={styles.newButton} size="small" onClick={onNew}>
            <PlusIcon size="1em" />
            {t("rest.newRequest")}
          </Button>
        </div>
        <Input
          size="small"
          value={filter}
          placeholder={t("rest.filterPlaceholder")}
          aria-label={t("rest.filterPlaceholder")}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className={styles.groups}>
        {group("saved", t("rest.saved"), lists.saved, t("rest.noSaved"))}
        {group(
          "recent",
          t("rest.recent", { n: lists.recent.length, max: RECENT_LIMIT }),
          lists.recent,
          t("rest.noRecent"),
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            type="button"
            onClick={() => {
              setRenaming(menu.request);
              setMenu(null);
            }}
          >
            {t("rest.rename")}
          </button>
          <button
            type="button"
            onClick={() => {
              onDuplicate(menu.request);
              setMenu(null);
            }}
          >
            {t("rest.duplicate")}
          </button>
          <button
            type="button"
            className="context-menu-delete"
            onClick={() => {
              // A saved request is asked about; a Recent one would not be, but nothing is in
              // Recent until Phase 2 and one branch is easier to get right than two.
              setDeleting(menu.request);
              setMenu(null);
            }}
          >
            {t("rest.delete")}
          </button>
        </ContextMenu>
      )}

      {renaming && (
        <NameDialog
          title={t("rest.renameTitle")}
          ariaLabel={t("rest.renameTitle")}
          label={t("rest.nameLabel")}
          initialName={renaming.name !== "" ? renaming.name : label(renaming)}
          emptyError={t("rest.nameEmpty")}
          submitLabel={t("rest.renameSubmit")}
          savingLabel={t("rest.renameSaving")}
          onCancel={() => setRenaming(null)}
          onSubmit={async (name) => {
            onSave({ ...renaming, name });
            setRenaming(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t("rest.deleteTitle")}
          message={t("rest.deleteMessage", { name: label(deleting) })}
          confirmLabel={t("rest.delete")}
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDelete(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

export default RequestList;
