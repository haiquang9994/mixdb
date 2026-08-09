import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Button from "../Button";
import Input from "../Input";
import Select from "../Select";
import { useTranslation } from "../../i18n";
import type { MysqlColumnSpec, MysqlStructureColumn } from "../../types";
import styles from "./ColumnDialog.module.css";

/** Types offered as a starting point, in the order a column is usually reached for. The box stays
 * free text — the list is a shortcut, not the set of what MySQL accepts. */
const COMMON_TYPES = [
  "int",
  "int unsigned",
  "bigint",
  "bigint unsigned",
  "tinyint(1)",
  "decimal(10,2)",
  "double",
  "varchar(255)",
  "char(36)",
  "text",
  "mediumtext",
  "longtext",
  "json",
  "date",
  "datetime",
  "timestamp",
  "time",
  "enum('a','b')",
  "blob",
  "binary(16)",
];

/** Where the column is to sit. The two fixed choices carry no colon, so they can never collide
 * with the `AFTER:` of a column that is named after one of them. */
const KEEP = "KEEP";
const FIRST = "FIRST";
const AFTER = "AFTER:";

interface Draft {
  name: string;
  dataType: string;
  nullable: boolean;
  /** Whether a DEFAULT clause is written at all — distinct from a default that is empty text. */
  hasDefault: boolean;
  defaultValue: string;
  defaultIsExpression: boolean;
  autoIncrement: boolean;
  onUpdateCurrentTimestamp: boolean;
  collation: string;
  comment: string;
  position: string;
}

function draftFromColumn(column: MysqlStructureColumn | undefined): Draft {
  if (!column) {
    return {
      name: "",
      dataType: "",
      nullable: true,
      hasDefault: false,
      defaultValue: "",
      defaultIsExpression: false,
      autoIncrement: false,
      onUpdateCurrentTimestamp: false,
      collation: "",
      comment: "",
      position: KEEP,
    };
  }
  return {
    name: column.name,
    dataType: column.dataType,
    nullable: column.nullable,
    hasDefault: column.defaultValue !== null,
    defaultValue: column.defaultValue ?? "",
    defaultIsExpression: column.defaultIsExpression,
    autoIncrement: column.autoIncrement,
    onUpdateCurrentTimestamp: column.onUpdateCurrentTimestamp,
    collation: column.collation ?? "",
    comment: column.comment,
    position: KEEP,
  };
}

interface Props {
  table: string;
  /** The table's columns as they stand, for the position picker. */
  columns: MysqlStructureColumn[];
  /** The column being redefined, or left out to add a new one. */
  column?: MysqlStructureColumn;
  onCancel: () => void;
  /** Rejects with the reason the ALTER failed: the dialog then shows it and stays open with the
   *  typed values still in it. The caller is what closes the dialog, once this resolves. */
  onSubmit: (spec: MysqlColumnSpec) => Promise<void>;
}

/**
 * The form behind both halves of a column's life: adding one, and redefining one that exists.
 * Editing sends a `CHANGE COLUMN`, which carries the whole definition — so every field starts at
 * what the column currently says, and anything left alone is written back unchanged.
 */
