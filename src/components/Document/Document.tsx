import { useState } from "react";
import { isWrapper, type TypedDocument, type TypedValue } from "../../mongo/bsonTypes";
import DocumentNode, { ValueEditor, type DocumentEditMode } from "../DocumentNode";
import Input from "../Input";
import { useTranslation } from "../../i18n";
import styles from "./Document.module.css";

interface ActiveEdit {
  path: string;
  mode: DocumentEditMode;
}

const EMPTY_SET: Set<string> = new Set();

function idPreviewText(idValue: TypedValue): string {
  if (idValue === null || idValue === undefined) return "null";
  if (typeof idValue === "string" || typeof idValue === "number" || typeof idValue === "boolean") {
    return String(idValue);
  }
  if (isWrapper(idValue)) {
    const v = idValue.$value;
    return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
  }
  return JSON.stringify(idValue);
}

export interface DocumentProps {
  doc: TypedDocument;
  /** 1-based position shown in the card header, page offset already applied. */
  displayNumber: number;
  /** Dotted paths staged for deletion, applied on Save. */
  deletedPaths?: Set<string>;
  /** Staged edits (value changes + delete marks); a non-zero count shows Save/Discard. */
  pendingCount: number;
  /** Shows the transient "saved" confirmation in the header. */
  saved: boolean;
  /** Disables the delete control while the document is being removed server-side. */
  deleting: boolean;
  onSetValue: (path: string[], value: TypedValue) => void;
  onRenameProp: (path: string[], newKey: string) => void;
  onAddChild: (parentPath: string[], key: string | undefined, value: TypedValue) => void;
  onToggleDelete: (path: string[]) => void;
  onSave: () => void;
  onDiscard: () => void;
  onDelete: () => void;
}

/** One MongoDB document rendered as a card: header controls plus a DocumentNode tree
 * per root property. Owns only view state (which field is being edited, collapse,
 * delete confirmation, the add-property row) — the document data, its staged edits and
 * everything that talks to the server live in the parent, which addresses documents by
 * index. Remount this component (via `key`) to reset that view state on a page load. */
function Document({
  doc,
  displayNumber,
  deletedPaths,
  pendingCount,
  saved,
  deleting,
  onSetValue,
  onRenameProp,
  onAddChild,
  onToggleDelete,
  onSave,
  onDiscard,
  onDelete,
}: DocumentProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [activeEdit, setActiveEdit] = useState<ActiveEdit | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [addingRoot, setAddingRoot] = useState(false);
  const [newRootKey, setNewRootKey] = useState("");

  const idValue = (doc._id ?? null) as TypedValue;
  const otherKeys = Object.keys(doc).filter((k) => k !== "_id");
  const marks = deletedPaths ?? EMPTY_SET;
  // "Edit mode" (field click affordances, always-visible delete icons) reflects whether a
  // prop-name/value input is actually open right now — it's separate from "has unsaved
  // changes", which drives the Save/Discard buttons.
  const isEditing = activeEdit !== null || addingRoot;

  /** Closes the inline editor at `path`/`mode` — a no-op once a different field has taken
   * over, so a late close can't clobber a switch that already moved the editor. */
  function finishEdit(path: string[], mode: DocumentEditMode) {
    const pathStr = path.join(".");
    setActiveEdit((prev) => (prev && prev.path === pathStr && prev.mode === mode ? null : prev));
  }

  const nodeProps = {
    parentKind: "object" as const,
    depth: 0,
    documentEditing: isEditing,
    activeEditPath: activeEdit?.path ?? null,
    activeEditMode: activeEdit?.mode ?? null,
    deletedPaths: marks,
    onRequestEdit: () => {},
    onActivateEdit: (path: string[], mode: DocumentEditMode) => setActiveEdit({ path: path.join("."), mode }),
    onFinishEdit: finishEdit,
    onToggleDelete,
    onSetValue,
    onRenameProp,
    onAddChild,
  };

  return (
    <div className={styles.docCard}>
      <div className={styles.docCardHeader}>
        <button
          type="button"
          className={styles.collapseToggle}
          onClick={() => setCollapsed((prev) => !prev)}
          title={collapsed ? t("noSqlTable.expandDocument") : t("noSqlTable.collapseDocument")}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span className={styles.docIndex}>#{displayNumber}</span>
        <span className={styles.docIdPreview} title={idPreviewText(idValue)}>
          {idPreviewText(idValue)}
        </span>
        <div className={styles.docHeaderSpacer} />
        {pendingCount > 0 && (
          <>
            <span className={styles.unsaved}>{t("noSqlTable.unsavedChanges", { n: pendingCount })}</span>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={() => {
                setActiveEdit(null);
                onSave();
              }}
            >
              {t("common.save")}
            </button>
            <button
              type="button"
              className={styles.discardBtn}
              onClick={() => {
                setActiveEdit(null);
                onDiscard();
              }}
            >
              {t("noSqlTable.discardChanges")}
            </button>
          </>
        )}
        {pendingCount === 0 && saved && <span className={styles.savedFlash}>✓ {t("noSqlTable.savedFlash")}</span>}
        {confirmingDelete ? (
          <span className={styles.confirmDelete}>
            {t("noSqlTable.confirmDeleteDocument")}
            <button
              type="button"
              className={styles.confirmDeleteYes}
              onClick={() => {
                setConfirmingDelete(false);
                onDelete();
              }}
            >
              {t("common.delete")}
            </button>
            <button type="button" className={styles.confirmDeleteNo} onClick={() => setConfirmingDelete(false)}>
              {t("common.cancel")}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={styles.deleteDocButton}
            disabled={deleting}
            title={t("noSqlTable.deleteDocument")}
            onClick={() => setConfirmingDelete(true)}
          >
            🗑
          </button>
        )}
      </div>
      {!collapsed && (
        <>
          <DocumentNode {...nodeProps} path={["_id"]} propKey="_id" value={idValue} readOnly />
          {otherKeys.map((key) => (
            <DocumentNode {...nodeProps} key={key} path={[key]} propKey={key} value={doc[key]} />
          ))}
          {addingRoot ? (
            <div className={styles.addRootRow}>
              <Input
                size="small"
                autoFocus
                placeholder={t("noSqlTable.propertyNamePlaceholder")}
                value={newRootKey}
                onChange={(e) => setNewRootKey(e.target.value)}
              />
              <ValueEditor
                initialValue=""
                onCommit={(value) => {
                  if (!newRootKey.trim()) return;
                  onAddChild([], newRootKey.trim(), value);
                  setAddingRoot(false);
                  setNewRootKey("");
                }}
                onCancel={() => {
                  setAddingRoot(false);
                  setNewRootKey("");
                }}
              />
            </div>
          ) : (
            <button type="button" className={styles.addRootButton} onClick={() => setAddingRoot(true)}>
              + {t("noSqlTable.addProperty")}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default Document;
