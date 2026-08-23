import { describe, expect, it } from "vitest";
import { parseSession } from "./session";

const MODULE_IDS = ["db", "rest", "terminal"];

const SESSION = {
  tabs: [
    { id: "a", moduleId: "db", title: "demo@192.168.50.86" },
    { id: "b", moduleId: "terminal", title: "localhost" },
  ],
  activeId: "b",
};

const stored = (value: unknown) => JSON.stringify(value);

describe("parseSession", () => {
  it("reads back what was written", () => {
    expect(parseSession(stored(SESSION), MODULE_IDS)).toEqual(SESSION);
  });

  it("has nothing to say on a first launch", () => {
    expect(parseSession(null, MODULE_IDS)).toBeNull();
  });

  /* Everything below is a string some other version of the app wrote, so none of it is trusted —
     see the note on the function. Each of these once meant a tab bar that threw on the way up. */
  it("gives up on anything that is not a session", () => {
    expect(parseSession("{ half-written", MODULE_IDS)).toBeNull();
    expect(parseSession(stored(null), MODULE_IDS)).toBeNull();
    expect(parseSession(stored("a string"), MODULE_IDS)).toBeNull();
    expect(parseSession(stored({ activeId: "a" }), MODULE_IDS)).toBeNull();
    expect(parseSession(stored({ tabs: "not an array" }), MODULE_IDS)).toBeNull();
  });

  it("drops the tabs it cannot draw and keeps the rest", () => {
    const session = {
      tabs: [
        { id: "a", moduleId: "db", title: "demo" },
        // A module taken out of the registry since this was written.
        { id: "b", moduleId: "gopher", title: "gopher://" },
        { id: "c", title: "no module at all" },
        { id: "", moduleId: "rest", title: "no id" },
        null,
      ],
      activeId: "a",
    };
    expect(parseSession(stored(session), MODULE_IDS)).toEqual({
      tabs: [{ id: "a", moduleId: "db", title: "demo" }],
      activeId: "a",
    });
  });

  it("gives up when nothing is left to draw", () => {
    const session = { tabs: [{ id: "a", moduleId: "gopher", title: "x" }], activeId: "a" };
    expect(parseSession(stored(session), MODULE_IDS)).toBeNull();
  });

  it("falls back to the last tab when the active one did not survive", () => {
    const session = {
      tabs: [
        { id: "a", moduleId: "db", title: "demo" },
        { id: "b", moduleId: "rest", title: "GET /users" },
      ],
      activeId: "gone",
    };
    expect(parseSession(stored(session), MODULE_IDS)?.activeId).toBe("b");
  });

  it("keeps nothing a stored tab was carrying beyond the three fields", () => {
    // Badges hold React elements and are never written; a session from a version that did write
    // something extra must not put it back into the tab bar's state.
    const session = { tabs: [{ ...SESSION.tabs[0], badges: ["stale"] }], activeId: "a" };
    expect(parseSession(stored(session), MODULE_IDS)?.tabs[0]).toEqual(SESSION.tabs[0]);
  });

  /* The one thing a stored tab carries that the shell does not understand. It goes through
     untouched — only the module that wrote it knows what shape it should have, and a shell that
     could tell a good `savedId` from a bad one is a shell that knows the database module exists. */
  it("carries a tab's module state through untouched", () => {
    const state = { savedId: "c-1", nested: { openIds: ["r-1", "r-2"], activeId: null } };
    const session = { tabs: [{ ...SESSION.tabs[0], state }], activeId: "a" };
    expect(parseSession(stored(session), MODULE_IDS)?.tabs[0].state).toEqual(state);
  });

  it("reads a session written before there was any module state", () => {
    expect(parseSession(stored(SESSION), MODULE_IDS)?.tabs[0].state).toBeUndefined();
  });

  it("passes rubbish state through rather than dropping the tab", () => {
    // Validation lives in the module's own `parseXTabState`, which will make `null` of these. A
    // tab is still a tab, and its neighbour has nothing to do with what it was carrying.
    for (const state of [42, "nonsense", null, []]) {
      const session = {
        tabs: [{ ...SESSION.tabs[0], state }, SESSION.tabs[1]],
        activeId: "b",
      };
      const parsed = parseSession(stored(session), MODULE_IDS);
      expect(parsed?.tabs).toHaveLength(2);
      expect(parsed?.tabs[0].state).toEqual(state);
    }
  });

  it("takes a dropped tab's state away with it", () => {
    const session = {
      tabs: [{ id: "z", moduleId: "gopher", title: "x", state: { savedId: "c-1" } }, SESSION.tabs[0]],
      activeId: "a",
    };
    expect(parseSession(stored(session), MODULE_IDS)?.tabs).toEqual([SESSION.tabs[0]]);
  });
});
