import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../../components/Button";
import ErrorBanner from "../../components/ErrorBanner";
import { TerminalIcon } from "../../icons";
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import { localShells, type SessionExit } from "./api";
import TargetForm from "./components/TargetForm";
import TerminalView from "./components/TerminalView";
import { useSavedHosts, useSavedHostsLoaded } from "./savedHostsStore";
import { parseTerminalTabState, tabStateFor } from "./tabState";
import { terminalBadgeMarks, terminalTarget, terminalTitle } from "./session";
import type { TerminalChoice } from "./types";
import "./terminal.css";

/** Terminal: một tab, một phiên. Form đứng trước, phiên thay chỗ nó khi người dùng bấm Mở. */
function TerminalTab({ active, onTitleChange, onBadgesChange, restored, onStateChange }: ModuleTabProps) {
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
  /* Tab này đang ở đâu lần mở app trước, chụp đúng một lần. Chụp chứ không đọc sống: `start` ghi
     giá trị mới ngay khi phiên mở, mà đọc lại cái đó thì tab tự khôi phục từ chính nó. */
  const [restoredState] = useState(() => parseTerminalTabState(restored));
  /* Gọi `useSavedHosts` ở đây là thứ khởi động lượt đọc mà `useSavedHostsLoaded` đang chờ — từ
     trước tới giờ chỉ `TargetForm` gọi nó, mà form thì không có mặt khi tab đang khôi phục. */
  const savedHosts = useSavedHosts();
  const savedHostsLoaded = useSavedHostsLoaded();
  /** Việc khôi phục đã có lượt của nó chưa — thắng hay thua đều tính. Thiếu cái này thì một tab
   *  khác lưu thêm host là snapshot mới, effect chạy lại, và tab này mở phiên thứ hai. */
  const restoreTried = useRef(false);

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
    /* Gọi từ event handler chứ không từ render, nên một object mới mỗi lần là đúng: shell so theo
       tham chiếu và chỉ ghi một lần cho mỗi lần mở phiên. */
    onStateChange(tabStateFor(next));
  }

  /* Bỏ phiên đã chết và quay về màn hình chọn đích. `lastTried` ở lại, nên form dựng lại đúng
     những gì vừa mở — mở lại cái cũ là một lần bấm, mà đổi sang cái khác cũng vậy.

     Đây là chỗ duy nhất quên ngữ cảnh: bấm nút này là nói "tôi rời khỏi đây". Phiên chết mà chưa
     bấm thì giữ — màn hình "phiên đã kết thúc" với nút Kết nối lại vẫn là màn hình của đích ấy —
     và `failed` cũng giữ, vì SSH hỏng không phải là rời đi. */
  function dismiss() {
    setExit(null);
    setChoice(null);
    onStateChange(undefined);
  }

  /* Tab quay lại đúng chỗ nó đang ở, một lần, lần đầu nó được nhìn tới — với một tab khôi phục từ
     phiên trước thì đó cũng là lần đầu nó được mount.

     Hai nhánh chờ hai thứ khác nhau. `ssh` chờ danh sách host đọc xong: trước đó danh sách rỗng và
     mọi id đều trông như đã bị xoá. `local` chờ `localShells()` — shell dò lại mỗi lần chạy, nên
     một distro WSL đã gỡ hay một shell đã xoá đơn giản là không có trong danh sách. Không tìm thấy
     thì về `TargetForm`, không banner: không có gì hỏng cả. */
  useEffect(() => {
    if (restoreTried.current || restoredState === null) return;

    if (restoredState.kind === "ssh") {
      if (!savedHostsLoaded) return;
      restoreTried.current = true;
      const host = savedHosts.find((h) => h.id === restoredState.hostId);
      // `config` ở đây đã đầy đủ — `savedHosts.ts` ghép bí mật từ keyring vào trước khi trao ra.
      if (host !== undefined) {
        start({
          kind: "ssh",
          config: host.config,
          hostId: host.id,
          runOnConnect: host.runOnConnect ?? null,
        });
      }
      return;
    }

    restoreTried.current = true;
    /* Không có cờ huỷ, và cố ý: `restoreTried` đã bảo đảm `localShells()` chỉ chạy đúng một lần,
       nên thứ duy nhất một cleanup huỷ được lại chính là lần thử ấy — StrictMode tháo rồi gắn lại
       ngay khi mount, cleanup bắn trước khi dò xong, và tab không bao giờ về lại shell của nó.
       Bỏ đi cũng không mất gì: tab đóng giữa chừng thì `start` ghi vào một component đã gỡ, React
       không làm gì cả, và `restateTab` bên shell bỏ qua id không còn trong danh sách. */
    localShells()
      .then((shells) => {
        const shell = shells.find((s) => s.name === restoredState.shellName);
        if (shell !== undefined) start({ kind: "local", shell, cwd: restoredState.cwd });
      })
      // Dò shell hỏng thì tab mở ra là form, đúng như trước khi có tính năng này.
      .catch(() => {});
  }, [restoredState, savedHostsLoaded, savedHosts]);

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
            runOnConnect={choice?.kind === "ssh" ? choice.runOnConnect : null}
            active={active}
            onOpened={opened}
            onExit={setExit}
            onFailed={failed}
            onDismiss={dismiss}
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
              <div className="terminal-ended-actions">
                <Button onClick={reconnect}>{t("terminal.reconnect")}</Button>
                <Button onClick={dismiss}>{t("terminal.closeSession")}</Button>
              </div>
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
