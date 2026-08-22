import { describe, expect, it } from "vitest";
import {
  cutOut,
  moveSelection,
  rectOf,
  selectAll,
  spanIn,
  stepSelection,
  type Selection,
} from "./resultSelection";

const AT_1_1: Selection = { anchor: { row: 1, col: 1 }, focus: { row: 1, col: 1 } };

describe("moveSelection", () => {
  it("collapses onto the cell that was clicked", () => {
    expect(moveSelection(AT_1_1, { row: 3, col: 2 }, false)).toEqual({
      anchor: { row: 3, col: 2 },
      focus: { row: 3, col: 2 },
    });
  });

  it("keeps the anchor and moves the focus when the click extends", () => {
    expect(moveSelection(AT_1_1, { row: 3, col: 2 }, true)).toEqual({
      anchor: { row: 1, col: 1 },
      focus: { row: 3, col: 2 },
    });
  });

  it("has nothing to extend from when nothing is selected", () => {
    expect(moveSelection(null, { row: 3, col: 2 }, true)).toEqual({
      anchor: { row: 3, col: 2 },
      focus: { row: 3, col: 2 },
    });
  });
});

describe("selectAll", () => {
  it("spans the whole grid", () => {
    expect(selectAll(4, 3)).toEqual({
      anchor: { row: 0, col: 0 },
      focus: { row: 3, col: 2 },
    });
  });

  it("selects nothing of an empty grid", () => {
    expect(selectAll(0, 3)).toBeNull();
    expect(selectAll(4, 0)).toBeNull();
  });
});

describe("rectOf", () => {
  it("puts the corners the right way round however it was dragged", () => {
    const upwards: Selection = { anchor: { row: 3, col: 2 }, focus: { row: 1, col: 0 } };
    expect(rectOf(upwards)).toEqual({ top: 1, left: 0, bottom: 3, right: 2 });
  });

  it("has no rectangle without a selection", () => {
    expect(rectOf(null)).toBeNull();
  });
});

describe("spanIn", () => {
  const rect = { top: 1, left: 2, bottom: 3, right: 4 };

  it("gives the columns of a row inside it", () => {
    expect(spanIn(rect, 2)).toEqual([2, 4]);
  });

  it("gives nothing for a row outside it", () => {
    expect(spanIn(rect, 0)).toEqual([-1, -1]);
    expect(spanIn(rect, 4)).toEqual([-1, -1]);
  });

  it("gives nothing when there is no rectangle at all", () => {
    expect(spanIn(null, 2)).toEqual([-1, -1]);
  });
});

describe("stepSelection", () => {
  it("starts at the first cell when nothing is selected", () => {
    expect(stepSelection(null, { row: 1, col: 0 }, false, 4, 3)).toEqual({
      anchor: { row: 0, col: 0 },
      focus: { row: 0, col: 0 },
    });
  });

  it("moves the whole selection when it does not extend", () => {
    expect(stepSelection(AT_1_1, { row: 1, col: 0 }, false, 4, 3)).toEqual({
      anchor: { row: 2, col: 1 },
      focus: { row: 2, col: 1 },
    });
  });

  it("stretches from the anchor when it extends", () => {
    expect(stepSelection(AT_1_1, { row: 1, col: 0 }, true, 4, 3)).toEqual({
      anchor: { row: 1, col: 1 },
      focus: { row: 2, col: 1 },
    });
  });

  it("stops at the edges rather than wrapping", () => {
    expect(stepSelection(AT_1_1, { row: -5, col: -5 }, false, 4, 3)?.focus).toEqual({
      row: 0,
      col: 0,
    });
    expect(stepSelection(AT_1_1, { row: 9, col: 9 }, false, 4, 3)?.focus).toEqual({
      row: 3,
      col: 2,
    });
  });

  it("has nowhere to go in an empty grid", () => {
    expect(stepSelection(null, { row: 1, col: 0 }, false, 0, 3)).toBeNull();
  });
});

describe("cutOut", () => {
  const rows: unknown[][] = [
    ["a0", "b0", "c0"],
    ["a1", "b1", "c1"],
    ["a2", "b2", "c2"],
  ];
  const columns = ["a", "b", "c"];

  it("takes the rectangle, and takes it through the view", () => {
    const view = [2, 0, 1];
    const cut = cutOut({ top: 0, left: 1, bottom: 1, right: 2 }, view, rows, columns);
    expect(cut.columns).toEqual(["b", "c"]);
    expect(cut.rows).toEqual([
      ["b2", "c2"],
      ["b0", "c0"],
    ]);
  });

  it("takes a single cell", () => {
    const cut = cutOut({ top: 1, left: 1, bottom: 1, right: 1 }, [0, 1, 2], rows, columns);
    expect(cut).toEqual({ columns: ["b"], rows: [["b1"]] });
  });
});
