/**
 * The one thing the column dialog must never get wrong: a column opened and saved without being
 * touched has to reach the server declared exactly as the server declared it.
 *
 * On PostgreSQL that is not merely tidiness. `postgres_ddl::modify_column` writes an
 * `ALTER COLUMN ... TYPE` only where the type it is given differs from the one the catalogue
 * reports, and that statement rewrites every row of the table under an ACCESS EXCLUSIVE lock. A
 * spelling that differs by a space is a full rewrite for a saved comment.
 */

import { describe, expect, it } from "vitest";
import { composeType, parseType } from "./ColumnDialog";
import { mysqlEditing } from "../../mysql/editing";
import { postgresEditing } from "../../postgres/editing";
import type { SqlTypeSpec } from "../../sql/dialect";

/** Opens a declared type in the dialog and saves it again without touching anything. */
function roundTrip(types: readonly SqlTypeSpec[], dataType: string): string {
  const parts = parseType(types, dataType);
  // The rest of the draft is what the other fields hold; only these four decide the type.
  return composeType(types, { ...parts } as Parameters<typeof composeType>[1]);
}

describe("PostgreSQL types survive being opened and saved", () => {
  const pg = (dataType: string) => roundTrip(postgresEditing.columnTypes, dataType);

  it.each([
    "integer",
    "bigint",
    "boolean",
    "text",
    "character varying(255)",
    "character(36)",
    "numeric(10,2)",
    "double precision",
    "timestamp without time zone",
    "timestamp with time zone",
    "time with time zone",
    "jsonb",
    "uuid",
  ])("%s", (dataType) => {
    expect(pg(dataType)).toBe(dataType);
  });

  /** The names whose type is written around the modifier rather than after it. The dialog has no
   *  entry for a bare `timestamp`, so it keeps the tail verbatim — which is what makes this work. */
  it.each(["timestamp(3) without time zone", "time(3) with time zone"])("%s", (dataType) => {
    expect(pg(dataType)).toBe(dataType);
  });

  /** `format_type` writes no space before the brackets, and neither may this: PostgreSQL accepts
   *  `character varying(255) []` but the catalogue never reports it that way, so saving one would
   *  read as a change of type. */
  it.each(["text[]", "integer[]", "character varying(255)[]", "numeric(10,2)[]"])(
    "%s",
    (dataType) => {
      expect(pg(dataType)).toBe(dataType);
    }
  );
});

describe("MySQL types survive being opened and saved", () => {
  const mysql = (dataType: string) => roundTrip(mysqlEditing.columnTypes, dataType);

  it.each([
    "int",
    "int unsigned",
    "bigint(20) unsigned",
    "tinyint(1)",
    "decimal(10,2)",
    "varchar(255)",
    "text",
    "datetime",
    "json",
    "geometry",
  ])("%s", (dataType) => {
    expect(mysql(dataType)).toBe(dataType);
  });

  /** A bracket inside an `enum` is part of a value, not an array marker — the array handling must
   *  not reach into the argument and close the space up. */
  it("leaves a bracket inside an enum value alone", () => {
    expect(mysql("enum('a [b]','c')")).toBe("enum('a [b]','c')");
    expect(mysql("set('x []','y')")).toBe("set('x []','y')");
  });

  /** Anything trailing that the dialog has no control for is carried through rather than dropped. */
  it("keeps a trailing attribute it does not model", () => {
    expect(mysql("int unsigned zerofill")).toBe("int unsigned zerofill");
  });
});
