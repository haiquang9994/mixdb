import type { ShortcutGroup } from "../../core/shortcuts";

/**
 * The chords this module's panes answer, handed to the shell through
 * `ModuleDefinition.shortcuts` — the same way `DB_SHORTCUTS` is.
 *
 * Labelled from this module's own dictionary: the `shortcuts.*` group belongs to the shell, and a
 * second dictionary claiming it stops the build.
 */
export const REST_SHORTCUTS: ShortcutGroup[] = [
  {
    scope: "rest",
    labelKey: "rest.shortcutScope",
    defs: [
      /* No `whenTyping: "ignore"`: sending from inside the body editor is the whole reason this
         chord exists, and a body is a textarea. */
      { id: "rest.send", chord: { key: "enter" }, labelKey: "rest.shortcutSend" },
      { id: "rest.newRequest", chord: { key: "n" }, labelKey: "rest.shortcutNewRequest" },
      /* Shares `Ctrl/Cmd+W` with the shell's `app.closeTab`. `decide()` resolves a clash in favour
         of whichever handler started listening last, which is this one — and it is registered only
         while a request tab is open, so an empty REST workspace still closes the MixDB tab. */
      { id: "rest.closeRequest", chord: { key: "w" }, labelKey: "rest.shortcutCloseRequest" },
      { id: "rest.history", chord: { key: "h" }, labelKey: "rest.shortcutHistory" },
    ],
  },
];
