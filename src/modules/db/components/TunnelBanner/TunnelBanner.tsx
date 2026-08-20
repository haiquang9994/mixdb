import { useEffect, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { onTunnelState, tunnelReconnect } from "../../tunnel";
import { HIDDEN, nextBannerState, type BannerState } from "./state";
import styles from "./TunnelBanner.module.css";

/** "Đã kết nối lại" ở lại bao lâu trước khi tự biến mất. */
const REASSURED_MS = 3000;

interface Props {
  connectionId: string;
}

/**
 * Nói cho người dùng biết SSH tunnel của tab này vừa đứt, đang được mở lại, hay không mở lại được.
 *
 * Trả `null` khi không có gì để nói — kể cả với connection không đi qua tunnel, vì với chúng không
 * có sự kiện nào tới cả.
 */
function TunnelBanner({ connectionId }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<BannerState>(HIDDEN);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let stopped = false;
    void onTunnelState(connectionId, (event) =>
      setState((current) => nextBannerState(current, event))
    ).then((fn) => {
      // Tab có thể đã đóng trước khi `listen` kịp trả về: gỡ ngay thay vì để lại một người nghe
      // không ai gỡ.
      if (stopped) fn();
      else unlisten = fn;
    });
    return () => {
      stopped = true;
      unlisten?.();
      setState(HIDDEN);
    };
  }, [connectionId]);

  useEffect(() => {
    if (state.kind !== "reconnected") return;
    const timer = setTimeout(() => setState(HIDDEN), REASSURED_MS);
    return () => clearTimeout(timer);
  }, [state]);

  if (state.kind === "hidden") return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await tunnelReconnect(connectionId);
    } catch {
      // Không cần bắt gì: dù mở lại được hay không, tunnel tự phát tin và banner đổi theo tin đó.
    } finally {
      setRetrying(false);
    }
  };

  return (
    <p className={`${styles.banner} ${styles[state.kind]}`} role="status">
      {state.kind === "reconnecting" && <span className={styles.spinner} aria-hidden="true" />}
      <span className={styles.text}>
        {state.kind === "reconnecting" && t("tunnel.reconnecting")}
        {state.kind === "reconnected" && t("tunnel.reconnected")}
        {state.kind === "failed" && t("tunnel.failed", { message: errorMessage(t, state.error) })}
      </span>
      {state.kind === "failed" && (
        <button type="button" className={styles.retry} onClick={retry} disabled={retrying}>
          {t("tunnel.retry")}
        </button>
      )}
    </p>
  );
}

export default TunnelBanner;
