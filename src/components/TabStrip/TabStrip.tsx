import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { CloseIcon } from "../../icons";
import styles from "./TabStrip.module.css";

/**
 * A strip of tabs: the app's own tab bar, the REST module's open requests, and the strips inside a
 * pane.
 *
 * What is shared here is the drawing, not the behaviour. Which element is selected, what closing
 * one means, whether a tab can be closed at all — every strip answers those differently, and each
 * keeps answering them itself. What none of them should answer differently is what a tab looks
 * like, which is what kept drifting while three files each held their own copy.
 *
 * A tab's contents are children rather than props. The shell puts a connection badge before the
 * name, the REST strip puts the method there, a pane tab is a bare word — passing each of those
 * through a prop would have meant one prop per caller, which is the point at which a shared
 * component costs more than the duplication it replaced.
 *
 * To recolour the open tab's accent bar, set `--tab-accent` on the tab. See `TabStrip.module.css`.
 */

interface TabStripProps extends HTMLAttributes<HTMLDivElement> {
  /** `small` is a strip inside a pane. See the note in `TabStrip.module.css`. */
  size?: "normal" | "small";
}

export function TabStrip({ size = "normal", className, children, ...rest }: TabStripProps) {
  const classes = [styles.strip, size === "small" && styles.small, className];
  return (
    <div className={classes.filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

interface TabProps extends HTMLAttributes<HTMLDivElement> {
  active: boolean;
  /** Given, a close button appears at the end of the tab. Omitted, the tab cannot be closed —
   *  which is what a pane tab is. */
  onClose?: () => void;
  /** What the close button is called, to anyone reading the screen and to anyone hovering it. */
  closeLabel?: string;
}

/**
 * One tab.
 *
 * A `div` rather than a `button`, because a tab that can be closed carries a button inside it and
 * a button inside a button is not markup a browser will keep. Selection, keyboard and middle-click
 * are the caller's — pass `role`, `onClick`, `onKeyDown` and `onAuxClick` through as the strip
 * needs them.
 */
export function Tab({ active, onClose, closeLabel, className, children, ...rest }: TabProps) {
  const classes = [styles.tab, active && styles.tabActive, className];
  return (
    <div className={classes.filter(Boolean).join(" ")} {...rest}>
      {children}
      {onClose !== undefined && (
        <button
          type="button"
          className={styles.close}
          aria-label={closeLabel}
          title={closeLabel}
          onClick={(e) => {
            // Closing a tab is not selecting it, and the tab is what is listening for the click.
            e.stopPropagation();
            onClose();
          }}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

/** The tab's name, clipped with an ellipsis when the tab runs out of room. */
export function TabTitle({ children }: { children: ReactNode }) {
  return <span className={styles.title}>{children}</span>;
}

/** An action at the end of the strip — in both strips that have one, `+` for a new tab. */
export function TabAction({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = [styles.action, className];
  return <button type="button" className={classes.filter(Boolean).join(" ")} {...rest} />;
}
