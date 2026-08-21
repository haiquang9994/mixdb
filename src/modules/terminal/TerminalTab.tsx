import { useCallback, useEffect, useMemo, useState } from "react";
import ErrorBanner from "../../components/ErrorBanner";
import { TerminalIcon } from "../../icons";
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import TargetForm from "./components/TargetForm";
import TerminalView from "./components/TerminalView";
import { localTarget, terminalBadgeMarks, terminalTitle } from "./session";
import type { LocalChoice } from "./types";
import "./terminal.css";

/** Terminal: một tab, một phiên. Form đứng trước, phiên thay chỗ nó khi người dùng bấm Mở. */
function TerminalTab({ active, onTitleChange, onBadgesChange }: ModuleTabProps) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<LocalChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onTitleChange(choice ? terminalTitle(choice) : t("terminal.newTabTitle"));
  }, [choice, onTitleChange, t]);

  useEffect(() => {
    onBadgesChange(
      terminalBadgeMarks(choice !== null, false).map((mark) => ({
        id: mark.type,
        icon: <TerminalIcon />,
        label: t("terminal.badgeLocal"),
      })),
    );
  }, [choice, onBadgesChange, t]);

  const showError = useCallback((message: string) => setError(message), []);

  /* `useMemo` chứ không gọi thẳng trong JSX: `target` là dependency của effect mở phiên trong
     `TerminalView`, nên một object mới mỗi lần cha render là một phiên mới mỗi lần cha render. */
  const target = useMemo(() => (choice ? localTarget(choice) : null), [choice]);

  return (
    <div className="terminal-tab">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {target ? (
        <TerminalView target={target} active={active} onExit={() => {}} onError={showError} />
      ) : (
        <TargetForm onOpen={setChoice} onError={showError} />
      )}
    </div>
  );
}

export default TerminalTab;
