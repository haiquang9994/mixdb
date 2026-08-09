import { useEffect, useMemo, useState } from "react";
import ActionBar from "../ActionBar";
import LoadingOverlay from "../LoadingOverlay";
import { ChevronDownIcon, ChevronUpIcon, ReloadIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import { mongoCollectionStats } from "../../mongo/api";
import { mysqlTableStats } from "../../mysql/api";
import type { TableStats } from "../../types";
import styles from "./DatabaseStats.module.css";

/** The columns the grid can be ordered by — every field of a row, the name included. */
type SortColumn = keyof TableStats;

interface Sort {
  column: SortColumn;
  desc: boolean;
}

/** Binary units, the ones a database reports its own sizes in. */
const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * A byte count as the closest unit that keeps it readable — `1536` becomes `1.50 KB`. Two decimals
 * below ten and one above, so the number stays about as wide whatever it is.
 */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 2 : 1;
  return `${value.toFixed(digits)} ${SIZE_UNITS[unit]}`;
}

/** A count with its thousands separated, which is what makes two of them comparable at a glance. */
function formatCount(value: number): string {
  return value.toLocaleString();
}

/** The figures on screen and the database they were read from, held together: a database changed
 * while the tab was hidden must not leave the previous one's figures under its name. */
interface Cache {
  database: string;
  rows: TableStats[];
}

interface Props {
  kind: "mysql" | "mongo";
  connectionId: string;
  /** The database being measured. Never empty: the workspace shows a prompt instead of mounting
   *  this until one is selected. */
  database: string;
  /** Whether the tab is the one on show. This stays mounted behind the others, so it is what says
   *  when the figures are worth reading — and when a reload the user cannot see would be wasted. */
  active: boolean;
  onError: (message: string) => void;
}

/**
 * What the selected database holds, table by table: how many rows, how much of the disk the rows
 * take, how much their indexes take, and how big an average row is.
 *
 * Ordered by data size to begin with rather than by name — the question this answers is which
 * table is the heavy one, and the sidebar next to it already lists them alphabetically.
 *
 * Read once and kept: the workspace leaves this mounted while another tab is up, so moving between
 * the tabs shows the figures already read rather than asking for them again. They are only re-read
 * when the database changes under them or the reload button asks, and a database changed while the
 * tab was hidden waits until it is looked at again before costing anything.
 *
 * Both databases report the same four numbers, so one grid serves them; only what the columns are
 * called changes, since MySQL counts rows in tables and MongoDB documents in collections. Neither
 * count is read by counting: MySQL's comes from `information_schema` (an estimate, on InnoDB) and
 * MongoDB's from the collection's own metadata, so this costs the server nothing to answer.
 */
