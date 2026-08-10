import type { SQLNamespace } from "@codemirror/lang-sql";
import type { MysqlOutlineColumn, MysqlSchemaOutline } from "../types";

/**
 * The schema outline, in the shape CodeMirror completes from.
 *
 * Everything is nested under the database's own name, and the editor is told that name is the
 * default one. That is what makes both spellings complete: `users` on its own, as an unqualified
 * script writes it, and `shop.users` where a script reaches across databases.
 */
export function completionSchema(outline: MysqlSchemaOutline | null): SQLNamespace | null {
  if (!outline) return null;
  const tables: Record<string, SQLNamespace> = {};
  for (const table of outline.tables) {
    tables[table.name] = {
      self: { label: table.name, type: "type" },
      children: table.columns.map((column) => ({
        label: column.name,
        type: "property",
        detail: columnDetail(column),
      })),
    };
  }
  return { [outline.database]: tables };
}

/** What is written beside a column in the list. Two columns of the same name in different tables
 *  are told apart by this line, so it carries what actually distinguishes them: the type, whether
 *  it is the key, and where a foreign key points.
 *
 *  Exported because the hover tooltip lists a table's columns the same way. One description of a
 *  column, wherever it is shown. */
export function columnDetail(column: MysqlOutlineColumn): string {
  const parts = [column.key === "PRI" ? "PK" : null, column.dataType];
  // `->` rather than a real arrow, and drawn as one either way: the app ships Fira Code itself, and
  // its ligature turns the two characters into a single long arrow. An actual `→` would come out
  // worse — U+2192 is in none of the subsets `@fontsource/fira-code` serves, whose latin range
  // carries U+2191 and U+2193 and stops there, so it would be borrowed from whatever the OS has and
  // sit at the wrong width in a column of monospace.
  if (column.references) parts.push(`-> ${column.references}`);
  return parts.filter((part) => part !== null).join(" ");
}
