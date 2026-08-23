import { describe, expect, it } from "vitest";
import { parseDbTabState } from "./tabState";

describe("parseDbTabState", () => {
  it("reads back what the tab wrote", () => {
    expect(parseDbTabState({ savedId: "c-1" })).toEqual({ savedId: "c-1" });
  });

  it("keeps nothing else that came with it", () => {
    // A field a later version added, or one an older version wrote and this one has dropped.
    expect(parseDbTabState({ savedId: "c-1", password: "hunter2" })).toEqual({ savedId: "c-1" });
  });

  it("has nothing to say about a tab that never wrote any", () => {
    expect(parseDbTabState(undefined)).toBeNull();
  });

  /* Everything here is a string some other version of the app put in `localStorage`, so none of it
     is trusted — the shell deliberately passes it through without a look. */
  it("gives up on anything that is not a db tab's state", () => {
    expect(parseDbTabState(null)).toBeNull();
    expect(parseDbTabState(42)).toBeNull();
    expect(parseDbTabState("c-1")).toBeNull();
    expect(parseDbTabState([])).toBeNull();
    expect(parseDbTabState({})).toBeNull();
    expect(parseDbTabState({ savedId: 7 })).toBeNull();
    expect(parseDbTabState({ savedId: null })).toBeNull();
    expect(parseDbTabState({ savedId: "" })).toBeNull();
  });
});
