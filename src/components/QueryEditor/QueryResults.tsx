import { memo } from "react";
import { TerminalIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import type { MysqlStatementResult } from "../../types";
import styles from "./QueryEditor.module.css";

/** How one value reads in the result grid. The same rendering the data grid uses: an absent value
 * is spelled out as NULL, and a structured one (a JSON column) as the JSON it came from. */
function displayValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "NULL";
  return typeof raw === "object" ? JSON.stringify(raw) : String(raw);
}

/** How long a cell value has to be before it is worth a tooltip. Cells are cut off at 320px, which
 * no value this short reaches at the grid's font size. */
const TOOLTIP_FROM = 24;

interface Props {
  /** One result per statement, or null before anything has been run. */
  results: MysqlStatementResult[] | null;
  /** A failure to run the script at all. Per-statement errors travel inside `results`. */
  error: string;
  /** How many statements of this run were sent with a `LIMIT` they were not written with. Said out
   *  loud so a shortened result is never mistaken for the whole answer. */
  limitsAdded: number;
  /** The ceiling that was applied, for the sentence that says so. */
  limit: number;
}

/**
 * What running the script produced.
 *
 * Split out of the editor and **memoised**, which is the whole point of it being its own file: a
 * result of a thousand rows is tens of thousands of cells, and this used to be rebuilt on every
 * keystroke — the editor kept the script in React state, so typing re-rendered the grid, formatted
 * every cell again and worked out every tooltip again. Editing a script above a large result went
 * from instant to seconds per key.
 *
 * The editor no longer re-renders as it is typed in, and this no longer re-renders when it does.
 * Both halves matter: one of them alone leaves the other free to bring the problem back.
 */
function QueryResults({ results, error, limitsAdded, limit }: Props) {
  const { t } = useTranslation();

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
    <div className={styles.results}>
      {error !== "" && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {/* What the tab shows when it is first opened, so it is given a shape of its own rather than
          left as one faint line in an empty pane. The same frame says so when a run produced no
          results at all — a script of nothing but comments runs, successfully, and has nothing to
          report; without this the pane simply went blank. */}
      {error === "" && (results === null || results.length === 0) && (
        <div className={styles.emptyState}>
          <TerminalIcon size={30} className={styles.emptyIcon} />
          <p className={styles.emptyTitle}>
            {results === null ? t("query.emptyResults") : t("query.noStatements")}
          </p>
          <p className={styles.emptyHint}>
            {results === null ? t("query.emptyHint") : t("query.noStatementsHint")}
          </p>
        </div>
      )}
      {/* Above the results rather than inside one of them: the ceiling was put on the script, and
          which statements it touched is visible in the statement each result quotes. */}
      {results !== null && limitsAdded > 0 && (
        <p className={styles.note}>{t("query.limitAdded", { n: limitsAdded, limit })}</p>
      )}
      {results?.map((result, i) => (
        <section key={i} className={styles.result}>
          <header className={styles.resultHeader}>
            <span className={styles.resultLabel}>
              {t("query.resultLabel", { n: i + 1, verb: result.verb })}
            </span>
            <span className={styles.resultDuration}>
              {t("query.duration", { ms: result.durationMs })}
            </span>
            {/* One line of it: the statement is in the editor above, and this is only here to say
                which of the statements up there this result belongs to. */}
            <span className={styles.resultStatement} title={result.statement}>
              {result.statement}
            </span>
          </header>

          <div className={styles.resultBody}>
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
                            <td
                              key={c}
                              className={isNull ? styles.cellNull : undefined}
                              // Only where the cell can actually be cut short. A result of a
                              // thousand rows is tens of thousands of cells, and a tooltip on
                              // every one of them is weight the grid carries for nothing.
                              title={value.length > TOOLTIP_FROM ? value : undefined}
                            >
                              {value}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.rows.length === 0 && <p className={styles.noRows}>{t("query.noRows")}</p>}
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

export default memo(QueryResults);
