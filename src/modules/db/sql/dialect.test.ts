/**
 * The dialects' write flags, checked together.
 *
 * One file rather than four because what is worth asserting is how they *differ*: an engine can
 * have the Structure tab open while the Query tab and dump/restore stay shut, and ClickHouse is
 * the first one that does. A single flag would make that impossible to express, and this is the
 * test that would fail if the three were ever folded back into one.
 */

import { describe, expect, it } from "vitest";
import { clickhouseDialect } from "../clickhouse/dialect";
import { mysqlDialect } from "../mysql/dialect";
import { postgresDialect } from "../postgres/dialect";
import { sqliteDialect } from "../sqlite/dialect";

const SQL_ENGINES = [mysqlDialect, postgresDialect, sqliteDialect];

describe("write flags", () => {
  it("leaves the three SQL engines with everything open", () => {
    for (const dialect of SQL_ENGINES) {
      expect(dialect.writable, dialect.kind).toBe(true);
      expect(dialect.ddlWritable, dialect.kind).toBe(true);
      expect(dialect.rowsWritable, dialect.kind).toBe(true);
    }
  });

  it("opens ClickHouse's schema without opening its Query tab or dump/restore", () => {
    // `writable` is what gates the Query tab and dump/restore, and the Query tab's guard does not
    // tell DDL from DML — so reaching `ALTER TABLE` through that flag would open hand-typed
    // `INSERT` with it. That is the whole reason `ddlWritable` exists.
    expect(clickhouseDialect.ddlWritable).toBe(true);
    expect(clickhouseDialect.writable).toBe(false);
  });
});