function ColumnDialog({ table, columns, column, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const editing = column !== undefined;
  const [draft, setDraft] = useState<Draft>(() => draftFromColumn(column));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Not while the ALTER is in flight: closing then would leave the user with no way to see
      // how it went.
      if (e.key === "Escape" && !saving) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, saving]);

  function patch(changes: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...changes }));
    setErrors([]);
  }

  const positionOptions = [
    { value: KEEP, label: t(editing ? "columnDialog.positionKeep" : "columnDialog.positionEnd") },
    { value: FIRST, label: t("columnDialog.positionFirst") },
    // A column cannot be moved after itself, so the one being edited is not on offer.
    ...columns
      .filter((c) => c.name !== column?.name)
      .map((c) => ({
        value: `${AFTER}${c.name}`,
        label: t("columnDialog.positionAfter", { column: c.name }),
      })),
  ];

  function toSpec(): MysqlColumnSpec {
    const position = draft.position;
    return {
      name: draft.name.trim(),
      dataType: draft.dataType.trim(),
      nullable: draft.nullable,
      defaultValue: draft.hasDefault ? draft.defaultValue : null,
      defaultIsExpression: draft.hasDefault && draft.defaultIsExpression,
      autoIncrement: draft.autoIncrement,
      onUpdateCurrentTimestamp: draft.onUpdateCurrentTimestamp,
      collation: draft.collation.trim() === "" ? null : draft.collation.trim(),
      comment: draft.comment,
      // Left out entirely, the column keeps its place (or a new one is appended); the empty string
      // is what asks for FIRST.
      ...(position === KEEP
        ? null
        : { after: position === FIRST ? "" : position.slice(AFTER.length) }),
    };
  }

  async function submit() {
    const messages: string[] = [];
    if (draft.name.trim() === "") messages.push(t("columnDialog.errorName"));
    if (draft.dataType.trim() === "") messages.push(t("columnDialog.errorType"));
    setErrors(messages);
    if (messages.length > 0) return;
    setSaving(true);
    try {
      await onSubmit(toSpec());
    } catch (e) {
      setErrors([String(e)]);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <>
      <div className={styles.overlay} onClick={saving ? undefined : onCancel} />
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={table}>
        <h3 className={styles.title}>
          {editing
            ? t("columnDialog.editTitle", { column: column.name })
            : t("columnDialog.addTitle", { table })}
        </h3>

        <div className={styles.form}>
          <label className={styles.field}>
            {t("columnDialog.name")}
            <Input
              ref={nameRef}
              size="normal"
              value={draft.name}
              disabled={saving}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>

          <label className={styles.field}>
            {t("columnDialog.type")}
            <div className={styles.typeRow}>
              <Input
                size="normal"
                className={styles.typeInput}
                value={draft.dataType}
                placeholder={t("columnDialog.typePlaceholder")}
                disabled={saving}
                onChange={(e) => patch({ dataType: e.target.value })}
              />
              {/* A menu rather than a value: it fills the box beside it and goes back to showing
                  its own placeholder, since the box is what the type really is. */}
              <Select
                value=""
                size="normal"
                className={styles.typeMenu}
                placeholder={t("columnDialog.commonTypes")}
                ariaLabel={t("columnDialog.commonTypes")}
                disabled={saving}
                searchable
                options={COMMON_TYPES.map((type) => ({ value: type, label: type }))}
                onChange={(type) => patch({ dataType: type })}
              />
            </div>
          </label>

          <label className={styles.field}>
            {t("columnDialog.position")}
            <Select
              value={draft.position}
              size="normal"
              options={positionOptions}
              ariaLabel={t("columnDialog.position")}
              disabled={saving}
              searchable
              onChange={(position) => patch({ position })}
            />
          </label>

          <label className={styles.field}>
            {t("columnDialog.collation")}
            <Input
              size="normal"
              value={draft.collation}
              placeholder={t("columnDialog.collationPlaceholder")}
              disabled={saving}
              onChange={(e) => patch({ collation: e.target.value })}
            />
          </label>

          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t("columnDialog.comment")}
            <Input
              size="normal"
              value={draft.comment}
              disabled={saving}
              onChange={(e) => patch({ comment: e.target.value })}
            />
          </label>
        </div>

        <div className={styles.toggles}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={draft.nullable}
              disabled={saving}
              onChange={(e) => patch({ nullable: e.target.checked })}
            />
            {t("columnDialog.nullable")}
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={draft.autoIncrement}
              disabled={saving}
              onChange={(e) => patch({ autoIncrement: e.target.checked })}
            />
            {t("columnDialog.autoIncrement")}
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={draft.onUpdateCurrentTimestamp}
              disabled={saving}
              onChange={(e) => patch({ onUpdateCurrentTimestamp: e.target.checked })}
            />
            {t("columnDialog.onUpdate")}
          </label>
        </div>

        <div className={styles.defaultBlock}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={draft.hasDefault}
              disabled={saving}
              onChange={(e) => patch({ hasDefault: e.target.checked })}
            />
            {t("columnDialog.hasDefault")}
          </label>
          {draft.hasDefault && (
            <>
              <Input
                size="normal"
                className={styles.defaultInput}
                value={draft.defaultValue}
                aria-label={t("columnDialog.defaultValue")}
                disabled={saving}
                onChange={(e) => patch({ defaultValue: e.target.value })}
              />
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={draft.defaultIsExpression}
                  disabled={saving}
                  onChange={(e) => patch({ defaultIsExpression: e.target.checked })}
                />
                {t("columnDialog.defaultIsExpression")}
              </label>
              <p className={styles.hint}>{t("columnDialog.defaultExpressionHint")}</p>
            </>
          )}
        </div>

        {errors.length > 0 && (
          <div className={styles.errors} role="alert">
            {errors.map((message, i) => (
              <p key={i}>{message}</p>
            ))}
          </div>
        )}

        <div className={styles.actions}>
          <Button size="large" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button size="large" onClick={() => void submit()} disabled={saving}>
            {saving
              ? t("columnDialog.saving")
              : t(editing ? "columnDialog.submitEdit" : "columnDialog.submitAdd")}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export default ColumnDialog;
