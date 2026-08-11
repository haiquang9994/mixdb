import { useTranslation } from "../../i18n";
import type { UpdateCheck } from "../../update";
import styles from "./SettingsModal.module.css";

interface Props {
  update: UpdateCheck;
}

/** `2026-08-10 14:32` in the user's own locale — enough to tell a check from this minute from one
 *  from last week, which is all this line is for. */
function formatChecked(at: number): string {
  return new Date(at).toLocaleString();
}

/**
 * What version is running, whether a newer one is out, and the buttons that fetch and install it.
 *
 * The update itself lives in App so the panel in the corner and this section agree about what was
 * found and how far it has got; this only shows it. A download started here goes on showing its
 * progress in the corner, and vice versa — there is one download, not one per place it is offered.
 */
function UpdateSection({ update }: Props) {
  const { t } = useTranslation();
  const { status, release, error, lastChecked, current, skipped, progress } = update;
  const busy = status === "checking";
  /* No second check while the first update is being fetched or put in place: the handle the
     download is using would be replaced underneath it. */
  const working = status === "downloading" || status === "installing";

  function statusLine(): string {
    if (busy) return t("update.checking");
    if (status === "error") return release === null
      ? t("update.checkFailed", { message: error })
      : t("update.failed", { message: error });
    if (status === "downloading") {
      return progress < 0
        ? t("update.downloadingUnknown")
        : t("update.downloading", { percent: Math.round(progress * 100) });
    }
    if (status === "installing") return t("update.installing");
    if (status === "downloaded" && release) return t("update.downloaded", { version: release.version });
    if (status === "available" && release) return t("update.available", { version: release.version });
    if (status === "upToDate") return t("update.upToDate");
    return t("update.notCheckedYet");
  }

  return (
    /* No heading of its own: the pane is reached by a list that already names it. */
    <div className={styles.section}>
      <div className={styles.updateRow}>
        <div className={styles.updateText}>
          <span className={styles.updateVersion}>
            {current === "" ? t("update.notCheckedYet") : t("update.runningNow", { version: current })}
          </span>
          <span
            className={
              status === "error" ? `${styles.updateStatus} ${styles.updateStatusError}` : styles.updateStatus
            }
          >
            {statusLine()}
          </span>
        </div>
        <div className={styles.toolSuiteActions}>
          {status === "available" && (
            <button type="button" className={styles.toolButton} onClick={update.download}>
              {t("update.updateNow")}
            </button>
          )}
          {status === "downloaded" && (
            <button type="button" className={styles.toolButton} onClick={update.install}>
              {t("update.restartNow")}
            </button>
          )}
          {status === "error" && (
            <button type="button" className={styles.toolButton} onClick={update.openPage}>
              {t("update.openPage")}
            </button>
          )}
          <button type="button" className={styles.toolButton} disabled={busy || working} onClick={update.check}>
            {busy ? t("update.checking") : t("update.checkNow")}
          </button>
        </div>
      </div>

      {skipped && release !== null && (
        <div className={styles.updateRow}>
          <span className={styles.hint}>{t("update.skipped", { version: release.version })}</span>
          <button type="button" className={styles.toolButton} onClick={update.unskip}>
            {t("update.unskip")}
          </button>
        </div>
      )}

      {lastChecked !== null && (
        <p className={styles.hint}>{t("update.lastChecked", { at: formatChecked(lastChecked) })}</p>
      )}
      <p className={styles.hint}>{status === "downloaded" ? t("update.restartHint") : t("update.autoHint")}</p>
    </div>
  );
}

export default UpdateSection;
