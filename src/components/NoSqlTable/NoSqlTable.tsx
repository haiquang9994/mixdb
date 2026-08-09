import { useCallback, useEffect, useRef, useState } from "react";
import {
  mongoCollectionPage,
  mongoDeleteDocument,
  mongoInsertDocuments,
  mongoNextIds,
  mongoUpdateDocument,
  type DocUpdateOps,
} from "../../mongo/api";
import type { TypedDocument, TypedValue } from "../../mongo/bsonTypes";
import {
  mergeDocumentFields,
  MONGO_FILTER_OPERATORS,
  mongoOperatorArity,
  type MongoFilter,
  type MongoFilterOperator,
} from "../../mongo/filters";
import ActionBar from "../ActionBar";
import Document from "../Document";
import FilterBar from "../FilterBar";
import InsertDocumentsDialog from "../InsertDocumentsDialog";
import LoadingOverlay from "../LoadingOverlay";
import Pagination from "../Pagination";
import { PlusIcon, ReloadIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import { errorMessage } from "../../errors";
import { initialFilterRows, toQueryFilters, type FilterRow } from "../../filters";
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

/** The only field every document is guaranteed to carry, and so the one the bar can offer before
 * a page has been loaded to read any others off. */
const ID_FIELD = ["_id"];

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
  // What the insert form opens on: an empty array for a blank document, or the documents a
  // clone starts from. `null` is the form being closed.
  const [insertSeeds, setInsertSeeds] = useState<TypedDocument[] | null>(null);
  // The filter bar edits `filterRows` freely; only Apply copies them into `appliedFilters`, which
  // is what the fetch below reads. Keeping the two apart is what stops a half-typed condition
  // from reloading the list on every keystroke.
  const [filterRows, setFilterRows] = useState<FilterRow<MongoFilterOperator>[]>(() =>
    initialFilterRows(ID_FIELD, "eq"),
  );
  const [appliedFilters, setAppliedFilters] = useState<MongoFilter[]>([]);
  // What the field select offers: seeded from the collection's first page and added to by every
  // page after it, never narrowed — see `mergeDocumentFields`.
  const [fields, setFields] = useState<string[]>(ID_FIELD);

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
    // A filter names a field, and the next collection's documents need not carry one by that
    // name — the bar starts over on an empty `_id =` row, the way it opened.
    setAppliedFilters([]);
    setFilterRows(initialFilterRows(ID_FIELD, "eq"));
    // The fields build up per collection: the next one's documents are the only thing that says
    // anything about what it can be filtered on.
    setFields(ID_FIELD);
  }, [selectedDb, selectedCollection]);

  const loadPage = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    mongoCollectionPage(connectionId, selectedDb, selectedCollection, page, pageSize, appliedFilters)
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
        // Whatever these documents carry that the bar didn't know about yet is now filterable.
        setFields((known) => mergeDocumentFields(known, result.documents));
      })
      .catch((e) => onError(errorMessage(t, e)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedDb, selectedCollection, page, pageSize, appliedFilters, onError]);

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
        onError(errorMessage(t, e));
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
        onError(errorMessage(t, e));
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
        .catch((e) => onError(errorMessage(t, e)))
        .finally(action);
    },
    [flushAll, onError],
  );

  /** Runs the filter bar's rows against the collection. Like a reload, whatever the cards have
   * staged is written out first: the documents come back filtered, and a card holding unsaved
   * edits is about to be replaced. The result is a different set of documents, so the list goes
   * back to the first page — the page the user was on need not even exist under the new
   * conditions. */
  const applyFilters = useCallback(() => {
    // A new array every time on purpose: pressing Apply twice on the same conditions is a
    // request to refetch, and an equal-but-identical array would be a no-op.
    flushThen(() => {
      setAppliedFilters(toQueryFilters(filterRows, mongoOperatorArity));
      setPage(0);
    });
  }, [flushThen, filterRows]);

  /** Opens the insert form on `seeds` — an empty array for a blank document. Whatever the cards
   * have staged is written out first: the form is modal, so nothing would flush it while it is
   * up, and a clone seeded from a card should be inserted alongside the edits it was copied
   * from rather than instead of them. */
  const openInsert = useCallback(
    (seeds: TypedDocument[]) => flushThen(() => setInsertSeeds(seeds)),
    [flushThen],
  );

  // Handed to every card, so it has to keep one identity — the cards are memoized.
  const cloneDocument = useCallback((doc: TypedDocument) => openInsert([doc]), [openInsert]);

  const nextIds = useCallback(
    (count: number) => mongoNextIds(connectionId, selectedDb, selectedCollection, count),
    [connectionId, selectedDb, selectedCollection],
  );

  /** Hands the form's documents to the server. Errors are left to reject so the form can show
   * them and stay open with the drafts still in it. */
  async function submitInsert(documents: TypedDocument[]) {
    try {
      await mongoInsertDocuments(connectionId, selectedDb, selectedCollection, documents);
    } finally {
      // The insert is ordered rather than atomic, so a failure partway through still leaves the
      // documents before it written: refetch either way, and let the form report the error over
      // the page it lands on.
      loadPage();
    }
    setInsertSeeds(null);
  }

  const busy = loading || writeCount > 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={styles.noSqlTable}>
      <FilterBar
        fields={fields}
        operators={MONGO_FILTER_OPERATORS}
        defaultOperator="eq"
        operatorLabel={(op) => t(`noSqlTable.op.${op}`)}
        rows={filterRows}
        onChange={setFilterRows}
        onApply={applyFilters}
        applyDisabled={busy}
      />
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
              onClone={cloneDocument}
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
            {
              key: "insert",
              icon: PlusIcon,
              label: t("noSqlTable.insertDocuments"),
              disabled: busy,
              onClick: () => openInsert([]),
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
      {insertSeeds !== null && (
        <InsertDocumentsDialog
          collection={selectedCollection}
          seedDocs={insertSeeds}
          nextIds={nextIds}
          onCancel={() => setInsertSeeds(null)}
          onSubmit={submitInsert}
        />
      )}
    </div>
  );
}

export default NoSqlTable;
