import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Button from "../Button";
import Input from "../Input";
import Select from "../Select";
import type { SelectOption } from "../Select";
import { useTranslation } from "../../i18n";
import type { MysqlCollation, MysqlColumnSpec, MysqlStructureColumn } from "../../types";
import styles from "./ColumnDialog.module.css";

/** One type the picker offers, and what the box beside it holds — the argument MySQL takes inside
 * the type's parentheses. */
interface TypeSpec {
  name: string;
  /** What to suggest for the argument: `null` for a type that takes none (the box is then closed),
   *  and `""` for one that accepts an argument no column really needs to give. */
  arg: string | null;
  /** Not valid without an argument: `varchar` has no length of its own to fall back on. */
  required?: boolean;
  /** The argument is a list of values rather than a number, so it is not checked as one. */
  list?: boolean;
  /** UNSIGNED means something here. */
  numeric?: boolean;
}

/** The types a column can be declared as, each family in the order it is usually reached for.
 * Every MySQL version in the app's reach has all of these; what differs between versions is the
 * collation list, which is read from the server instead. */
const TYPES: TypeSpec[] = [
  { name: "int", arg: "", numeric: true },
  { name: "bigint", arg: "", numeric: true },
  { name: "tinyint", arg: "1", numeric: true },
  { name: "smallint", arg: "", numeric: true },
  { name: "mediumint", arg: "", numeric: true },
  { name: "decimal", arg: "10,2", numeric: true },
  { name: "float", arg: "", numeric: true },
  { name: "double", arg: "", numeric: true },
  { name: "bit", arg: "1" },
  { name: "varchar", arg: "255", required: true },
  { name: "char", arg: "36" },
  { name: "text", arg: null },
  { name: "mediumtext", arg: null },
  { name: "longtext", arg: null },
  { name: "tinytext", arg: null },
  { name: "enum", arg: "'a','b'", required: true, list: true },
  { name: "set", arg: "'a','b'", required: true, list: true },
  { name: "date", arg: null },
  { name: "datetime", arg: "" },
  { name: "timestamp", arg: "" },
  { name: "time", arg: "" },
  { name: "year", arg: null },
  { name: "json", arg: null },
  { name: "binary", arg: "16" },
  { name: "varbinary", arg: "255", required: true },
  { name: "blob", arg: null },
  { name: "mediumblob", arg: null },
  { name: "longblob", arg: null },
  { name: "tinyblob", arg: null },
  { name: "geometry", arg: null },
  { name: "point", arg: null },
  { name: "linestring", arg: null },
  { name: "polygon", arg: null },
  { name: "multipoint", arg: null },
  { name: "multilinestring", arg: null },
  { name: "multipolygon", arg: null },
  { name: "geometrycollection", arg: null },
];

/** What is known about a type name, or undefined for one this list doesn't carry — a column
 * declared as something older or newer than the app knows still has to be editable. */
function typeSpec(name: string): TypeSpec | undefined {
  return TYPES.find((type) => type.name === name.toLowerCase());
}

/** Only a number, or a number and a scale: what every type but `enum`/`set` takes. */
const NUMERIC_ARGUMENT = /^\d+(\s*,\s*\d+)?$/;

/** Splits a declared type into the parts the form edits. `varchar(255)` is a name and an argument,
 * `int unsigned` a name and a flag, and anything else trailing (`zerofill`, a character set) is
 * kept verbatim so that editing a column cannot quietly drop it. */
