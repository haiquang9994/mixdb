import { useTranslation } from "../../i18n";
import styles from "./TransferOverlay.module.css";

interface Props {
  /** What is running, in full — "Dumping pnedu...", say. */
  label: string;
}

/**
 * The veil for dumping, restoring, dropping and fetching the tools.
 *
 * Those four differ from every other wait in the app: an external tool is doing the work, it can
 * run for minutes, and nothing in the connection can be touched while it does. So unlike
 * LoadingOverlay's one quiet line over a single panel, this one dims the whole workspace, states
 * in plain size what is happening, and says the wait is expected — otherwise a locked tab reads
 * as a hung one.
 *
 * It covers its nearest positioned ancestor, which is the workspace: the tab bar and the other
 * connections stay live, so a long dump in one tab never holds up work in another.
 */
function TransferOverlay({ label }: Props) {
  const { t } = useTranslation();

  return (
    <div className={styles.overlay} role="status" aria-live="polite" aria-busy="true">
      <div className={styles.card}>
        <div className={styles.spinner} aria-hidden="true" />
        <p className={styles.label}>{label}</p>
        <p className={styles.hint}>{t("dump.transferHint")}</p>
      </div>
    </div>
  );
}

export default TransferOverlay;
