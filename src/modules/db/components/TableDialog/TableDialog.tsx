import { useState } from "react";
import CollationSelect from "../CollationSelect";
import NameDialog, { fieldClassName } from "../../../../components/NameDialog";
import { useTranslation } from "../../../../i18n";
import type { SqlCollation } from "../../types";
import { useSqlDialect } from "../../sql/context";

interface Props {
  /** The database the table is to be created in — named in the title, since the sidebar's own
   *  picker is behind the dialog. */
  database: string;
  /** What this server supports, for the collation picker. Empty leaves it a text box. */
  collations: SqlCollation[];
  onCancel: () => void;
  /** Rejects with the reason the CREATE failed, which the dialog then shows. */
  onSubmit: (name: string, collation: string | null) => Promise<void>;
}

/**
 * The form behind the sidebar's "new table": a name and — on MySQL — a collation, which are the
 * two things a table is hard to change afterwards. The columns are not asked for here: the table
 * is created with an `id` primary key and grows the rest of its columns in the Structure tab.
 *
 * PostgreSQL is asked only for the name, since a table there carries no collation of its own — only
 * its individual text columns do. The name may carry a schema (`sales.orders`), exactly as the
 * sidebar writes one, and that is how a table is created outside `public`.
 */
function TableDialog({ database, collations, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const { kind, editing: offers } = useSqlDialect();
  const [collation, setCollation] = useState("");

  return (
    <NameDialog
      title={t("tableDialog.title", { database })}
      ariaLabel={database}
      label={t("tableDialog.name")}
      emptyError={t("tableDialog.errorName")}
      submitLabel={t("tableDialog.submit")}
      savingLabel={t("tableDialog.saving")}
      hint={t(kind === "postgres" ? "tableDialog.columnHintPostgres" : "tableDialog.columnHint")}
      extraFields={
        offers.objectCollation
          ? (saving) => (
              <label className={fieldClassName}>
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
            )
          : undefined
      }
      onCancel={onCancel}
      onSubmit={(name) => onSubmit(name, collation.trim() === "" ? null : collation.trim())}
    />
  );
}

export default TableDialog;
