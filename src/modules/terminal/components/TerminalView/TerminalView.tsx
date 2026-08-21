import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import {
  closeSession,
  openSession,
  resizeSession,
  writeSession,
  type SessionExit,
} from "../../api";
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
  onError: (message: string) => void;
}

function TerminalView({ target, active, onOpened, onExit, onFailed, onError }: Props) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);

  // Callback đi qua ref: effect mở phiên chỉ được chạy lại khi `target` đổi, không phải mỗi lần
  // cha render lại.
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: '"Fira Code", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
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

    void openSession(id, target, { cols: term.cols, rows: term.rows }, (message) => {
      if (message instanceof ArrayBuffer) {
        term.write(new Uint8Array(message));
        return;
      }
      ended = true;
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
