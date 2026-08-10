import { CloseIcon, DownloadIcon, ReloadIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import type { UpdateCheck } from "../../update";
import styles from "./UpdateToast.module.css";

interface Props {
  update: UpdateCheck;
}

/** The first line of the release notes, which is where a release says what it is. Notes can run to
 *  a screenful of Markdown, and a corner panel is not where anyone reads that. */
function summarise(notes: string): string {
  const line = notes
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l !== "");
  if (!line) return "";
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

/**
 * The update, in the corner of the window: what is out, how far it has downloaded, and the button
 * that puts it in place.
 *
 * A corner rather than a bar across the top: this arrives while the user is in the middle of
 * something, and nothing here is urgent enough to move the thing they are looking at. Closing it
 * does not stop a download — it only hides the panel, and the MixDB button stays lit.
 */
function UpdateToast({ update }: Props) {
  const { t } = useTranslation();
  const { release, current, status, progress, error } = update;
  if (release === null) return null;

  const summary = summarise(release.notes);
  const downloading = status === "downloading";
  const installing = status === "installing";

  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <div className={styles.header}>
        <span className={styles.title}>
          {status === "downloaded"
            ? t("update.downloaded", { version: release.version })
            : t("update.available", { version: release.version })}
        </span>
        <button type="button" className={styles.close} onClick={update.dismiss} title={t("update.later")}>
          <CloseIcon />
        </button>
      </div>

      {status === "available" && (
        <>
          <p className={styles.current}>{t("update.runningNow", { version: current })}</p>
          {summary !== "" && <p className={styles.summary}>{summary}</p>}
          <p className={styles.hint}>{t("update.autoHint")}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.download} onClick={update.download}>
              <DownloadIcon />
              {t("update.updateNow")}
            </button>
            <button type="button" className={styles.secondary} onClick={update.dismiss}>
              {t("update.later")}
            </button>
            <button type="button" className={styles.secondary} onClick={update.skip}>
              {t("update.skip")}
            </button>
          </div>
        </>
      )}

      {(downloading || installing) && (
        <>
          <p className={styles.summary}>
            {installing
              ? t("update.installing")
              : progress < 0
                ? t("update.downloadingUnknown")
                : t("update.downloading", { percent: Math.round(progress * 100) })}
          </p>
          {/* Indeterminate whenever the server did not say how big the bundle is, which is what a
              negative progress means — a bar that sits at zero reads as a download that stalled. */}
          <div
            className={styles.progress}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={downloading && progress >= 0 ? Math.round(progress * 100) : undefined}
          >
            <div
              className={downloading && progress >= 0 ? styles.bar : `${styles.bar} ${styles.barIndeterminate}`}
              style={downloading && progress >= 0 ? { width: `${progress * 100}%` } : undefined}
            />
          </div>
          {installing && <p className={styles.hint}>{t("update.restartHint")}</p>}
        </>
      )}

      {status === "downloaded" && (
        <>
          <p className={styles.hint}>{t("update.restartHint")}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.download} onClick={update.install}>
              <ReloadIcon />
              {t("update.restartNow")}
            </button>
            <button type="button" className={styles.secondary} onClick={update.dismiss}>
              {t("update.later")}
            </button>
          </div>
        </>
      )}

      {status === "error" && (
        <>
          <p className={styles.summary}>{t("update.failed", { message: error })}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.download} onClick={update.openPage}>
              <DownloadIcon />
              {t("update.openPage")}
            </button>
            <button type="button" className={styles.secondary} onClick={update.dismiss}>
              {t("update.later")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default UpdateToast;
