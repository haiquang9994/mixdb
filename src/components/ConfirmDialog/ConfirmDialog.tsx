import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../i18n";
import Button from "../Button";
import { useDialogExit } from "../dialogMotion";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  title: string;
  message: string;
  /** Defaults to the generic "Confirm"; give it a verb when the action has a name of its own. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paints the confirm button as destructive. For actions that lose data, not merely risky ones. */
  danger?: boolean;
  /** Extra controls shown under the message — options that change what confirming will do. */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A modal yes/no gate. Rendered into `document.body` rather than in place: the dialog is fixed to
 * the viewport, and a caller deep inside a scrolling panel shouldn't have to care whether some
 * ancestor of theirs establishes a containing block for it.
 *
 * Both answers go through `close`, so the dialog is off the screen before the caller acts on what
 * it said — including the confirm, which is the one place a modal here animates out of a decision
 * rather than out of a dismissal.
 */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const { close, cls } = useDialogExit();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close(onCancel);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, onCancel]);

  return createPortal(
    <>
      <div className={cls(styles.overlay)} onClick={() => close(onCancel)} />
      <div className={cls(styles.dialog)} role="dialog" aria-modal="true" aria-label={title}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.message}>{message}</p>
        {children}
        <div className={styles.actions}>
          <Button size="large" onClick={() => close(onCancel)}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button
            size="large"
            /* A destructive confirm keeps its own red and stays outlined: filling it with the
               accent would dress the dangerous choice as the recommended one. */
            variant={danger ? "default" : "primary"}
            className={danger ? styles.danger : undefined}
            onClick={() => close(onConfirm)}
            autoFocus
          >
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export default ConfirmDialog;
