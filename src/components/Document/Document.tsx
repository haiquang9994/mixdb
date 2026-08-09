import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocUpdateOps } from "../../mongo/api";
import { deleteAtPath, getAtPath, renameKeyAtPath, setAtPath } from "../../mongo/docOps";
import { isWrapper, type TypedDocument, type TypedValue } from "../../mongo/bsonTypes";
import DocumentNode, { ValueEditor, type DocumentEditMode } from "../DocumentNode";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, DotIcon, TrashIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import styles from "./Document.module.css";

interface ActiveEdit {
  path: string;
  mode: DocumentEditMode;
}

const EMPTY_SET: Set<string> = new Set();
const NOOP = () => {};
const SAVED_FLASH_MS = 1500;

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

/** Everything staged at or under `prefix`, dropped — for when a single op covering the whole
 * branch replaces them, or the branch itself is gone. */
function withoutPrefix<T>(staged: Record<string, T>, prefix: string): Record<string, T> {
  const dotted = `${prefix}.`;
  const next: Record<string, T> = {};
  for (const key of Object.keys(staged)) {
    if (key !== prefix && !key.startsWith(dotted)) next[key] = staged[key];
  }
  return next;
}

/** The set-shaped counterpart of {@link withoutPrefix}. Always a fresh set, so callers are
 * free to keep writing to it. */
function pathsWithoutPrefix(staged: Set<string>, prefix: string): Set<string> {
  const dotted = `${prefix}.`;
  const next = new Set<string>();
  for (const key of staged) {
    if (key !== prefix && !key.startsWith(dotted)) next.add(key);
  }
  return next;
}

/** The staged op that already carries `pathStr` with it, if there is one. Staging a value
 * writes the whole subtree at that path, so an op on an ancestor subsumes anything below it —
 * and Mongo rejects an update naming both a field and a path inside it. */
function stagedAncestorOf(staged: Record<string, TypedValue>, pathStr: string): string | null {
  for (const key of Object.keys(staged)) {
    if (pathStr.startsWith(`${key}.`)) return key;
  }
  return null;
}

/** Re-keys staged ops after an item is spliced out of the array at `arrayPath`: whatever
 * pointed past the removed index moves down one. Only locally added items are ever spliced,
 * and those always sit after the ones the server sent, so this can never disturb an op
 * staged against an original item. */
function reindexStagedAfterSplice(
  staged: Record<string, TypedValue>,
  arrayPath: string,
  removedIndex: number,
): Record<string, TypedValue> {
  const prefix = `${arrayPath}.`;
  const next: Record<string, TypedValue> = {};
  for (const key of Object.keys(staged)) {
    const rest = key.startsWith(prefix) ? key.slice(prefix.length) : null;
    const dot = rest === null ? -1 : rest.indexOf(".");
    const index = rest === null ? NaN : Number(dot === -1 ? rest : rest.slice(0, dot));
    if (!Number.isInteger(index) || index <= removedIndex) {
      next[key] = staged[key];
      continue;
    }
    next[`${prefix}${index - 1}${dot === -1 ? "" : rest!.slice(dot)}`] = staged[key];
  }
  return next;
}

/** Sorts deletion paths so array elements are removed highest-index-first, keeping lower
 * indices of the same array stable while several siblings go in one flush. */
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

/** Rewrites one staged dotted key across a rename of `oldPath` to `newPath`: that path and
 * everything beneath it move, everything else stays. Returns null for keys to drop — Mongo's
 * `$rename` overwrites the field it targets, so ops staged against whatever used to sit at
 * `newPath` no longer refer to anything. */
function rewriteStagedPath(key: string, oldPath: string, newPath: string): string | null {
  if (key === oldPath) return newPath;
  if (key.startsWith(`${oldPath}.`)) return newPath + key.slice(oldPath.length);
  if (key === newPath || key.startsWith(`${newPath}.`)) return null;
  return key;
}

function remapStagedSet(
  staged: Record<string, TypedValue>,
  oldPath: string,
  newPath: string,
): Record<string, TypedValue> {
  const keys = Object.keys(staged);
  if (keys.length === 0) return staged;
  const next: Record<string, TypedValue> = {};
  for (const key of keys) {
    const moved = rewriteStagedPath(key, oldPath, newPath);
    if (moved !== null) next[moved] = staged[key];
  }
  return next;
}