function parseType(dataType: string): Pick<Draft, "typeName" | "typeArg" | "unsigned" | "typeTail"> {
  const text = dataType.trim();
  const open = text.indexOf("(");
  // The last `)`, not the first: an enum's values may have parentheses of their own inside quotes.
  const close = text.lastIndexOf(")");
  const parenthesised = open !== -1 && close > open;
  const head = (parenthesised ? text.slice(0, open) : text).trim();
  const [name = "", ...rest] = head.split(/\s+/);
  const words = [...rest, ...(parenthesised ? text.slice(close + 1) : "").split(/\s+/)].filter(
    (word) => word !== "",
  );
  return {
    typeName: name.toLowerCase(),
    typeArg: parenthesised ? text.slice(open + 1, close).trim() : "",
    unsigned: words.some((word) => word.toLowerCase() === "unsigned"),
    typeTail: words.filter((word) => word.toLowerCase() !== "unsigned").join(" "),
  };
}

/** The declared type the parts add back up to — what actually reaches the `ALTER TABLE`. */
function composeType(draft: Draft): string {
  const name = draft.typeName.trim();
  if (name === "") return "";
  const arg = draft.typeArg.trim();
  const spec = typeSpec(name);
  // An argument on a type that takes none is dropped rather than written out: the box is closed
  // for those, so anything left in it is from a type chosen before.
  const parts = [arg !== "" && spec?.arg !== null ? `${name}(${arg})` : name];
  if (draft.unsigned) parts.push("unsigned");
  if (draft.typeTail !== "") parts.push(draft.typeTail);
  return parts.join(" ");
}

/** The character sets a column is realistically declared in, most likely first. Everything else the
 * server offers follows them, alphabetically — the order is only about what is quick to reach. */
const CHARSET_ORDER = ["utf8mb4", "utf8mb3", "utf8", "latin1", "ascii", "binary"];

function charsetRank(charset: string): number {
  const index = CHARSET_ORDER.indexOf(charset);
  return index === -1 ? CHARSET_ORDER.length : index;
}

/** Where the column is to sit. The two fixed choices carry no colon, so they can never collide
 * with the `AFTER:` of a column that is named after one of them. */
const KEEP = "KEEP";
const FIRST = "FIRST";
const AFTER = "AFTER:";

