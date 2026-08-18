import { useState } from "react";
import ErrorBanner from "../../../../components/ErrorBanner";
import { useTranslation } from "../../../../i18n";
import {
  SOURCE_MAX_BYTES,
  availableModes,
  pickMode,
  type DetectedBody,
  type ViewMode,
} from "../../contentType";
import { formatBytes } from "../../format";
import type { RestResponse } from "../../types";
import HexView from "../HexView";
import ResponseStatusBar from "../ResponseStatusBar";
import styles from "./ResponsePane.module.css";

/** How much of a text body is put on screen. Past this the webview spends its time laying out
 *  characters nobody is reading. */
const MAX_TEXT = 5 * 1024 * 1024;

/**
 * The modes that exist so far.
 *
 * `availableModes` answers what a body *could* be shown as; this is what has been built. Task 14
 * adds `source` and Task 15 adds `preview`, one word each, and until then neither is ever offered
 * — which is what keeps every task in this plan something you can ship.
 */
const IMPLEMENTED: ViewMode[] = ["raw"];

export interface SendState {
  phase: "idle" | "sending" | "done" | "cancelled" | "failed";
  /** The id `rest_cancel` names, while a send is in flight. */
  sendId: string | null;
  /** The URL that was actually sent, which is how a redirect is spotted. */
  sentUrl: string;
  response: RestResponse | null;
  bytes: Uint8Array | null;
  detected: DetectedBody | null;
  /** Already translated. A failed send keeps the previous response on screen underneath it. */
  error: string | null;
}

export const IDLE_SEND: SendState = {
  phase: "idle",
  sendId: null,
  sentUrl: "",
  response: null,
  bytes: null,
  detected: null,
  error: null,
};

interface Props {
  state: SendState;
  /** The viewer the user last chose, kept even while this body cannot be shown in it. */
  preferred: ViewMode;
  onPreferredChange: (mode: ViewMode) => void;
  headersOpen: boolean;
  onHeadersOpenChange: (open: boolean) => void;
  onDismissError: () => void;
}

/** The right-hand pane: the status line, four tabs, and whichever of them is open. */
function ResponsePane({
  state,
  preferred,
  onPreferredChange,
  headersOpen,
  onHeadersOpenChange,
  onDismissError,
}: Props) {
  const { t } = useTranslation();
  const [wrap, setWrap] = useState(false);

  const { response, bytes, detected } = state;
  const size = bytes?.length ?? 0;
  const possible = detected === null ? [] : availableModes(detected.kind, size);
  const offered = possible.filter((mode) => IMPLEMENTED.includes(mode));
  const mode = offered.length === 0 ? null : pickMode(preferred, offered);

  const tabs: { key: ViewMode | "headers"; label: string }[] = [
    ...offered.map((m) => ({
      key: m,
      label:
        m === "preview"
          ? t("rest.previewTab")
          : m === "source"
            ? t("rest.sourceTab")
            : t("rest.rawTab"),
    })),
    ...(response === null
      ? []
      : [
          {
            key: "headers" as const,
            label: t("rest.responseHeadersTab", { n: response.headers.length }),
          },
        ]),
  ];

  function view() {
    if (headersOpen && response !== null) {
      return (
        <div className={styles.headers}>
          {response.headers.map(([name, value], i) => (
            // Keyed on the position: a header may appear twice with the same name and value, and
            // the order they arrived in is part of what the tab is for.
            <div key={`${name}-${i}`} style={{ display: "contents" }}>
              <span className={styles.headerName}>{name}</span>
              <span className={styles.headerValue}>{value}</span>
            </div>
          ))}
        </div>
      );
    }
    if (bytes === null || detected === null || mode === null) {
      return <p className="rest-empty muted">{t("rest.responseEmpty")}</p>;
    }
    if (mode === "raw") {
      if (detected.text === null) {
        return <HexView bytes={bytes} totalSize={response?.body_size ?? bytes.length} />;
      }
      const shown = detected.text.slice(0, MAX_TEXT);
      return (
        <>
          <label className={styles.toolbar}>
            <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
            {t("rest.wrapLines")}
          </label>
          {shown.length < detected.text.length && (
            <p className={`${styles.notice} muted`}>
              {t("rest.truncatedNotice", {
                shown: formatBytes(MAX_TEXT),
                total: formatBytes(response?.body_size ?? bytes.length),
              })}
            </p>
          )}
          <pre className={`${styles.raw}${wrap ? ` ${styles.rawWrapped}` : ""}`}>{shown}</pre>
        </>
      );
    }
    // Tasks 14 and 15 add the other two; until then `IMPLEMENTED` keeps them off the strip.
    return null;
  }

  return (
    <div className={styles.pane}>
      <ResponseStatusBar state={state} />
      {state.error !== null && <ErrorBanner message={state.error} onDismiss={onDismissError} />}
      {tabs.length > 0 && (
        <div className="rest-pane-tabs" role="tablist">
          {tabs.map((tab) => {
            const selected = tab.key === "headers" ? headersOpen : !headersOpen && tab.key === mode;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`rest-pane-tab${selected ? " rest-pane-tab-active" : ""}`}
                onClick={() => {
                  if (tab.key === "headers") {
                    onHeadersOpenChange(true);
                    return;
                  }
                  onHeadersOpenChange(false);
                  onPreferredChange(tab.key);
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
      {detected !== null && size > SOURCE_MAX_BYTES && !headersOpen && (
        <p className={`${styles.notice} muted`}>
          {t("rest.sourceTooBig", { limit: formatBytes(SOURCE_MAX_BYTES) })}
        </p>
      )}
      <div className={styles.body}>{view()}</div>
    </div>
  );
}

export default ResponsePane;
