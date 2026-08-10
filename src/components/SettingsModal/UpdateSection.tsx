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
 * What version is running, whether a newer one is out, and the button that asks GitHub again.
 *
 * The check itself lives in App so the panel in the corner and this section agree about what was
 * found; this only shows it and offers the three things the user can do with it.
 */
function UpdateSection({ update }: Props) {
  const { t } = useTranslation();
  const { status, release, error, lastChecked, current, skipped } = update;
  const busy = status === "checking";

  function statusLine(): string {
    if (busy) return t("update.checking");
    if (status === "error") return t("update.checkFailed", { message: error });
    if (status === "available" && release) return t("update.available", { version: release.version });
    if (status === "upToDate") return t("update.upToDate");
    return t("update.notCheckedYet");
  }

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>{t("update.title")}</span>

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
              {t("update.download")}
            </button>
          )}
          <button type="button" className={styles.toolButton} disabled={busy} onClick={update.check}>
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
      <p className={styles.hint}>{t("update.manualHint")}</p>
    </div>
  );
}

export default UpdateSection;