function remapStagedPaths(staged: Set<string>, oldPath: string, newPath: string): Set<string> {
  if (staged.size === 0) return staged;
  const next = new Set<string>();
  for (const key of staged) {
    const moved = rewriteStagedPath(key, oldPath, newPath);
    if (moved !== null) next.add(moved);
  }
  return next.size === 0 ? EMPTY_SET : next;
}

export interface DocumentProps {
  /** The document as fetched. Read once, to seed this card's working copy — remount the
   * card (via `key`) to adopt a newly fetched version of it. */
  doc: TypedDocument;
  /** 1-based position shown in the card header, page offset already applied. */
  displayNumber: number;
  /** Hands the list a way to write out this card's staged edits before it refetches.
   * Returns the matching unregister function. */
  registerFlush: (flush: () => Promise<void>) => () => void;
  /** Asks the list to apply `ops` to this document. Resolves to whether the write landed —
   * the card adopts its edits on success and rolls them back on failure. The list owns the
   * connection, the progress indicator and the error reporting. */
  onWrite: (id: TypedValue, ops: DocUpdateOps) => Promise<boolean>;
  /** Asks the list to remove this document; it refetches the page afterwards. */
  onDelete: (id: TypedValue) => Promise<boolean>;
}

/** One MongoDB document, rendered as a card over a tree of DocumentNodes.
 *
 * The card owns everything about its document that has not been written yet: a working copy
 * of the data, the edits staged against it, and which field is being edited. It never talks
 * to the database itself — it builds the ops and hands them to the list. Value edits and
 * property deletions are staged and go out together on Save; renames are applied
 * immediately, because they move the paths everything else is keyed by. */
