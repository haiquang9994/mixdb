import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Button from "../Button";
import { useTranslation } from "../../i18n";
import type { MysqlDumpMode } from "../../mysql/api";
import styles from "./DumpDialog.module.css";

/** The three choices, in the order they are offered: the whole thing first, since that is what a
 * backup means, and the two halves after it. */
const MODES: { mode: MysqlDumpMode; labelKey: "dump.modeAll" | "dump.modeStructure" | "dump.modeData"; hintKey: "dump.modeAllHint" | "dump.modeStructureHint" | "dump.modeDataHint" }[] = [
  { mode: "all", labelKey: "dump.modeAll", hintKey: "dump.modeAllHint" },
  { mode: "structure", labelKey: "dump.modeStructure", hintKey: "dump.modeStructureHint" },
  { mode: "data", labelKey: "dump.modeData", hintKey: "dump.modeDataHint" },
];

interface Props {
  database: string;
  onCancel: () => void;
  /** Given the chosen mode. The file to write to is asked for after this, by the caller. */
  onSubmit: (mode: MysqlDumpMode) => void;
}

/** What of a MySQL database to write out. Only MySQL asks: a mongodump archive is whole or not
 *  at all. */
function DumpDialog({ database, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<MysqlDumpMode>("all");

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
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={database}>
        <h3 className={styles.title}>{t("dump.dumpTitle", { database })}</h3>

        <div className={styles.modes}>
          {MODES.map((option) => (
            <label key={option.mode} className={styles.mode}>
              <input
                type="radio"
                name="dump-mode"
                checked={mode === option.mode}
                onChange={() => setMode(option.mode)}
              />
              <span>
                <span className={styles.modeLabel}>{t(option.labelKey)}</span>
                <span className={styles.modeHint}>{t(option.hintKey)}</span>
              </span>
            </label>
          ))}
        </div>

        <div className={styles.actions}>
          <Button size="large" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button size="large" onClick={() => onSubmit(mode)}>
            {t("dump.chooseFile")}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export default DumpDialog;
