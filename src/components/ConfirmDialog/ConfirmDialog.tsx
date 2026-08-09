import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../i18n";
import Button from "../Button";
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return createPortal(
    <>
      <div className={styles.overlay} onClick={onCancel} />
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.message}>{message}</p>
        {children}
        <div className={styles.actions}>
          <Button size="large" onClick={onCancel}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button
            size="large"
            className={danger ? styles.danger : undefined}
            onClick={onConfirm}
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
