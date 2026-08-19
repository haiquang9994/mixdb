import { Tab, TabAction, TabStrip, TabTitle, tabKeyDown } from "../../../../components/TabStrip";
import { PlusIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import type { RestRequest } from "../../types";

interface Props {
  tabs: RestRequest[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** What a request with neither name nor URL is called. */
  label: (request: RestRequest) => string;
  /** Handed to the strip. The workspace puts the environment dropdown beside it and moves the
   *  background and the bottom edge onto the row that holds both. */
  className?: string;
}

/**
 * The open requests, across the top of the main area.
 *
 * Drawn by the shared `TabStrip`, which is also what the app's own tab bar is drawn by — a tab is
 * a tab, and a second strip two rows below the first one that answered to different rules read as
 * a different app.
 *
 * Closing asks nothing: there is no unsaved state to lose, because every edit is written through
 * to the request as it is made. Middle-click closes too, which is what a tab strip does.
 */
function RequestTabs({ tabs, activeId, onSelect, onClose, onNew, label, className }: Props) {
  const { t } = useTranslation();
  return (
    <TabStrip role="tablist" className={className}>
      {tabs.map((request) => (
        <Tab
          key={request.id}
          active={request.id === activeId}
          role="tab"
          aria-selected={request.id === activeId}
          tabIndex={0}
          onClose={() => onClose(request.id)}
          closeLabel={t("rest.shortcutCloseRequest")}
          onClick={() => onSelect(request.id)}
          onKeyDown={tabKeyDown(() => onSelect(request.id))}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(request.id);
          }}
        >
          <span className={`rest-method rest-method-${request.method}`}>{request.method}</span>
          <TabTitle>{label(request)}</TabTitle>
        </Tab>
      ))}
      {/* Sits after the last tab, as the shell's does after its own — the same gesture in the same
          place, one row down. */}
      <TabAction
        aria-label={t("rest.newRequest")}
        title={t("rest.newRequest")}
        onClick={onNew}
      >
        <PlusIcon size="1em" />
      </TabAction>
    </TabStrip>
  );
}

export default RequestTabs;
