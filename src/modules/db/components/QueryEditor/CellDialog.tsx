import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import Button from "../../../../components/Button";
import JsonView from "../../../../components/JsonView";
import { useDialogExit } from "../../../../components/dialogMotion";
import { copyText } from "../../../../core/clipboard";
import { displayValue } from "../../../../core/virtualRows";
import { errorMessage } from "../../../../core/errors";
import styles from "./QueryEditor.module.css";

interface Props {
  /** The column the cell is in, for the heading. */
  column: string;
  /** Which row of the result it came from — the number the `#` column shows, so the dialog and the
   *  grid behind it agree about where this is. */
  rowNumber: number;
  value: unknown;
  onClose: () => void;
}

/**
 * Whatever is in the cell, parsed as JSON when it turns out to be JSON.
 *
 * A driver hands JSON columns over as objects already, so those need no parsing. The case worth
 * catching is the other one: a `TEXT` column holding a document, which arrives as a string and is
 * the very thing somebody opens a cell to read. Only an object or an array counts — `JSON.parse`
 * also swallows `42` and `"hello"`, and rendering a number as a JSON document would put a bare
 * value on a coloured line for no reason.
 */
function asJson(value: unknown): unknown | null {
  if (typeof value === "object" && value !== null) return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * One cell of a result, big enough to read.
 *
 * The grid cuts every cell off at 320px and puts the rest in a tooltip, which is right for scanning
 * a table and useless for a value that is a paragraph, a stack trace or a document. This is where
 * that value is actually read — and copied, since selecting text out of a 320px cell is not a thing
 * anyone manages.
 *
 * Read-only, and it is meant to be: a query result has no way back to the table it came from.
 */
function CellDialog({ column, rowNumber, value, onClose }: Props) {
  const { t } = useTranslation();
  const { close, cls } = useDialogExit();
  const [failed, setFailed] = useState("");
  const json = useMemo(() => asJson(value), [value]);
  /** What the copy button puts on the clipboard: the text on screen, whichever of the two it is. */
  const text = useMemo(
    () => (json === null ? displayValue(value) : JSON.stringify(json, null, 2)),
    [json, value]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close(onClose);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, onClose]);

  const title = t("query.cellTitle", { column, n: rowNumber });

  return createPortal(
    <>
      <div className={cls(styles.overlay)} onClick={() => close(onClose)} />
      <div className={cls(styles.cellDialog)} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.historyHeader}>
          <h3 className={styles.historyTitle}>{title}</h3>
          <button
            type="button"
            className={styles.historyClose}
            onClick={() => close(onClose)}
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <CloseIcon />
          </button>
        </div>

        <div className={styles.cellBody}>
          {json === null ? <pre className={styles.cellText}>{text}</pre> : <JsonView value={json} />}
        </div>

        {failed !== "" && (
          <p className={styles.copyFailed} role="alert">
            {failed}
          </p>
        )}

        <div className={styles.cellActions}>
          <Button
            size="large"
            onClick={() => {
              void copyText(text)
                .then(() => setFailed(""))
                .catch((e) => setFailed(errorMessage(t, e)));
            }}
          >
            {t("query.copySelection")}
          </Button>
        </div>
      </div>
    </>,
    document.body
  );
}

export default CellDialog;
