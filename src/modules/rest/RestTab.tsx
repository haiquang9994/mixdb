import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import "./rest.css";

/** The REST client's whole workspace. Filled in over the tasks that follow. */
function RestTab({}: ModuleTabProps) {
  const { t } = useTranslation();
  return (
    <div className="rest-tab">
      <p className="rest-empty muted">{t("rest.emptyMain")}</p>
    </div>
  );
}

export default RestTab;
