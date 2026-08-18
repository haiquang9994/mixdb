import { useCallback, useEffect, useRef, useState } from "react";
import { enterModal } from "../core/shortcuts";
import styles from "./dialogMotion.module.css";

/** Kept in step with the `.closing` animations in `dialogMotion.module.css`. */
const EXIT_MS = 130;

/**
 * Lets a dialog see itself out.
 *
 * Without this there is no exit animation to speak of: callers render a dialog as
 * `{open && <Dialog … />}`, so the moment it reports back it is gone from the tree and whatever
 * the stylesheet had to say about leaving never runs. So the dialog holds the answer for the
 * length of that animation and hands it over at the end — the caller is unchanged, and it is the
 * dialog that decides when it has finished.
 *
 * Only for the ways a dialog closes *itself* — Cancel, Escape, a click on the overlay. A dialog
 * that closes because a save succeeded is unmounted by its caller and goes at once, which is the
 * right answer there anyway: the user has been watching a "Saving…" button and wants the result,
 * not another frame of the form they are done with.
 */
export function useDialogExit() {
  /* Every dialog in the app calls this hook, which makes it the one place that knows a dialog is
     up — so it is where the count is kept. Ten dialogs, and not one of their files has to say so.
     The count is what a global shortcut asks before acting: the keyboard belongs to whatever is on
     top, and a reload fired blind from behind a form throws away what was being typed into it.

     It stays up through the exit animation, because the dialog is still on screen for those 130ms
     and still holds the keyboard. */
  useEffect(() => enterModal(), []);

  const [closing, setClosing] = useState(false);
  const answer = useRef<(() => void) | null>(null);

  /** Starts the exit; `reply` is called once it finishes. First call wins — a second Escape, or a
      click on the overlay behind a dialog already on its way out, is ignored. */
  const close = useCallback((reply: () => void) => {
    if (answer.current) return;
    answer.current = reply;
    setClosing(true);
  }, []);

  useEffect(() => {
    if (!closing) return;
    // With motion turned down there is nothing to wait for, so the answer goes back at once.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = window.setTimeout(() => answer.current?.(), reduced ? 0 : EXIT_MS);
    return () => window.clearTimeout(id);
  }, [closing]);

  /** Wraps a class in the shared `closing` marker while the dialog animates out. */
  const cls = useCallback(
    (base: string) => (closing ? `${base} ${styles.closing}` : base),
    [closing],
  );

  return { closing, close, cls };
}
