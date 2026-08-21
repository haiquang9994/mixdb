import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { copyText } from "../../../../core/clipboard";
import { errorMessage } from "../../../../core/errors";
import { isClaimed, pressOf, useShortcut } from "../../../../core/shortcuts";
import { useTranslation } from "../../../../i18n";
import {
  closeSession,
  openSession,
  resizeSession,
  writeSession,
  type SessionExit,
} from "../../api";
import { useTerminalSettings, zoomTerminal } from "../../settingsStore";
import { shellKeeps } from "../../keys";
import type { TerminalTarget } from "../../types";
import styles from "./TerminalView.module.css";

/** Kéo cửa sổ sinh ra hàng chục sự kiện một giây; đầu xa chỉ cần biết kích thước cuối cùng. */
const RESIZE_DEBOUNCE = 100;

interface Props {
  target: TerminalTarget;
  /** Tab nằm sau vẫn mounted và vẫn nhận byte — cái này chỉ quyết định focus và lúc nào đo lại. */
  active: boolean;
  /** Phiên đã mở xong. Với SSH thì đây là lúc kết nối, xác thực và xin pty đều đã qua — vài giây
   *  sau khi bấm nút, nên tab có gì đó để nói trong lúc chờ. */
  onOpened: () => void;
  onExit: (exit: SessionExit) => void;
  /** Phiên không mở được: sai mật khẩu, vân tay đổi, máy chủ không tới được. Khác `onError` ở chỗ
   *  nó nói rằng *không có phiên nào cả*, nên tab trả màn hình về form. */
  onFailed: () => void;
  /** Bỏ hẳn phiên đã kết thúc và quay về màn hình chọn đích. Khác `onExit` ở chỗ đó là người dùng
   *  nói, không phải shell nói. */
  onDismiss: () => void;
  onError: (message: string) => void;
}

