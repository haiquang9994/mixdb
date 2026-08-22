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
});
