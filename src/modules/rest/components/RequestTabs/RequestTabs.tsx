import { CloseIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import type { RestRequest } from "../../types";
import styles from "./RequestTabs.module.css";

interface Props {
  tabs: RestRequest[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** What a request with neither name nor URL is called. */
  label: (request: RestRequest) => string;
}

/**
 * The open requests, across the top of the main area.
 *
 * Closing asks nothing: there is no unsaved state to lose, because every edit is written through
 * to the request as it is made. Middle-click closes too, which is what a tab strip does.
 */
function RequestTabs({ tabs, activeId, onSelect, onClose, label }: Props) {
  const { t } = useTranslation();
  return (
    <div className={styles.strip} role="tablist">
      {tabs.map((request) => (
        <div
          key={request.id}
          role="tab"
          aria-selected={request.id === activeId}
          tabIndex={0}
          className={`${styles.tab}${request.id === activeId ? ` ${styles.tabActive}` : ""}`}
          onClick={() => onSelect(request.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onSelect(request.id);
          }}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(request.id);
          }}
        >
          <span className={styles.method}>{request.method}</span>
          <span className={styles.title}>{label(request)}</span>
          <button
            type="button"
            className={styles.close}
            aria-label={t("rest.shortcutCloseRequest")}
            title={t("rest.shortcutCloseRequest")}
            onClick={(e) => {
              e.stopPropagation();
              onClose(request.id);
            }}
          >
            <CloseIcon size="0.85em" />
          </button>
        </div>
      ))}
    </div>
  );
}

export default RequestTabs;
