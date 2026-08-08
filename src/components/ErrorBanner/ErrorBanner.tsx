import { useEffect, useRef } from "react";
import styles from "./ErrorBanner.module.css";

const AUTO_DISMISS_MS = 60_000;

interface Props {
  message: string;
  onDismiss: () => void;
}

function ErrorBanner({ message, onDismiss }: Props) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // Keyed only on `message` so the timer restarts when a *new* error replaces
  // the current one, but not on every parent re-render (onDismiss is often a
  // fresh inline closure each render).
  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <p className={styles.banner}>
      {message}
      <button type="button" className={styles.dismiss} aria-label="Dismiss error" onClick={onDismiss}>
        ×
      </button>
      <span className={styles.countdown}>
        {/* key={message} remounts the bar (and its CSS animation) per new error */}
        <span
          key={message}
          className={styles.countdownBar}
          style={{ animationDuration: `${AUTO_DISMISS_MS}ms` }}
        />
      </span>
    </p>
  );
}

export default ErrorBanner;
