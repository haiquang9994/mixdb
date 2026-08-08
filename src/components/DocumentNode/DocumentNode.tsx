import { useEffect, useRef, useState } from "react";
import Select from "../Select";
import Input from "../Input";
import { useTranslation, type TranslationKey } from "../../i18n";
import {
  CREATABLE_TYPES,
  isContainerKind,
  isEditableKind,
  isWrapper,
  kindOf,
  type BsonKind,
  type CreatableType,
  type TypedValue,
  type TypedWrapper,
} from "../../mongo/bsonTypes";
import styles from "./DocumentNode.module.css";

const CHILDREN_PREVIEW_COUNT = 5;
const MAX_DEPTH = 12;
const INDENT_PX = 16;

// CreatableType's underlying BsonTypeTag technically also covers the exotic
// read-only tags (MinKey/MaxKey/Undefined/DbPointer/JavaScriptWithScope);
// the editor never programmatically produces those (CREATABLE_TYPES and the
// isEditableKind gate both exclude them), but draftToValue still needs a
// fallback arm for TS exhaustiveness.
type EditableType = CreatableType;

const BADGE_TEXT: Record<BsonKind, string> = {
  ObjectId: "ObjectId",
  Int32: "I32",
  Int64: "I64",
  Double: "Dbl",
  Decimal128: "Dec128",
  Date: "Date",
  Binary: "Bin",
  RegExp: "RegExp",
  Timestamp: "Ts",
  MinKey: "MinKey",
  MaxKey: "MaxKey",
  JavaScript: "JS",
  JavaScriptWithScope: "JSscope",
  Symbol: "Sym",
  Undefined: "Undef",
  DbPointer: "DBRef",
  String: "Str",
  Boolean: "Bool",
  Null: "Null",
  Array: "Arr",
  Object: "Obj",
};

const TYPE_LABEL_KEY: Record<BsonKind, TranslationKey> = {
  ObjectId: "noSqlTable.typeLabel.objectId",
  Int32: "noSqlTable.typeLabel.int32",
  Int64: "noSqlTable.typeLabel.int64",
  Double: "noSqlTable.typeLabel.double",
  Decimal128: "noSqlTable.typeLabel.decimal128",
  Date: "noSqlTable.typeLabel.date",
  Binary: "noSqlTable.typeLabel.binary",
  RegExp: "noSqlTable.typeLabel.regExp",
  Timestamp: "noSqlTable.typeLabel.timestamp",
  MinKey: "noSqlTable.typeLabel.minKey",
  MaxKey: "noSqlTable.typeLabel.maxKey",
  JavaScript: "noSqlTable.typeLabel.javaScript",
  JavaScriptWithScope: "noSqlTable.typeLabel.javaScriptWithScope",
  Symbol: "noSqlTable.typeLabel.symbol",
  Undefined: "noSqlTable.typeLabel.undefined",
  DbPointer: "noSqlTable.typeLabel.dbPointer",
  String: "noSqlTable.typeLabel.string",
  Boolean: "noSqlTable.typeLabel.boolean",
  Null: "noSqlTable.typeLabel.null",
  Array: "noSqlTable.typeLabel.array",
  Object: "noSqlTable.typeLabel.object",
};

function containerCount(v: TypedValue): number {
  if (Array.isArray(v)) return v.length;
  if (v !== null && typeof v === "object") return Object.keys(v).length;
  return 0;
}

