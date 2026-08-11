import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Button from "../Button";
import Input from "../Input";
import Select from "../Select";
import { useDialogExit } from "../dialogMotion";
import { MinusIcon, PlusIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import { errorMessage } from "../../errors";
import type { MysqlIndexKind, MysqlIndexSpec, MysqlTableIndex } from "../../types";
import styles from "./IndexDialog.module.css";

/** One column of the index being built. `prefixLength` is text rather than a number so a
 * half-typed value doesn't have to mean anything yet. */
interface DraftColumn {
  /** Distinguishes this row from the others while the list is being edited — two rows may well
   * name the same column before one of them is changed. */
  id: number;
  name: string;
  prefixLength: string;
}

/** Which kind of index this is, read back off one the server reported: the kind is spread across
 * three of its fields, and the dialog needs it as the single choice it is on screen. */
export function indexKind(index: MysqlTableIndex): MysqlIndexKind {
  if (index.primary) return "primary";
  const type = index.indexType.toUpperCase();
  if (type === "FULLTEXT") return "fulltext";
  if (type === "SPATIAL") return "spatial";
  return index.unique ? "unique" : "index";
}

/** The two kinds that have a choice of structure. `FULLTEXT` and `SPATIAL` have exactly one each,
 * and MySQL rejects a `USING` clause on them. */
function takesMethod(kind: MysqlIndexKind): boolean {
  return kind === "index" || kind === "unique";
}

let nextId = 0;

function draftColumns(index: MysqlTableIndex | undefined, columns: string[]): DraftColumn[] {
  if (!index) {
    return [{ id: nextId++, name: columns[0] ?? "", prefixLength: "" }];
  }
  return index.columns.map((column) => ({
    id: nextId++,
    // A functional index has no column name; such an index is not offered for editing, so this
    // only ever stands in for one the table no longer has.
    name: column.name ?? "",
    prefixLength: column.prefixLength === null ? "" : String(column.prefixLength),
  }));
}

interface Props {
  table: string;
  /** The columns available to index, in table order. */
  columns: string[];
  /** The index being replaced, or left out to add a new one. */
  index?: MysqlTableIndex;
  onCancel: () => void;
  /** Rejects with the reason the ALTER failed: the dialog then shows it and stays open with the
   *  typed values still in it. The caller is what closes the dialog, once this resolves. */
  onSubmit: (spec: MysqlIndexSpec) => Promise<void>;
}

/**
 * The form behind both halves of an index's life: adding one, and replacing one that exists.
 * MySQL cannot alter an index in place, so an edit is a drop and a rebuild — the note in the
 * dialog says so, since that is a heavier operation than the form makes it look.
 */
function IndexDialog({ table, columns, index, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const editing = index !== undefined;
  const [name, setName] = useState(index?.name ?? "");
  const [kind, setKind] = useState<MysqlIndexKind>(index ? indexKind(index) : "index");
  const [method, setMethod] = useState(() => {
    const type = index?.indexType.toUpperCase() ?? "";
    return type === "BTREE" || type === "HASH" ? type : "";
  });
  const [draft, setDraft] = useState<DraftColumn[]>(() => draftColumns(index, columns));
  const [comment, setComment] = useState(index?.comment ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const { close, cls } = useDialogExit();

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Not while the ALTER is in flight: closing then would leave the user with no way to see
      // how it went.
      if (e.key === "Escape" && !saving) close(onCancel);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, onCancel, saving]);

  function updateColumn(id: number, changes: Partial<DraftColumn>) {
    setDraft((prev) => prev.map((row) => (row.id === id ? { ...row, ...changes } : row)));
    setErrors([]);
  }

  const columnOptions = columns.map((c) => ({ value: c, label: c }));
  const kindOptions: { value: MysqlIndexKind; label: string }[] = [
    { value: "index", label: t("indexDialog.kindIndex") },
    { value: "unique", label: t("indexDialog.kindUnique") },
    { value: "primary", label: t("indexDialog.kindPrimary") },
    { value: "fulltext", label: t("indexDialog.kindFulltext") },
    { value: "spatial", label: t("indexDialog.kindSpatial") },
  ];

  function toSpec(): MysqlIndexSpec {
    return {
      name: name.trim(),
      kind,
      indexType: takesMethod(kind) && method !== "" ? method : null,
      columns: draft
        .filter((row) => row.name !== "")
        .map((row) => {
          const prefix = Number.parseInt(row.prefixLength, 10);
          return {
            name: row.name,
            prefixLength: Number.isFinite(prefix) && prefix > 0 ? prefix : null,
          };
        }),
      comment: comment.trim(),
    };
  }

  async function submit() {
    const spec = toSpec();
    const messages: string[] = [];
    if (spec.columns.length === 0) messages.push(t("indexDialog.errorColumns"));
    const seen = new Set<string>();
    for (const column of spec.columns) {
      if (seen.has(column.name)) {
        messages.push(t("indexDialog.errorDuplicateColumn", { column: column.name }));
      }
      seen.add(column.name);
    }
    setErrors(messages);
    if (messages.length > 0) return;
    setSaving(true);
    try {
      await onSubmit(spec);
    } catch (e) {
      setErrors([errorMessage(t, e)]);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <>
      <div className={cls(styles.overlay)} onClick={saving ? undefined : () => close(onCancel)} />
      <div className={cls(styles.dialog)} role="dialog" aria-modal="true" aria-label={table}>
        <div className={styles.header}>
          <h3 className={styles.title}>
            {editing
              ? t("indexDialog.editTitle", { index: index.name })
              : t("indexDialog.addTitle", { table })}
          </h3>
          {editing && <p className={styles.note}>{t("indexDialog.replaceNote")}</p>}
        </div>

        <div className={styles.form}>
          <label className={styles.field}>
            {t("indexDialog.name")}
            <Input
              ref={nameRef}
              size="normal"
              value={kind === "primary" ? "PRIMARY" : name}
              placeholder={t("indexDialog.namePlaceholder")}
              // A primary key is always called PRIMARY, so there is nothing to type here.
              disabled={saving || kind === "primary"}
              title={kind === "primary" ? t("indexDialog.nameFixed") : undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            {t("indexDialog.kind")}
            <Select
              value={kind}
              size="normal"
              options={kindOptions}
              ariaLabel={t("indexDialog.kind")}
              disabled={saving}
              onChange={(next) => {
                setKind(next);
                setErrors([]);
              }}
            />
          </label>

          <label className={styles.field}>
            {t("indexDialog.method")}
            <Select
              value={method}
              size="normal"
              options={[
                { value: "", label: t("indexDialog.methodDefault") },
                { value: "BTREE", label: "BTREE" },
                { value: "HASH", label: "HASH" },
              ]}
              ariaLabel={t("indexDialog.method")}
              disabled={saving || !takesMethod(kind)}
              onChange={setMethod}
            />
          </label>

          <label className={styles.field}>
            {t("indexDialog.comment")}
            <Input
              size="normal"
              value={comment}
              disabled={saving}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
        </div>

        <div className={styles.columns}>
          <span className={styles.columnsLabel}>{t("indexDialog.columns")}</span>
          {draft.map((row) => (
            <div key={row.id} className={styles.columnRow}>
              <Select
                value={row.name}
                size="small"
                className={styles.columnSelect}
                options={columnOptions}
                ariaLabel={t("indexDialog.column")}
                disabled={saving}
                searchable
                onChange={(next) => updateColumn(row.id, { name: next })}
              />
              <Input
                size="small"
                className={styles.prefixInput}
                value={row.prefixLength}
                placeholder={t("indexDialog.prefixPlaceholder")}
                aria-label={t("indexDialog.prefixLength")}
                title={t("indexDialog.prefixTooltip")}
                inputMode="numeric"
                disabled={saving}
                onChange={(e) => updateColumn(row.id, { prefixLength: e.target.value })}
              />
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t("indexDialog.removeColumn")}
                title={t("indexDialog.removeColumn")}
                disabled={saving || draft.length === 1}
                onClick={() => {
                  setDraft((prev) => prev.filter((r) => r.id !== row.id));
                  setErrors([]);
                }}
              >
                <MinusIcon size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t("indexDialog.addColumn")}
            title={t("indexDialog.addColumn")}
            disabled={saving || columns.length === 0}
            onClick={() => {
              setDraft((prev) => [
                ...prev,
                { id: nextId++, name: columns[0] ?? "", prefixLength: "" },
              ]);
              setErrors([]);
            }}
          >
            <PlusIcon size={14} />
          </button>
        </div>

        {errors.length > 0 && (
          <div className={styles.errors} role="alert">
            {errors.map((message, i) => (
              <p key={i}>{message}</p>
            ))}
          </div>
        )}

        <div className={styles.actions}>
          <Button size="large" onClick={() => close(onCancel)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button size="large" variant="primary" onClick={() => void submit()} disabled={saving}>
            {saving
              ? t("indexDialog.saving")
              : t(editing ? "indexDialog.submitEdit" : "indexDialog.submitAdd")}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export default IndexDialog;
