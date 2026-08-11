import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import type { AccentColor, ThemeMode } from "../../theme";
import type { TranslationKey } from "../../i18n";
import type { IconProps } from "../../icons";
import { CloseIcon, DownloadIcon, PaletteIcon, WrenchIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import type { UpdateCheck } from "../../update";
import { useDialogExit } from "../dialogMotion";
import AppearanceSection from "./AppearanceSection";
import ToolsSection from "./ToolsSection";
import UpdateSection from "./UpdateSection";
import styles from "./SettingsModal.module.css";

interface SettingsModalProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  accent: AccentColor;
  onAccentChange: (accent: AccentColor) => void;
  update: UpdateCheck;
  onClose: () => void;
}

type SectionId = "appearance" | "tools" | "update";

/** The panes, in the order they are listed: the one a user changes often first, the errands after
 *  it. Each names itself with the heading its own content used to carry, so nothing is said twice
 *  once the list is on screen. */
const SECTIONS: { id: SectionId; labelKey: TranslationKey; icon: ComponentType<IconProps> }[] = [
  { id: "appearance", labelKey: "settings.appearance", icon: PaletteIcon },
  { id: "tools", labelKey: "tools.title", icon: WrenchIcon },
  { id: "update", labelKey: "update.title", icon: DownloadIcon },
];

/**
 * Everything about the app rather than about a connection.
 *
 * It is a list of panes rather than one long scroll: theme, accent and language are settings, the
 * dump tools are a downloader, and the updater is a downloader of another kind — three things that
 * happen to live behind the same door, and reading as one column made the door look busier than
 * what is behind it.
 */
function SettingsModal({ theme, onThemeChange, accent, onAccentChange, update, onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const { close, cls } = useDialogExit();
  /* Opened while an update is waiting, this dialog is almost always being opened *for* the update —
     the brand button's dot is what the user just clicked. */
  const [section, setSection] = useState<SectionId>(update.pending ? "update" : "appearance");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close(onClose);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, onClose]);

  return (
    <>
      <div className={cls(styles.overlay)} onClick={() => close(onClose)} />
      <div className={cls(styles.dialog)} role="dialog" aria-modal="true" aria-label={t("settings.title")}>
        <div className={styles.header}>
          <h3 className={styles.title}>{t("settings.title")}</h3>
          <button type="button" className={styles.close} onClick={() => close(onClose)} title={t("settings.close")}>
            <CloseIcon />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.nav} role="tablist" aria-orientation="vertical">
            {SECTIONS.map(({ id, labelKey, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`settings-tab-${id}`}
                aria-selected={id === section}
                aria-controls={`settings-panel-${id}`}
                className={id === section ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
                onClick={() => setSection(id)}
              >
                <Icon size={15} />
                <span className={styles.navLabel}>{t(labelKey)}</span>
                {/* The same dot the brand button carries, so whichever of the two brought the user
                    here, the thing waiting for them is marked the same way. */}
                {id === "update" && update.pending && (
                  <span
                    className={styles.navDot}
                    title={update.release ? t("update.available", { version: update.release.version }) : undefined}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Hidden rather than unmounted: a download started under Tools carries on when the user
              goes to look at something else, and it has to still be there — with its bar where it
              left it — when they come back. */}
          <div
            className={styles.panel}
            role="tabpanel"
            id="settings-panel-appearance"
            aria-labelledby="settings-tab-appearance"
            hidden={section !== "appearance"}
          >
            <AppearanceSection
              theme={theme}
              onThemeChange={onThemeChange}
              accent={accent}
              onAccentChange={onAccentChange}
            />
          </div>
          <div
            className={styles.panel}
            role="tabpanel"
            id="settings-panel-tools"
            aria-labelledby="settings-tab-tools"
            hidden={section !== "tools"}
          >
            <ToolsSection />
          </div>
          <div
            className={styles.panel}
            role="tabpanel"
            id="settings-panel-update"
            aria-labelledby="settings-tab-update"
            hidden={section !== "update"}
          >
            <UpdateSection update={update} />
          </div>
        </div>
      </div>
    </>
  );
}

export default SettingsModal;
