/**
 * The client's statement splitter, held against the server's.
 *
 * Every case in the first half of this file is one of the cases
 * [`mysql_script.rs`](../../src-tauri/src/db/mysql_script.rs) tests its own splitter with, written
 * out again here in the same order. That is the point: the two are ports of each other, and the
 * whole contract between them is that a script carves up the same way on both sides. A statement
 * the editor marks in the margin has to be the statement the server ends up running as one, or the
 * highlight, the error underlines and the write guard are all drawn around the wrong text.
 *
 * The second half covers what this port adds and the Rust one has no need of: where each statement
 * sits in the script, and which one the caret is in.
 */

import { describe, expect, it } from "vitest";
import { splitStatements, statementAt } from "./statements";

const texts = (sql: string) => splitStatements(sql).map((statement) => statement.text);
const verbs = (sql: string) => splitStatements(sql).map((statement) => statement.verb);

describe("splitStatements", () => {
  it("splits on semicolons and trims each statement", () => {
    expect(texts("SELECT 1;\n  SELECT 2 ;")).toEqual(["SELECT 1", "SELECT 2"]);
    // A script needs no trailing semicolon, and an empty one adds no statement.
    expect(texts("SELECT 1")).toEqual(["SELECT 1"]);
    expect(texts(";;\n;")).toEqual([]);
  });

  it("takes the verb from the opening keyword, upper-cased", () => {
    expect(verbs("select 1; delete from t")).toEqual(["SELECT", "DELETE"]);
    // Leading whitespace and a comment before the keyword don't become part of it.
    expect(verbs("  -- a note\n  insert into t values ()")).toEqual(["INSERT"]);
  });

  it("does not split on a semicolon inside a string or a quoted name", () => {
    expect(texts("INSERT INTO t VALUES ('a;b'); SELECT 1")).toEqual([
      "INSERT INTO t VALUES ('a;b')",
      "SELECT 1",
    ]);
    expect(texts(`SELECT "a;b"`)).toEqual([`SELECT "a;b"`]);
    expect(texts("SELECT `we;ird`")).toEqual(["SELECT `we;ird`"]);
  });

  /** Both of MySQL's escapes inside a string literal: a backslash, and the quote doubled. */
  it("does not end a string on an escaped quote", () => {
    expect(texts(String.raw`SELECT 'a\'; b'`)).toEqual([String.raw`SELECT 'a\'; b'`]);
    expect(texts("SELECT 'a''; b'")).toEqual(["SELECT 'a''; b'"]);
  });

  /**
   * Comments are carried along — a `/*! ... *\/` version comment or a `/*+ hint *\/` is part of what
   * MySQL is being asked to run — but a semicolon inside one separates nothing.
   */
  it("carries comments along and hides their semicolons", () => {
    expect(texts("SELECT 1 -- one; two\n; SELECT 2")).toEqual(["SELECT 1 -- one; two", "SELECT 2"]);
    expect(texts("SELECT 1 # one; two")).toEqual(["SELECT 1 # one; two"]);
    expect(texts("/*!40101 SET x=1; */ SELECT 1")).toEqual(["/*!40101 SET x=1; */ SELECT 1"]);
    // Nothing but a comment is not a statement at all.
    expect(texts("-- just a note\n")).toEqual([]);
  });

  /** `--` opens a comment only when whitespace follows it; `5--3` is arithmetic. */
  it("reads two dashes without whitespace as an operator", () => {
    expect(texts("SELECT 5--3; SELECT 2")).toEqual(["SELECT 5--3", "SELECT 2"]);
  });

  /** What this port adds: the range is the trimmed statement, so a finding drawn against it lands
   *  on the text rather than on the whitespace in front of it. */
  it("points each statement at where its trimmed text sits", () => {
    const sql = "  SELECT 1;\n\nSELECT 2";
    const [first, second] = splitStatements(sql);
    expect(sql.slice(first.from, first.to)).toBe("SELECT 1");
    expect(sql.slice(second.from, second.to)).toBe("SELECT 2");
    // The terminating semicolon belongs to neither.
    expect(sql[first.to]).toBe(";");
  });
});

describe("statementAt", () => {
  it("finds the statement the caret is inside", () => {
    const sql = "SELECT 1;\nSELECT 2";
    const statements = splitStatements(sql);
    expect(statementAt(sql, statements, 3)?.text).toBe("SELECT 1");
    expect(statementAt(sql, statements, 12)?.text).toBe("SELECT 2");
  });

  it("stays with the statement just ended until a blank line says otherwise", () => {
    // The caret left sitting after the semicolon it has just typed is still working on that
    // statement — running it is the commonest thing to do next.
    const near = "SELECT 1;\nSELECT 2";
    expect(statementAt(near, splitStatements(near), 9)?.text).toBe("SELECT 1");

    // Past a blank line it has moved on to what comes next.
    const apart = "SELECT 1;\n\n\n   SELECT 2";
    expect(statementAt(apart, splitStatements(apart), 12)?.text).toBe("SELECT 2");
  });

  it("answers with nothing for a script that holds no statements", () => {
    expect(statementAt("", [], 0)).toBeNull();
    expect(statementAt("-- a note", splitStatements("-- a note"), 4)).toBeNull();
  });
});
