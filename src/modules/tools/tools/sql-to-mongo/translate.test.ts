import { describe, expect, it } from "vitest";
import { translate } from "./translate";

const ok = async (sql: string) => {
  const result = await translate(sql, "mysql");
  if (!result.ok) throw new Error(`không dịch được: ${JSON.stringify(result.unsupported)}`);
  return result;
};

const codes = async (sql: string) => {
  const result = await translate(sql, "mysql");
  if (result.ok) throw new Error("đáng lẽ phải bị từ chối");
  return result.unsupported.map((u) => u.code);
};

describe("translate — trường hợp tối giản", () => {
  it("SELECT * thành find rỗng", async () => {
    expect((await ok("SELECT * FROM users")).output).toBe("db.users.find({})");
  });

  it("bỏ qua dấu chấm phẩy và khoảng trắng thừa", async () => {
    expect((await ok("  SELECT * FROM users ;  ")).output).toBe("db.users.find({})");
  });
});

describe("translate — từ chối", () => {
  it("từ chối JOIN", async () => {
    expect(await codes("SELECT * FROM a JOIN b ON a.id = b.a_id")).toContain("join");
  });

  it("từ chối subquery", async () => {
    expect(await codes("SELECT * FROM a WHERE id IN (SELECT id FROM b)")).toContain("subquery");
  });

  it("từ chối UNION", async () => {
    expect(await codes("SELECT a FROM x UNION SELECT a FROM y")).toContain("union");
  });

  it("từ chối CTE", async () => {
    expect(await codes("WITH t AS (SELECT 1) SELECT * FROM t")).toContain("cte");
  });

  it("từ chối INSERT/UPDATE/DELETE", async () => {
    expect(await codes("DELETE FROM users WHERE id = 1")).toContain("dml");
    expect(await codes("INSERT INTO users (a) VALUES (1)")).toContain("dml");
  });

  it("từ chối nhiều câu lệnh trong một lần dán", async () => {
    expect(await codes("SELECT * FROM a; SELECT * FROM b")).toContain("multi");
  });

  it("từ chối hàm vô hướng", async () => {
    expect(await codes("SELECT CONCAT(a, b) FROM t")).toContain("function");
  });

  it("từ chối CASE", async () => {
    expect(await codes("SELECT CASE WHEN a = 1 THEN 2 ELSE 3 END FROM t")).toContain("case");
  });

  it("báo lỗi cú pháp thành mã `parse`, không ném ra ngoài", async () => {
    expect(await codes("SELECT FROM")).toContain("parse");
  });

  it("kèm đoạn SQL gây ra, để Panel chỉ được chỗ", async () => {
    const result = await translate("SELECT * FROM a JOIN b ON a.id = b.a_id", "mysql");
    if (result.ok) throw new Error("đáng lẽ phải bị từ chối");
    expect(result.unsupported[0].fragment).not.toBe("");
  });

  it("`NOT` là một node function trong AST nhưng vẫn phải dịch được", async () => {
    expect((await ok("SELECT * FROM t WHERE NOT (a = 1)")).output).toContain("$nor");
  });
});

describe("translate — đường find()", () => {
  it("chuyển danh sách cột thành projection, và tắt _id", async () => {
    expect((await ok("SELECT name, email FROM users")).output).toBe(
      'db.users.find({}, {\n  "name": 1,\n  "email": 1,\n  "_id": 0\n})',
    );
  });

  it("giữ _id khi nó được chọn tên", async () => {
    const out = (await ok("SELECT _id, name FROM users")).output;
    expect(out).toContain('"_id": 1');
    expect(out).not.toContain('"_id": 0');
  });

  it("đổi alias thành projection có biểu thức", async () => {
    expect((await ok("SELECT name AS n FROM users")).output).toContain('"n": "$name"');
  });

  it("dịch các toán tử so sánh", async () => {
    expect((await ok("SELECT * FROM u WHERE age > 18")).output).toContain('"$gt": 18');
    expect((await ok("SELECT * FROM u WHERE age = 18")).output).toContain('"age": 18');
    expect((await ok("SELECT * FROM u WHERE age <> 18")).output).toContain('"$ne": 18');
    expect((await ok("SELECT * FROM u WHERE age >= 18")).output).toContain('"$gte": 18');
    expect((await ok("SELECT * FROM u WHERE age <= 18")).output).toContain('"$lte": 18');
    expect((await ok("SELECT * FROM u WHERE age < 18")).output).toContain('"$lt": 18');
  });

  it("dịch AND và OR", async () => {
    expect((await ok("SELECT * FROM u WHERE a = 1 AND b = 2")).output).toContain('"$and"');
    expect((await ok("SELECT * FROM u WHERE a = 1 OR b = 2")).output).toContain('"$or"');
  });

  it("dịch IN, NOT IN và BETWEEN", async () => {
    expect((await ok("SELECT * FROM u WHERE id IN (1, 2)")).output).toContain('"$in"');
    expect((await ok("SELECT * FROM u WHERE id NOT IN (1, 2)")).output).toContain('"$nin"');
    const between = (await ok("SELECT * FROM u WHERE age BETWEEN 1 AND 5")).output;
    expect(between).toContain('"$gte": 1');
    expect(between).toContain('"$lte": 5');
  });

  it("dịch IS NULL và IS NOT NULL", async () => {
    expect((await ok("SELECT * FROM u WHERE a IS NULL")).output).toContain('"a": null');
    expect((await ok("SELECT * FROM u WHERE a IS NOT NULL")).output).toContain('"$ne": null');
  });

  it("dịch ORDER BY, LIMIT và OFFSET, theo đúng thứ tự chuỗi phương thức", async () => {
    expect((await ok("SELECT * FROM u ORDER BY a DESC, b ASC LIMIT 10 OFFSET 20")).output).toBe(
      'db.u.find({}).sort({\n  "a": -1,\n  "b": 1\n}).skip(20).limit(10)',
    );
  });

  it("LIMIT không kèm OFFSET thì không sinh ra .skip()", async () => {
    expect((await ok("SELECT * FROM u LIMIT 10")).output).toBe("db.u.find({}).limit(10)");
  });

  it("đọc được tên cột của PostgreSQL, thứ AST gói trong một object thay vì một chuỗi", async () => {
    const result = await translate("SELECT * FROM u WHERE age > 18", "postgresql");
    if (!result.ok) throw new Error("đáng lẽ dịch được");
    expect(result.output).toContain('"age"');
  });
});
