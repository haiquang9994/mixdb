import type { ShortcutGroup } from "../core/shortcuts";
import { MODULES } from "./registry";

/** The chords the app answers wherever you are — the tab bar's, and the reload every pane shares.
 *
 *  Empty until the shell's own keys are moved over. */
export const SHELL_SHORTCUTS: ShortcutGroup[] = [];

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