function badgeText(kind: BsonKind, value: TypedValue): string {
  if (kind === "Array") return `${BADGE_TEXT.Array}[${containerCount(value)}]`;
  if (kind === "Object") return `${BADGE_TEXT.Object}{${containerCount(value)}}`;
  return BADGE_TEXT[kind];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

interface Draft {
  type: EditableType;
  text: string;
  bool: boolean;
  base64: string;
  subType: string;
  pattern: string;
  options: string;
  t: string;
  i: string;
}

function emptyDraft(type: EditableType): Draft {
  return { type, text: "", bool: false, base64: "", subType: "0", pattern: "", options: "", t: "0", i: "0" };
}

function draftFromValue(value: TypedValue): Draft {
  const kind = kindOf(value);
  const base = emptyDraft(kind as EditableType);
  switch (kind) {
    case "String":
      return { ...base, text: value as string };
    case "Boolean":
      return { ...base, bool: value as boolean };
    case "Int32":
    case "Int64":
    case "Double":
    case "Decimal128":
    case "ObjectId":
    case "JavaScript":
    case "Symbol":
      return { ...base, text: String((value as TypedWrapper).$value) };
    case "Date": {
      const d = new Date(String((value as TypedWrapper).$value));
      return { ...base, text: Number.isNaN(d.getTime()) ? "" : toDatetimeLocalValue(d) };
    }
    case "Binary": {
      const v = (value as TypedWrapper).$value as { base64: string; subType: number };
      return { ...base, base64: v.base64, subType: String(v.subType) };
    }
    case "RegExp": {
      const v = (value as TypedWrapper).$value as { pattern: string; options: string };
      return { ...base, pattern: v.pattern, options: v.options };
    }
    case "Timestamp": {
      const v = (value as TypedWrapper).$value as { t: number; i: number };
      return { ...base, t: String(v.t), i: String(v.i) };
    }
    default:
      return base;
  }
}

function draftToValue(draft: Draft): { ok: true; value: TypedValue } | { ok: false; error: string } {
  switch (draft.type) {
    case "String":
      return { ok: true, value: draft.text };
    case "Boolean":
      return { ok: true, value: draft.bool };
    case "Null":
      return { ok: true, value: null };
    case "Array":
      return { ok: true, value: [] };
    case "Object":
      return { ok: true, value: {} };
    case "Int32": {
      const n = Number(draft.text);
      if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) return { ok: false, error: "Invalid Int32" };
      return { ok: true, value: { $type: "Int32", $value: n } };
    }
    case "Int64": {
      if (!/^-?\d+$/.test(draft.text.trim())) return { ok: false, error: "Invalid Int64" };
      return { ok: true, value: { $type: "Int64", $value: draft.text.trim() } };
    }
    case "Double": {
      const n = Number(draft.text);
      if (Number.isNaN(n)) return { ok: false, error: "Invalid Double" };
      return { ok: true, value: { $type: "Double", $value: n } };
    }
    case "Decimal128": {
      if (draft.text.trim() === "") return { ok: false, error: "Invalid Decimal128" };
      return { ok: true, value: { $type: "Decimal128", $value: draft.text.trim() } };
    }
    case "Date": {
      const d = new Date(draft.text);
      if (Number.isNaN(d.getTime())) return { ok: false, error: "Invalid Date" };
      return { ok: true, value: { $type: "Date", $value: d.toISOString() } };
    }
    case "ObjectId": {
      if (!/^[0-9a-fA-F]{24}$/.test(draft.text.trim())) return { ok: false, error: "Invalid ObjectId (24 hex chars)" };
      return { ok: true, value: { $type: "ObjectId", $value: draft.text.trim() } };
    }
    case "Binary": {
      const subType = Number(draft.subType);
      if (!Number.isInteger(subType) || subType < 0 || subType > 255) return { ok: false, error: "Invalid subType (0-255)" };
      return { ok: true, value: { $type: "Binary", $value: { base64: draft.base64, subType } } };
    }
    case "RegExp":
      return { ok: true, value: { $type: "RegExp", $value: { pattern: draft.pattern, options: draft.options } } };
    case "Timestamp": {
      const tVal = Number(draft.t);
      const iVal = Number(draft.i);
      if (!Number.isInteger(tVal) || !Number.isInteger(iVal)) return { ok: false, error: "Invalid Timestamp" };
      return { ok: true, value: { $type: "Timestamp", $value: { t: tVal, i: iVal } } };
    }
    case "JavaScript":
      return { ok: true, value: { $type: "JavaScript", $value: draft.text } };
    case "Symbol":
      return { ok: true, value: { $type: "Symbol", $value: draft.text } };
    default:
      return { ok: false, error: `Unsupported type: ${draft.type}` };
  }
}

