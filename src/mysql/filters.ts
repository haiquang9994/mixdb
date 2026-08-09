/** How many values an operator reads out of the one text box the filter row gives it. */
export type FilterArity =
  /** None — `IS NULL` and its kind stand on their own, and the box is left disabled. */
  | "none"
  /** One, taken as typed. */
  | "one"
  /** A comma-separated list, for `IN` / `NOT IN`. */
  | "list"
  /** Two bounds, `min,max`, for `BETWEEN` / `NOT BETWEEN`. */
  | "pair";

/** Every operator a filter row can use, in the order the dropdown offers them: comparisons first,
 * then the text matches, then the set/range ones, and the value-less ones last. Each `id` is what
 * the backend matches on (`build_where` in `src-tauri/src/db/mysql.rs`) and also names its label
 * under `sqlTable.op.*` — an operator added here needs an entry in both. */
export const FILTER_OPERATORS = [
  { id: "eq", arity: "one" },
  { id: "ne", arity: "one" },
  { id: "gt", arity: "one" },
  { id: "gte", arity: "one" },
  { id: "lt", arity: "one" },
  { id: "lte", arity: "one" },
  { id: "contains", arity: "one" },
  { id: "notContains", arity: "one" },
  { id: "startsWith", arity: "one" },
  { id: "endsWith", arity: "one" },
  { id: "like", arity: "one" },
  { id: "notLike", arity: "one" },
  { id: "regexp", arity: "one" },
  { id: "notRegexp", arity: "one" },
  { id: "in", arity: "list" },
  { id: "notIn", arity: "list" },
  { id: "between", arity: "pair" },
  { id: "notBetween", arity: "pair" },
  { id: "isNull", arity: "none" },
  { id: "isNotNull", arity: "none" },
  { id: "isEmpty", arity: "none" },
  { id: "isNotEmpty", arity: "none" },
] as const satisfies readonly { id: string; arity: FilterArity }[];

export type FilterOperator = (typeof FILTER_OPERATORS)[number]["id"];

const ARITY: Record<FilterOperator, FilterArity> = Object.fromEntries(
  FILTER_OPERATORS.map((op) => [op.id, op.arity]),
) as Record<FilterOperator, FilterArity>;

export function operatorArity(operator: FilterOperator): FilterArity {
  return ARITY[operator];
}

/** One condition sent to the server. They are ANDed together; the value is always text, and the
 * operator is what says how to read it. */
export interface MysqlFilter {
  column: string;
  operator: FilterOperator;
  value: string;
}

/**
 * Splits an `IN`/`BETWEEN` value into its items — `1,2,3` or `abc,xyz`, each item trimmed.
 *
 * An item may be wrapped in single or double quotes, which is how a value that itself holds a
 * comma (or spaces that matter) gets through: the quotes come off and what was inside them is
 * taken as-is. Empty items are dropped, so a trailing comma costs nothing — but a quoted `''`
 * stays, being the only way to put an empty string in a list.
 *
 * This mirrors `split_list` in `src-tauri/src/db/mysql.rs`, which is what actually builds the
 * placeholders; the two have to agree on how many items a value holds or a row would be sent as
 * complete and come back matching something else.
 */
export function splitFilterList(raw: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  let quoted = false;

  function flush() {
    const item = quoted ? current : current.trim();
    if (quoted || item !== "") items.push(item);
    current = "";
    quoted = false;
  }

  for (const ch of raw) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      quoted = true;
      continue;
    }
    if (ch === ",") {
      flush();
      continue;
    }
    current += ch;
  }
  flush();
  return items;
}

/** Whether a row has everything its operator needs to be worth sending. A row that hasn't been
 * filled in yet is left out of the query entirely rather than matched literally — the bar opens
 * with an empty `id =` row, and that must not mean "the rows whose id is the empty string". */
export function isFilterComplete(operator: FilterOperator, value: string): boolean {
  switch (operatorArity(operator)) {
    case "none":
      return true;
    case "list":
      return splitFilterList(value).length > 0;
    case "pair":
      return splitFilterList(value).length >= 2;
    default:
      return value !== "";
  }
}
