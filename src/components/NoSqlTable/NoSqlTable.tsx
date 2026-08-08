import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mongoCollectionPage, mongoDeleteDocument, mongoUpdateDocument, type DocUpdateOps } from "../../mongo/api";
import { deleteAtPath, getAtPath, renameKeyAtPath, setAtPath } from "../../mongo/docOps";
import { isWrapper, type TypedDocument, type TypedValue } from "../../mongo/bsonTypes";
import DocumentNode, { ValueEditor } from "../DocumentNode";
import Pagination from "../Pagination";
import Input from "../Input";
import { useTranslation } from "../../i18n";
import styles from "./NoSqlTable.module.css";

interface Props {
  connectionId: string;
  selectedDb: string;
  selectedCollection: string;
  onError: (message: string) => void;
  layoutWidth?: number;
}

interface PendingOps {
  set: Record<string, TypedValue>;
  originalSnapshot: TypedDocument;
}

type EditMode = "value" | "rename";

interface ActiveEdit {
  path: string;
  mode: EditMode;
}

const DOC_PAGE_SIZES = [20, 50, 100, 200];
const EMPTY_SET: Set<string> = new Set();

function collapseOpsUnderPrefix(setOps: Record<string, TypedValue>, unsetOps: Set<string>, prefix: string) {
  const dotted = `${prefix}.`;
  for (const key of Object.keys(setOps)) {
    if (key === prefix || key.startsWith(dotted)) delete setOps[key];
  }
  for (const key of Array.from(unsetOps)) {
    if (key === prefix || key.startsWith(dotted)) unsetOps.delete(key);
  }
}

/** Sorts deletion paths so array elements are removed highest-index-first,
 * keeping lower indices of the same array stable while multiple siblings
 * are being deleted in one flush. */
function comparePathsForDeletion(a: string, b: string): number {
  const aParts = a.split(".");
  const bParts = b.split(".");
  const len = Math.min(aParts.length, bParts.length);
  for (let idx = 0; idx < len; idx++) {
    if (aParts[idx] !== bParts[idx]) {
      const an = Number(aParts[idx]);
      const bn = Number(bParts[idx]);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return bn - an;
      return aParts[idx] < bParts[idx] ? -1 : 1;
    }
  }
  return bParts.length - aParts.length;
}

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

function documentMatchesQuery(doc: TypedDocument, query: string): boolean {
  if (!query) return true;
  return JSON.stringify(doc).toLowerCase().includes(query);
}

