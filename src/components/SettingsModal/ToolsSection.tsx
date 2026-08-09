import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "../../i18n";
import { toolsInstall, toolsSetPath, toolsStatus, toolsUninstall } from "../../tools";
import type { ToolStatus, ToolSuite } from "../../tools";
import styles from "./SettingsModal.module.css";

/** The two suites, and what each one is called where it is downloaded from. */
const SUITES: { suite: ToolSuite; labelKey: "tools.mysqlSuite" | "tools.mongoSuite" }[] = [
  { suite: "mysql", labelKey: "tools.mysqlSuite" },
  { suite: "mongo", labelKey: "tools.mongoSuite" },
];

/** What each way of finding a tool is called. Spelled out rather than built from the value, so
 * every key the translations need is one a search for it finds. */
const SOURCE_LABEL = {
  custom: "tools.sourceCustom",
  downloaded: "tools.sourceDownloaded",
  system: "tools.sourceSystem",
} as const;

/**
 * The dump and restore tools: where each one was found, and what can be done about it — download
 * MixDB's own copy, delete that copy again, or point the app at one already on this machine.
 */
function ToolsSection() {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolStatus[]>([]);
  /** The suite being downloaded or removed, so only its own buttons go quiet. */
  const [working, setWorking] = useState<ToolSuite | null>(null);
  const [error, setError] = useState("");

  const onError = useCallback((message: string) => setError(message), []);

  const refresh = useCallback(() => {
    toolsStatus()
      .then(setTools)
      .catch((e) => onError(String(e)));
  }, [onError]);

  useEffect(refresh, [refresh]);

  async function act(suite: ToolSuite, work: () => Promise<void>) {
    setWorking(suite);
    setError("");
    try {
      await work();
    } catch (e) {
      onError(String(e));
    } finally {
      setWorking(null);
      refresh();
    }
  }

  async function choose(tool: ToolStatus) {
    const path = await open({ multiple: false, directory: false });
    if (typeof path !== "string") return;
    try {
      await toolsSetPath(tool.name, path);
    } catch (e) {
      onError(String(e));
    }
    refresh();
  }

  async function forget(tool: ToolStatus) {
    try {
      await toolsSetPath(tool.name, null);
    } catch (e) {
      onError(String(e));
    }
    refresh();
  }

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>{t("tools.title")}</span>
      <p className={styles.hint}>{t("tools.intro")}</p>
      {error !== "" && (
        <p className={styles.toolError} role="alert">
          {error}
        </p>
      )}

      {SUITES.map(({ suite, labelKey }) => {
        const members = tools.filter((tool) => tool.suite === suite);
        // Only a copy MixDB downloaded can be removed; what was already on the machine is not
        // MixDB's to delete.
        const downloaded = members.some((tool) => tool.source === "downloaded");
        const busy = working === suite;
        return (
          <div key={suite} className={styles.toolSuite}>
            <div className={styles.toolSuiteHeader}>
              <span className={styles.toolSuiteName}>{t(labelKey)}</span>
              <div className={styles.toolSuiteActions}>
                <button
                  type="button"
                  className={styles.toolButton}
                  disabled={busy}
                  onClick={() => void act(suite, () => toolsInstall(suite))}
                >
                  {busy ? t("tools.working") : t(downloaded ? "tools.redownload" : "tools.download")}
                </button>
                {downloaded && (
                  <button
                    type="button"
                    className={`${styles.toolButton} ${styles.toolButtonDanger}`}
                    disabled={busy}
                    onClick={() => void act(suite, () => toolsUninstall(suite))}
                  >
                    {t("tools.remove")}
                  </button>
                )}
              </div>
            </div>

            {members.map((tool) => (
              <div key={tool.name} className={styles.tool}>
                <div className={styles.toolText}>
                  <span className={styles.toolName}>
                    {tool.name}
                    <span
                      className={
                        tool.source === null
                          ? `${styles.toolBadge} ${styles.toolBadgeMissing}`
                          : styles.toolBadge
                      }
                    >
                      {tool.source === null ? t("tools.missing") : t(SOURCE_LABEL[tool.source])}
                    </span>
                  </span>
                  <span className={styles.toolPath} title={tool.path ?? ""}>
                    {tool.path ?? t("tools.missingHint")}
                  </span>
                </div>
                <div className={styles.toolSuiteActions}>
                  <button
                    type="button"
                    className={styles.toolButton}
                    onClick={() => void choose(tool)}
                  >
                    {t("tools.choose")}
                  </button>
                  {tool.source === "custom" && (
                    <button
                      type="button"
                      className={styles.toolButton}
                      onClick={() => void forget(tool)}
                    >
                      {t("tools.forget")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default ToolsSection;