function TerminalView({ target, active, onOpened, onExit, onFailed, onDismiss, onError }: Props) {
  const { t } = useTranslation();
  const settings = useTerminalSettings();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  /* Trong state chứ không trong ref: nó là điều kiện `enabled` của `terminal.copy`, và một ref đổi
     giá trị thì không có ai đăng ký lại phím tắt. */
  const [hasSelection, setHasSelection] = useState(false);
  /* Shell đã chết. Trong state chứ không chỉ trong biến `ended` của effect bên dưới, và cũng vì lý
     do ấy: nó quyết định phím tắt nào đang được đăng ký. */
  const [ended, setEnded] = useState(false);

  /* Cài đặt lúc dựng terminal đi qua ref: đổi cài đặt thì `term.options` được đặt lại tại chỗ —
     xem effect ở cuối — chứ không dựng lại cả màn hình và mở lại cả phiên. */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Callback đi qua ref: effect mở phiên chỉ được chạy lại khi `target` đổi, không phải mỗi lần
  // cha render lại.
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: settingsRef.current.fontFamily,
      fontSize: settingsRef.current.fontSize,
      cursorStyle: settingsRef.current.cursorStyle,
      cursorBlink: settingsRef.current.cursorBlink,
      scrollback: settingsRef.current.scrollback,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    /* Cửa duy nhất để lấy được một phím ra khỏi xterm. Nó đọc `keydown` trên textarea ẩn của chính
       nó và `stopPropagation` mọi `Ctrl`+chữ cái, nên listener của app ở `window` không bao giờ
       nghe thấy `Ctrl+W`. Trả `false` là xterm thoát ra *trước* khi `preventDefault`, và sự kiện
       bay lên nguyên vẹn — cho bộ điều phối, hoặc cho chính webview khi đó là lệnh dán. */
    term.attachCustomKeyEventHandler((e) => {
      const press = pressOf(e);
      return shellKeeps(press, isClaimed(press));
    });
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    /* Id sinh ở đây chứ không do tab cấp: `StrictMode` chạy effect hai vòng trong dev, và cleanup
       của vòng đầu phải đóng đúng phiên của vòng đầu. */
    const id = crypto.randomUUID();
    sessionRef.current = id;
    let ended = false;

    const typed = term.onData((data) => {
      void writeSession(id, data).catch(() => {});
    });
    const selected = term.onSelectionChange(() => setHasSelection(term.hasSelection()));

    void openSession(id, target, { cols: term.cols, rows: term.rows }, (message) => {
      if (message instanceof ArrayBuffer) {
        term.write(new Uint8Array(message));
        return;
      }
      ended = true;
      setEnded(true);
      onExitRef.current(message);
    })
      .then(() => onOpenedRef.current())
      .catch((e) => {
        /* Không có phiên nào để đóng: `terminal_open` hỏng trước khi đưa được gì vào map, nên
           cleanup bên dưới không được gọi `terminal_close` cho một id chưa từng tồn tại. */
        ended = true;
        onErrorRef.current(errorMessage(tRef.current, e));
        onFailedRef.current();
      });

    return () => {
      typed.dispose();
      selected.dispose();
      // Chỉ khi unmount, không phải khi mất `active`: tab nằm sau vẫn phải cuộn tiếp.
      if (!ended) void closeSession(id).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      sessionRef.current = null;
    };
  }, [target]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        /* Khung ẩn có kích thước 0, và `fit()` lúc đó tính ra cols/rows rác rồi bắn xuống server. */
        if (host.clientWidth === 0 || host.clientHeight === 0) return;
        fitRef.current?.fit();
        const term = termRef.current;
        const id = sessionRef.current;
        if (term && id) void resizeSession(id, term.cols, term.rows).catch(() => {});
      }, RESIZE_DEBOUNCE);
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  /* Chỉ đăng ký khi đang có vùng chọn, và đó là toàn bộ cách `Ctrl+C` biết mình là lệnh nào: không
     chọn gì thì không ai nhận chord, `shellKeeps` trả phím lại cho shell và nó là lệnh huỷ như mọi
     khi. Trên macOS thì `Cmd+C` mang chord này còn `Ctrl+C` không mang gì — không có gì để phân xử. */
  useShortcut(
    "terminal.copy",
    () => {
      const term = termRef.current;
      if (!term) return;
      const text = term.getSelection();
      if (!text) return;
      /* Xoá vùng chọn ngay, kể cả khi chép hỏng: để nguyên thì lần `Ctrl+C` sau lại là chép, và
         không còn đường nào gửi lệnh huỷ xuống shell. */
      term.clearSelection();
      void copyText(text).catch((e) => onErrorRef.current(errorMessage(tRef.current, e)));
    },
    active && hasSelection,
  );

  /* Cùng `Ctrl/Cmd+C`, và hai cái không bao giờ cùng sống: có vùng chọn thì phím là lệnh chép, hết
     phiên mà không chọn gì thì nó đóng màn hình đã đứng im. Nên lần bấm đầu chép và xoá vùng chọn,
     lần thứ hai đóng — cùng nhịp với phiên đang sống, nơi lần thứ hai là lệnh huỷ. */
  useShortcut("terminal.dismiss", () => onDismissRef.current(), active && ended && !hasSelection);

  /* Phóng to thu nhỏ đi qua store dùng chung nên mọi tab terminal đổi cùng lúc — và vì `enabled` là
     `active`, chỉ tab đang xem mới nhận phím; ở một tab cơ sở dữ liệu thì `Ctrl+=` không có ai
     nhận và rơi xuống webview như cũ. */
  useShortcut("terminal.zoomIn", () => zoomTerminal(1), active);
  useShortcut("terminal.zoomOut", () => zoomTerminal(-1), active);

  /* Font đổi là ô chữ đổi, nên số cột và số dòng đổi theo: đo lại rồi báo cho đầu kia. Thiếu bước
     ấy thì `stty size` trong shell nói một đằng còn màn hình vẽ một nẻo, và mọi thứ vẽ theo chiều
     rộng cuối dòng đều lệch.

     Con trỏ và scrollback không đổi kích thước ô nào, nhưng chúng đi cùng effect này vì chúng đi
     cùng một object `settings`: tách ra là ba effect cùng một dependency. */
  useEffect(() => {
    const term = termRef.current;
    const host = hostRef.current;
    if (!term || !host) return;
    term.options.fontFamily = settings.fontFamily;
    term.options.fontSize = settings.fontSize;
    term.options.cursorStyle = settings.cursorStyle;
    term.options.cursorBlink = settings.cursorBlink;
    term.options.scrollback = settings.scrollback;
    // Khung đang ẩn thì để yên: `fit()` lúc ấy tính ra cols/rows rác. Tab quay lại sẽ đo lại —
    // xem effect `[active]` bên dưới.
    if (host.clientWidth === 0) return;
    fitRef.current?.fit();
    const id = sessionRef.current;
    if (id) void resizeSession(id, term.cols, term.rows).catch(() => {});
  }, [settings]);

  // Tab quay lại: cửa sổ có thể đã đổi kích thước trong lúc khung này ẩn, và `ResizeObserver`
  // không bắn cho một khung đang `display: none`.
  useEffect(() => {
    if (!active) return;
    const host = hostRef.current;
    const term = termRef.current;
    if (!host || !term || host.clientWidth === 0) return;
    fitRef.current?.fit();
    term.focus();
    const id = sessionRef.current;
    if (id) void resizeSession(id, term.cols, term.rows).catch(() => {});
  }, [active]);

  return (
    <div
      ref={hostRef}
      className={styles.host}
      role="application"
      aria-label={t("terminal.screen")}
    />
  );
}

export default TerminalView;
