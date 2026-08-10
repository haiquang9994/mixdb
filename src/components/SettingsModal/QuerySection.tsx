import { useTranslation } from "../../i18n";
import { AUTO_LIMIT_CHOICES, setAutoLimit, useAutoLimit } from "../../querySettings";
import styles from "./SettingsModal.module.css";

/**
 * What the Query tab does to a script on its way to the server.
 *
 * One setting, and it is on by default: a `SELECT` with no `LIMIT` against a table nobody has
 * counted lately is the commonest way to make an editor stop responding, and the ceiling costs
 * nothing to anyone who was going to write their own.
 */
function QuerySection() {
  const { t } = useTranslation();
  const limit = useAutoLimit();

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>{t("settings.queryTitle")}</span>
      <div className={styles.themeOptions}>
        {AUTO_LIMIT_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            className={
              choice === limit ? `${styles.themeOption} ${styles.themeOptionActive}` : styles.themeOption
            }
            onClick={() => setAutoLimit(choice)}
          >
            {choice === 0 ? t("settings.autoLimitOff") : t("settings.autoLimitRows", { n: choice })}
          </button>
        ))}
      </div>
      <p className={styles.hint}>{t("settings.autoLimitHint")}</p>
    </div>
  );
}

export default QuerySection;
