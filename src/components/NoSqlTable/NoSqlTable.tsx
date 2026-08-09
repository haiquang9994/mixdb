import { useCallback, useEffect, useRef, useState } from "react";
import { mongoCollectionPage, mongoDeleteDocument, mongoUpdateDocument, type DocUpdateOps } from "../../mongo/api";
import type { TypedDocument, TypedValue } from "../../mongo/bsonTypes";
import ActionBar from "../ActionBar";
import Document from "../Document";
import LoadingOverlay from "../LoadingOverlay";
import Pagination from "../Pagination";
import { ReloadIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import styles from "./NoSqlTable.module.css";

interface Props {
  connectionId: string;
  selectedDb: string;
  selectedCollection: string;
  onError: (message: string) => void;
  layoutWidth?: number;
}

/** Where a loaded page came from. Held in state rather than read off the props, so the write
 * helpers stay bound to the collection the documents on screen were fetched from — the props
 * already carry the newly selected collection while the old cards are still mounted. */
interface Target {
  connectionId: string;
  database: string;
  collection: string;
}

const DOC_PAGE_SIZES = [20, 50, 100, 200];

/** A page of a collection, one Document card per row.
 *
 * This component is the only thing here that talks to the database: it fetches a page, and
 * it performs every write a card asks for, reporting the errors and showing the progress.
 * What a card has changed but not yet written — the working copy, the staged edits, the open
 * inline editor — belongs to Document. Cards only hand back a document id and the ops to
 * apply, plus a "save what you have staged" hook so a refetch can wait for them. */
function NoSqlTable({ connectionId, selectedDb, selectedCollection, onError }: Props) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [documents, setDocuments] = useState<TypedDocument[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // Counted rather than a flag: a Save and a rename can overlap, and the last one to finish
  // is what should clear the indicator.
  const [writeCount, setWriteCount] = useState(0);
  // Bumped on every load and folded into each card's key, so cards remount and rebuild
  // themselves from the new data rather than carrying the previous page's state into it.
  const [loadId, setLoadId] = useState(0);

  const flushersRef = useRef<Set<() => Promise<void>>>(new Set());

  /** Called by each card on mount; returns its own unregister function. */
  const registerFlush = useCallback((flush: () => Promise<void>) => {
    flushersRef.current.add(flush);
    return () => {
      flushersRef.current.delete(flush);
    };
  }, []);

  const flushAll = useCallback(async () => {
    await Promise.all(Array.from(flushersRef.current, (flush) => flush()));
  }, []);

  useEffect(() => {
    setPage(0);
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
        // One batched update, so `target` can never describe a different collection than the
        // documents rendered alongside it.
        setDocuments(result.documents);
        setTarget({ connectionId, database: selectedDb, collection: selectedCollection });
        setTotal(result.total);
        setLoadId((n) => n + 1);
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

  /** Applies one card's ops to its document. Resolves to whether the write landed, so the
   * card knows to adopt its edits or roll them back; the error itself is reported here. */
  const writeDocument = useCallback(
    async (id: TypedValue, ops: DocUpdateOps): Promise<boolean> => {
      if (!target) return false;
      setWriteCount((n) => n + 1);
      try {
        await mongoUpdateDocument(target.connectionId, target.database, target.collection, id, ops);
        return true;
      } catch (e) {
        onError(String(e));
        return false;
      } finally {
        setWriteCount((n) => n - 1);
      }
    },
    [target, onError],
  );

  const removeDocument = useCallback(
    async (id: TypedValue): Promise<boolean> => {
      if (!target) return false;
      // Deleting refetches the page, which replaces every card: give the others a chance to
      // write out what they have staged first. The card being deleted opts itself out.
      await flushAll();
      setWriteCount((n) => n + 1);
      try {
        await mongoDeleteDocument(target.connectionId, target.database, target.collection, id);
        loadPage();
        return true;
      } catch (e) {
        onError(String(e));
        return false;
      } finally {
        setWriteCount((n) => n - 1);
      }
    },
    [target, flushAll, loadPage, onError],
  );

  /** Runs `action` once every card has written out its staged edits. Costs nothing when
   * nothing is staged — a card with no pending changes returns before it hits the network. */
  const flushThen = useCallback(
    (action: () => void) => {
      // A failed write is already reported by writeDocument; whatever else could surface here
      // must not leave the list stuck on a page the user has moved away from.
      flushAll()
        .catch((e) => onError(String(e)))
        .finally(action);
    },
    [flushAll, onError],
  );

  const busy = loading || writeCount > 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={styles.noSqlTable}>
      <div className={styles.scrollWrap}>
        <div className={styles.scroll}>
          {documents.length === 0 && !loading && <p className="muted">{t("noSqlTable.noDocuments")}</p>}
          {documents.map((doc, i) => (
            <Document
              key={`${loadId}:${i}`}
              doc={doc}
              displayNumber={page * pageSize + i + 1}
              registerFlush={registerFlush}
              onWrite={writeDocument}
              onDelete={removeDocument}
            />
          ))}
        </div>
        {busy && <LoadingOverlay label={loading ? t("noSqlTable.loading") : t("noSqlTable.saving")} />}
      </div>
      <div className={styles.footer}>
        <ActionBar
          actions={[
            {
              key: "reload",
              icon: ReloadIcon,
              label: t("noSqlTable.reloadDocuments"),
              disabled: busy,
              busy,
              // Same as changing page: whatever the cards have staged is written out before the
              // refetch replaces them.
              onClick: () => flushThen(loadPage),
            },
          ]}
        />
        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
          pageSizeOptions={DOC_PAGE_SIZES}
          loading={busy}
          onPageChange={(next) => flushThen(() => setPage(next))}
          onPageSizeChange={(n) =>
            flushThen(() => {
              setPageSize(n);
              setPage(0);
            })
          }
        />
      </div>
    </div>
  );
}

export default NoSqlTable;
