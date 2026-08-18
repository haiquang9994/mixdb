import { useEffect, useRef } from "react";
import { hasPrimaryModifier } from "../platform";
import { isTextEntry } from "../textEntry";
import { decide } from "./decide";
import { enabledIds, modalDepth, register, run } from "./store";
import type { ShortcutGroup } from "./types";

/**
 * Answers `id` for as long as `enabled` says this pane is the one being looked at.
 *
 * `enabled` is what keeps a chord unambiguous: every connection tab stays mounted behind the one
 * on show, and each of their grids would otherwise answer the same keystroke together.
 *
 * `handler` is read at the moment the key is pressed rather than when the listener was registered,
 * so it may close over state freely — a pane mid-request checks for that inside it, exactly as its
 * button's `disabled` does.
 */
export function useShortcut(id: string, handler: () => void, enabled: boolean): void {
  // Through a ref so the registration is made once per spell of being on screen, rather than torn
  // down and remade on every render that hands the hook a fresh closure.
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!enabled) return;
    return register({ id, handler: () => latest.current() });
  }, [id, enabled]);
}

/**
 * The app's one keydown listener. Called once, by the shell.
 *
 * `groups` must be a stable value — a fresh array each render would rebind the listener each
 * render. The catalogues are module-level constants, which is what makes that true.
 */
export function useShortcutDispatcher(groups: ShortcutGroup[]): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // CodeMirror declares `preventDefault: true` on its own keymap and sits on the editor
      // element, so it always answers before anything on the window. An editor with the focus
      // wins, and it says so this way rather than by being negotiated with.
      if (e.defaultPrevented) return;

      const decision = decide(
        {
          key: e.key.toLowerCase(),
          shift: e.shiftKey,
          alt: e.altKey,
          mod: hasPrimaryModifier(e),
          typing: isTextEntry(e.target),
        },
        groups,
        { modalDepth: modalDepth(), enabled: enabledIds() },
      );

      if (decision.do === "nothing") return;
      // One `preventDefault`, and not only for tidiness: on a Mac this is what keeps `⌘W` on the
      // tab instead of letting the AppKit menu bar close the window. A handler that forgot it lost
      // its key to the operating system; there is nowhere left to forget it now.
      e.preventDefault();
      if (decision.do === "run") run(decision.id);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [groups]);
}
