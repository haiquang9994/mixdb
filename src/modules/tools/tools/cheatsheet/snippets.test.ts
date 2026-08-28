import { describe, expect, it } from "vitest";
import { fill, paramsOf } from "./snippets";

describe("paramsOf", () => {
  it("lấy tham số theo thứ tự xuất hiện", () => {
    expect(paramsOf("cmd -h {{host}} -u {{user}}")).toEqual(["host", "user"]);
  });

  it("không lặp lại tham số dùng nhiều lần", () => {
    expect(paramsOf("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });

  it("trả mảng rỗng cho template không có tham số", () => {
    expect(paramsOf("docker system prune -af")).toEqual([]);
  });

  it("bỏ qua ngoặc nhọn không thành cặp", () => {
    expect(paramsOf("echo {{a} và {b}}")).toEqual([]);
  });

  it("nhận tên có gạch dưới và số", () => {
    expect(paramsOf("{{local_port}}:{{remote_2}}")).toEqual(["local_port", "remote_2"]);
  });
});

describe("fill", () => {
  it("thay tham số bằng giá trị", () => {
    expect(fill("psql -h {{host}} -U {{user}}", { host: "db", user: "an" })).toBe(
      "psql -h db -U an",
    );
  });

  it("thay mọi lần xuất hiện của cùng một tham số", () => {
    expect(fill("{{a}}-{{a}}", { a: "x" })).toBe("x-x");
  });

  // Một ô chưa điền phải nhìn thấy được trong đầu ra, chứ không biến mất thành khoảng trắng.
  it("giữ nguyên tham số chưa có giá trị", () => {
    expect(fill("cmd {{host}} {{port}}", { host: "db" })).toBe("cmd db {{port}}");
  });

  it("giữ nguyên tham số có giá trị rỗng", () => {
    expect(fill("cmd {{host}}", { host: "" })).toBe("cmd {{host}}");
  });

  // Tool không bọc ngoặc hộ: người viết template quyết định chỗ nào cần ngoặc.
  it("không tự bọc ngoặc cho giá trị có dấu cách", () => {
    expect(fill("mysql -p'{{password}}'", { password: "mật khẩu" })).toBe("mysql -p'mật khẩu'");
  });
});
