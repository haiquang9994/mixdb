# Filter bar

The condition bar above a table (MySQL) or document list (Mongo) is split in two: the
database-agnostic mechanics in `src/filters.ts`, and one operator list per database in
`src/<db>/filters.ts`.

## The shared half — `src/filters.ts`

- `FilterArity` — how many values an operator reads out of its single text box: `"none"`
  (`IS NULL`, box disabled), `"one"`, `"list"` (comma-separated, for `IN`), `"pair"` (`min,max`,
  for `BETWEEN`).
- `FilterRow` — a row while it is being edited: the condition plus a synthetic `id` (rows can be
  identical and positions shift) and an `enabled` checkbox, so a condition can be kept written down
  but unapplied.
- `QueryFilter` — what is actually sent: `{ column, operator, value }`. Values are **always text**;
  the operator says how to read them. Conditions are ANDed together.

## The per-database half

`FILTER_OPERATORS` is a `const satisfies readonly FilterOperatorSpec[]` array, ordered as the
dropdown offers them (comparisons, text matches, set/range, value-less last). Each `id` does triple
duty, and adding an operator means touching all three:

1. The frontend id in `src/<db>/filters.ts`.
2. Its label in **both** `en.ts` and `vi.ts` — under `sqlTable.op.*` for MySQL, `noSqlTable.op.*`
   for Mongo.
3. The matching arm in the backend's WHERE builder — `build_where` in
   `src-tauri/src/db/mysql.rs`, with value splitting from `src-tauri/src/db/filters.rs`.

An id present in the frontend list but missing from the backend match silently drops the condition;
missing from the dictionaries it shows as the raw id.
