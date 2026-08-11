# Query editor roadmap

Plan for turning the Query tab's editor from a `<textarea>` into a real MySQL editor. Written
2026-08-10, before any of it is built. Three phases; each one ships on its own and leaves the tab
usable.

**Status: P1 shipped 2026-08-10, P2 shipped 2026-08-11. P3 is being shipped a feature at a time —
hover docs and `Ctrl+Click` landed 2026-08-11.**

Measured on the test server (`192.168.50.86:3307`, MySQL 5.7.44) while building P1, so the next
phase can argue from numbers rather than from worry:

| | |
| --- | --- |
| `schema_outline`, 2 tables | 36 ms |
| `schema_outline`, 302 tables / 3,606 columns / 300 foreign keys | 104–216 ms |
| Splitting a 146 KB script | 0.83 ms |
| Splitting a 732 KB script | 4.6 ms |

So the outline is affordable even on a large 5.7 schema, and splitting only starts to matter on
scripts of half a megabyte. The same read on MySQL 8.4.8 (port 3308) returns the same shape — only
the type spellings differ (`int unsigned` against 5.7's `int(10) unsigned`).

Today's editor is [QueryEditor.tsx](../../src/components/QueryEditor/QueryEditor.tsx): a plain
textarea with two behaviours — `Tab` inserts two spaces, `Ctrl+Enter` runs. No highlighting, no
completion, no error checking. The backend side is already the strong half: `mysql_script::run`
splits a script, runs it statement by statement on one connection, and `mysql_cancel_query` kills a
statement in flight. Almost everything below is frontend work plus three new read-only commands.

## Decisions taken up front

**CodeMirror 6, not Monaco.** `@codemirror/lang-sql` ships a `MySQL` dialect (backtick identifiers,
`--`/`#`/`/*! */` comments, MySQL keyword set) and schema-driven completion as first-class API.
It is plain ESM, tree-shakes to a few hundred KB, and its theming is CSS — so it can be dressed in
the app's own tokens and Fira Code rather than fought with. Monaco would drag in ~5 MB, web
workers, and a SQL language service we would have to write ourselves.

**Syntax checking is two layers.** A fast client-side lint while typing, plus a debounced
server-side check that asks MySQL itself to parse the statement (see P2). Only the server knows the
dialect of the version actually connected; only the client can be instant. Neither alone is enough.

When P1 lands, record the CodeMirror choice properly in `.agent/decisions/`.

## Phase 1 — the editor itself

The goal: a script written here reads and behaves like one written in a real SQL editor.

### New component

`src/components/SqlEditor/` — a CodeMirror wrapper with no knowledge of MySQL commands or results.
It takes `value`, `onChange`, `schema`, `onRun`, `onRunAll` and renders an editor.

| File | Role |
| --- | --- |
| `SqlEditor.tsx` | The React shell: creates one `EditorView` in `useEffect`, destroys it on cleanup, syncs external `value` changes in |
| `extensions.ts` | The extension list assembled in one place (language, completion, search, keymap, gutters) |
| `theme.ts` | `EditorView.theme` built from the app's CSS tokens, plus the highlight style |
| `completion.ts` | Schema-aware completion source (P1) and the doc tooltips (P3) |
| `SqlEditor.module.css` | The frame, the resize handle, the height rules |
| `index.ts` | Re-export |

`QueryEditor` keeps everything it owns now — the toolbar, the target chip, the results column — and
swaps the `<textarea>` for `<SqlEditor>`.

Packages: `codemirror` (or the individual `@codemirror/{state,view,commands,language,autocomplete,search,lint}`),
`@codemirror/lang-sql`, `sql-formatter`.

### Schema outline — a new backend command

Completion needs every table and column of the selected database at once. `mysql_table_structure`
reads one table at a time and is the wrong shape for this.

`mysql_schema_outline(id, database) -> MysqlSchemaOutline` — one round trip over
`information_schema.columns`, `.statistics` and `.key_column_usage`, returning per table: column
names, data types, nullability, key flags, and the foreign keys pointing out of it. Follow
[adding-a-command](../conventions/adding-a-command.md); it is read-only and cheap enough to fetch
on first use of the tab.

Frontend cache in `src/mysql/schemaCache.ts`, keyed by `connectionId + database`, shaped like
[savedConnectionsStore.ts](../../src/savedConnectionsStore.ts) (external store + `useSyncExternalStore`)
so several tabs share one copy. Invalidate when the workspace runs DDL or the user hits refresh.

### Statement splitting on the client

Running the statement under the caret, and highlighting it, needs the same split the backend does.
Port `split_statements` from
[mysql_script.rs](../../src-tauri/src/db/mysql_script.rs) to `src/mysql/statements.ts`, returning
`{ text, verb, from, to }` ranges rather than just text.

> The two splitters must stay in sync. If the Rust one learns something (a `DELIMITER` directive,
> a new comment form), the TS one learns it in the same commit. Both files get a comment saying so.

### What P1 delivers

- MySQL syntax highlighting, bracket/quote matching, auto-close, line numbers.
  **Not** code folding: `@codemirror/lang-sql` declares no fold ranges, so a fold gutter would be
  an empty column. Folding a script by statement is possible — the splitter already knows the
  ranges — and is P3 material if it is ever wanted.
- Schema completion: after `FROM`/`JOIN` → tables; in `SELECT`/`WHERE`/`ORDER BY`/`GROUP BY` →
  columns of the tables in scope; after `alias.` → that table's columns. Keywords and MySQL
  built-in functions always. Completion entries carry the column type as detail.
- ~~`Ctrl+Enter` runs the statement under the caret, `Ctrl+Shift+Enter` the whole script.~~
  **Superseded.** One key runs: `Ctrl+R`, which sends the selection when there is one and the whole
  script when there is not. The caret's statement is still highlighted, but nothing runs from it.
  The `Enter` chords and the Run all button are gone; the hint strip says the one shortcut.
- `Ctrl+Shift+F` formats via `sql-formatter` (`language: "mysql"`), selection-only when there is a
  selection.
- Editing comforts: `Ctrl+/` comment toggle, multi-cursor, `Ctrl+F` find/replace with regex,
  `Ctrl+D` duplicate line, `Alt+↑/↓` move line.
- Theme follows the app's light/dark and accent tokens; the pane keeps its vertical resize.

### Traps to expect

- **React 19 StrictMode double-mounts.** Create the view in `useEffect` and `view.destroy()` in the
  cleanup, never in render.
- **Controlled value.** Only `dispatch` an external value into the view when it differs from
  `view.state.doc.toString()`, or every keystroke fights the state update and the caret jumps.
- **Height.** CodeMirror needs a definite height. Keep the resizable wrapper and give the editor
  `height: 100%`, not the other way round.
- **The focus ring belongs to the pane**, as it does today — `.editorPane:focus-within`. Turn off
  CodeMirror's own `outline`.
- IME composition: do not intercept keys while `event.isComposing`.

## Phase 2 — error checking, safety, memory

**Shipped 2026-08-11**, as planned below with three changes worth writing down.

*The "`SELECT` with no `FROM` where one is clearly meant" rule was dropped.* Every version of it
that was cheap enough to run per keystroke also fired on valid SQL, and `mysql_validate_sql` catches
the real cases exactly, with the server's own wording. A checker that cries wolf gets switched off,
and then it catches nothing at all.

*An unqualified name is only reported when a real column is within two edits of it.* A bare word in
a statement can be a function without brackets, a unit in an `INTERVAL`, an alias written without
`AS` — none of which `lint.ts` models. A qualified `alias.column` is checked unconditionally,
because what the alias stands for is known exactly. See the reasoning in the header of
[lint.ts](../../src/mysql/lint.ts).

*`TRUNCATE` was added to the unguarded-write confirmation.* It is the same danger as a `DELETE` with
no `WHERE`, and saying which rows is not something it can do.

*The confirmation does not say how many rows the table holds.* The plan above assumed the outline
would know, and it does not — `schema_outline` reads column names and foreign keys, nothing about
size. The count lives in `mysql_table_stats`, which is a separate read of `information_schema` for
the whole database, and firing that off while someone is waiting on a confirmation buys a number
that is an InnoDB estimate anyway. Naming the table is what the dialog is for; if the count is ever
wanted, widening the outline is the way to get it, not a second round trip from the dialog.

Measured against both test servers (5.7.44 on :3307, 8.4.8 on :3308): a syntax error comes back as
`1064` with the line parsed out, an unknown column as `1054` and an unknown table as `1146`, both as
warnings; `USE` returns nothing (`1295`). A `DELETE` and a `CREATE TABLE` put through `validate`
left the probe table's rows and the schema exactly as they were — the proof that `PREPARE` alone
executes nothing.

*The auto-`LIMIT` leaves a locking read alone.* `FOR UPDATE`, `FOR SHARE` and `LOCK IN SHARE MODE`
come after the `LIMIT` in MySQL's grammar, so the appended one lands on the wrong side of the clause
and the statement stops parsing — `1064` on both servers, for `SELECT ... FOR UPDATE LIMIT 500` as
well as for the `LOCK IN SHARE MODE` form. Such a query is deliberate and rarely unbounded, so it is
sent as written rather than rewritten around the clause.

### Client-side lint (instant)

A `@codemirror/lint` source that runs on the parsed document and reports, with a range:

- Unterminated string, backtick or block comment; unbalanced parentheses.
- A `SELECT` with no `FROM` where one is clearly meant, a trailing comma before `FROM`.
- Identifiers not in the loaded schema: unknown table, or unknown column for the tables in scope.
  Offer a quick fix naming the closest match (Levenshtein ≤ 2) — this is the single feature that
  will feel best day to day.
- Unknown identifiers are **warnings, not errors**: a script may create the table it then uses.

### Server-side validation (accurate)

`mysql_validate_sql(id, database, sql) -> MysqlSqlProblem | null`. It asks MySQL to parse the
statement without running it:

```sql
SET @mixdb_check = ?;            -- the statement text, bound
PREPARE mixdb_check FROM @mixdb_check;
DEALLOCATE PREPARE mixdb_check;
```

`PREPARE` cannot take a placeholder directly — its argument must be a string literal or a user
variable — hence the `SET` step, which *can* be bound and so never interpolates user text into SQL.

Rules this command has to follow:

- **Never executes.** `PREPARE` parses and plans; `DEALLOCATE` throws the plan away.
- Error 1295 (`ER_UNSUPPORTED_PS`) means "this statement kind cannot be prepared", not "invalid".
  Return `null`. Same for anything that is plainly a privilege error.
- Validation runs on a pooled connection, **not** the session the script runs on. So a temp table,
  a `USE`, or a `SET` from earlier in the script is invisible to it — "table doesn't exist" comes
  back as a *warning* severity, never an error.
- MySQL's syntax errors read `... near 'xxx' at line N`. Parse the line number out and anchor the
  diagnostic there; fall back to the whole statement when it isn't there.

Frontend: debounce (shipped at 400 ms, which reads as an answer rather than as a pause), validate
only the statement under the caret, and skip entirely while a script is running or no database is
selected. A check already sent is **not** cancelled — a Tauri `invoke` has nothing to cancel it
with — so instead its answer is measured against the text on screen when it lands and dropped if
the two have parted company. One request is outstanding per editor at a time, which is what keeps
that from mattering.

### Safety rails

- **Confirm before an unguarded write.** `UPDATE`/`DELETE` with no `WHERE` gets a `ConfirmDialog`
  naming the table. *Shipped without the row count* — the outline carries none, and reading one per
  table would be a cost paid on every database opened, for a sentence in a dialog. `DROP` and a
  dropping `ALTER` were added to the same gate afterwards: it would be a strange dialog that stopped
  `DELETE FROM users` and waved `DROP TABLE users` through.
- **Auto-LIMIT** (setting, default on): a bare `SELECT` with no `LIMIT` is run with `LIMIT 500`
  appended, and the result says the limit was added. Backend already truncates at 1000 rows; this
  saves the server the work rather than the client the memory.
- **Read-only connections**: a flag on the saved connection that refuses any statement whose verb
  writes, before it is sent. **It governs the whole workspace, not the Query tab** — the sidebar's
  create/rename/drop, the database tools, row editing in the Data tab and every `ALTER` in the
  Structure tab are all closed by it. A flag that guarded one of the five would read as a promise
  about the connection and keep none of it.

  All three of these read the statement's *tokens* ([guard.ts](../../src/mysql/guard.ts)), never a
  regular expression over its text — a `WHERE` inside a string or a comment is not a `WHERE`, and
  that is precisely the case a pattern would wave through. Two things learned by testing it: a
  statement opening with `WITH` has to be judged by what it leads into, since MySQL 8 lets a common
  table expression open an `UPDATE` or a `DELETE`; and a backtick-quoted name must be kept as a name
  but never matched against a keyword, or `` `where` `` talks the gate out of asking.

### Memory

- **Draft autosave** — the editor's text per `connectionId + database`, written through
  `@tauri-apps/plugin-store` (debounced), restored when the tab reopens.
- **Query history** — every run appended with `{ sql, database, startedAt, durationMs, rowCount,
  error }`, capped at a few hundred entries. A searchable panel; click to load into the editor,
  and a shortcut to re-run the last one.
- **Snippets** — named saved queries, insertable from completion by typing their name.

`src/queryDrafts.ts` and `src/queryHistory.ts`, both external stores like `savedConnectionsStore`.

## Phase 3 — what makes it stand out

- **EXPLAIN panel.** A button running `EXPLAIN FORMAT=JSON` (and `EXPLAIN ANALYZE` on MySQL 8.0.18+)
  for the current statement, rendered as a tree with cost and row estimates, flagging `type: ALL`,
  `Using filesort`, `Using temporary`, and any table read without an index. New command
  `mysql_explain(id, database, sql, analyze)`.
- ~~**Hover docs.**~~ **Shipped 2026-08-11.** Hovering a table shows its columns and their types;
  hovering a column shows its type, nullability, key and foreign key; hovering a built-in function
  shows its signature from [functions.ts](../../src/mysql/functions.ts). Two departures from the
  plan. *No indexes and no row count* — `schema_outline` reads neither, as P2 already found out, and
  widening it for a tooltip is a cost paid on every database opened for a thing looked at
  occasionally. *Signatures only, no prose*: a sentence per function would have to be written in
  both languages and kept correct, and the signature is the part someone actually stops to check.

  What resolves the name is [reference.ts](../../src/mysql/reference.ts), and it shares
  `lint.ts`'s tokeniser and its scope reader — which was pulled out of `checkStatement` into
  `readScope` for the purpose. That sharing is the point: the tooltip over `u.id` and the warning
  under it cannot disagree about which table `u` is. Where the checks go quiet on what they cannot
  model, this answers anyway — a checker that cries wolf loses its credibility, while a tooltip is
  only ever asked for.

  The one place the two must differ is the keyword list. The checks turn away every word MySQL
  reserves, and should: warning about `ORDER` would be crying wolf. But fifty of the ninety
  commonest column names are in that list — `date`, `code`, `user`, `value`, `text`, `comment`,
  `state`, `size`, `data`, `start`, `count` — so applying it here meant `SELECT date FROM logs` said
  nothing about `date` while `SELECT l.date` said everything. A bare word is now looked up against
  the columns of the tables the statement itself names, keywords and all; only the words that hold a
  statement together are refused. The wider guess, against every table in the database, keeps the
  full list — that one has nothing behind it but the spelling, and `Ctrl+Click` hangs off it.

  A known limit of that shorter list, left standing on purpose. Most of what is in it MySQL
  *reserves*, so it can never be a bare column name and refusing it costs nothing. A handful is not
  reserved — `end`, `view`, `full`, `duplicate`, `schema`, `database`, `some`, `any`, `truncate`,
  `separator` — and those are legal columns written plain, so `SELECT start, end FROM bookings`
  describes `start` and says nothing about `end`. Written in backticks they resolve, since a quoted
  word skips the list entirely. Taking them out would cost more than it buys: a table with a column
  called `end` would then have the `END` of every `CASE` described as that column. Four plausible
  names against fifty is the trade the current list makes.
- ~~**Ctrl+Click a table name**~~ **Shipped 2026-08-11**, into the Data tab: someone following a
  name out of a script wants rows, not column definitions. `onOpenTable` runs from
  [MysqlWorkspace.tsx](../../src/mysql/MysqlWorkspace.tsx) down into `QueryEditor`, and only a
  *table* is ever a target — a column's own table is one hover away, and opening a tab for it would
  surprise whoever aimed at the column. Holding the modifier underlines what it would follow, which
  is what makes the feature findable at all; the underline needs the pointer to be over the word
  itself, since `posAtCoords` will happily answer for the empty space at the end of a line.
- **Named parameters.** `:userId` in the script prompts for values before running. Prefer passing
  them to the backend as binds — `mysql_run_script` gains an optional `params` argument and
  rewrites `:name` to `?` per statement — over substituting text on the client, which means writing
  our own escaper.
- **Result grid work**: sort by column, find within results, hide columns, expand one cell as
  formatted JSON/text, and copy or export as CSV, JSON or `INSERT` statements. Follow whatever
  [SqlTable](../../src/components/SqlTable/SqlTable.tsx) already does rather than inventing a
  second grid.
- **Transaction bar**: `BEGIN` / `COMMIT` / `ROLLBACK` buttons with an indicator when the session is
  inside a transaction. The script already runs on one connection, so this works as-is.
- **Multiple query tabs** per connection, each with its own draft and results.
- Total script time and an "N of M statements" line above the results.

## Known rough edges in the results pane

Found while reviewing the pane rework of 2026-08-11 and left standing — both are reachable only by
driving a control to its limit, and neither loses any work.

- **The divider can push the footer bar out of view.** `MIN_EDITOR` in
  [resultsPane.ts](../../src/components/QueryEditor/resultsPane.ts) reserves 150px, but measures it
  against `tabRef` — the whole tab, toolbar and footer bar included — while `.editorPane` has a
  `min-height` of `6rem` it will not shrink past and `.queryEditor` has no `overflow: hidden` to
  clip what overflows. Drag the divider all the way up and the bar goes off the bottom edge. The fix
  is to measure the room the editor actually has rather than the room the tab has.
- **Expand and Hide do not exclude each other.** Expand stays enabled while the pane is shut, so
  results just put away can be lifted over the window; Hide stays enabled while the pane is up
  there, and closing it then flies the box home to a slot that has since collapsed. Either disable
  each against the other's state, or have Hide close the zoom on its way.

## Cross-cutting rules

- Every new string goes through `t("...")` in **both** `en.ts` and `vi.ts` — see
  [i18n](../conventions/i18n.md). The `query.*` group already exists.
- New components follow [component-structure](../conventions/component-structure.md) and
  [css-modules](../conventions/css-modules.md); no hardcoded colours, tokens only.
- New commands follow [adding-a-command](../conventions/adding-a-command.md) — all five places,
  including the `generate_handler!` list.
- Each phase adds its lines to `## [Unreleased]` in [CHANGELOG.md](../../CHANGELOG.md) as it is
  written.
- `npm run build` is the check; `npm run dev:app` is the only way to exercise a new command.
- `npm test` runs what can be tested without a database — the statement splitter, which has to keep
  agreeing with the Rust one it was ported from.

## Rough sizing

| Phase | Weight | Backend commands |
| --- | --- | --- |
| P1 | Largest single chunk — new component, new dependency, statement splitter port | `mysql_schema_outline` |
| P2 | Medium; the PREPARE detail work is the risk | `mysql_validate_sql` |
| P3 | Several independent features, ship one at a time | `mysql_explain`, params on `mysql_run_script` |
