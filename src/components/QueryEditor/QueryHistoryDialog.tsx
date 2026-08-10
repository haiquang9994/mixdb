import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, TrashIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import { clearQueryHistory, useQueryHistory } from "../../queryHistory";
import Button from "../Button";
import Input from "../Input";
import styles from "./QueryEditor.module.css";

interface Props {
  /** Only this connection's runs are listed — a query against staging is not an answer to a
   *  question about production. */
  profileId: string;
  /** Puts the query back in the editor. Whether that replaces the script or is inserted at the
   *  caret is the editor's business, not this list's. */
  onPick: (sql: string) => void;
  onClose: () => void;
}

/** The query on one line, so a list of them can be scanned. The whole thing is in the title
 *  attribute, and picking one puts the whole thing back in the editor. */
function oneLine(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/**
 * Everything this connection has been asked to run, newest first.
 *
 * A list rather than a panel down the side: it is opened to find one thing, and it closes as soon
 * as that thing is found. The filter matches the query text, so the way back to a query is to
 * remember any word that was in it.
 */
function QueryHistoryDialog({ profileId, onPick, onClose }: Props) {
  const { t, lang } = useTranslation();
  const history = useQueryHistory();
  const [filter, setFilter] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const mine = useMemo(
    () => history.filter((entry) => entry.profileId === profileId),
    [history, profileId]
  );

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") return mine;
    return mine.filter((entry) => entry.sql.toLowerCase().includes(needle));
  }, [mine, filter]);

  const when = useMemo(
    () => new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short" }),
    [lang]
  );

  return createPortal(
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div
        className={styles.historyDialog}
        role="dialog"
        aria-modal="true"
        aria-label={t("query.historyTitle")}
      >
        <div className={styles.historyHeader}>
          <h3 className={styles.historyTitle}>{t("query.historyTitle")}</h3>
          <button type="button" className={styles.historyClose} onClick={onClose} title={t("common.close")}>
            <CloseIcon />
          </button>
        </div>

        <div className={styles.historyTools}>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("query.historyFilter")}
            aria-label={t("query.historyFilter")}
            autoFocus
          />
          <Button
            size="small"
            onClick={() =>
              confirmClear
                ? (clearQueryHistory(profileId), setConfirmClear(false))
                : setConfirmClear(true)
            }
            disabled={mine.length === 0}
          >
            <TrashIcon size="0.9em" />
            {/* Two presses rather than a second dialog on top of this one: the button says what it
                is about to do, and clicking anywhere else takes the offer back. */}
            {confirmClear ? t("query.historyClearConfirm") : t("query.historyClear")}
          </Button>
        </div>

        {shown.length === 0 ? (
          <p className={styles.historyEmpty}>
            {mine.length === 0 ? t("query.historyEmpty") : t("query.historyNoMatch")}
          </p>
        ) : (
          <ul className={styles.historyList} onMouseDown={() => setConfirmClear(false)}>
            {shown.map((entry) => (
              <li key={`${entry.startedAt}-${entry.sql.length}`}>
                <button
                  type="button"
                  className={styles.historyEntry}
                  title={entry.sql}
                  onClick={() => {
                    onPick(entry.sql);
                    onClose();
                  }}
                >
                  <span className={styles.historySql}>{oneLine(entry.sql)}</span>
                  <span className={styles.historyMeta}>
                    <span>{when.format(entry.startedAt)}</span>
                    {entry.database !== "" && <span>{entry.database}</span>}
                    <span>{t("query.duration", { ms: entry.durationMs })}</span>
                    {entry.error !== null ? (
                      <span className={styles.historyFailed}>{t("query.historyFailed")}</span>
                    ) : (
                      entry.rowCount !== null && <span>{t("query.rowCount", { n: entry.rowCount })}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>,
    document.body
  );
}

export default QueryHistoryDialog;
