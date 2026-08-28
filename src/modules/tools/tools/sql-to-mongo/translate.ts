import { likeToRegex } from "./like";
import type { Dialect, Translation, Unsupported, Warning } from "./types";

/*
 * Hình dạng AST dưới đây là của `node-sql-parser`, đọc ra từ chính nó chứ không đoán. Vài chỗ
 * không như tên gọi gợi ý, và mỗi chỗ đều đã suýt thành một lỗi:
 *
 * - `NOT (a = 1)` **không** phải `binary_expr` với operator `NOT`. Nó là một node `function` tên
 *   `NOT`, nên nó phải được nhận ra *trước* khi luật từ chối gạt mọi hàm vô hướng đi.
 * - PostgreSQL trả `column_ref.column` là `{ expr: { value } }`, MySQL trả một chuỗi. `columnName`
 *   đọc cả hai.
 * - `astify` trả một object cho một câu lệnh và một **mảng** cho nhiều câu.
 * - `limit` là `{ seperator, value: [limit, offset?] }` — `seperator` (viết sai chính tả như vậy
 *   trong thư viện) là `"offset"` khi có phần tử thứ hai.
 */

/** Đủ dùng cho việc duyệt ở đây; AST thật rộng hơn nhiều và ta không cần phần còn lại. */
interface Node {
  type?: string;
  [key: string]: unknown;
}

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Tên cột, đọc được cả dạng chuỗi của MySQL lẫn dạng object của PostgreSQL. */
function columnName(ref: Node): string {
  const column = ref.column;
  if (typeof column === "string") return column;
  if (isNode(column) && isNode(column.expr) && typeof column.expr.value === "string") {
    return column.expr.value;
  }
  return "";
}

/** Tên của một node `function`, đọc từ cấu trúc `name.name[0].value`. */
function functionName(node: Node): string {
  const name = node.name;
  if (typeof name === "string") return name;
  if (isNode(name) && Array.isArray(name.name)) {
    const first = name.name[0];
    if (isNode(first) && typeof first.value === "string") return first.value.toUpperCase();
  }
  return "";
}

const AGGREGATES = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

/**
 * Mọi lý do câu lệnh này không dịch được, gom một lượt.
 *
 * Gom hết thay vì dừng ở cái đầu tiên: người dán một câu có cả JOIN lẫn subquery nên thấy cả hai
 * trong một lần, chứ không phải sửa một cái rồi mới biết còn cái nữa.
 */
function collectUnsupported(ast: Node, sql: string): Unsupported[] {
  const found: Unsupported[] = [];
  const add = (code: Unsupported["code"], fragment: string) => {
    if (!found.some((u) => u.code === code)) found.push({ code, fragment: fragment || sql });
  };

  if (ast.with) add("cte", "WITH");
  if (ast._next) add("union", String(ast.set_op ?? "UNION").toUpperCase());

  const from = Array.isArray(ast.from) ? ast.from : [];
  if (from.length > 1) {
    const joined = from.find((entry) => isNode(entry) && entry.join);
    add("join", isNode(joined) ? String(joined.join) : "FROM a, b");
  }

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!isNode(value)) return;

    // Một subquery xuất hiện dưới dạng một node lồng có khoá `ast`, hoặc một node `select` lồng.
    if (value.ast !== undefined || (value !== ast && value.type === "select")) {
      add("subquery", "SELECT (…)");
      return;
    }

    if (value.type === "case") add("case", "CASE");
    if (value.over) add("window", "OVER");

    if (value.type === "aggr_func") {
      const name = typeof value.name === "string" ? value.name.toUpperCase() : "";
      if (!AGGREGATES.has(name)) add("function", `${name}(…)`);
    }

    // `NOT` đội lốt một hàm vô hướng. Đi vào trong nó thay vì từ chối nó.
    if (value.type === "function" && functionName(value) !== "NOT") {
      add("function", `${functionName(value)}(…)`);
      return;
    }

    Object.values(value).forEach(walk);
  };

  walk(ast.columns);
  walk(ast.where);
  walk(ast.having);
  walk(ast.groupby);
  walk(ast.orderby);

  return found;
}