interface Draft {
  name: string;
  /** The type without its argument or attributes: `varchar`, `int`. */
  typeName: string;
  /** What goes inside the type's parentheses — a length, a precision, or a list of values. */
  typeArg: string;
  unsigned: boolean;
  /** Attributes the form has no control of its own for (`zerofill`), carried through unchanged. */
  typeTail: string;
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
      typeName: "",
      typeArg: "",
      unsigned: false,
      typeTail: "",
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
    ...parseType(column.dataType),
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
  /** What this server supports, for the collation picker. Empty — a server that would not say, or
   *  a list still on its way — leaves the collation a text box, which is what it was before. */
  collations: MysqlCollation[];
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
function ColumnDialog({ table, columns, collations, column, onCancel, onSubmit }: Props) {
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

  const selectedType = typeSpec(draft.typeName);
  const typeOptions: SelectOption<string>[] = [
    // A type the list has no entry for goes on the front of it: without an option of its own the
    // picker would show nothing, and saving would redeclare the column as something else.
    ...(draft.typeName !== "" && selectedType === undefined
      ? [{ value: draft.typeName, label: draft.typeName }]
      : []),
    ...TYPES.map((type) => ({ value: type.name, label: type.name })),
  ];

  /** Switching type takes the previous type's argument with it when the new one has no
   * parentheses to put it in, and drops UNSIGNED where it means nothing. */
  function chooseType(typeName: string) {
    const spec = typeSpec(typeName);
    patch({
      typeName,
      ...(spec?.arg === null ? { typeArg: "" } : null),
      ...(spec !== undefined && !spec.numeric ? { unsigned: false } : null),
    });
  }

  /** The collation list as it is offered: the column's own character set first, then the ones most
   * columns use, and inside each the character set's default ahead of the rest. */
  const collationOptions = useMemo(() => {
    const current = draft.collation.trim();
    // Changing a collation nearly always means changing it within the character set the column is
    // already in, so that set's collations sit above every other.
    const currentCharset = collations.find((c) => c.name === current)?.charset;
    const sorted = [...collations].sort((a, b) => {
      if (a.charset !== b.charset) {
        if (a.charset === currentCharset) return -1;
        if (b.charset === currentCharset) return 1;
        return charsetRank(a.charset) - charsetRank(b.charset) || a.charset.localeCompare(b.charset);
      }
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const options: SelectOption<string>[] = [
      { value: "", label: t("columnDialog.collationPlaceholder") },
      ...sorted.map((collation) => ({
        value: collation.name,
        label: collation.name,
        optionLabel: (
          <span className={styles.collationOption}>
            <span>{collation.name}</span>
            <span className={styles.collationCharset}>
              {collation.isDefault
                ? t("columnDialog.collationCharsetDefault", { charset: collation.charset })
                : collation.charset}
            </span>
          </span>
        ),
        // The charset is searchable too: typing "latin1" is how its collations are found.
        searchText: `${collation.name} ${collation.charset}`,
      })),
    ];
    // A collation this server no longer lists — an old column, a character set since dropped —
    // would otherwise leave the trigger blank and be lost the moment the column is saved.
    if (current !== "" && !collations.some((c) => c.name === current)) {
      options.splice(1, 0, { value: current, label: current });
    }
    return options;
  }, [collations, draft.collation, t]);

  function toSpec(): MysqlColumnSpec {
    const position = draft.position;
    return {
      name: draft.name.trim(),
      dataType: composeType(draft),
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
    const arg = draft.typeArg.trim();
    if (draft.typeName === "") {
      messages.push(t("columnDialog.errorType"));
    } else if (selectedType?.required && arg === "") {
      messages.push(t("columnDialog.errorTypeArg", { type: draft.typeName }));
      // Only the numeric arguments are checked. An enum's values are the user's own literals, and
      // a type this list doesn't carry is left alone entirely — MySQL is what judges those.
    } else if (
      arg !== "" &&
      selectedType !== undefined &&
      selectedType.list !== true &&
      !NUMERIC_ARGUMENT.test(arg)
    ) {
      messages.push(t("columnDialog.errorTypeArgNumber"));
    }
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
              <Select
                value={draft.typeName}
                size="normal"
                className={styles.typeSelect}
                placeholder={t("columnDialog.typePlaceholder")}
                ariaLabel={t("columnDialog.type")}
                disabled={saving}
                searchable
                options={typeOptions}
                onChange={chooseType}
              />
              {/* What goes in the type's parentheses, kept beside it rather than typed into the
                  name — the two are edited together, but only one of them is a choice. */}
              <Input
                size="normal"
                className={styles.typeArg}
                value={draft.typeArg}
                placeholder={selectedType?.arg ?? ""}
                aria-label={t("columnDialog.typeArg")}
                // Closed for a type with no parentheses to put anything in, rather than hidden:
                // the row keeps its shape as the type changes.
                disabled={saving || selectedType?.arg === null}
                onChange={(e) => patch({ typeArg: e.target.value })}
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
            {collations.length > 0 ? (
              <Select
                value={draft.collation.trim()}
                size="normal"
                options={collationOptions}
                ariaLabel={t("columnDialog.collation")}
                disabled={saving}
                searchable
                searchPlaceholder={t("columnDialog.collationSearch")}
                onChange={(collation) => patch({ collation })}
              />
            ) : (
              <Input
                size="normal"
                value={draft.collation}
                placeholder={t("columnDialog.collationPlaceholder")}
                disabled={saving}
                onChange={(e) => patch({ collation: e.target.value })}
              />
            )}
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
          {/* Shown for the types it means something to, and for a type the list doesn't carry that
              already says it — dropping it there would change the column behind the user's back. */}
          {(selectedType?.numeric || draft.unsigned) && (
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={draft.unsigned}
                disabled={saving}
                onChange={(e) => patch({ unsigned: e.target.checked })}
              />
              {t("columnDialog.unsigned")}
            </label>
          )}
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
