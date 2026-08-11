import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useContextMenuPosition } from "./contextMenuPosition";

interface Props {
  /** Where the pointer was when the menu was asked for, in client coordinates. */
  x: number;
  y: number;
  /** Called for every way out that isn't choosing an entry: the overlay, Escape, a second
   * right-click. Choosing an entry is the caller's own business, since only it knows what the
   * entry does. */
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
 */
function ContextMenu({ x, y, onClose, children }: Props) {
  const { ref, style } = useContextMenuPosition(x, y);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <>
      {/* Catches the click that dismisses the menu before it reaches whatever is underneath —
          otherwise the click both closes the menu and does something else. */}
      <div
        className="context-menu-overlay"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="context-menu" ref={ref} style={style}>
        {children}
      </div>
    </>,
    document.body,
  );
}

export default ContextMenu;
