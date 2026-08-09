import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Button from "../Button";
import CollationSelect from "../CollationSelect";
import Input from "../Input";
import { useTranslation } from "../../i18n";
import type { MysqlCollation } from "../../types";
import styles from "./TableDialog.module.css";

interface Props {
  /** The database the table is to be created in — named in the title, since the sidebar's own
   *  picker is behind the dialog. */
  database: string;
  /** What this server supports, for the collation picker. Empty leaves it a text box. */
  collations: MysqlCollation[];
  onCancel: () => void;
  /** Rejects with the reason the CREATE failed: the dialog then shows it and stays open with the
   *  typed name still in it. The caller is what closes the dialog, once this resolves. */
  onSubmit: (name: string, collation: string | null) => Promise<void>;
}

/**
 * The form behind the sidebar's "new table": a name and a collation, which are the two things a
 * table is hard to change afterwards. The columns are not asked for here — the table is created
 * with an `id` primary key and grows the rest of its columns in the Structure tab.
 */
function TableDialog({ database, collations, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [collation, setCollation] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Not while the CREATE is in flight: closing then would leave the user with no way to see
      // how it went.
      if (e.key === "Escape" && !saving) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, saving]);

  async function submit() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setErrors([t("tableDialog.errorName")]);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      await onSubmit(trimmed, collation.trim() === "" ? null : collation.trim());
    } catch (e) {
      setErrors([String(e)]);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <>
      <div className={styles.overlay} onClick={saving ? undefined : onCancel} />
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={database}>
        <h3 className={styles.title}>{t("tableDialog.title", { database })}</h3>

        <div className={styles.form}>
          <label className={styles.field}>
            {t("tableDialog.name")}
            <Input
              ref={nameRef}
              size="normal"
              value={name}
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) void submit();
              }}
            />
          </label>

          <label className={styles.field}>
            {t("tableDialog.collation")}
            <CollationSelect
              value={collation}
              collations={collations}
              placeholder={t("tableDialog.collationPlaceholder")}
              ariaLabel={t("tableDialog.collation")}
              disabled={saving}
              onChange={setCollation}
            />
          </label>
        </div>

        <p className={styles.hint}>{t("tableDialog.columnHint")}</p>

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
            {saving ? t("tableDialog.saving") : t("tableDialog.submit")}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export default TableDialog;
