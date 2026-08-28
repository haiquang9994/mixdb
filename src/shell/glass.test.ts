import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the two engines make of `backdrop-filter`, asserted against the stylesheet itself.
 *
 * There is no rendering here to check, and none of this is visible in review: WebKit *accepts* the
 * declaration `backdrop-filter: url(#…)` and then draws nothing for it — reference filters on a
 * backdrop are unimplemented (WebKit bug 245510) — while Blink resolves it. So a lens that names
 * the SVG filter unconditionally keeps its frost on Windows and loses it on a Mac, and the only
 * symptom is a menu that looks too transparent.
 *
 * The trap is the fallback. Since Safari 18 `-webkit-backdrop-filter` is an alias of the same
 * property rather than a second one, so a `backdrop-filter: url(…)` written after it does not sit
 * beside the prefixed line as its replacement — it overwrites it, and takes down the frost the
 * prefixed line was there to provide.
 *
 * Đọc từ đĩa bằng `node:fs`. Đến 2026-08-29 file này dùng `import css from "./glass.css?raw"`, và
 * trong cấu hình vitest ở đây hậu tố `?raw` trả về **chuỗi rỗng** — plugin CSS của Vite xử lý file
 * trước khi nó kịp có tác dụng. Cả hai test bên dưới parse chuỗi rỗng, được 0 rule, lọc ra mảng
 * rỗng, rồi khẳng định `[] === []`: chúng xanh suốt mà chưa từng đọc một dòng CSS nào. Một tấm
 * lưới an toàn hỏng im lặng còn tệ hơn không có lưới, vì nó còn làm người ta thôi nhìn.
 */
describe("glass.css", () => {
  const css = readFileSync(join(import.meta.dirname, "glass.css"), "utf8");

  /* Canh chính cái bẫy trên: nếu nguồn đọc lại rỗng, hai test dưới lại xanh mà không kiểm gì. */
  it("đọc được stylesheet", () => {
    expect(css).toContain("backdrop-filter");
  });

  /** Every innermost `selector { … }` in the file, as the selector it is drawn for and its
   *  declarations. Innermost because the pattern admits no braces on either side, so an at-rule's
   *  own line is never mistaken for a rule of its own. */
  const blocks = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, selector, body]) => {
    const lines = selector.trim().split("\n");
    return { selector: lines[lines.length - 1].trim(), body };
  });

  it("names the SVG filter only where an engine resolves it", () => {
    const unguarded = blocks
      .filter(({ body }) => /(?<!-webkit-)backdrop-filter:\s*url\(/.test(body))
      .filter(({ selector }) => !selector.includes('[data-platform="windows"]'))
      .map(({ selector }) => selector);
    expect(unguarded).toEqual([]);
  });

  it("leaves every prefixed frost a plain unprefixed one beside it", () => {
    const stranded = blocks
      .filter(({ body }) => body.includes("-webkit-backdrop-filter:"))
      .filter(({ body }) => !/(?<!-webkit-)backdrop-filter:(?!\s*url\()/.test(body))
      .map(({ selector }) => selector);
    expect(stranded).toEqual([]);
  });
});
