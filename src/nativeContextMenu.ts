/**
 * The webview's own right-click menu, taken off it.
 *
 * MixDB is a desktop application that happens to be drawn by a webview, and the menu the webview
 * offers on a right-click is a browser's: Back, Reload, Save as, Print, View source. None of it
 * means anything here, and two of the entries are actively harmful — a reload drops every open
 * connection, every unsaved query draft and every staged edit, exactly as `Ctrl+R` would if it were
 * not already claimed in {@link ./reload}. Worse, it appears in every corner of the app that has no
 * menu of its own, so what a right-click does depends on where it lands.
 *
 * So the default is refused everywhere, and the panes that have something to offer answer the
 * gesture themselves through their own `onContextMenu` — the sidebar's connections, the Redis keys,
 * the item lists. Those handlers see the event first and are unaffected by this one, which sits on
 * the document and only ever acts on what nothing else has claimed.
 *
 * Text fields are the exception: cut, copy and paste on a right-click are the webview's to give, no
 * part of the app replaces them, and a form you cannot paste a password into is worse than a stray
 * browser menu. Which elements those are is {@link ./textEntry}'s to say, and `Ctrl+A` asks it the
 * same question — a tickbox is an `<input>` and holds no text, so it keeps no menu.
 *
 * Unlike the reload keys, this makes no exception for a development build, and the cost is known:
 * right-click → Inspect element goes with it, leaving `F12` and `Ctrl+Shift+C`. It is deliberate.
 * A right-click is a gesture users make, not a developer's tool, and one that behaved differently
 * under `npm run dev` would be one nobody was really developing against — a pane that forgot its
 * `preventDefault` would look right for as long as it was being worked on and only break once
 * packaged. `F5` is left alive there precisely because nobody but a developer presses it.
 */
import { isTextEntry } from "./textEntry";

/** Refuses the webview's menu for the life of the window. Called once, at startup. */
export function blockNativeContextMenu(): void {
  document.addEventListener("contextmenu", (e) => {
    if (isTextEntry(e.target)) return;
    e.preventDefault();
  });
}
