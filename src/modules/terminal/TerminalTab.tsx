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
  /* Cái tab vừa thử mở. Khác `choice` ở chỗ nó không bị xoá khi phiên hỏng — form cần nó để dựng
     lại đúng những gì người dùng đã gõ. */
  const [lastTried, setLastTried] = useState<TerminalChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exit, setExit] = useState<SessionExit | null>(null);
  /** Phiên đã yêu cầu nhưng chưa mở xong. Với SSH thì đây là vài giây kết nối và xác thực. */
  const [opening, setOpening] = useState(false);
  /* Bấm "Kết nối lại" là bơm số này lên: `TerminalView` mount lại, sinh id mới, mở phiên mới. Nội
     dung cũ đi theo instance cũ — đúng thế, vì nó là màn hình của một shell không còn nữa. */
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    onTitleChange(choice ? terminalTitle(choice) : t("terminal.newTabTitle"));
  }, [choice, onTitleChange, t]);

  /* `useMemo` chứ không dựng thẳng trong effect, và effect không lấy `onBadgesChange` làm phụ
     thuộc: shell so danh sách badge theo tham chiếu (xem `shell/tabs.ts`), nên một mảng mới là một
     `setTabs` — và `App` cấp một closure mới mỗi lần render. Hai cái đó cộng lại là một vòng lặp
     tự nuôi nó cho tới khi React cắt bằng "Maximum update depth exceeded", và cả cây đi theo. */
  const badges = useMemo(
    () =>
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
    [choice, exit, t],
  );

  useEffect(() => {
    onBadgesChange(badges);
  }, [badges]);

  const showError = useCallback((message: string) => setError(message), []);

  const opened = useCallback(() => setOpening(false), []);

  /* Phiên không mở được. `choice` bị xoá nên form quay lại — với `lastTried` còn nguyên, nên người
     dùng sửa mật khẩu rồi bấm lại chứ không gõ lại từ đầu. Banner do `onError` đặt vẫn ở trên đó. */
  const failed = useCallback(() => {
    setOpening(false);
    setChoice(null);
  }, []);

  function start(next: TerminalChoice) {
    setLastTried(next);
    setExit(null);
    setOpening(true);
    setChoice(next);
  }

  function reconnect() {
    setExit(null);
    setOpening(true);
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
            onOpened={opened}
            onExit={setExit}
            onFailed={failed}
            onError={showError}
          />
          {opening && <div className="terminal-connecting">{t("terminal.connecting")}</div>}
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
        <TargetForm onOpen={start} onError={showError} initial={lastTried} />
      )}
    </div>
  );
}

export default TerminalTab;
