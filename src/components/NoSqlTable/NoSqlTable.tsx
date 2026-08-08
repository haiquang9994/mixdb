import { useEffect, useRef, useState } from "react";
import { mongoCollectionPage, mongoUpdateDocument, type DocUpdateOps } from "../../mongo/api";
import { deleteAtPath, getAtPath, renameKeyAtPath, setAtPath } from "../../mongo/docOps";
import type { TypedDocument, TypedValue } from "../../mongo/bsonTypes";
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
  unset: Set<string>;
  originalSnapshot: TypedDocument;
}

const DOC_PAGE_SIZES = [20, 50, 100, 200];

function collapseArrayPendingOps(pending: PendingOps, arrayPathStr: string) {
  const prefix = `${arrayPathStr}.`;
  for (const key of Object.keys(pending.set)) {
    if (key === arrayPathStr || key.startsWith(prefix)) delete pending.set[key];
  }
  for (const key of Array.from(pending.unset)) {
    if (key === arrayPathStr || key.startsWith(prefix)) pending.unset.delete(key);
  }
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

  const pendingOpsRef = useRef<Map<number, PendingOps>>(new Map());
  const originalIdsRef = useRef<Map<number, TypedValue>>(new Map());
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    setPage(0);
  }, [selectedDb, selectedCollection]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    mongoCollectionPage(connectionId, selectedDb, selectedCollection, page, pageSize)
      .then((result) => {
        if (cancelled) return;
        pendingOpsRef.current = new Map();
        originalIdsRef.current = new Map();
        result.documents.forEach((doc, i) => originalIdsRef.current.set(i, doc._id ?? null));
        setDocuments(result.documents);
        setTotal(result.total);
      })
      .catch((e) => onError(String(e)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedDb, selectedCollection, page, pageSize, onError]);

  function ensurePending(index: number): PendingOps {
    let pending = pendingOpsRef.current.get(index);
    if (!pending) {
      pending = { set: {}, unset: new Set(), originalSnapshot: documents[index] };
      pendingOpsRef.current.set(index, pending);
    }
    return pending;
  }

  function setValueAt(index: number, path: string[], value: TypedValue) {
    const pathStr = path.join(".");
    const pending = ensurePending(index);
    pending.unset.delete(pathStr);
    pending.set[pathStr] = value;
    setDocuments((prev) => prev.map((d, i) => (i === index ? (setAtPath(d, path, value) as TypedDocument) : d)));
  }

  function deletePropAt(index: number, path: string[]) {
    const doc = documents[index];
    if (!doc) return;
    const parentPath = path.slice(0, -1);
    const parentValue = parentPath.length === 0 ? doc : getAtPath(doc, parentPath);
    const pending = ensurePending(index);
    const newDoc = deleteAtPath(doc, path) as TypedDocument;

    if (Array.isArray(parentValue)) {
      const arrayPathStr = parentPath.join(".");
      const newArray = getAtPath(newDoc, parentPath);
      collapseArrayPendingOps(pending, arrayPathStr);
      pending.set[arrayPathStr] = newArray ?? [];
    } else {
      const pathStr = path.join(".");
      delete pending.set[pathStr];
      pending.unset.add(pathStr);
    }
    setDocuments((prev) => prev.map((d, i) => (i === index ? newDoc : d)));
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
    if (!pending) return;
    if (Object.keys(pending.set).length === 0 && pending.unset.size === 0) {
      pendingOpsRef.current.delete(index);
      return;
    }
    const docId = originalIdsRef.current.get(index);
    if (docId === undefined) return;
    const ops: DocUpdateOps = { set: pending.set, unset: Array.from(pending.unset), rename: {} };
    pendingOpsRef.current.delete(index);
    try {
      await mongoUpdateDocument(connectionId, selectedDb, selectedCollection, docId, ops);
    } catch (e) {
      onError(String(e));
      setDocuments((prev) => prev.map((d, i) => (i === index ? pending.originalSnapshot : d)));
    }
  }

  function flushAll() {
    for (const index of Array.from(pendingOpsRef.current.keys())) {
      void flushDocument(index);
    }
  }

  useEffect(() => {
    return () => flushAll();
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

  function handleCardBlur(index: number, e: React.FocusEvent<HTMLDivElement>) {
    const card = cardRefs.current.get(index);
    const next = e.relatedTarget as Node | null;
    if (card && next && card.contains(next)) return;
    void flushDocument(index);
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  if (loading && documents.length === 0) {
    return <p className="muted">{t("noSqlTable.loading")}</p>;
  }

  return (
    <div className={styles.noSqlTable}>
      <div className={styles.scroll}>
        {documents.length === 0 && !loading && <p className="muted">{t("noSqlTable.noDocuments")}</p>}
        {documents.map((doc, i) => {
          const idValue = (doc._id ?? null) as TypedValue;
          const otherKeys = Object.keys(doc).filter((k) => k !== "_id");
          return (
            <div
              key={i}
              className={styles.docCard}
              ref={(el) => {
                if (el) cardRefs.current.set(i, el);
                else cardRefs.current.delete(i);
              }}
              onBlur={(e) => handleCardBlur(i, e)}
            >
              <DocumentNode
                path={["_id"]}
                propKey="_id"
                value={idValue}
                parentKind="object"
                readOnly
                depth={0}
                onSetValue={(path, value) => setValueAt(i, path, value)}
                onDeleteProp={(path) => deletePropAt(i, path)}
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
                  onSetValue={(path, value) => setValueAt(i, path, value)}
                  onDeleteProp={(path) => deletePropAt(i, path)}
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
              {(() => {
                const pending = pendingOpsRef.current.get(i);
                if (!pending) return null;
                const n = Object.keys(pending.set).length + pending.unset.size;
                return <span className={styles.unsaved}>{t("noSqlTable.unsavedChanges", { n })}</span>;
              })()}
            </div>
          );
        })}
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
            flushAll();
            setPage(next);
          }}
          onPageSizeChange={(n) => {
            flushAll();
            setPageSize(n);
            setPage(0);
          }}
        />
      </div>
    </div>
  );
}

export default NoSqlTable;
