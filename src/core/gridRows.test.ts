import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ô của lưới không được có padding dọc.
 *
 * Chiều cao dòng là một số khai báo trong TypeScript (`ROW_HEIGHT`), và spacer đứng thay cho các
 * dòng ngoài khung cao đúng `count × ROW_HEIGHT` — xem `virtualRows.ts`. CSS lấy lại con số đó qua
 * `--row-h` và đặt `height`, nên hai bên không thể lệch nhau *trừ khi* một rule cộng thêm chiều
 * cao mà `height` không nuốt: padding dọc, hoặc border dọc.
 *
 * Đã có người dính đúng cái đó khi thử "nén dòng lại" bằng padding: dòng phồng từ 33px lên 38.8px
 * và số dòng thấy được **giảm**. Không test nào đỏ, và triệu chứng duy nhất là đáy trang trôi ra
 * xa khi cuộn tới gần nó.
 *
 * Vitest ở đây chạy môi trường node, không có DOM, nên chiều cao thật không đo được. Cái đo được
 * là stylesheet, và đây là điều kiện duy nhất trên stylesheet có thể phá bất biến kia.
 *
 * Đọc từ đĩa: `?raw` trong cấu hình này trả về chuỗi rỗng, và một test parse chuỗi rỗng thì xanh
 * mà chưa kiểm gì — xem ghi chú trong `shell/fonts.test.ts`.
 */

const SRC = join(import.meta.dirname, "..");

function stylesheets(dir: string): { path: string; css: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheets(full);
    if (!entry.name.endsWith(".css")) return [];
    return [{ path: relative(SRC, full).replace(/\\/g, "/"), css: readFileSync(full, "utf8") }];
  });
}

/** Mọi khối `selector { … }` trong cùng, tách như `glass.test.ts` tách chúng. */
function blocks(css: string) {
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, selector, body]) => {
    const lines = selector.trim().split("\n");
    return { selector: lines[lines.length - 1].trim(), body };
  });
}

const sheets = stylesheets(join(SRC, "modules/db"));

describe("grid rows", () => {
  it("đọc được stylesheet, không phải một mớ rỗng", () => {
    expect(sheets.length).toBeGreaterThan(10);
    expect(sheets.every(({ css }) => css.length > 0)).toBe(true);
  });

  it("không rule nào cho ô của lưới padding dọc", () => {
    const offenders = sheets.flatMap(({ path, css }) =>
      blocks(css)
        .filter(({ selector }) => /\.gridRows\b[^{]*\btd\b/.test(selector))
        .filter(({ body }) => /padding(-top|-bottom)?:\s*(?![0;\s])/.test(body))
        .map(({ selector }) => `${path}: ${selector}`),
    );
    expect(offenders).toEqual([]);
  });

  it("mọi rule ghim dòng đều lấy chiều cao từ --row-h, không viết số", () => {
    const offenders = sheets.flatMap(({ path, css }) =>
      blocks(css)
        .filter(({ selector }) => /\.gridRows\b[^{]*\btd\b/.test(selector))
        .filter(({ body }) => /height:/.test(body) && !/height:\s*var\(--row-h\)/.test(body))
        .map(({ selector }) => `${path}: ${selector}`),
    );
    expect(offenders).toEqual([]);
  });
});
