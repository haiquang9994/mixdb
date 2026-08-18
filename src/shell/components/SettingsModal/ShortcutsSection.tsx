import { shortcutLabel } from "../../../core/platform";
import type { Chord } from "../../../core/shortcuts";
import { useTranslation } from "../../../i18n";
import { ALL_SHORTCUTS } from "../../shortcuts";
import styles from "./SettingsModal.module.css";

/** The chord as this platform spells it — `⌘A` on a Mac, `Ctrl+A` elsewhere. The same function
 *  names the reload button, so the table and the tooltips cannot come to disagree about a key. */
function chordLabel(chord: Chord): string {
  return shortcutLabel(chord.key.toUpperCase(), { shift: chord.shift, alt: chord.alt });
}

/**
 * Every Ctrl/Cmd shortcut the app has, read straight out of the catalogue the dispatcher resolves
 * against — so the table cannot say one thing while the app does another. A module's chords appear
 * because the module contributed them, not because this file knows about it.
 *
 * Read-only. The keys are not remappable yet, and a control that does nothing is worse than none.
 */
function ShortcutsSection() {
  const { t } = useTranslation();

  return (
    <>
      {ALL_SHORTCUTS.map((group) => (
        <div key={group.scope} className={styles.section}>
          <span className={styles.sectionLabel}>{t(group.labelKey)}</span>
          {group.defs.map((def) => (
            <div key={def.id} className={styles.shortcutRow}>
              <span>{t(def.labelKey)}</span>
              <kbd className={styles.shortcutKey}>{chordLabel(def.chord)}</kbd>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

export default ShortcutsSection;
