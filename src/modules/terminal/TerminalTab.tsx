import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../../components/Button";
import ErrorBanner from "../../components/ErrorBanner";
import { TerminalIcon } from "../../icons";
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import type { SessionExit } from "./api";
import TargetForm from "./components/TargetForm";
import TerminalView from "./components/TerminalView";
import { terminalBadgeMarks, terminalTarget, terminalTitle } from "./session";
import type { TerminalChoice } from "./types";
import "./terminal.css";

/** Terminal: một tab, một phiên. Form đứng trước, phiên thay chỗ nó khi người dùng bấm Mở. */
function TerminalTab({ active, onTitleChange, onBadgesChange }: ModuleTabProps) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<TerminalChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exit, setExit] = useState<SessionExit | null>(null);
  /* Bấm "Kết nối lại" là bơm số này lên: `TerminalView` mount lại, sinh id mới, mở phiên mới. Nội
     dung cũ đi theo instance cũ — đúng thế, vì nó là màn hình của một shell không còn nữa. */
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    onTitleChange(choice ? terminalTitle(choice) : t("terminal.newTabTitle"));
  }, [choice, onTitleChange, t]);

  useEffect(() => {
    onBadgesChange(
      terminalBadgeMarks(choice, exit !== null).map((mark) => {
        if (mark.type === "ended") {
          return {
            id: "ended",
            icon: <TerminalIcon />,
            label: t("terminal.badgeEnded"),
            tabClassName: "terminal-tab-ended",
          };
        }
        return mark.type === "local"
          ? { id: "local", icon: <TerminalIcon />, label: t("terminal.badgeLocal") }
          : { id: "ssh", icon: <TerminalIcon />, label: t("terminal.badgeSsh") };
      }),
    );
  }, [choice, exit, onBadgesChange, t]);

  const showError = useCallback((message: string) => setError(message), []);

  function reconnect() {
    setExit(null);
    setGeneration((n) => n + 1);
  }

  /* `useMemo` chứ không gọi thẳng trong JSX: `target` là dependency của effect mở phiên trong
     `TerminalView`, nên một object mới mỗi lần cha render là một phiên mới mỗi lần cha render. */
  const target = useMemo(() => (choice ? terminalTarget(choice) : null), [choice]);

  return (
    <div className="terminal-tab">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {target ? (
        <>
          <TerminalView
            key={generation}
            target={target}
            active={active}
            onExit={setExit}
            onError={showError}
          />
          {exit && (
            <div className="terminal-ended">
              <span>
                {exit.code === null
                  ? t("terminal.sessionEnded")
                  : t("terminal.sessionEndedCode", { code: exit.code })}
              </span>
              <Button onClick={reconnect}>{t("terminal.reconnect")}</Button>
            </div>
          )}
        </>
      ) : (
        <TargetForm onOpen={setChoice} onError={showError} />
      )}
    </div>
  );
}

export default TerminalTab;
