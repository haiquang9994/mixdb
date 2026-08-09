import { useState } from "react";
import CollationSelect from "../CollationSelect";
import NameDialog, { fieldClassName } from "../NameDialog";
import { useTranslation } from "../../i18n";
import type { MysqlCollation } from "../../types";

interface Props {
  /** The database the table is to be created in — named in the title, since the sidebar's own
   *  picker is behind the dialog. */
  database: string;
  /** What this server supports, for the collation picker. Empty leaves it a text box. */
  collations: MysqlCollation[];
  onCancel: () => void;
  /** Rejects with the reason the CREATE failed, which the dialog then shows. */
  onSubmit: (name: string, collation: string | null) => Promise<void>;
}

/**
 * The form behind the sidebar's "new table": a name and a collation, which are the two things a
 * table is hard to change afterwards. The columns are not asked for here — the table is created
 * with an `id` primary key and grows the rest of its columns in the Structure tab.
 */
function TableDialog({ database, collations, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const [collation, setCollation] = useState("");

  return (
    <NameDialog
      title={t("tableDialog.title", { database })}
      ariaLabel={database}
      label={t("tableDialog.name")}
      emptyError={t("tableDialog.errorName")}
      submitLabel={t("tableDialog.submit")}
      savingLabel={t("tableDialog.saving")}
      hint={t("tableDialog.columnHint")}
      extraFields={(saving) => (
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
      )}
      onCancel={onCancel}
      onSubmit={(name) => onSubmit(name, collation.trim() === "" ? null : collation.trim())}
    />
  );
}

export default TableDialog;