/** Giá trị literal của một node, dùng thẳng làm giá trị JSON. */
function literal(node: Node): unknown {
  if (node.type === "null") return null;
  if (node.type === "bool") return node.value;
  return node.value;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Ngữ cảnh đi kèm suốt lượt duyệt: dialect quyết định `LIKE` có phân biệt hoa thường không, và
 *  cảnh báo được gom vào đây trên đường đi. */
interface Context {
  dialect: Dialect;
  warnings: Warning[];
}

function warn(ctx: Context, code: Warning["code"], fragment: string) {
  if (!ctx.warnings.some((w) => w.code === code && w.fragment === fragment)) {
    ctx.warnings.push({ code, fragment });
  }
}

function buildFilter(node: unknown, ctx: Context): unknown {
  if (!isNode(node)) return {};

  if (node.type === "function" && functionName(node) === "NOT") {
    const args = isNode(node.args) && Array.isArray(node.args.value) ? node.args.value : [];
    // `$not` của Mongo chỉ đứng bên trong một trường; phủ định cả một điều kiện là `$nor`.
    return { $nor: args.map((arg) => buildFilter(arg, ctx)) };
  }

  if (node.type !== "binary_expr") return {};

  const operator = String(node.operator ?? "");
  const left = node.left;
  const right = node.right;

  if (operator === "AND") return { $and: [buildFilter(left, ctx), buildFilter(right, ctx)] };
  if (operator === "OR") return { $or: [buildFilter(left, ctx), buildFilter(right, ctx)] };

  if (!isNode(left) || !isNode(right)) return {};
  const field = columnName(left);

  if (operator === "LIKE" || operator === "NOT LIKE" || operator === "ILIKE") {
    // MySQL không phân biệt hoa thường theo collation mặc định; PostgreSQL thì có, và `ILIKE` là
    // cách nó nói "đừng phân biệt". Đây là chỗ ô chọn dialect có ảnh hưởng thật.
    const insensitive = ctx.dialect === "mysql" || operator === "ILIKE";
    const expr = {
      $regex: likeToRegex(String(right.value ?? "")),
      ...(insensitive ? { $options: "i" } : {}),
    };
    return { [field]: operator === "NOT LIKE" ? { $not: expr } : expr };
  }

  if (operator === "IS") warn(ctx, "isNull", field);

  if (operator === "=" && right.type === "single_quote_string") {
    const value = String(right.value ?? "");
    if (field === "_id" && OBJECT_ID.test(value)) warn(ctx, "objectId", value);
    else if (/^\d+$/.test(value)) warn(ctx, "type", field);
  }

  switch (operator) {
    // Dạng ngắn, không `$eq`: đó là cái người ta viết tay, và nó đọc được hơn.
    case "=":
      return { [field]: literal(right) };
    case "!=":
    case "<>":
      return { [field]: { $ne: literal(right) } };
    case ">":
      return { [field]: { $gt: literal(right) } };
    case ">=":
      return { [field]: { $gte: literal(right) } };
    case "<":
      return { [field]: { $lt: literal(right) } };
    case "<=":
      return { [field]: { $lte: literal(right) } };
    case "IS":
      return { [field]: null };
    case "IS NOT":
      return { [field]: { $ne: null } };
    case "IN":
    case "NOT IN": {
      const values = Array.isArray(right.value) ? right.value.filter(isNode).map(literal) : [];
      return { [field]: operator === "IN" ? { $in: values } : { $nin: values } };
    }
    case "BETWEEN": {
      const pair = Array.isArray(right.value) ? right.value.filter(isNode).map(literal) : [];
      return { [field]: { $gte: pair[0], $lte: pair[1] } };
    }
    default:
      return {};
  }
}

/** `null` cho `SELECT *` — không có projection thì `find` không nhận tham số thứ hai. */
function buildProjection(columns: unknown): Record<string, unknown> | null {
  if (!Array.isArray(columns)) return null;

  const projection: Record<string, unknown> = {};
  let named = false;

  for (const entry of columns) {
    if (!isNode(entry) || !isNode(entry.expr)) continue;
    if (entry.expr.type === "column_ref" && columnName(entry.expr) === "*") return null;
    if (entry.expr.type !== "column_ref") continue;

    const name = columnName(entry.expr);
    const alias = typeof entry.as === "string" ? entry.as : null;
    projection[alias ?? name] = alias ? `$${name}` : 1;
    named = true;
  }

  if (!named) return null;
  // `_id` đi kèm mặc định trong Mongo, còn `SELECT name` thì không có nghĩa là "name và _id".
  if (!("_id" in projection)) projection._id = 0;
  return projection;
}

function buildSort(orderby: unknown): Record<string, number> | null {
  if (!Array.isArray(orderby) || orderby.length === 0) return null;

  const sort: Record<string, number> = {};
  for (const entry of orderby) {
    if (!isNode(entry) || !isNode(entry.expr)) continue;
    sort[columnName(entry.expr)] = String(entry.type).toUpperCase() === "DESC" ? -1 : 1;
  }
  return Object.keys(sort).length > 0 ? sort : null;
}

/** `[limit, skip]`, mỗi cái `null` khi câu lệnh không nói tới. */
function buildLimit(limit: unknown): [number | null, number | null] {
  if (!isNode(limit) || !Array.isArray(limit.value) || limit.value.length === 0) return [null, null];
  const values = limit.value.filter(isNode).map((node) => Number(node.value));
  const hasOffset = String(limit.seperator ?? "") === "offset" && values.length > 1;
  return [values[0] ?? null, hasOffset ? values[1] : null];
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

function formatFind(
  collection: string,
  filter: unknown,
  projection: Record<string, unknown> | null,
  sort: Record<string, number> | null,
  skip: number | null,
  limit: number | null,
): string {
  let out = projection
    ? `db.${collection}.find(${json(filter)}, ${json(projection)})`
    : `db.${collection}.find(${json(filter)})`;
  if (sort) out += `.sort(${json(sort)})`;
  if (skip !== null) out += `.skip(${skip})`;
  if (limit !== null) out += `.limit(${limit})`;
  return out;
}

/**
 * Một câu SQL thành một truy vấn MongoDB, hoặc thành lý do vì sao không.
 *
 * Async vì parser được `import()` động: nó là thứ nặng duy nhất của tool, và nó chỉ cần có mặt
 * khi người ta thật sự bấm dịch.
 */
export async function translate(sql: string, dialect: Dialect): Promise<Translation> {
  const trimmed = sql.trim();
  if (trimmed === "") return { ok: false, unsupported: [{ code: "parse", fragment: "" }] };

  /* Bản dựng riêng cho một dialect, không phải entry chính.
     `node-sql-parser` gói cả mười mấy dialect vào một file 2,5 MB; `build/mysql` là 276 kB và
     `build/postgresql` là 308 kB. Ta biết dialect ngay tại đây, nên không có lý do gì tải phần
     còn lại — và hai nhánh `import()` viết rời nhau như thế này là cách bundler tách được chúng
     thành hai chunk. */
  const { Parser } =
    dialect === "mysql"
      ? await import("node-sql-parser/build/mysql")
      : await import("node-sql-parser/build/postgresql");

  let parsed: unknown;
  try {
    parsed = new Parser().astify(trimmed, { database: dialect });
  } catch {
    return { ok: false, unsupported: [{ code: "parse", fragment: trimmed }] };
  }

  if (Array.isArray(parsed)) {
    if (parsed.length > 1) return { ok: false, unsupported: [{ code: "multi", fragment: trimmed }] };
    parsed = parsed[0];
  }
  if (!isNode(parsed)) return { ok: false, unsupported: [{ code: "parse", fragment: trimmed }] };

  const ast = parsed;
  if (ast.type !== "select") {
    return { ok: false, unsupported: [{ code: "dml", fragment: String(ast.type).toUpperCase() }] };
  }

  const unsupported = collectUnsupported(ast, trimmed);
  if (unsupported.length > 0) return { ok: false, unsupported };

  const from = Array.isArray(ast.from) ? ast.from : [];
  const first = from[0];
  const collection = isNode(first) && typeof first.table === "string" ? first.table : "collection";

  const ctx: Context = { dialect, warnings: [] };
  const [limit, skip] = buildLimit(ast.limit);

  return {
    ok: true,
    output: formatFind(
      collection,
      buildFilter(ast.where, ctx),
      buildProjection(ast.columns),
      buildSort(ast.orderby),
      skip,
      limit,
    ),
    warnings: ctx.warnings,
  };
}
