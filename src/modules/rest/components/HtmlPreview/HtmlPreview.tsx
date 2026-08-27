import { useState } from "react";
import { useTranslation } from "../../../../i18n";
import styles from "./HtmlPreview.module.css";

interface Props {
  html: string;
  /** Where the response ended up, which is what external resources would be resolved against. */
  finalUrl: string;
}

/**
 * A rendered HTML response, behind the tightest sandbox there is.
 *
 * `sandbox` is present and starts **empty**: no scripts, no same-origin, no forms and no top-level
 * navigation. Two switches loosen it, both off every time this pane is drawn, and both deliberately
 * here rather than in Settings — a decision about a response belongs beside that response, not in a
 * dialog where it was made three weeks ago about something else.
 *
 * Neither switch ever adds `allow-same-origin`. That flag next to `allow-scripts` is not a looser
 * sandbox, it is no sandbox: the frame would share the app's origin and from there reach Tauri's
 * IPC. Nothing here offers it.
 *
 * *Load external resources* adds a `<base href>`, so images, stylesheets and tracking pixels reach
 * the server again. *Run scripts* adds `allow-scripts`, so the page's own script runs — on the app's
 * main thread, which is the honest reason it stays a per-response decision: a response that loops
 * forever takes the window with it, and the way out is not a checkbox you can still click.
 */
function HtmlPreview({ html, finalUrl }: Props) {
  const { t } = useTranslation();
  const [external, setExternal] = useState(false);
  const [scripts, setScripts] = useState(false);

  const document =
    external && finalUrl !== ""
      ? html.replace(/<head([^>]*)>/i, `<head$1><base href="${finalUrl.replace(/"/g, "&quot;")}">`)
      : html;

  return (
    <div className={styles.preview}>
      <div className={styles.toolbar}>
        <label className={styles.switch} title={t("rest.loadExternalHint")}>
          <input
            type="checkbox"
            checked={external}
            onChange={(e) => setExternal(e.target.checked)}
          />
          {t("rest.loadExternal")}
        </label>
        <label className={styles.switch} title={t("rest.runScriptsHint")}>
          <input type="checkbox" checked={scripts} onChange={(e) => setScripts(e.target.checked)} />
          {t("rest.runScripts")}
        </label>
      </div>
      <iframe
        // Remounted when either switch is flipped: a `<base>` added to a document already loaded
        // changes nothing about what it already fetched, and a sandbox is read once at load.
        key={`${external ? "external" : "isolated"}-${scripts ? "scripts" : "inert"}`}
        className={styles.frame}
        sandbox={scripts ? "allow-scripts" : ""}
        srcDoc={document}
        title={t("rest.previewTab")}
      />
    </div>
  );
}

export default HtmlPreview;
