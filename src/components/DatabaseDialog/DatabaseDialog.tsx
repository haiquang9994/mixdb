import { useState } from "react";
import CollationSelect from "../CollationSelect";
import NameDialog, { fieldClassName } from "../NameDialog";
import { useTranslation } from "../../i18n";
import type { MysqlCollation } from "../../types";

interface Props {
  /** What this server supports, for the collation picker. Empty leaves it a text box. */
  collations: MysqlCollation[];
  onCancel: () => void;
  /** Rejects with the reason the CREATE failed, which the dialog then shows. */
  onSubmit: (name: string, collation: string | null) => Promise<void>;
}

/**
 * The form behind the database picker's "new database": a name, and the collation every table
 * created in it will inherit unless it says otherwise.
 */
function DatabaseDialog({ collations, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const [collation, setCollation] = useState("");

  return (
    <NameDialog
      title={t("databaseDialog.title")}
      ariaLabel={t("databaseDialog.title")}
      label={t("databaseDialog.name")}
      emptyError={t("databaseDialog.errorName")}
      submitLabel={t("databaseDialog.submit")}
      savingLabel={t("databaseDialog.saving")}
      extraFields={(saving) => (
        <label className={fieldClassName}>
          {t("databaseDialog.collation")}
          <CollationSelect
            value={collation}
            collations={collations}
            placeholder={t("databaseDialog.collationPlaceholder")}
            ariaLabel={t("databaseDialog.collation")}
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

export default DatabaseDialog;
