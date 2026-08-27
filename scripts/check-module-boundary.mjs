/**
 * Fails if anything outside `src/modules/` imports a module.
 *
 *   node scripts/check-module-boundary.mjs
 *
 * The rule is in AGENT.md and in .agent/conventions/adding-a-module.md: the shell knows nothing
 * about db, rest or terminal, and neither do the shared primitives. `tsc` compiles a broken
 * boundary perfectly happily — a `Button` importing from `modules/db/` type-checks — so this is
 * the only thing that says no, and until it ran in CI nothing said no on any machine but the
 * author's.
 *
 * Two files are the exception, and they are the point: `src/shell/registry.ts` joins a module to
 * the tab bar and `src/i18n/dicts.ts` joins its strings to the dictionary. One line per module in
 * each, and adding a fourth module means editing exactly those two.
 *
 * It matches import *specifiers* rather than the text `modules/`, which the convention doc's
 * PowerShell greps did. Those greps have two false positives today — both of them prose in
 * `src/shell/shortcuts.ts` explaining the very rule being checked — so a check written that way
 * would have failed on its first run and taught everyone to ignore it.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Everything the boundary protects. `src/modules/` and `src/main.tsx` are deliberately absent. */
export const GUARDED_DIRS = ["src/components", "src/core", "src/icons", "src/shell", "src/i18n"];

/** The two places a module is joined to the app — see the header. */
export const ALLOWED_FILES = new Set(["src/shell/registry.ts", "src/i18n/dicts.ts"]);

/**
 * The quoted half of any import: `from "x"`, `import("x")`, `import "x"` — and by the first of
 * those, `export { y } from "x"` too. Requiring the quotes is what keeps prose out: a comment can
 * say "import from modules/" all it likes without naming a specifier.
 */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

/**
 * @param {Array<{ path: string, text: string }>} files repo-relative paths, forward slashes
 * @returns {Array<{ path: string, line: number, statement: string }>} in the order given
 */
export function findViolations(files) {
  const violations = [];

  for (const { path, text } of files) {
    if (ALLOWED_FILES.has(path)) continue;
    if (!GUARDED_DIRS.some((dir) => path.startsWith(`${dir}/`))) continue;

    text.split(/\r?\n/).forEach((line, index) => {
      for (const [, specifier] of line.matchAll(SPECIFIER)) {
        if (!specifier.includes("modules/")) continue;
        violations.push({ path, line: index + 1, statement: line.trim() });
        // One report per line: a line naming two modules is still one thing to go and fix.
        break;
      }
    });
  }

  return violations;
}

/** Every `.ts`/`.tsx` under `dir`, as repo-relative forward-slash paths. */
function walk(root, dir) {
  const files = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...walk(root, path));
    else if (/\.tsx?$/.test(entry.name)) {
      files.push({ path, text: readFileSync(join(root, path), "utf8") });
    }
  }
  return files;
}

// Only when run as a command, so the tests can import the function above without this firing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const violations = findViolations(GUARDED_DIRS.flatMap((dir) => walk(root, dir)));

  if (violations.length === 0) {
    console.log(`Module boundary holds across ${GUARDED_DIRS.join(", ")}.`);
    process.exit(0);
  }

  console.error("Module boundary broken — nothing outside src/modules/ may import a module:\n");
  for (const { path, line, statement } of violations) {
    console.error(`  ${path}:${line}  ${statement}`);
  }
  console.error(
    `\nThe only files allowed to are ${[...ALLOWED_FILES].join(" and ")}.` +
      "\nSee .agent/conventions/adding-a-module.md.",
  );
  process.exit(1);
}
