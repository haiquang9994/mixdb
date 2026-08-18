import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { enterModal } from "../core/shortcuts";
import { useContextMenuPosition } from "./contextMenuPosition";

interface Props {
  /** Where the pointer was when the menu was asked for, in client coordinates. */
  x: number;
  y: number;
  /** Called for every way out that isn't choosing an entry: a press outside, Escape, a scroll.
   * Choosing an entry is the caller's own business, since only it knows what the entry does. */
  onClose: () => void;
  /** The entries — plain `<button>`s, which `.context-menu` in `App.css` styles. */
  children: ReactNode;
}

/**
 * The menu a right-click opens, hung off the pointer and kept inside the window.
 *
 * Rendered out at the body rather than where it was asked for: every caller sits in a pane that
 * scrolls, and a menu drawn inside one is clipped by it. Being at the body is also what makes the
 * window, not the pane, the thing it is fitted against — see {@link useContextMenuPosition}.
 *
 * The rest of the app stays live while it is open. Nothing is laid over the window to catch the
 * dismissing click: a press outside closes the menu and then goes on to do whatever it would have
 * done anyway — pick another row, press a button, right-click somewhere else and get that menu.
 * The alternative costs a press for every menu opened by mistake.
 */
function ContextMenu({ x, y, onClose, children }: Props) {
  const { ref, style } = useContextMenuPosition(x, y);

  /* An open menu is about to act on a selection, so it holds the keyboard the same way a dialog
     does — which is what lets the grid stop keeping its own `menu !== null` guard for `Ctrl+A`. */
  useEffect(() => enterModal(), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    /**
     * Closes on a press anywhere but in the menu, without swallowing it.
     *
     * Watched from the capture phase so the menu is gone before the handler under the pointer
     * runs, and on `pointerdown` rather than `click` so a press that turns into a drag — a column
     * being resized, a pane divider — closes it too. The press that *opened* the menu cannot be
     * caught here: `contextmenu` follows it, so this listener does not exist yet.
     */
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    // The menu hangs at a point in the window, not at the row it was opened from, so anything that
    // moves what is underneath leaves it pointing at the wrong thing. A menu long enough to scroll
    // inside itself is the one exception.
    function onScroll(e: Event) {
      if (e.target !== ref.current) onClose();
    }
    function onResize() {
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose, ref]);

  return createPortal(
    <div className="context-menu glass" ref={ref} style={style}>
      {children}
    </div>,
    document.body,
  );
}

export default ContextMenu;
