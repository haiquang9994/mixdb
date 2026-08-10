import { CloseIcon, DownloadIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import type { Release } from "../../update";
import styles from "./UpdateToast.module.css";

interface Props {
  release: Release;
  current: string;
  /** Opens the release page in the browser. */
  onDownload: () => void;
  /** Hides this until the next launch, leaving the MixDB button lit. */
  onDismiss: () => void;
  /** Hides it for good, for this version. */
  onSkip: () => void;
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
 * The news that a newer MixDB exists, in the corner of the window.
 *
 * A corner rather than a bar across the top: this arrives while the user is in the middle of
 * something, and nothing here is urgent enough to move the thing they are looking at.
 */
function UpdateToast({ release, current, onDownload, onDismiss, onSkip }: Props) {
  const { t } = useTranslation();
  const summary = summarise(release.notes);

  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <div className={styles.header}>
        <span className={styles.title}>{t("update.available", { version: release.version })}</span>
        <button type="button" className={styles.close} onClick={onDismiss} title={t("update.later")}>
          <CloseIcon />
        </button>
      </div>

      <p className={styles.current}>{t("update.runningNow", { version: current })}</p>
      {summary !== "" && <p className={styles.summary}>{summary}</p>}
      <p className={styles.hint}>{t("update.manualHint")}</p>

      <div className={styles.actions}>
        <button type="button" className={styles.download} onClick={onDownload}>
          <DownloadIcon />
          {t("update.download")}
        </button>
        <button type="button" className={styles.secondary} onClick={onDismiss}>
          {t("update.later")}
        </button>
        <button type="button" className={styles.secondary} onClick={onSkip}>
          {t("update.skip")}
        </button>
      </div>
    </div>
  );
}

export default UpdateToast;
