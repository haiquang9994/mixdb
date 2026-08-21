import { useEffect, useState } from "react";
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import { localShells } from "./api";
import TerminalView from "./components/TerminalView";
import type { TerminalTarget } from "./types";
import "./terminal.css";

/** Terminal: một tab, một phiên. Việc 7 thay chỗ giữ chỗ này bằng form chọn đích. */
function TerminalTab({ active, onTitleChange }: ModuleTabProps) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<TerminalTarget | null>(null);

  useEffect(() => {
    onTitleChange(t("terminal.newTabTitle"));
  }, [onTitleChange, t]);

  useEffect(() => {
    localShells()
      .then((shells) => {
        const first = shells[0];
        if (first) setTarget({ type: "local", shell: first.path, args: first.args, cwd: null });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="terminal-tab">
      {target && (
        <TerminalView target={target} active={active} onExit={() => {}} onError={() => {}} />
      )}
    </div>
  );
}

export default TerminalTab;
