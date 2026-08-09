import { useEffect } from "react";
import type { CSSProperties } from "react";
import type { AccentColor, ThemeMode } from "../../theme";
import { ACCENT_COLORS } from "../../theme";
import type { Language, TranslationKey } from "../../i18n";
import { CloseIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import ToolsSection from "./ToolsSection";
import styles from "./SettingsModal.module.css";

interface SettingsModalProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  accent: AccentColor;
  onAccentChange: (accent: AccentColor) => void;
  onClose: () => void;
}

/** `blue` -> `settings.accentBlue`, the label beside each swatch. */
function accentLabelKey(accent: AccentColor): TranslationKey {
  return `settings.accent${accent.charAt(0).toUpperCase()}${accent.slice(1)}` as TranslationKey;
}

function SettingsModal({ theme, onThemeChange, accent, onAccentChange, onClose }: SettingsModalProps) {
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
            <CloseIcon />
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
          <span className={styles.sectionLabel}>{t("settings.accent")}</span>
          <div className={styles.accentOptions}>
            {ACCENT_COLORS.map((opt) => {
              const label = t(accentLabelKey(opt));
              return (
                <button
                  key={opt}
                  type="button"
                  className={opt === accent ? `${styles.accentOption} ${styles.accentOptionActive}` : styles.accentOption}
                  /* The palette lives in App.css; the swatch only names which of the ten it is,
                     so it picks up that colour's light and dark cast on its own. */
                  style={{ "--accent-swatch": `var(--c-${opt})` } as CSSProperties}
                  onClick={() => onAccentChange(opt)}
                  title={label}
                  aria-label={label}
                  aria-pressed={opt === accent}
                />
              );
            })}
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

        <ToolsSection />
      </div>
    </>
  );
}

export default SettingsModal;
