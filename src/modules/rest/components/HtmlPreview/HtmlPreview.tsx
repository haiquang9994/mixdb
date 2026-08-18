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
 * `sandbox` is present and **empty**: no `allow-scripts`, no `allow-same-origin`, no forms and no
 * top-level navigation. A script in the response does not run, and there is no path from the
 * frame to Tauri's IPC. Nothing about this is configurable.
 *
 * No `<base href>` by default either, so images, stylesheets and tracking pixels do not load and
 * the page shown is its own markup and inline CSS. Turning that on is a decision to let the app
 * call the server again, which is why it is a checkbox and why it starts off.
 */
function HtmlPreview({ html, finalUrl }: Props) {
  const { t } = useTranslation();
  const [external, setExternal] = useState(false);

  const document =
    external && finalUrl !== ""
      ? html.replace(/<head([^>]*)>/i, `<head$1><base href="${finalUrl.replace(/"/g, "&quot;")}">`)
      : html;

  return (
    <div className={styles.preview}>
      <label className={styles.toolbar} title={t("rest.loadExternalHint")}>
        <input type="checkbox" checked={external} onChange={(e) => setExternal(e.target.checked)} />
        {t("rest.loadExternal")}
      </label>
      <iframe
        // Remounted when the switch is flipped: a `<base>` added to a document already loaded
        // changes nothing about what it already fetched.
        key={external ? "external" : "isolated"}
        className={styles.frame}
        sandbox=""
        srcDoc={document}
        title={t("rest.previewTab")}
      />
    </div>
  );
}

export default HtmlPreview;