function DatabaseStats({ kind, connectionId, database, active, onError }: Props) {
  const { t } = useTranslation();
  const [cache, setCache] = useState<Cache | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<Sort>({ column: "dataSize", desc: true });

  /** What has been read for the database now selected, or null when that is nothing yet — which
   *  is also what a cache left over from another database counts as. */
  const stats = cache?.database === database ? cache.rows : null;

  useEffect(() => {
    // Nothing to do until the tab is looked at, and nothing to do once it has been read: this is
    // what makes moving between the tabs free.
    if (!active || stats !== null) return;
    let cancelled = false;
    setLoading(true);
    const read =
      kind === "mysql"
        ? mysqlTableStats(connectionId, database)
        : mongoCollectionStats(connectionId, database);
    read
      .then((result) => {
        if (!cancelled) setCache({ database, rows: result });
      })
      .catch((e) => {
        if (cancelled) return;
        // Nothing is cached for a read that failed, so coming back to the tab tries again rather
        // than settling on an empty grid.
        onError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, connectionId, database, active, stats, onError]);

  const sorted = useMemo(() => {
    const rows = [...(stats ?? [])];
    rows.sort((a, b) => {
      const left = a[sort.column];
      const right = b[sort.column];
      const order =
        typeof left === "string" && typeof right === "string"
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      return sort.desc ? -order : order;
    });
    return rows;
  }, [stats, sort]);

  /** What the footer adds up. The average is the database's own — total bytes over total records,
   *  not the mean of the per-table averages, which would weigh a tiny table like a huge one. */
  const totals = useMemo(() => {
    const sum = sorted.reduce(
      (acc, row) => ({
        rows: acc.rows + row.rows,
        dataSize: acc.dataSize + row.dataSize,
        indexSize: acc.indexSize + row.indexSize,
      }),
      { rows: 0, dataSize: 0, indexSize: 0 },
    );
    return { ...sum, avgRecordSize: sum.rows > 0 ? sum.dataSize / sum.rows : 0 };
  }, [sorted]);

  /** Moves the clicked column to its next sort state: a new column opens on the order that reads
   *  it best — biggest first for a number, A to Z for a name — and clicking it again reverses. */
  function toggleSort(column: SortColumn) {
    setSort((prev) =>
      prev.column === column
        ? { column, desc: !prev.desc }
        : { column, desc: column !== "name" },
    );
  }

  const nameLabel = t(kind === "mysql" ? "dbStats.colTable" : "dbStats.colCollection");
  const countLabel = t(kind === "mysql" ? "dbStats.colRows" : "dbStats.colDocuments");
  const averageLabel = t(kind === "mysql" ? "dbStats.colAvgRow" : "dbStats.colAvgDocument");

  /** One sortable header. The chevron is always in the flow, empty when the column is not the one
   *  being sorted by, so the header does not change width as the sort moves between columns. */
  function header(column: SortColumn, label: string, numeric: boolean) {
    const active = sort.column === column;
    return (
      <th
        className={numeric ? `${styles.headerCell} ${styles.numeric}` : styles.headerCell}
        aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
        title={t(
          active ? (sort.desc ? "dbStats.sortDesc" : "dbStats.sortAsc") : "dbStats.sortNone",
          { column: label },
        )}
        onClick={() => toggleSort(column)}
      >
        {label}
        <span className={styles.sortIcon}>
          {active && (sort.desc ? <ChevronDownIcon /> : <ChevronUpIcon />)}
        </span>
      </th>
    );
  }

  return (
    <div className={styles.stats}>
      <header className={styles.panelHeader}>
        <h4 className={styles.panelTitle}>
          {t(kind === "mysql" ? "dbStats.tablesTitle" : "dbStats.collectionsTitle", { database })}
        </h4>
        <ActionBar
          actions={[
            {
              key: "reload",
              icon: ReloadIcon,
              label: t("dbStats.reload"),
              disabled: loading,
              busy: loading,
              // Dropping the cache is the reload: the effect reads again the moment there is
              // nothing held for the database on show.
              onClick: () => setCache(null),
            },
          ]}
        />
      </header>

      <div className={styles.gridWrap}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th className={styles.rowNumber}>#</th>
              {header("name", nameLabel, false)}
              {header("rows", countLabel, true)}
              {header("dataSize", t("dbStats.colDataSize"), true)}
              {header("indexSize", t("dbStats.colIndexSize"), true)}
              {header("avgRecordSize", averageLabel, true)}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={row.name}>
                <td className={styles.rowNumber}>{i + 1}</td>
                <td>
                  <span className={styles.name}>{row.name}</span>
                </td>
                <td className={styles.numeric}>{formatCount(row.rows)}</td>
                {/* The exact byte count is in the tooltip: what the cell shows is rounded to a
                    unit, and two tables can read the same while differing by megabytes. */}
                <td className={styles.numeric} title={t("dbStats.bytes", { bytes: formatCount(row.dataSize) })}>
                  {formatSize(row.dataSize)}
                </td>
                <td className={styles.numeric} title={t("dbStats.bytes", { bytes: formatCount(row.indexSize) })}>
                  {formatSize(row.indexSize)}
                </td>
                <td className={styles.numeric} title={t("dbStats.bytes", { bytes: formatCount(row.avgRecordSize) })}>
                  {formatSize(row.avgRecordSize)}
                </td>
              </tr>
            ))}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr>
                <td className={styles.rowNumber} />
                <td className={styles.name}>{t("dbStats.total")}</td>
                <td className={styles.numeric}>{formatCount(totals.rows)}</td>
                <td className={styles.numeric}>{formatSize(totals.dataSize)}</td>
                <td className={styles.numeric}>{formatSize(totals.indexSize)}</td>
                <td className={styles.numeric}>{formatSize(totals.avgRecordSize)}</td>
              </tr>
            </tfoot>
          )}
        </table>
        {/* Only once something has actually been read: `stats` is null while the first read is
            still out, and after one that failed — neither is an empty database. */}
        {!loading && stats?.length === 0 && (
          <p className="muted">
            {t(kind === "mysql" ? "dbStats.noTables" : "dbStats.noCollections")}
          </p>
        )}
      </div>

      {/* MySQL's row counts are sampled rather than counted, and saying so once under the grid is
          better than a tooltip on every cell that carries one. */}
      {kind === "mysql" && sorted.length > 0 && (
        <p className={styles.note}>{t("dbStats.estimateNote")}</p>
      )}

      {loading && <LoadingOverlay label={t("dbStats.loading")} />}
    </div>
  );
}

export default DatabaseStats;
