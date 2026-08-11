import { useTranslation } from "../../i18n";
import styles from "./LoadingOverlay.module.css";

interface Props {
  /** What the overlay says it is doing. Defaults to the generic "Loading..." text. */
  label?: string;
}

/** A translucent veil over the content it covers, with a single line of status text.
 *
 * Meant for a refetch or a write that replaces data already on screen: the previous data
 * stays visible (and keeps its scroll position) instead of collapsing into a placeholder.
 * The nearest positioned ancestor is what gets covered, so mount it as a sibling of the
 * scroll container inside a `position: relative` wrapper — that way the veil stays pinned
 * to the viewport rather than scrolling away with the content. */
function LoadingOverlay({ label }: Props) {
  const { t } = useTranslation();

  return (
    <div className={styles.overlay}>
      <span className={styles.label}>
        {/* Decoration on a line that already says what is happening, so it is hidden rather than
            described a second time. */}
        <span className={styles.spinner} aria-hidden="true" />
        {label ?? t("common.loading")}
      </span>
    </div>
  );
}

export default LoadingOverlay;
