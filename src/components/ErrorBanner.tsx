import { useEffect, useRef } from "react";

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
    <p className="error">
      {message}
      <button type="button" className="error-dismiss" aria-label="Dismiss error" onClick={onDismiss}>
        ×
      </button>
      <span className="error-countdown">
        {/* key={message} remounts the bar (and its CSS animation) per new error */}
        <span
          key={message}
          className="error-countdown-bar"
          style={{ animationDuration: `${AUTO_DISMISS_MS}ms` }}
        />
      </span>
    </p>
  );
}

export default ErrorBanner;
