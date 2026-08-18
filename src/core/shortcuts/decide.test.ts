import { describe, expect, it } from "vitest";
import { decide, type Press } from "./decide";
import type { ShortcutGroup } from "./types";

/** A press with the modifier down on `A`, which each test bends to what it is asking about. */
const press = (over: Partial<Press> = {}): Press => ({
  key: "a",
  shift: false,
  alt: false,
  mod: true,
  typing: false,
  ...over,
});

/* A catalogue of its own rather than the app's: these tests are about the rules, and a test that
   reads the real catalogue starts failing the day someone adds a shortcut to it. `labelKey` is a
   real key only because the type demands one — nothing here reads it. */
const GROUPS: ShortcutGroup[] = [
  {
    scope: "app",
    labelKey: "app.settings",
    defs: [
      { id: "app.newTab", chord: { key: "t" }, labelKey: "app.settings", inModal: true },
      { id: "pane.reload", chord: { key: "r" }, labelKey: "app.settings" },
    ],
  },
  {
    scope: "grid",
    labelKey: "app.settings",
    defs: [
      {
        id: "grid.selectAll",
        chord: { key: "a" },
        labelKey: "app.settings",
        whenTyping: "ignore",
        unhandled: "swallow",
      },
      { id: "grid.focusFilter", chord: { key: "f" }, labelKey: "app.settings" },
      {
        id: "editor.format",
        chord: { key: "f", shift: true },
        labelKey: "app.settings",
        owner: "editor",
      },
    ],
  },
  {
    /* A second pane that would want the same chord — the case the resolver is built for before it
       exists, so the remap screen does not have to retrofit it. */
    scope: "keys",
    labelKey: "app.settings",
    defs: [{ id: "keys.selectAll", chord: { key: "a" }, labelKey: "app.settings" }],
  },
];

const ctx = (enabled: string[], modalDepth = 0) => ({ modalDepth, enabled });

describe("decide", () => {
  it("ignores a press without the platform's modifier", () => {
    expect(decide(press({ mod: false }), GROUPS, ctx(["grid.selectAll"]))).toEqual({ do: "nothing" });
  });

  it("runs the shortcut whose handler is listening", () => {
    expect(decide(press(), GROUPS, ctx(["grid.selectAll"]))).toEqual({
      do: "run",
      id: "grid.selectAll",
    });
  });

  it("leaves a chord nothing claims alone", () => {
    expect(decide(press({ key: "q" }), GROUPS, ctx([]))).toEqual({ do: "nothing" });
  });

  it("matches shift and alt exactly", () => {
    // Ctrl+Shift+F is the editor's, not the filter bar's.
    expect(decide(press({ key: "f", shift: true }), GROUPS, ctx(["grid.focusFilter"]))).toEqual({
      do: "nothing",
    });
    expect(decide(press({ key: "f" }), GROUPS, ctx(["grid.focusFilter"]))).toEqual({
      do: "run",
      id: "grid.focusFilter",
    });
  });

  it("swallows a chord that asks to be swallowed when nobody is listening", () => {
    // Nothing selects rows on the connection form, and the webview must still not paint the whole
    // window blue.
    expect(decide(press(), GROUPS, ctx([]))).toEqual({ do: "swallow" });
  });

  it("does not swallow a chord that never asked to be", () => {
    expect(decide(press({ key: "r" }), GROUPS, ctx([]))).toEqual({ do: "nothing" });
  });

  it("holds every shortcut back while a modal is up, except the ones marked for it", () => {
    expect(decide(press({ key: "r" }), GROUPS, ctx(["pane.reload"], 1))).toEqual({ do: "nothing" });
    expect(decide(press({ key: "t" }), GROUPS, ctx(["app.newTab"], 1))).toEqual({
      do: "run",
      id: "app.newTab",
    });
  });

  it("still swallows behind a modal when the swallowing def is the one held back", () => {
    // The grid is not going to select anything from behind a question, but the webview selecting
    // the app's own chrome is no better an answer there than anywhere else. This is what `App.tsx`
    // did before the registry — swallow unconditionally, outside a text field — and losing it would
    // be a regression nobody asked for.
    expect(decide(press(), GROUPS, ctx(["grid.selectAll"], 1))).toEqual({ do: "swallow" });
  });

  it("stands aside where the user is typing", () => {
    // Ctrl+A in the filter bar is that field's select-all and has to reach it.
    expect(decide(press({ typing: true }), GROUPS, ctx(["grid.selectAll"]))).toEqual({
      do: "nothing",
    });
  });

  it("only stands aside for the shortcuts that asked to", () => {
    expect(decide(press({ key: "f", typing: true }), GROUPS, ctx(["grid.focusFilter"]))).toEqual({
      do: "run",
      id: "grid.focusFilter",
    });
  });

  it("never runs a shortcut the editor owns", () => {
    expect(decide(press({ key: "f", shift: true }), GROUPS, ctx(["editor.format"]))).toEqual({
      do: "nothing",
    });
  });

  it("breaks a tie on the order handlers were enabled, not the order they are declared", () => {
    // `grid.selectAll` comes first in the catalogue, so a resolver reading catalogue order would
    // answer the same both ways round. The last one enabled is the one on top.
    expect(decide(press(), GROUPS, ctx(["keys.selectAll", "grid.selectAll"]))).toEqual({
      do: "run",
      id: "grid.selectAll",
    });
    expect(decide(press(), GROUPS, ctx(["grid.selectAll", "keys.selectAll"]))).toEqual({
      do: "run",
      id: "keys.selectAll",
    });
  });

  it("ignores handlers listening for something else entirely", () => {
    expect(decide(press(), GROUPS, ctx(["pane.reload"]))).toEqual({ do: "swallow" });
  });
});
