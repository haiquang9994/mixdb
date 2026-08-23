import { useRef, type ButtonHTMLAttributes, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { CloseIcon } from "../../icons";
import { useTabSlide } from "./slide";
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
  const ref = useRef<HTMLDivElement>(null);
  // Costs one measurement per render and does nothing at all to a strip whose tabs never move —
  // a pane strip carries no `data-tab-id` and so has nothing to measure. See `slide.ts`.
  useTabSlide(ref);
  return (
    <div ref={ref} className={classes.filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

interface TabProps extends HTMLAttributes<HTMLDivElement> {
  active: boolean;
  /** Given, a close button appears at the end of the tab, and the middle mouse button closes it
   *  too. Omitted, the tab cannot be closed — which is what a pane tab is. */
  onClose?: () => void;
  /** What the close button is called, to anyone reading the screen and to anyone hovering it. */
  closeLabel?: string;
}

/**
 * One tab.
 *
 * A `div` rather than a `button`, because a tab that can be closed carries a button inside it and
 * a button inside a button is not markup a browser will keep. Selection and keyboard are the
 * caller's — pass `role`, `onClick` and `onKeyDown` through as the strip needs them.
 *
 * Middle-click is not: it closes the tab wherever a tab closes at all. It is the same gesture with
 * the same meaning in every strip and in every browser the user already has open, and leaving it
 * to callers is how the app ended up with it on one strip and not the other.
 *
 * A tab that can be dragged into a new place says so through what `useTabReorder` spreads onto it,
 * and is marked `data-dragging` by that hook while it is in hand — see `TabStrip.module.css`.
 */
export function Tab({
  active,
  onClose,
  closeLabel,
  className,
  children,
  onMouseDown,
  onAuxClick,
  ...rest
}: TabProps) {
  const classes = [styles.tab, active && styles.tabActive, className];
  return (
    <div
      className={classes.filter(Boolean).join(" ")}
      onMouseDown={(e: MouseEvent<HTMLDivElement>) => {
        // Chromium answers a middle press with the autoscroll cursor, which then eats the release
        // this tab is waiting for. Refused here rather than in `onAuxClick`, which comes too late.
        if (e.button === 1 && onClose !== undefined) e.preventDefault();
        onMouseDown?.(e);
      }}
      onAuxClick={(e: MouseEvent<HTMLDivElement>) => {
        if (e.button === 1 && onClose !== undefined) onClose();
        onAuxClick?.(e);
      }}
      {...rest}
    >
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
