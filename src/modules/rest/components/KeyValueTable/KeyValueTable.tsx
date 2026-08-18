import { useEffect, useRef } from "react";
import Input from "../../../../components/Input";
import { CloseIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import type { KeyValue } from "../../types";
import styles from "./KeyValueTable.module.css";

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

/**
 * The Params and Headers tables, and from Phase 3 the form-body one too.
 *
 * There is always one empty row at the foot, and it is not in the data: typing into it is what
 * adds a row. That is what makes a table with no Add button, and it is why an empty table is
 * still something you can type into.
 *
 * The tick is how a row is parked. An unticked row is left out of the request and kept in the
 * table, which is the only way to try without a header and get it back.
 */
function KeyValueTable({ rows, onChange, keyPlaceholder, valuePlaceholder }: Props) {
  const { t } = useTranslation();

  /* Every box in the table, by row and column.
   *
   * Typing into the foot of the table makes a row, and the box that was typed into is not the box
   * that row is edited in — the draft is always empty and always at the bottom. Left alone, the
   * caret stays on the draft and the second character starts a *second* row. So the new row's
   * matching box is handed the keyboard the moment it exists, and typing carries on into the row
   * that was just made. */
  const boxes = useRef(new Map<string, HTMLInputElement>());
  const owed = useRef<string | null>(null);

  const bind = (slot: string) => (el: HTMLInputElement | null) => {
    if (el === null) boxes.current.delete(slot);
    else boxes.current.set(slot, el);
  };

  useEffect(() => {
    const slot = owed.current;
    if (slot === null) return;
    owed.current = null;
    const box = boxes.current.get(slot);
    if (box === undefined) return;
    box.focus();
    // The caret goes after the character that made the row, not before it.
    box.setSelectionRange(box.value.length, box.value.length);
  });

  function update(id: string, patch: Partial<KeyValue>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function append(column: "key" | "value", text: string) {
    const id = crypto.randomUUID();
    owed.current = `${id}:${column}`;
    onChange([...rows, { id, enabled: true, key: "", value: "", [column]: text }]);
  }

  return (
    <div className={styles.table}>
      <div className={`${styles.row} ${styles.head}`}>
        <span />
        <span>{t("rest.keyColumn")}</span>
        <span>{t("rest.valueColumn")}</span>
        <span />
      </div>
      {rows.map((row) => (
        <div key={row.id} className={styles.row}>
          <input
            type="checkbox"
            checked={row.enabled}
            aria-label={t("rest.rowEnabled")}
            title={t("rest.rowEnabled")}
            onChange={(e) => update(row.id, { enabled: e.target.checked })}
          />
          <Input
            ref={bind(`${row.id}:key`)}
            size="small"
            value={row.key}
            placeholder={keyPlaceholder}
            aria-label={t("rest.keyColumn")}
            onChange={(e) => update(row.id, { key: e.target.value })}
          />
          <Input
            ref={bind(`${row.id}:value`)}
            size="small"
            value={row.value}
            placeholder={valuePlaceholder}
            aria-label={t("rest.valueColumn")}
            onChange={(e) => update(row.id, { value: e.target.value })}
          />
          <button
            type="button"
            className={styles.remove}
            aria-label={t("rest.removeRow")}
            title={t("rest.removeRow")}
            onClick={() => onChange(rows.filter((kept) => kept.id !== row.id))}
          >
            <CloseIcon size="0.9em" />
          </button>
        </div>
      ))}
      <div className={`${styles.row} ${styles.draft}`}>
        <span />
        <Input
          size="small"
          value=""
          placeholder={keyPlaceholder ?? t("rest.addRow")}
          aria-label={t("rest.addRow")}
          onChange={(e) => append("key", e.target.value)}
        />
        <Input
          size="small"
          value=""
          placeholder={valuePlaceholder}
          aria-label={t("rest.valueColumn")}
          onChange={(e) => append("value", e.target.value)}
        />
        <span />
      </div>
    </div>
  );
}

export default KeyValueTable;
