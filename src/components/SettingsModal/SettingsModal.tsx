import { useEffect } from "react";
import type { ThemeMode } from "../../theme";
import styles from "./SettingsModal.module.css";

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Sáng" },
  { value: "dark", label: "Tối" },
  { value: "system", label: "Hệ thống" },
];

interface SettingsModalProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onClose: () => void;
}

function SettingsModal({ theme, onThemeChange, onClose }: SettingsModalProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Cài đặt">
        <div className={styles.header}>
          <h3 className={styles.title}>Cài đặt</h3>
          <button type="button" className={styles.close} onClick={onClose} title="Đóng">
            ×
          </button>
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>Giao diện</span>
          <div className={styles.themeOptions}>
            {THEME_OPTIONS.map((opt) => (
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
      </div>
    </>
  );
}

export default SettingsModal;
