import { useRef, useState } from "react";
import { mysqlCancelQuery, mysqlRunScript } from "../../mysql/api";
import Button from "../Button";
import LoadingOverlay from "../LoadingOverlay";
import { useTranslation } from "../../i18n";
import { errorMessage } from "../../errors";
import type { MysqlStatementResult } from "../../types";
import styles from "./QueryEditor.module.css";

/** How one value reads in the result grid. The same rendering the data grid uses: an absent value
 * is spelled out as NULL, and a structured one (a JSON column) as the JSON it came from. */
function displayValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "NULL";
  return typeof raw === "object" ? JSON.stringify(raw) : String(raw);
}

/** Two spaces per Tab: pressing Tab in a code editor is indentation, not "leave this field". */
const INDENT = "  ";

interface Props {
  connectionId: string;
  /** The database picked in the header. Applied as a `USE` before the script, so unqualified table
   *  names resolve the way they do in the other tabs. Empty means none is selected. */
  database: string;
}

/**
 * A SQL editor over the connection, and what running it produced.
 *
 * What comes back is one result per statement, and each one is shown as what it is: a result set
 * becomes a read-only grid, a write reports how many rows it changed (and the id it generated),
 * and everything else reports that it ran. A statement that failed carries the reason instead, and
 * stops the ones after it — the results before it are still shown.
 */
function QueryEditor({ connectionId, database }: Props) {
  const { t } = useTranslation();
  const [sql, setSql] = useState("");
  const [results, setResults] = useState<MysqlStatementResult[] | null>(null);
  const [running, setRunning] = useState(false);
  /** Set once the server has been asked to stop the statement, until the script comes back. */
  const [cancelling, setCancelling] = useState(false);
  /** A failure to run the script at all — a lost connection, or nothing to run. Per-statement
   * errors are not this: they arrive inside the results and are shown against the statement. */
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);

  /** The selection when there is one, else the whole editor: running part of a script is the
   * normal way to work through one, and selecting is how that is said. */
  function textToRun(): string {
    const el = editorRef.current;
    if (!el) return sql;
    const selected = sql.slice(el.selectionStart, el.selectionEnd);
    return selected.trim() === "" ? sql : selected;
  }

  async function run() {
    const text = textToRun();
    if (text.trim() === "" || running) return;
    setRunning(true);
    setCancelling(false);
    setError("");
    try {
      setResults(await mysqlRunScript(connectionId, text, database || undefined));
    } catch (e) {
      setError(errorMessage(t, e));
      setResults(null);
    } finally {
      setRunning(false);
      setCancelling(false);
    }
  }

  /** Asks the server to stop the statement in flight. The script itself still returns through
   * {@link run} — with the killed statement carrying the server's reason — so there is nothing to
   * do here but say that it has been asked for. */
  async function cancel() {
    if (!running || cancelling) return;
    setCancelling(true);
    try {
      await mysqlCancelQuery(connectionId);
    } catch (e) {
      setError(errorMessage(t, e));
      setCancelling(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void run();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart, selectionEnd } = el;
      const next = sql.slice(0, selectionStart) + INDENT + sql.slice(selectionEnd);
      setSql(next);
      // React re-renders with the new value and would put the caret at the end of it, so the
      // caret is placed back after the inserted indent once that render has landed.
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = selectionStart + INDENT.length;
      });
    }
  }

  /** The one line under a result's header that says what it did. */
  function summary(result: MysqlStatementResult): string {
    switch (result.kind) {
      case "rows":
        return result.truncated
          ? t("query.truncated", { n: result.rows.length })
          : t("query.rowCount", { n: result.rows.length });
      case "affected": {
        const changed = t("query.affected", { n: result.rowsAffected });
        return result.lastInsertId === null
          ? changed
          : `${changed} · ${t("query.lastInsertId", { id: result.lastInsertId })}`;
      }
      default:
        return t("query.ok");
    }
  }

  return (
    <div className={styles.queryEditor}>
      <div className={styles.toolbar}>
        <Button size="small" variant="primary" onClick={() => void run()} disabled={running || sql.trim() === ""}>
          {running ? t("query.running") : t("query.run")}
        </Button>
        {running && (
          <Button size="small" onClick={() => void cancel()} disabled={cancelling}>
            {cancelling ? t("query.cancelling") : t("query.cancel")}
          </Button>
        )}
        <span className={styles.hint}>{t("query.runHint")}</span>
        <span className={styles.target}>
          {database ? t("query.targetDatabase", { database }) : t("query.noDatabase")}
        </span>
      </div>

      <textarea
        ref={editorRef}
        className={styles.editor}
        value={sql}
        placeholder={t("query.placeholder")}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        aria-label={t("query.editorLabel")}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      <div className={styles.resultsWrap}>
        <div className={styles.results}>
          {error !== "" && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {error === "" && results === null && <p className="muted">{t("query.emptyResults")}</p>}
          {results?.map((result, i) => (
            <section key={i} className={styles.result}>
              <header className={styles.resultHeader}>
                <span className={styles.resultLabel}>
                  {t("query.resultLabel", { n: i + 1, verb: result.verb })}
                </span>
                <span className={styles.resultDuration}>
                  {t("query.duration", { ms: result.durationMs })}
                </span>
                {/* One line of it: the statement is in the editor above, and this is only here to
                    say which of the statements up there this result belongs to. */}
                <span className={styles.resultStatement} title={result.statement}>
                  {result.statement}
                </span>
              </header>

              {result.error === null ? (
                <p className={styles.resultSummary}>{summary(result)}</p>
              ) : (
                <div className={styles.resultError} role="alert">
                  <p>{result.error}</p>
                  <p className={styles.resultErrorNote}>{t("query.statementFailed")}</p>
                </div>
              )}

              {result.kind === "rows" && result.columns.length > 0 && (
                <div className={styles.gridWrap}>
                  <table className={styles.grid}>
                    <thead>
                      <tr>
                        <th className={styles.rowNumber}>#</th>
                        {result.columns.map((column, c) => (
                          // Keyed by position: an arbitrary SELECT may well name the same column
                          // twice, which is also why the rows are positional.
                          <th key={c}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, r) => (
                        <tr key={r}>
                          <td className={styles.rowNumber}>{r + 1}</td>
                          {result.columns.map((_, c) => {
                            const value = displayValue(row[c]);
                            const isNull = row[c] === null || row[c] === undefined;
                            return (
                              <td key={c} className={isNull ? styles.cellNull : undefined} title={value}>
                                {value}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.rows.length === 0 && <p className="muted">{t("query.noRows")}</p>}
                </div>
              )}
            </section>
          ))}
        </div>
        {running && (
          <LoadingOverlay label={cancelling ? t("query.cancelling") : t("query.running")} />
        )}
      </div>
    </div>
  );
}

export default QueryEditor;
