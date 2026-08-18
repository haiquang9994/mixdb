import type { ShortcutGroup } from "../core/shortcuts";
import { MODULES } from "./registry";

/** The chords the app answers wherever you are — the tab bar's, and the reload every pane shares. */
export const SHELL_SHORTCUTS: ShortcutGroup[] = [
  {
    scope: "app",
    labelKey: "shortcuts.scope.app",
    defs: [
      /* Not `inModal`: the pane behind a dialog is not the one in front, and a reload fired from
         behind a confirmation acts on the very thing being asked about. */
      { id: "pane.reload", chord: { key: "r" }, labelKey: "shortcuts.reload" },
    ],
  },
];

/**
 * Every chord in the app, the shell's and the modules'.
 *
 * Assembled here rather than inside `core/shortcuts/`: that folder is the mechanism and may not
 * import from `shell/` or `modules/` at all — see `.agent/architecture/frontend.md`. The
 * dispatcher is handed this list; it never goes looking for one.
 *
 * A module-level constant, so the dispatcher binds its listener once for the life of the app.
 */
export const ALL_SHORTCUTS: ShortcutGroup[] = [
  ...SHELL_SHORTCUTS,
  ...MODULES.flatMap((m) => m.shortcuts ?? []),
];
