import { describe, expect, it } from "vitest";
import { ALL_SHORTCUTS, MODULE_TAB_SHORTCUTS, newModuleTabId } from "./shortcuts";
import { MODULES } from "./registry";

/* The number keys are derived from the registry, so what is worth pinning down is the derivation:
   which module each key opens, and that the catalogue the table and the dispatcher read carries
   every one of them. `App.tsx` registers its handlers from the same list, which is why nothing here
   has to reach into React to check they agree. */
describe("MODULE_TAB_SHORTCUTS", () => {
  it("gives the modules 1, 2, 3… in the order the registry lists them", () => {
    expect(MODULE_TAB_SHORTCUTS.map((entry) => [entry.def.chord.key, entry.moduleId])).toEqual(
      MODULES.map((module, i) => [String(i + 1), module.id]),
    );
  });

  it("names each chord after the module it opens, and the module after itself", () => {
    for (const { moduleId, def } of MODULE_TAB_SHORTCUTS) {
      expect(def.id).toBe(newModuleTabId(moduleId));
      expect(def.labelVars?.module).toBe(MODULES.find((m) => m.id === moduleId)?.labelKey);
    }
  });

  it("is on the catalogue the dispatcher resolves against", () => {
    const ids = ALL_SHORTCUTS.flatMap((group) => group.defs).map((def) => def.id);
    for (const { def } of MODULE_TAB_SHORTCUTS) expect(ids).toContain(def.id);
  });

  it("leaves no chord claimed twice", () => {
    const chords = ALL_SHORTCUTS.flatMap((group) => group.defs)
      // `rest.closeRequest` shares `Ctrl/Cmd+W` with `app.closeTab` on purpose — the pane listening
      // last wins. Only the number keys are being checked here.
      .filter((def) => /^[1-9]$/.test(def.chord.key))
      .map((def) => def.chord.key);
    expect(new Set(chords).size).toBe(chords.length);
  });
});
