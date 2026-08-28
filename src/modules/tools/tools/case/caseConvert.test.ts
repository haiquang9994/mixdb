import { describe, expect, it } from "vitest";
import { convert, splitWords } from "./caseConvert";

describe("splitWords", () => {
  it("tách camelCase", () => {
    expect(splitWords("fooBar")).toEqual(["foo", "bar"]);
  });

  it("giữ cụm viết hoa liền nhau thành một từ", () => {
    expect(splitWords("getHTTPResponse")).toEqual(["get", "http", "response"]);
  });

  it("tách trước chữ số nhưng không tách bên trong cụm số-chữ", () => {
    expect(splitWords("user2FA")).toEqual(["user", "2fa"]);
  });

  it("coi mọi dấu ngăn là như nhau", () => {
    expect(splitWords("created_at")).toEqual(["created", "at"]);
    expect(splitWords("created-at")).toEqual(["created", "at"]);
    expect(splitWords("created at")).toEqual(["created", "at"]);
    expect(splitWords("created.at")).toEqual(["created", "at"]);
  });

  it("bỏ dấu ngăn thừa ở hai đầu và ở giữa", () => {
    expect(splitWords("__created___at__")).toEqual(["created", "at"]);
  });

  it("trả mảng rỗng cho chuỗi không có ký tự nào dùng được", () => {
    expect(splitWords("   ")).toEqual([]);
    expect(splitWords("")).toEqual([]);
  });
});

describe("convert", () => {
  const input = "created_at";

  it("đổi sang từng kiểu", () => {
    expect(convert(input, "camel")).toBe("createdAt");
    expect(convert(input, "snake")).toBe("created_at");
    expect(convert(input, "kebab")).toBe("created-at");
    expect(convert(input, "pascal")).toBe("CreatedAt");
    expect(convert(input, "constant")).toBe("CREATED_AT");
    expect(convert(input, "dot")).toBe("created.at");
    expect(convert(input, "title")).toBe("Created At");
  });

  it("trả lại nguyên dòng khi không tách được từ nào", () => {
    expect(convert("   ", "camel")).toBe("   ");
  });
});
