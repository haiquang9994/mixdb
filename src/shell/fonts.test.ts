import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Hai vai của chữ, khẳng định trên chính stylesheet.
 *
 * Không có gì để render ở đây, và không có gì trong này thấy được khi review. Trước đợt token này
 * `var(--font-mono)` đã được dùng ở bốn chỗ mà chưa bao giờ được định nghĩa: ba chỗ có `, monospace`
 * đỡ phía sau, chỗ thứ tư không có, nên rule của nó vô hiệu và chữ rơi về font kế thừa từ `:root`
 * — vốn tình cờ cũng là Fira Code. Nó đúng nhờ tai nạn, và cái tai nạn đó biến mất đúng lúc `:root`
 * chuyển sang sans. Triệu chứng duy nhất là một dialog đổi font, nên nó được khẳng định ở đây.
 *
 * Stylesheet được đọc từ đĩa bằng `node:fs`, không phải qua `?raw`. Trong cấu hình vitest này
 * `import css from "./x.css?raw"` trả về **chuỗi rỗng** — plugin CSS của Vite xử lý file trước khi
 * hậu tố `?raw` kịp có tác dụng. Một test parse chuỗi rỗng thì được 0 rule, lọc ra mảng rỗng, và
 * khẳng định `[] === []`: nó xanh mà chưa từng kiểm gì. Đó là lý do ở đây đọc đĩa, và là lý do
 * `stylesheets()` được canh bằng một test riêng bên dưới — một tấm lưới an toàn hỏng im lặng thì
 * tệ hơn là không có lưới, vì nó còn làm người ta yên tâm.
 */

const SRC = join(import.meta.dirname, "..");

/** Mọi `.css` dưới `src/`, theo đường dẫn tương đối với `src/` cho thông báo lỗi đọc được. */
function stylesheets(dir: string = SRC): { path: string; css: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheets(full);
    if (!entry.name.endsWith(".css")) return [];
    return [{ path: relative(SRC, full).replace(/\\/g, "/"), css: readFileSync(full, "utf8") }];
  });
}

const sheets = stylesheets();

/** `App.css` một mình — nơi mọi token được định nghĩa. */
const appCss = sheets.find(({ path }) => path === "shell/App.css")!.css;

describe("font tokens", () => {
  it("đọc được stylesheet, không phải một mớ rỗng", () => {
    // Cái bẫy mà `?raw` rơi vào, canh ở đây để nó không quay lại im lặng.
    expect(sheets.length).toBeGreaterThan(40);
    expect(sheets.every(({ css }) => css.length > 0)).toBe(true);
    expect(appCss).toContain(":root");
  });

  it("định nghĩa cả hai vai trên :root", () => {
    expect(appCss).toMatch(/--font-ui:\s*[^;]+;/);
    expect(appCss).toMatch(/--font-mono:\s*[^;]+;/);
  });

  it("không stylesheet nào gọi tên font ngoài chỗ định nghĩa token", () => {
    const offenders = sheets
      .filter(({ path }) => path !== "shell/App.css")
      .filter(({ css }) => /font-family:[^;]*(Fira Code|system-ui|sans-serif|monospace)/.test(css))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("mọi var(--font-*) được dùng đều có định nghĩa", () => {
    const defined = new Set([...appCss.matchAll(/(--font-[\w-]+):/g)].map(([, name]) => name));
    const used = new Set(
      sheets.flatMap(({ css }) =>
        [...css.matchAll(/var\((--font-[\w-]+)/g)].map(([, name]) => name),
      ),
    );
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });
});
