import { useEffect } from "react";
import type { ThemeMode } from "../../theme";
import type { Language } from "../../i18n";
import { useTranslation } from "../../i18n";
import styles from "./SettingsModal.module.css";

interface SettingsModalProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onClose: () => void;
}

function SettingsModal({ theme, onThemeChange, onClose }: SettingsModalProps) {
  const { t, lang, setLang } = useTranslation();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: "light", label: t("settings.themeLight") },
    { value: "dark", label: t("settings.themeDark") },
    { value: "system", label: t("settings.themeSystem") },
  ];

  const languageOptions: { value: Language; label: string }[] = [
    { value: "en", label: t("settings.languageEnglish") },
    { value: "vi", label: t("settings.languageVietnamese") },
  ];

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={t("settings.title")}>
        <div className={styles.header}>
          <h3 className={styles.title}>{t("settings.title")}</h3>
          <button type="button" className={styles.close} onClick={onClose} title={t("settings.close")}>
            ×
          </button>
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>{t("settings.appearance")}</span>
          <div className={styles.themeOptions}>
            {themeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={opt.value === theme ? `${styles.themeOption} ${styles.themeOptionActive}` : styles.themeOption}
                onClick={() => onThemeChange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>{t("settings.language")}</span>
          <div className={styles.themeOptions}>
            {languageOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={opt.value === lang ? `${styles.themeOption} ${styles.themeOptionActive}` : styles.themeOption}
                onClick={() => setLang(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default SettingsModal;
