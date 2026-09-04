import { describe, expect, it } from "vitest";
import { resolve } from "./index";
import { EN } from "./dicts";

describe("resolve", () => {
  it("reads a nested key", () => {
    expect(resolve(EN, "common.save")).toBe(EN.common.save);
  });

  it("returns the key itself when the dictionary doesn't have it", () => {
    // Hành vi đã tài liệu hoá trong .agent/conventions/i18n.md: "An unknown key resolves to the
    // key string itself rather than throwing."
    expect(resolve(EN, "no.such.key" as never)).toBe("no.such.key");
  });

  it("does not throw when key is not a string", () => {
    // Đúng dạng lỗi thật: một Record<SomeUnion, TranslationKey> tra bằng giá trị đọc từ đĩa (ví dụ
    // KIND_LABEL[kindLạ] trước khi có kindLabel()) trả undefined, và undefined lọt tới đây.
    expect(() => resolve(EN, undefined as never)).not.toThrow();
  });
});
