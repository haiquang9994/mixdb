import { useEffect, useRef } from "react";

/**
 * `Ctrl+R`, taken off the webview and handed to the pane on screen.
 *
 * Every content pane in the app carries a reload button, and `Ctrl+R` is the key a user reaches for
 * to press it — except that the webview underneath answers first and reloads the whole app, which
 * drops every open connection, every unsaved query draft and every staged edit with it. So the
 * gesture is intercepted here: in a packaged build none of the reload keys reach the webview at
 * all, and the plain one presses the reload button of whichever pane the user is looking at.
 *
 * The hard reload and `F5` stay live under `npm run dev:app`: that build is being edited while it
 * runs, and taking away the developer's own way of picking up a change would be no kindness.
 * `Ctrl+R` is claimed there too, so what is being developed against is the behaviour that ships.
 */

/** `Ctrl`/`Cmd+R` on its own — the gesture the panes answer. */
function isPaneReload(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r";
}

/** The rest of what a webview reloads itself on: the cache-skipping variant, and the function key
 *  with or without a modifier held over it. */
function isWebviewReload(e: KeyboardEvent): boolean {
  return e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r");
}

/** Whether this is a reload gesture the webview must not be left to act on. */
export function isBlockedReload(e: KeyboardEvent): boolean {
  return isPaneReload(e) || (import.meta.env.PROD && isWebviewReload(e));
}

/** The modifier as it is written on the keyboard in front of the user. Tauri renders in the host's
 *  own webview, so the user agent names the platform. Exported because every shortcut the app draws
 *  is drawn with this one — two spellings of the same key would drift apart. */
export const MODIFIER_LABEL = navigator.userAgent.includes("Mac OS X") ? "⌘" : "Ctrl";

/** How the shortcut is written in a tooltip. A Mac writes its chords without a separator. */
export const RELOAD_SHORTCUT = MODIFIER_LABEL === "⌘" ? "⌘R" : `${MODIFIER_LABEL}+R`;

/** Names a reload button after the key that also presses it. Without this the shortcut is one
 *  nothing on screen mentions, which is the same as one nobody has. */
export function withReloadShortcut(label: string): string {
  return `${label} (${RELOAD_SHORTCUT})`;
}

/**
 * Presses this pane's reload button on `Ctrl+R`, for as long as `active` says the pane is the one
 * being looked at.
 *
 * `active` is what keeps the key unambiguous: plenty of panes are mounted at once — the connection
 * tabs sitting in the background, the stats grid kept behind the data grid — and every one of them
 * would otherwise answer the same keystroke together.
 *
 * A dialog standing over the pane is the pane not being the one in front either, and callers pass
 * that in here as well. The keyboard belongs to whatever is on top: a reload fired blind behind a
 * form throws away what was being typed into it, and behind a question that has not been answered
 * yet it acts on the very thing that is being asked about.
 *
 * `reload` is read at the moment the key is pressed rather than when the listener was bound, so it
 * may close over state freely; a pane that is mid-request checks for that inside it, exactly as its
 * button's `disabled` does.
 */
export function useReloadShortcut(active: boolean, reload: () => void): void {
  // Through a ref so the listener is bound once per spell of being on screen, rather than torn down
  // and rebound on every render that hands the hook a fresh closure.
  const latest = useRef(reload);
  latest.current = reload;

  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!isPaneReload(e)) return;
      e.preventDefault();
      latest.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);
}
