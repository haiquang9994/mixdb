import Button from "../Button";
import Input from "../Input";
import Select from "../Select";
import { MinusIcon, PlusIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import {
  FILTER_OPERATORS,
  isFilterComplete,
  operatorArity,
  type FilterOperator,
  type MysqlFilter,
} from "../../mysql/filters";
import styles from "./FilterBar.module.css";

/** One row of the bar while it is being edited — a condition plus the two things only the UI
 * cares about: whether it is switched on, and what tells it apart from an identical row. */
export interface FilterRow {
  /** Identity for React and for the edit handlers, since two rows may otherwise be equal and a
   * row's position changes as the ones above it are removed. */
  id: number;
  /** The checkbox at the head of the row: off leaves the condition written down but unapplied. */
  enabled: boolean;
  column: string;
  operator: FilterOperator;
  value: string;
}

let nextRowId = 1;

/** The column a row starts on: `id` when the table has one — it is what a lookup is nearly
 * always by — and otherwise the first column, so the row is never left pointing at nothing. */
function startingColumn(columns: string[]): string {
  return columns.find((c) => c.toLowerCase() === "id") ?? columns[0] ?? "";
}

export function createFilterRow(columns: string[]): FilterRow {
  return {
    id: nextRowId++,
    enabled: true,
    column: startingColumn(columns),
    operator: "eq",
    value: "",
  };
}

/** What the bar holds when a table is first opened: an empty `id =` row, ready for the lookup
 * that is about to be typed into it. A table with no id column starts with no rows at all —
 * there is no column to guess at, and an arbitrary one would only be in the way. */
export function initialFilterRows(columns: string[]): FilterRow[] {
  return columns.some((c) => c.toLowerCase() === "id") ? [createFilterRow(columns)] : [];
}

/** The conditions that actually reach the query: the rows that are switched on and filled in.
 * A row whose operator still wants a value is dropped rather than sent — see
 * {@link isFilterComplete}. */
export function toQueryFilters(rows: FilterRow[]): MysqlFilter[] {
  return rows
    .filter((row) => row.enabled && row.column !== "" && isFilterComplete(row.operator, row.value))
    .map(({ column, operator, value }) => ({ column, operator, value }));
}

interface Props {
  columns: string[];
  rows: FilterRow[];
  onChange: (rows: FilterRow[]) => void;
  /** Runs the rows against the table. The bar edits freely until this is called. */
  onApply: () => void;
  /** Blocks applying while the grid is busy with something else; the rows stay editable. */
  applyDisabled?: boolean;
}

/** The row of conditions above the grid. Every row is ANDed with the others, and none of them
 * touch the query until Apply (or Enter in a value box) is pressed — so a half-typed condition
 * never costs a round trip. */
function FilterBar({ columns, rows, onChange, onApply, applyDisabled }: Props) {
  const { t } = useTranslation();

  const columnOptions = columns.map((c) => ({ value: c, label: c }));
  const operatorOptions = FILTER_OPERATORS.map((op) => ({
    value: op.id,
    label: t(`sqlTable.op.${op.id}`),
  }));

  function updateRow(id: number, patch: Partial<FilterRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function changeOperator(row: FilterRow, operator: FilterOperator) {
    // An operator that takes no value leaves the box disabled, and text left sitting in a
    // disabled box reads as if it were still part of the condition.
    const clears = operatorArity(operator) === "none";
    updateRow(row.id, { operator, ...(clears ? { value: "" } : null) });
  }

  function valuePlaceholder(operator: FilterOperator): string {
    switch (operatorArity(operator)) {
      case "none":
        return "";
      case "list":
        return t("sqlTable.filterListPlaceholder");
      case "pair":
        return t("sqlTable.filterPairPlaceholder");
      default:
        return t("sqlTable.filterValuePlaceholder");
    }
  }

  return (
    <div className={styles.bar}>
      {rows.length > 0 && (
        <div className={styles.rows}>
          {rows.map((row) => {
            const takesValue = operatorArity(row.operator) !== "none";
            return (
              <div key={row.id} className={styles.row}>
                <input
                  type="checkbox"
                  className={styles.toggle}
                  checked={row.enabled}
                  aria-label={t("sqlTable.enableFilter")}
                  title={t("sqlTable.enableFilter")}
                  onChange={(e) => updateRow(row.id, { enabled: e.target.checked })}
                />
                <Select
                  size="small"
                  className={styles.column}
                  value={row.column}
                  options={columnOptions}
                  ariaLabel={t("sqlTable.filterColumn")}
                  searchable
                  searchPlaceholder={t("sqlTable.filterColumnSearch")}
                  onChange={(column) => updateRow(row.id, { column })}
                />
                <Select
                  size="small"
                  className={styles.operator}
                  value={row.operator}
                  options={operatorOptions}
                  ariaLabel={t("sqlTable.filterOperator")}
                  searchable
                  searchPlaceholder={t("sqlTable.filterOperatorSearch")}
                  onChange={(operator) => changeOperator(row, operator)}
                />
                <Input
                  size="small"
                  className={styles.value}
                  value={row.value}
                  disabled={!takesValue}
                  placeholder={valuePlaceholder(row.operator)}
                  aria-label={t("sqlTable.filterValue")}
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                  // Enter is the shortcut for the Apply button beneath — a filter is typed and
                  // run far more often than it is typed and left.
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || applyDisabled) return;
                    e.preventDefault();
                    onApply();
                  }}
                />
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t("sqlTable.removeFilter")}
                  title={t("sqlTable.removeFilter")}
                  onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                >
                  <MinusIcon size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t("sqlTable.addFilter")}
          title={t("sqlTable.addFilter")}
          disabled={columns.length === 0}
          onClick={() => onChange([...rows, createFilterRow(columns)])}
        >
          <PlusIcon size={14} />
        </button>
        <Button size="small" disabled={applyDisabled} onClick={onApply}>
          {t("sqlTable.applyFilters")}
        </Button>
      </div>
    </div>
  );
}

export default FilterBar;