function Document({ doc: fetchedDoc, displayNumber, registerFlush, onWrite, onDelete }: DocumentProps) {
  const { t } = useTranslation();

  // Document data: the working copy on screen, plus what is staged against it.
  const [doc, setDoc] = useState<TypedDocument>(fetchedDoc);
  const [pendingSet, setPendingSet] = useState<Record<string, TypedValue>>({});
  const [deletedPaths, setDeletedPaths] = useState<Set<string>>(EMPTY_SET);
  // Renames go to the server the moment they are made, so unlike the rest of this state they
  // are not "pending" — this is a record of what was renamed while the card has been on screen,
  // and it lives exactly that long: a refetch remounts the card and starts it empty again.
  const [renamedPaths, setRenamedPaths] = useState<Set<string>>(EMPTY_SET);

  // View state.
  const [collapsed, setCollapsed] = useState(false);
  const [activeEdit, setActiveEdit] = useState<ActiveEdit | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [addingRoot, setAddingRoot] = useState(false);
  const [newRootKey, setNewRootKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const idRef = useRef<TypedValue>(fetchedDoc._id ?? null);
  /** The document as the server last confirmed it: the baseline an edit is diffed against,
   * and what to roll back to when a write fails. */
  const originalRef = useRef<TypedDocument>(fetchedDoc);
  // Set once this document is on its way out: its staged edits are moot, and the page-wide
  // flush that precedes the delete must not write them back moments before it lands.
  const abandonedRef = useRef(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Render-phase mirrors of the editable state. The handlers below need to read the current
  // values but must stay referentially stable, since DocumentNode is memoized and a new
  // callback identity would re-render every row in the tree.
  const docRef = useRef(doc);
  docRef.current = doc;
  const pendingSetRef = useRef(pendingSet);
  pendingSetRef.current = pendingSet;
  const deletedPathsRef = useRef(deletedPaths);
  deletedPathsRef.current = deletedPaths;
  const renamedPathsRef = useRef(renamedPaths);
  renamedPathsRef.current = renamedPaths;

  const pendingCount = Object.keys(pendingSet).length + deletedPaths.size;

  /** Splits the staged paths into the ones that add something and the ones that alter what the
   * server already holds — the two are coloured differently in the tree. Read from the same
   * baseline `setValue` diffs against, so a successful save empties both at once. */
  const { changedPaths, addedPaths } = useMemo(() => {
    const changed = new Set<string>();
    const added = new Set<string>();
    for (const key of Object.keys(pendingSet)) {
      if (getAtPath(originalRef.current, key.split(".")) === undefined) added.add(key);
      else changed.add(key);
    }
    return { changedPaths: changed, addedPaths: added };
  }, [pendingSet]);

  const idValue = (doc._id ?? null) as TypedValue;
  const otherKeys = Object.keys(doc).filter((k) => k !== "_id");
  // "Edit mode" (field click affordances, always-visible delete icons) reflects whether an
  // input is open right now — separate from "has unsaved changes", which drives Save/Discard.
  const isEditing = activeEdit !== null || addingRoot;

  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => {
      setSaved(false);
      savedTimerRef.current = null;
    }, SAVED_FLASH_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  /** Turns the staged value edits and delete marks into one set of ops and hands them up. A
   * no-op when nothing is staged, and safe to call twice — the second call sees the state
   * the first one cleared. */
  async function flush() {
    if (abandonedRef.current) return;
    if (Object.keys(pendingSet).length === 0 && deletedPaths.size === 0) return;

    let setOps: Record<string, TypedValue> = { ...pendingSet };
    let unsetOps = new Set<string>();
    let workingDoc = doc;

    for (const pathStr of Array.from(deletedPaths).sort(comparePathsForDeletion)) {
      const path = pathStr.split(".");
      const parentPath = path.slice(0, -1);
      const parentValue = parentPath.length === 0 ? workingDoc : getAtPath(workingDoc, parentPath);
      const newDoc = deleteAtPath(workingDoc, path) as TypedDocument;
      if (Array.isArray(parentValue)) {
        // $unset on an array index leaves a null hole, so rewrite the spliced array whole —
        // and drop the staged ops that pointed into the version being replaced.
        const arrayPathStr = parentPath.join(".");
        setOps = withoutPrefix(setOps, arrayPathStr);
        unsetOps = pathsWithoutPrefix(unsetOps, arrayPathStr);
        setOps[arrayPathStr] = getAtPath(newDoc, parentPath) ?? [];
      } else {
        // Whatever was staged below a field being removed goes with it: an update naming both
        // the field it unsets and a path inside it is one Mongo refuses.
        setOps = withoutPrefix(setOps, pathStr);
        unsetOps = pathsWithoutPrefix(unsetOps, pathStr);
        unsetOps.add(pathStr);
      }
      workingDoc = newDoc;
    }

    setPendingSet({});
    setDeletedPaths(EMPTY_SET);

    const ops: DocUpdateOps = { set: setOps, unset: Array.from(unsetOps), rename: {} };
    if (await onWrite(idRef.current, ops)) {
      originalRef.current = workingDoc;
      setDoc(workingDoc);
      flashSaved();
    } else {
      setDoc(originalRef.current);
    }
  }

  // `flush` closes over the current render's staged state, so the hook registered with the
  // list has to reach it through a ref rather than capture one render's version of it.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const runFlush = useCallback(() => flushRef.current(), []);

  useEffect(() => registerFlush(runFlush), [registerFlush, runFlush]);

  useEffect(() => {
    // Selecting another collection refetches without anyone flushing first, so a card on its
    // way out saves itself. Fire-and-forget: it is unmounted by the time this resolves, and
    // reporting the outcome is the list's job anyway.
    return () => {
      void flushRef.current();
    };
  }, []);

  const setValue = useCallback((path: string[], value: TypedValue) => {
    const pathStr = path.join(".");
    setPendingSet((prev) => {
      const ancestor = stagedAncestorOf(prev, pathStr);
      if (ancestor) {
        // This write lands inside a branch that is already staged whole — a property added as
        // an empty object, say, now getting its first child. Update that op in place: staging
        // the child separately would have the update name both a field and a path inside it,
        // which Mongo rejects outright.
        const relative = path.slice(ancestor.split(".").length);
        return { ...prev, [ancestor]: setAtPath(prev[ancestor], relative, value) };
      }
      const next = withoutPrefix(prev, pathStr);
      // Editing a field back to what the server already holds isn't a change worth sending.
      if (JSON.stringify(getAtPath(originalRef.current, path)) !== JSON.stringify(value)) next[pathStr] = value;
      return next;
    });
    setDoc((prev) => setAtPath(prev, path, value) as TypedDocument);
  }, []);

  /** Drops a property or item that only exists here: one added since the last save, which the
   * server has never seen. Everything it left behind goes with it — the working copy entry and
   * the staged op that would have created it — so adding and then removing something is not a
   * change at all, rather than the two it would count as if the removal were staged. */
  const removeAddedValue = useCallback((path: string[]) => {
    const pathStr = path.join(".");
    const parentPath = path.slice(0, -1);
    const parent = parentPath.length === 0 ? docRef.current : getAtPath(docRef.current, parentPath);

    setPendingSet((prev) => {
      const ancestor = stagedAncestorOf(prev, pathStr);
      if (ancestor) {
        const relative = path.slice(ancestor.split(".").length);
        return { ...prev, [ancestor]: deleteAtPath(prev[ancestor], relative) };
      }
      const next = withoutPrefix(prev, pathStr);
      if (!Array.isArray(parent)) return next;
      return reindexStagedAfterSplice(next, parentPath.join("."), Number(path[path.length - 1]));
    });
    setDeletedPaths((prev) => {
      // Nothing inside a locally added branch can carry a delete mark (this path runs instead),
      // so this only ever matters if that stops being true.
      const next = pathsWithoutPrefix(prev, pathStr);
      if (next.size === prev.size) return prev;
      return next.size === 0 ? EMPTY_SET : next;
    });
    setDoc((prev) => deleteAtPath(prev, path) as TypedDocument);
  }, []);

  const addChild = useCallback(
    (parentPath: string[], key: string | undefined, value: TypedValue) => {
      const parentValue = parentPath.length === 0 ? docRef.current : getAtPath(docRef.current, parentPath);
      // Array items are appended at the next index; object properties need a name.
      if (!Array.isArray(parentValue) && !key) return;
      const childPath = Array.isArray(parentValue)
        ? [...parentPath, String(parentValue.length)]
        : [...parentPath, key ?? ""];
      setValue(childPath, value);
    },
    [setValue],
  );

  const toggleDelete = useCallback(
    (path: string[]) => {
      // A property the server has never seen has nothing to mark: remove it outright.
      if (getAtPath(originalRef.current, path) === undefined) {
        removeAddedValue(path);
        return;
      }
      const pathStr = path.join(".");
      setDeletedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(pathStr)) next.delete(pathStr);
        else next.add(pathStr);
        // Fall back to the shared empty set so an untouched card keeps one stable identity.
        return next.size === 0 ? EMPTY_SET : next;
      });
    },
    [removeAddedValue],
  );

  const renameProp = useCallback(
    async (path: string[], newKey: string) => {
      const oldPath = path.join(".");
      // `$rename` takes a full dotted path on both sides — handing it the bare key would move
      // a nested property up to the root of the document instead of renaming it in place.
      const newPath = [...path.slice(0, -1), newKey].join(".");
      const before = {
        doc: docRef.current,
        pendingSet: pendingSetRef.current,
        deletedPaths: deletedPathsRef.current,
        renamedPaths: renamedPathsRef.current,
      };

      // Everything staged is keyed by dotted path, so a rename has to carry the staged ops
      // across with the data. Leaving them behind would make Save write the edited value to
      // the old name, recreating the property this rename just moved away from.
      setDoc(renameKeyAtPath(before.doc, path, newKey) as TypedDocument);
      setPendingSet(remapStagedSet(before.pendingSet, oldPath, newPath));
      setDeletedPaths(remapStagedPaths(before.deletedPaths, oldPath, newPath));
      // Marks already recorded move with the paths they name, same as the staged ops.
      setRenamedPaths(new Set(remapStagedPaths(before.renamedPaths, oldPath, newPath)).add(newPath));

      const ops: DocUpdateOps = { set: {}, unset: [], rename: { [oldPath]: newPath } };
      if (await onWrite(idRef.current, ops)) {
        // The server document moved, so the baseline setValue diffs against has to move too.
        originalRef.current = renameKeyAtPath(originalRef.current, path, newKey) as TypedDocument;
      } else {
        setDoc(before.doc);
        setPendingSet(before.pendingSet);
        setDeletedPaths(before.deletedPaths);
        setRenamedPaths(before.renamedPaths);
      }
    },
    [onWrite],
  );

  const activateEdit = useCallback((path: string[], mode: DocumentEditMode) => {
    setActiveEdit({ path: path.join("."), mode });
  }, []);

  /** Closes the inline editor at `path`/`mode` — a no-op once a different field has taken
   * over, so a late close can't clobber a switch that already moved the editor. */
  const finishEdit = useCallback((path: string[], mode: DocumentEditMode) => {
    const pathStr = path.join(".");
    setActiveEdit((prev) => (prev && prev.path === pathStr && prev.mode === mode ? null : prev));
  }, []);

  function closeAddRoot() {
    setAddingRoot(false);
    setNewRootKey("");
  }

  function discard() {
    setActiveEdit(null);
    setPendingSet({});
    setDeletedPaths(EMPTY_SET);
    setDoc(originalRef.current);
  }

  async function performDelete() {
    setConfirmingDelete(false);
    setDeleting(true);
    abandonedRef.current = true;
    if (!(await onDelete(idRef.current))) abandonedRef.current = false;
    setDeleting(false);
  }

  const nodeProps = useMemo(
    () => ({
      parentKind: "object" as const,
      depth: 0,
      documentEditing: isEditing,
      activeEditPath: activeEdit?.path ?? null,
      activeEditMode: activeEdit?.mode ?? null,
      deletedPaths,
      changedPaths,
      addedPaths,
      renamedPaths,
      onRequestEdit: NOOP,
      onActivateEdit: activateEdit,
      onFinishEdit: finishEdit,
      onToggleDelete: toggleDelete,
      onSetValue: setValue,
      onRenameProp: renameProp,
      onAddChild: addChild,
    }),
    [
      isEditing,
      activeEdit,
      deletedPaths,
      changedPaths,
      addedPaths,
      renamedPaths,
      activateEdit,
      finishEdit,
      toggleDelete,
      setValue,
      renameProp,
      addChild,
    ],
  );

  return (
    <div className={styles.docCard}>
      <div className={styles.docCardHeader}>
        <button
          type="button"
          className={styles.collapseToggle}
          onClick={() => setCollapsed((prev) => !prev)}
          title={collapsed ? t("noSqlTable.expandDocument") : t("noSqlTable.collapseDocument")}
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
        </button>
        <span className={styles.docIndex}>#{displayNumber}</span>
        <span className={styles.docIdPreview} title={idPreviewText(idValue)}>
          {idPreviewText(idValue)}
        </span>
        <div className={styles.docHeaderSpacer} />
        {pendingCount > 0 && (
          <>
            <span className={styles.unsaved}>
              <DotIcon />
              {t("noSqlTable.unsavedChanges", { n: pendingCount })}
            </span>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={() => {
                setActiveEdit(null);
                void flush();
              }}
            >
              {t("common.save")}
            </button>
            <button type="button" className={styles.discardBtn} onClick={discard}>
              {t("noSqlTable.discardChanges")}
            </button>
          </>
        )}
        {pendingCount === 0 && saved && (
          <span className={styles.savedFlash}>
            <CheckIcon />
            {t("noSqlTable.savedFlash")}
          </span>
        )}
        {confirmingDelete ? (
          <span className={styles.confirmDelete}>
            {t("noSqlTable.confirmDeleteDocument")}
            <button type="button" className={styles.confirmDeleteYes} onClick={() => void performDelete()}>
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
            <TrashIcon />
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
              <ValueEditor
                initialValue=""
                propertyName={{ value: newRootKey, onChange: setNewRootKey }}
                onCommit={(value) => {
                  closeAddRoot();
                  // A property nobody named was never really added: leave the document as it was.
                  if (!newRootKey.trim()) return;
                  addChild([], newRootKey.trim(), value);
                }}
                onCancel={closeAddRoot}
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

/** Memoized: with the list holding nothing per-document, a card only ever re-renders from
 * its own state — editing one document can no longer touch any of the others. */
export default memo(Document);