function NoSqlTable({ connectionId, selectedDb, selectedCollection, onError }: Props) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [documents, setDocuments] = useState<TypedDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [addingRootProp, setAddingRootProp] = useState<number | null>(null);
  const [newRootKey, setNewRootKey] = useState("");
  const [collapsedCards, setCollapsedCards] = useState<Set<number>>(new Set());
  const [editingCards, setEditingCards] = useState<Set<number>>(new Set());
  const [activeEdit, setActiveEdit] = useState<Map<number, ActiveEdit>>(new Map());
  const [deleteMarks, setDeleteMarks] = useState<Map<number, Set<string>>>(new Map());
  const [confirmingDeleteIndex, setConfirmingDeleteIndex] = useState<number | null>(null);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
  const [savedFlash, setSavedFlash] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");

  const pendingOpsRef = useRef<Map<number, PendingOps>>(new Map());
  const originalIdsRef = useRef<Map<number, TypedValue>>(new Map());
  const flashTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    setPage(0);
    setQuery("");
  }, [selectedDb, selectedCollection]);

  const loadPage = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    mongoCollectionPage(connectionId, selectedDb, selectedCollection, page, pageSize)
      .then((result) => {
        if (cancelled) return;
        if (result.documents.length === 0 && page > 0 && result.total > 0) {
          setPage((p) => Math.max(0, p - 1));
          return;
        }
        pendingOpsRef.current = new Map();
        originalIdsRef.current = new Map();
        result.documents.forEach((doc, i) => originalIdsRef.current.set(i, doc._id ?? null));
        setDocuments(result.documents);
        setTotal(result.total);
        setCollapsedCards(new Set());
        setEditingCards(new Set());
        setActiveEdit(new Map());
        setDeleteMarks(new Map());
        setConfirmingDeleteIndex(null);
      })
      .catch((e) => onError(String(e)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedDb, selectedCollection, page, pageSize, onError]);

  useEffect(() => loadPage(), [loadPage]);

  useEffect(() => {
    const timers = flashTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  function flashSaved(index: number) {
    setSavedFlash((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
    const existing = flashTimers.current.get(index);
    if (existing) clearTimeout(existing);
    flashTimers.current.set(
      index,
      setTimeout(() => {
        setSavedFlash((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
        flashTimers.current.delete(index);
      }, 1500),
    );
  }

  function enterEditMode(index: number) {
    setEditingCards((prev) => {
      if (prev.has(index)) return prev;
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }

  function exitEditMode(index: number) {
    setEditingCards((prev) => {
      if (!prev.has(index)) return prev;
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
    setActiveEdit((prev) => {
      if (!prev.has(index)) return prev;
      const next = new Map(prev);
      next.delete(index);
      return next;
    });
    setDeleteMarks((prev) => {
      if (!prev.has(index)) return prev;
      const next = new Map(prev);
      next.delete(index);
      return next;
    });
  }

  function activateEditAt(index: number, path: string[], mode: EditMode) {
    enterEditMode(index);
    setActiveEdit((prev) => {
      const next = new Map(prev);
      next.set(index, { path: path.join("."), mode });
      return next;
    });
  }

  function finishEdit(index: number) {
    setActiveEdit((prev) => {
      if (!prev.has(index)) return prev;
      const next = new Map(prev);
      next.delete(index);
      return next;
    });
  }

  function toggleDeleteMark(index: number, path: string[]) {
    enterEditMode(index);
    const pathStr = path.join(".");
    setDeleteMarks((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(index) ?? []);
      if (current.has(pathStr)) current.delete(pathStr);
      else current.add(pathStr);
      if (current.size === 0) next.delete(index);
      else next.set(index, current);
      return next;
    });
  }

  function ensurePending(index: number): PendingOps {
    let pending = pendingOpsRef.current.get(index);
    if (!pending) {
      pending = { set: {}, originalSnapshot: documents[index] };
      pendingOpsRef.current.set(index, pending);
    }
    enterEditMode(index);
    return pending;
  }

  function setValueAt(index: number, path: string[], value: TypedValue) {
    const pending = ensurePending(index);
    pending.set[path.join(".")] = value;
    setDocuments((prev) => prev.map((d, i) => (i === index ? (setAtPath(d, path, value) as TypedDocument) : d)));
  }

  function addChildAt(index: number, parentPath: string[], key: string | undefined, value: TypedValue) {
    const doc = documents[index];
    if (!doc) return;
    const parentValue = parentPath.length === 0 ? doc : getAtPath(doc, parentPath);
    const childPath = Array.isArray(parentValue)
      ? [...parentPath, String(parentValue.length)]
      : [...parentPath, key ?? ""];
    if (!Array.isArray(parentValue) && !key) return;
    setValueAt(index, childPath, value);
  }

  async function flushDocument(index: number) {
    const pending = pendingOpsRef.current.get(index);
    const marks = deleteMarks.get(index);
    const hasSetChanges = !!pending && Object.keys(pending.set).length > 0;
    const hasMarks = !!marks && marks.size > 0;
    if (!hasSetChanges && !hasMarks) {
      pendingOpsRef.current.delete(index);
      return;
    }
    const docId = originalIdsRef.current.get(index);
    if (docId === undefined) return;

    const originalSnapshot = pending?.originalSnapshot ?? documents[index];
    const setOps: Record<string, TypedValue> = { ...(pending?.set ?? {}) };
    const unsetOps = new Set<string>();
    let workingDoc = documents[index];

    if (marks) {
      for (const pathStr of Array.from(marks).sort(comparePathsForDeletion)) {
        const path = pathStr.split(".");
        const parentPath = path.slice(0, -1);
        const parentValue = parentPath.length === 0 ? workingDoc : getAtPath(workingDoc, parentPath);
        const newDoc = deleteAtPath(workingDoc, path) as TypedDocument;
        if (Array.isArray(parentValue)) {
          const arrayPathStr = parentPath.join(".");
          collapseOpsUnderPrefix(setOps, unsetOps, arrayPathStr);
          setOps[arrayPathStr] = getAtPath(newDoc, parentPath) ?? [];
        } else {
          delete setOps[pathStr];
          unsetOps.add(pathStr);
        }
        workingDoc = newDoc;
      }
    }

    pendingOpsRef.current.delete(index);
    const ops: DocUpdateOps = { set: setOps, unset: Array.from(unsetOps), rename: {} };
    try {
      await mongoUpdateDocument(connectionId, selectedDb, selectedCollection, docId, ops);
      setDocuments((prev) => prev.map((d, i) => (i === index ? workingDoc : d)));
      flashSaved(index);
    } catch (e) {
      onError(String(e));
      setDocuments((prev) => prev.map((d, i) => (i === index ? originalSnapshot : d)));
    }
  }

  function discardDocument(index: number) {
    const pending = pendingOpsRef.current.get(index);
    if (!pending) return;
    pendingOpsRef.current.delete(index);
    setDocuments((prev) => prev.map((d, i) => (i === index ? pending.originalSnapshot : d)));
  }

  function cancelEdit(index: number) {
    discardDocument(index);
    exitEditMode(index);
  }

  async function saveDocument(index: number) {
    await flushDocument(index);
    exitEditMode(index);
  }

  function flushAll(): Promise<void[]> {
    return Promise.all(Array.from(pendingOpsRef.current.keys()).map((index) => flushDocument(index)));
  }

  function toggleCollapse(index: number) {
    setCollapsedCards((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function deleteDocumentAt(index: number) {
    const docId = originalIdsRef.current.get(index);
    if (docId === undefined) return;
    setConfirmingDeleteIndex(null);
    pendingOpsRef.current.delete(index);
    await flushAll();
    setDeletingIndex(index);
    try {
      await mongoDeleteDocument(connectionId, selectedDb, selectedCollection, docId);
      loadPage();
    } catch (e) {
      onError(String(e));
    } finally {
      setDeletingIndex(null);
    }
  }

  useEffect(() => {
    return () => {
      void flushAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, selectedDb, selectedCollection, page, pageSize]);

  async function renameAt(index: number, path: string[], newKey: string) {
    const doc = documents[index];
    if (!doc) return;
    const original = doc;
    setDocuments((prev) => prev.map((d, i) => (i === index ? (renameKeyAtPath(d, path, newKey) as TypedDocument) : d)));
    const docId = originalIdsRef.current.get(index);
    if (docId === undefined) return;
    try {
      await mongoUpdateDocument(connectionId, selectedDb, selectedCollection, docId, {
        set: {},
        unset: [],
        rename: { [path.join(".")]: newKey },
      });
    } catch (e) {
      onError(String(e));
      setDocuments((prev) => prev.map((d, i) => (i === index ? original : d)));
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const trimmedQuery = query.trim().toLowerCase();
  const visibleIndices = useMemo(
    () => documents.map((_, i) => i).filter((i) => documentMatchesQuery(documents[i], trimmedQuery)),
    [documents, trimmedQuery],
  );

  if (loading && documents.length === 0) {
    return <p className="muted">{t("noSqlTable.loading")}</p>;
  }

  return (
    <div className={styles.noSqlTable}>
      <div className={styles.toolbar}>
        <Input
          size="small"
          className={styles.searchInput}
          placeholder={t("noSqlTable.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {trimmedQuery && documents.length > 0 && (
          <span className={styles.matchCount}>
            {t("noSqlTable.searchMatchCount", { matched: visibleIndices.length, total: documents.length })}
          </span>
        )}
      </div>
      <div className={styles.scrollWrap}>
        <div className={styles.scroll}>
          {documents.length === 0 && !loading && <p className="muted">{t("noSqlTable.noDocuments")}</p>}
          {documents.length > 0 && visibleIndices.length === 0 && (
            <p className="muted">{t("noSqlTable.noMatches")}</p>
          )}
          {visibleIndices.map((i) => {
            const doc = documents[i];
            const idValue = (doc._id ?? null) as TypedValue;
            const otherKeys = Object.keys(doc).filter((k) => k !== "_id");
            const pending = pendingOpsRef.current.get(i);
            const marks = deleteMarks.get(i);
            const pendingCount = (pending ? Object.keys(pending.set).length : 0) + (marks ? marks.size : 0);
            const collapsed = collapsedCards.has(i);
            const isEditing = editingCards.has(i);
            const active = activeEdit.get(i) ?? null;
            return (
              <div key={i} className={styles.docCard}>
                <div className={styles.docCardHeader}>
                  <button
                    type="button"
                    className={styles.collapseToggle}
                    onClick={() => toggleCollapse(i)}
                    title={collapsed ? t("noSqlTable.expandDocument") : t("noSqlTable.collapseDocument")}
                  >
                    {collapsed ? "▸" : "▾"}
                  </button>
                  <span className={styles.docIndex}>#{page * pageSize + i + 1}</span>
                  <span className={styles.docIdPreview} title={idPreviewText(idValue)}>
                    {idPreviewText(idValue)}
                  </span>
                  <div className={styles.docHeaderSpacer} />
                  {isEditing && (
                    <>
                      {pendingCount > 0 && (
                        <span className={styles.unsaved}>{t("noSqlTable.unsavedChanges", { n: pendingCount })}</span>
                      )}
                      <button type="button" className={styles.saveBtn} onClick={() => void saveDocument(i)}>
                        {t("common.save")}
                      </button>
                      <button type="button" className={styles.discardBtn} onClick={() => cancelEdit(i)}>
                        {t("noSqlTable.discardChanges")}
                      </button>
                    </>
                  )}
                  {!isEditing && savedFlash.has(i) && (
                    <span className={styles.savedFlash}>✓ {t("noSqlTable.savedFlash")}</span>
                  )}
                  {confirmingDeleteIndex === i ? (
                    <span className={styles.confirmDelete}>
                      {t("noSqlTable.confirmDeleteDocument")}
                      <button type="button" className={styles.confirmDeleteYes} onClick={() => void deleteDocumentAt(i)}>
                        {t("common.delete")}
                      </button>
                      <button
                        type="button"
                        className={styles.confirmDeleteNo}
                        onClick={() => setConfirmingDeleteIndex(null)}
                      >
                        {t("common.cancel")}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={styles.deleteDocButton}
                      disabled={deletingIndex === i}
                      title={t("noSqlTable.deleteDocument")}
                      onClick={() => setConfirmingDeleteIndex(i)}
                    >
                      🗑
                    </button>
                  )}
                </div>
                {!collapsed && (
                  <>
                    <DocumentNode
                      path={["_id"]}
                      propKey="_id"
                      value={idValue}
                      parentKind="object"
                      readOnly
                      depth={0}
                      documentEditing={isEditing}
                      activeEditPath={active?.path ?? null}
                      activeEditMode={active?.mode ?? null}
                      deletedPaths={marks ?? EMPTY_SET}
                      onRequestEdit={() => enterEditMode(i)}
                      onActivateEdit={(path, mode) => activateEditAt(i, path, mode)}
                      onFinishEdit={() => finishEdit(i)}
                      onToggleDelete={(path) => toggleDeleteMark(i, path)}
                      onSetValue={(path, value) => setValueAt(i, path, value)}
                      onRenameProp={(path, newKey) => void renameAt(i, path, newKey)}
                      onAddChild={(parentPath, key, value) => addChildAt(i, parentPath, key, value)}
                    />
                    {otherKeys.map((key) => (
                      <DocumentNode
                        key={key}
                        path={[key]}
                        propKey={key}
                        value={doc[key]}
                        parentKind="object"
                        depth={0}
                        documentEditing={isEditing}
                        activeEditPath={active?.path ?? null}
                        activeEditMode={active?.mode ?? null}
                        deletedPaths={marks ?? EMPTY_SET}
                        onRequestEdit={() => enterEditMode(i)}
                        onActivateEdit={(path, mode) => activateEditAt(i, path, mode)}
                        onFinishEdit={() => finishEdit(i)}
                        onToggleDelete={(path) => toggleDeleteMark(i, path)}
                        onSetValue={(path, value) => setValueAt(i, path, value)}
                        onRenameProp={(path, newKey) => void renameAt(i, path, newKey)}
                        onAddChild={(parentPath, key2, value) => addChildAt(i, parentPath, key2, value)}
                      />
                    ))}
                    {addingRootProp === i ? (
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
                            addChildAt(i, [], newRootKey.trim(), value);
                            setAddingRootProp(null);
                            setNewRootKey("");
                          }}
                          onCancel={() => {
                            setAddingRootProp(null);
                            setNewRootKey("");
                          }}
                        />
                      </div>
                    ) : (
                      <button type="button" className={styles.addRootButton} onClick={() => setAddingRootProp(i)}>
                        + {t("noSqlTable.addProperty")}
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
        {loading && documents.length > 0 && (
          <div className={styles.loadingOverlay}>
            <span>{t("noSqlTable.loading")}</span>
          </div>
        )}
      </div>
      <div className={styles.footer}>
        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
          pageSizeOptions={DOC_PAGE_SIZES}
          loading={loading}
          onPageChange={(next) => {
            void flushAll();
            setPage(next);
          }}
          onPageSizeChange={(n) => {
            void flushAll();
            setPageSize(n);
            setPage(0);
          }}
        />
      </div>
    </div>
  );
}

export default NoSqlTable;
