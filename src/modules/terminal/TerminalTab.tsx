import { useEffect, useState } from "react";
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import { localShells } from "./api";
import { shellLabel } from "./shells";
import type { LocalShell } from "./types";
import "./terminal.css";

/** Terminal: một tab, một phiên. Việc 7 thay chỗ giữ chỗ này bằng form chọn đích. */
function TerminalTab({ onTitleChange }: ModuleTabProps) {
  const { t } = useTranslation();
  const [shells, setShells] = useState<LocalShell[]>([]);

  useEffect(() => {
    onTitleChange(t("terminal.newTabTitle"));
  }, [onTitleChange, t]);

  useEffect(() => {
    localShells()
      .then(setShells)
      .catch(() => setShells([]));
  }, []);

  return (
    <div className="terminal-tab">
      <ul>
        {shells.map((shell) => (
          <li key={shell.path}>
            {shellLabel(shell.name)} — {shell.path}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default TerminalTab;
