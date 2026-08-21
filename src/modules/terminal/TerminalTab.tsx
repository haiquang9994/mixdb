import { useEffect } from "react";
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import "./terminal.css";

/** Terminal: một tab, một phiên. Việc 7 thay chỗ giữ chỗ này bằng form chọn đích. */
function TerminalTab({ onTitleChange }: ModuleTabProps) {
  const { t } = useTranslation();

  useEffect(() => {
    onTitleChange(t("terminal.newTabTitle"));
  }, [onTitleChange, t]);

  return <div className="terminal-tab">{t("terminal.localTitle")}</div>;
}

export default TerminalTab;
