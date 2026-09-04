import type { SqlEditing } from "../sql/dialect";

/**
 * What the Structure tab's dialogs would offer on ClickHouse — unreachable in v1, since
 * `writable: false` on {@link clickhouseDialect} closes every button that would open one of them.
 * Kept as an honest empty shape rather than copied from another engine's, so that turning writing
 * on one day starts from "nothing is offered yet" instead of from types and clauses that were
 * never actually checked against a ClickHouse `ALTER TABLE`.
 */
export const clickhouseEditing: SqlEditing = {
  columnTypes: [],
  unsigned: false,
  columnPosition: false,
  onUpdateCurrentTimestamp: false,
  objectCollation: false,
  markExpressionDefaults: false,
  indexKinds: [],
  indexMethods: [],
  indexPrefix: false,
  primaryKeyName: null,
};