export interface ValueEditorProps {
  initialValue: TypedValue;
  onCommit: (value: TypedValue) => void;
  onCancel: () => void;
  /** Hides the confirm/cancel buttons; clicking outside the editor commits the current draft instead. */
  autoCommit?: boolean;
}

/** Type-aware value editor (BSON type selector + matching input) shared by
 * DocumentNode's own scalar/add-child editing and NoSqlTable's root-level
 * "add property" row — reused rather than re-implemented there, since it's
 * a substantial piece of type-dispatch logic, not a trivial form. */
export function ValueEditor({ initialValue, onCommit, onCancel, autoCommit }: ValueEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => draftFromValue(initialValue));
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The type <Select> renders its option list through a React portal (to
  // document.body), so clicking an option isn't DOM-contained within
  // rootRef. Track pointerdown targets ourselves so picking a type doesn't
  // register as "clicked outside" and prematurely auto-commit the draft.
  const pointerInsideRef = useRef(false);

  const initialKind = kindOf(initialValue);
  const typeOptions: EditableType[] = CREATABLE_TYPES.includes(initialKind as CreatableType)
    ? CREATABLE_TYPES
    : [...CREATABLE_TYPES, initialKind as EditableType];

  useEffect(() => {
    if (!autoCommit) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      const insideRoot = !!target && !!rootRef.current?.contains(target);
      const insidePortalMenu = target instanceof Element && !!target.closest('[role="listbox"]');
      pointerInsideRef.current = insideRoot || insidePortalMenu;
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [autoCommit]);

  function commit() {
    const result = draftToValue(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCommit(result.value);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!autoCommit) return;
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    if (pointerInsideRef.current) return;
    commit();
  }

  return (
    <div ref={rootRef} className={styles.editor} onKeyDown={handleKeyDown} onBlur={handleBlur}>
      <Select
        size="small"
        value={draft.type}
        onChange={(next) => setDraft({ ...emptyDraft(next), text: next === draft.type ? draft.text : "" })}
        options={typeOptions.map((opt) => ({ value: opt, label: t(TYPE_LABEL_KEY[opt as BsonKind]) }))}
      />
      {(draft.type === "String" ||
        draft.type === "Int32" ||
        draft.type === "Int64" ||
        draft.type === "Double" ||
        draft.type === "Decimal128" ||
        draft.type === "ObjectId" ||
        draft.type === "JavaScript" ||
        draft.type === "Symbol") && (
        <Input
          size="small"
          autoFocus
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          className={styles.editorInput}
        />
      )}
      {draft.type === "Boolean" && (
        <label className={styles.checkboxLabel}>
          <input type="checkbox" checked={draft.bool} onChange={(e) => setDraft({ ...draft, bool: e.target.checked })} />
        </label>
      )}
      {draft.type === "Date" && (
        <Input
          size="small"
          type="datetime-local"
          step={1}
          autoFocus
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
      )}
      {draft.type === "Binary" && (
        <>
          <Input
            size="small"
            placeholder="base64"
            autoFocus
            value={draft.base64}
            onChange={(e) => setDraft({ ...draft, base64: e.target.value })}
            className={styles.editorInput}
          />
          <Input
            size="small"
            type="number"
            min={0}
            max={255}
            value={draft.subType}
            onChange={(e) => setDraft({ ...draft, subType: e.target.value })}
            className={styles.editorNarrow}
          />
        </>
      )}
      {draft.type === "RegExp" && (
        <>
          <Input
            size="small"
            placeholder="pattern"
            autoFocus
            value={draft.pattern}
            onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
            className={styles.editorInput}
          />
          <Input
            size="small"
            placeholder="options"
            value={draft.options}
            onChange={(e) => setDraft({ ...draft, options: e.target.value })}
            className={styles.editorNarrow}
          />
        </>
      )}
      {draft.type === "Timestamp" && (
        <>
          <Input
            size="small"
            type="number"
            placeholder="t"
            autoFocus
            value={draft.t}
            onChange={(e) => setDraft({ ...draft, t: e.target.value })}
            className={styles.editorNarrow}
          />
          <Input
            size="small"
            type="number"
            placeholder="i"
            value={draft.i}
            onChange={(e) => setDraft({ ...draft, i: e.target.value })}
            className={styles.editorNarrow}
          />
        </>
      )}
      {!autoCommit && (
        <>
          <button type="button" className={styles.editorConfirm} onClick={commit} title={t("noSqlTable.confirmAdd")}>
            ✓
          </button>
          <button type="button" className={styles.editorCancel} onClick={onCancel} title={t("noSqlTable.cancelAdd")}>
            ✕
          </button>
        </>
      )}
      {error && <span className={styles.editorError}>{error}</span>}
    </div>
  );
}

/** Blurs whatever editor input is currently focused so it runs its own commit path
 * (ValueEditor's auto-commit / the rename input's onBlur) before the caller moves the
 * inline editor elsewhere. Without this the open input is unmounted by the switch
 * before it can ever fire blur, silently dropping what was typed in it. */
function blurActiveEditor() {
  const el = document.activeElement;
  if (el instanceof HTMLElement && el !== document.body) el.blur();
}

export type DocumentEditMode = "value" | "rename";

export interface DocumentNodeProps {
  path: string[];
  propKey: string;
  value: TypedValue;
  parentKind: "object" | "array";
  readOnly?: boolean;
  depth: number;
  /** Whether the whole document this node belongs to is in edit mode. */
  documentEditing: boolean;
  /** Dotted path of the field currently showing an inline editor within this document, if any. */
  activeEditPath: string | null;
  activeEditMode: DocumentEditMode | null;
  /** Dotted paths within this document marked for deletion, pending Save. */
  deletedPaths: Set<string>;
  /** Fired on double-clicking a non-renameable, non-editable key (e.g. an array index over a
   * nested container) — no field can be activated, so callers may leave this a no-op. */
  onRequestEdit: () => void;
  /** Switches the whole document into edit mode (if needed) and moves the inline editor to this field. */
  onActivateEdit: (path: string[], mode: DocumentEditMode) => void;
  /** Closes the inline editor at `path`/`mode` for this document — a no-op if the
   * document has since switched to editing a different field. */
  onFinishEdit: (path: string[], mode: DocumentEditMode) => void;
  /** Toggles whether this prop is marked for deletion (actual removal happens on Save). */
  onToggleDelete: (path: string[]) => void;
  onSetValue: (path: string[], value: TypedValue) => void;
  onRenameProp: (path: string[], newKey: string) => void;
  onAddChild: (parentPath: string[], key: string | undefined, value: TypedValue) => void;
}

function DocumentNode({
  path,
  propKey,
  value,
  parentKind,
  readOnly,
  depth,
  documentEditing,
  activeEditPath,
  activeEditMode,
  deletedPaths,
  onRequestEdit,
  onActivateEdit,
  onFinishEdit,
  onToggleDelete,
  onSetValue,
  onRenameProp,
  onAddChild,
}: DocumentNodeProps) {
  const { t } = useTranslation();
  const kind = kindOf(value);
  const container = isContainerKind(kind);
  const count = container ? containerCount(value) : 0;
  const [expanded, setExpanded] = useState(count <= CHILDREN_PREVIEW_COUNT);
  const [renameDraft, setRenameDraft] = useState(propKey);
  const [addingChild, setAddingChild] = useState(false);
  const [newChildKey, setNewChildKey] = useState("");
  // Enter commits and Escape cancels synchronously, unmounting the rename
  // input; guards a same-tick blur (fired as the input leaves the DOM) from
  // re-committing against a path that was already renamed.
  const renameCommittedRef = useRef(false);

  if (depth > MAX_DEPTH) {
    return (
      <div className={styles.row} style={{ paddingLeft: depth * INDENT_PX }}>
        <span className={styles.key}>{propKey}</span>
        <span className={styles.badgeReadOnly}>{t("noSqlTable.maxDepthReached")}</span>
      </div>
    );
  }

  const pathStr = path.join(".");
  const marked = deletedPaths.has(pathStr);
  const editingValue = documentEditing && !marked && activeEditPath === pathStr && activeEditMode === "value";
  const renaming = documentEditing && !marked && activeEditPath === pathStr && activeEditMode === "rename";

  function commitRename() {
    if (renameCommittedRef.current) return;
    renameCommittedRef.current = true;
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== propKey) onRenameProp(path, trimmed);
    onFinishEdit(path, "rename");
  }

  function startRenaming() {
    renameCommittedRef.current = false;
    setRenameDraft(propKey);
    onActivateEdit(path, "rename");
  }

  function renderChildren() {
    const entries: Array<{ key: string; childPath: string[]; childValue: TypedValue }> = Array.isArray(value)
      ? value.map((v, i) => ({ key: String(i), childPath: [...path, String(i)], childValue: v }))
      : Object.entries(value as Record<string, TypedValue>).map(([k, v]) => ({
          key: k,
          childPath: [...path, k],
          childValue: v,
        }));
    const visible = expanded ? entries : entries.slice(0, CHILDREN_PREVIEW_COUNT);
    const hiddenCount = entries.length - visible.length;
    const childParentKind: "object" | "array" = Array.isArray(value) ? "array" : "object";

    return (
      <div className={styles.children}>
        {visible.map((entry) => (
          <DocumentNode
            key={entry.key}
            path={entry.childPath}
            propKey={entry.key}
            value={entry.childValue}
            parentKind={childParentKind}
            // A read-only container (currently only the root `_id` field)
            // makes its whole subtree read-only — mutating a nested part of
            // a compound _id is just as forbidden as replacing _id itself.
            readOnly={readOnly}
            depth={depth + 1}
            documentEditing={documentEditing}
            activeEditPath={activeEditPath}
            activeEditMode={activeEditMode}
            deletedPaths={deletedPaths}
            onRequestEdit={onRequestEdit}
            onActivateEdit={onActivateEdit}
            onFinishEdit={onFinishEdit}
            onToggleDelete={onToggleDelete}
            onSetValue={onSetValue}
            onRenameProp={onRenameProp}
            onAddChild={onAddChild}
          />
        ))}
        {hiddenCount > 0 && (
          <button type="button" className={styles.showMore} style={{ paddingLeft: (depth + 1) * INDENT_PX }} onClick={() => setExpanded(true)}>
            {t("noSqlTable.showMore", { n: hiddenCount })}
          </button>
        )}
        {expanded && entries.length > CHILDREN_PREVIEW_COUNT && (
          <button type="button" className={styles.showMore} style={{ paddingLeft: (depth + 1) * INDENT_PX }} onClick={() => setExpanded(false)}>
            {t("noSqlTable.collapse")}
          </button>
        )}
        {!readOnly &&
          !marked &&
          (addingChild ? (
            <div className={styles.addRow} style={{ paddingLeft: (depth + 1) * INDENT_PX }}>
              {childParentKind === "object" && (
                <Input
                  size="small"
                  autoFocus
                  placeholder={t("noSqlTable.propertyNamePlaceholder")}
                  value={newChildKey}
                  onChange={(e) => setNewChildKey(e.target.value)}
                  className={styles.editorInput}
                />
              )}
              <ValueEditor
                initialValue=""
                onCommit={(v) => {
                  if (childParentKind === "object" && !newChildKey.trim()) return;
                  onAddChild(path, childParentKind === "object" ? newChildKey.trim() : undefined, v);
                  setAddingChild(false);
                  setNewChildKey("");
                  setExpanded(true);
                }}
                onCancel={() => {
                  setAddingChild(false);
                  setNewChildKey("");
                }}
              />
            </div>
          ) : (
            <button type="button" className={styles.addButton} style={{ paddingLeft: (depth + 1) * INDENT_PX }} onClick={() => setAddingChild(true)}>
              + {childParentKind === "object" ? t("noSqlTable.addProperty") : t("noSqlTable.addItem")}
            </button>
          ))}
      </div>
    );
  }

  return (
    <div className={styles.node}>
      <div className={styles.row} style={{ paddingLeft: depth * INDENT_PX }}>
        {renaming ? (
          <Input
            size="small"
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") {
                renameCommittedRef.current = true;
                onFinishEdit(path, "rename");
              }
            }}
            onBlur={commitRename}
            className={styles.editorInput}
          />
        ) : (
          <span
            className={styles.key}
            tabIndex={-1}
            onMouseDown={(e) => {
              // Uses mousedown (not click) so the switch is decided while the pointer is
              // still over this row — committing the previously open input reflows the
              // rows, and a click event fired after that reflow can miss its target.
              if (!documentEditing || readOnly || marked || parentKind !== "object") return;
              // mousedown's default action focuses its target; that target is this span,
              // which the switch is about to replace with an input. Letting it run would
              // yank focus off the freshly auto-focused input and blur it straight back shut.
              e.preventDefault();
              blurActiveEditor();
              startRenaming();
            }}
            onDoubleClick={() => {
              if (readOnly || marked) return;
              if (parentKind === "object") startRenaming();
              else if (!container && isEditableKind(kind)) onActivateEdit(path, "value");
              else onRequestEdit();
            }}
          >
            {parentKind === "array" ? `[${propKey}]` : propKey}
            {readOnly && <span className={styles.lock} title={t("noSqlTable.idReadOnlyTooltip")}>🔒</span>}
          </span>
        )}
        <span
          className={isEditableKind(kind) ? styles.badge : styles.badgeReadOnly}
          title={t(TYPE_LABEL_KEY[kind])}
        >
          {badgeText(kind, value)}
        </span>

        {!container && editingValue && !readOnly && isEditableKind(kind) ? (
          <ValueEditor
            initialValue={value}
            autoCommit
            onCommit={(v) => {
              onSetValue(path, v);
              onFinishEdit(path, "value");
            }}
            onCancel={() => onFinishEdit(path, "value")}
          />
        ) : (
          !container && (
            <span
              className={marked ? `${styles.value} ${styles.markedForDeletion}` : styles.value}
              tabIndex={-1}
              onMouseDown={(e) => {
                // Uses mousedown (not click) so the switch — including from this same
                // node's rename input — is decided while the pointer is still over this
                // row; committing the previously open input reflows the rows, and a click
                // event fired after that reflow can miss its target.
                if (!documentEditing || readOnly || marked || !isEditableKind(kind)) return;
                // See the key span above: without this the browser's post-mousedown focus
                // lands on this (already replaced) span and closes the new editor at once.
                e.preventDefault();
                blurActiveEditor();
                onActivateEdit(path, "value");
              }}
              onDoubleClick={() => {
                if (readOnly || marked || !isEditableKind(kind)) return;
                onActivateEdit(path, "value");
              }}
            >
              {kind === "Null" ? t("noSqlTable.typeLabel.null") : displayScalar(value)}
            </span>
          )
        )}

        {!readOnly && (
          <button
            type="button"
            className={
              marked
                ? `${styles.iconButton} ${styles.deleteMarked}`
                : documentEditing
                  ? styles.iconButton
                  : `${styles.iconButton} ${styles.hoverOnly}`
            }
            title={marked ? t("noSqlTable.undoDeleteProperty") : t("noSqlTable.deleteProperty")}
            onClick={() => onToggleDelete(path)}
          >
            🗑
          </button>
        )}
      </div>
      {container && renderChildren()}
    </div>
  );
}

function displayScalar(value: TypedValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (isWrapper(value)) {
    if (typeof value.$value === "object" && value.$value !== null) return JSON.stringify(value.$value);
    return String(value.$value);
  }
  return String(value);
}

export default DocumentNode;
