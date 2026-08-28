import { describe, expect, it } from "vitest";
import { diffLines, type DiffOptions } from "./diff";

const plain: DiffOptions = { ignoreWhitespace: false, ignoreCase: false };

const kinds = (left: string, right: string, options: DiffOptions = plain): string[] => {
  const result = diffLines(left, right, options);
  return result.ok ? result.lines.map((line) => `${line.kind[0]}:${line.text}`) : [result.reason];
};

describe("diffLines", () => {
  it("gọi hai đoạn giống nhau là giống nhau", () => {
    expect(kinds("a\nb", "a\nb")).toEqual(["s:a", "s:b"]);
  });

  it("thấy dòng thêm vào", () => {
    expect(kinds("a\nc", "a\nb\nc")).toEqual(["s:a", "a:b", "s:c"]);
  });

  it("thấy dòng bị xoá", () => {
    expect(kinds("a\nb\nc", "a\nc")).toEqual(["s:a", "r:b", "s:c"]);
  });

  it("đếm số dòng thêm và xoá", () => {
    const result = diffLines("a\nb", "a\nc\nd", plain);
    expect(result.ok && result.added).toBe(2);
    expect(result.ok && result.removed).toBe(1);
  });

  it("đánh số dòng theo từng bên", () => {
    const result = diffLines("a\nb", "a", plain);
    expect(result.ok && result.lines[1]).toEqual({
      kind: "remove",
      leftNo: 2,
      rightNo: null,
      text: "b",
    });
  });

  it("bỏ qua khoảng trắng khi được yêu cầu", () => {
    expect(kinds("a  b", "a b", { ignoreWhitespace: true, ignoreCase: false })).toEqual(["s:a  b"]);
  });

  it("bỏ qua hoa thường khi được yêu cầu", () => {
    expect(kinds("Abc", "abc", { ignoreWhitespace: false, ignoreCase: true })).toEqual(["s:Abc"]);
  });

  // Cắt đầu đuôi giống nhau là thứ làm tool dùng được với file thật: mười dòng khác nhau giữa
  // hai file 50 nghìn dòng thì bảng LCS chỉ còn 10×10.
  it("chạy được với file rất dài khi phần khác nhau nhỏ", () => {
    const head = Array.from({ length: 30_000 }, (_, i) => `dòng ${i}`).join("\n");
    const result = diffLines(`${head}\nX`, `${head}\nY`, plain);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
  });

  it("từ chối khi phần khác nhau vượt quá giới hạn", () => {
    const left = Array.from({ length: 2100 }, (_, i) => `l${i}`).join("\n");
    const right = Array.from({ length: 2100 }, (_, i) => `r${i}`).join("\n");
    expect(diffLines(left, right, plain)).toEqual({ ok: false, reason: "tooLarge" });
  });
});
