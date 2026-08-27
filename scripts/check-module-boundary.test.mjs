import { describe, expect, test } from "vitest";

import { findViolations } from "./check-module-boundary.mjs";

/** A file as the walker hands it over: a repo-relative path with forward slashes, and its text. */
const file = (path, text) => ({ path, text });

describe("findViolations", () => {
  test("reports a guarded file importing from a module", () => {
    const violations = findViolations([
      file("src/core/gridText.ts", 'import { rowText } from "../modules/db/rowText";\n'),
    ]);

    expect(violations).toEqual([
      {
        path: "src/core/gridText.ts",
        line: 1,
        statement: 'import { rowText } from "../modules/db/rowText";',
      },
    ]);
  });

  test("ignores a module named in a comment", () => {
    expect(
      findViolations([
        file(
          "src/shell/shortcuts.ts",
          "// a REST module — the registry is still the only place outside `src/modules/` that may.\n",
        ),
      ]),
    ).toEqual([]);
  });

  test("lets the two joining files import a module", () => {
    expect(
      findViolations([
        file("src/shell/registry.ts", 'import { dbModule } from "../modules/db";\n'),
        file("src/i18n/dicts.ts", 'import dbEn from "../modules/db/i18n/en";\n'),
      ]),
    ).toEqual([]);
  });

  test("the allowance is for those two files, not their folders", () => {
    const violations = findViolations([
      file("src/shell/App.tsx", 'import { DbTab } from "../modules/db/DbTab";\n'),
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0].path).toBe("src/shell/App.tsx");
  });

  test("catches a dynamic import and a re-export, not just a static import", () => {
    const violations = findViolations([
      file("src/core/lazy.ts", 'const m = await import("../modules/rest/api");\n'),
      file("src/components/Tabs/index.ts", 'export { badges } from "../../modules/db/badges";\n'),
    ]);

    expect(violations.map((v) => v.path)).toEqual([
      "src/core/lazy.ts",
      "src/components/Tabs/index.ts",
    ]);
  });

  test("says nothing about files outside the guarded folders", () => {
    expect(
      findViolations([
        file("src/modules/db/DbTab.tsx", 'import { api } from "../modules/db/api";\n'),
        file("src/main.tsx", 'import { MODULES } from "./shell/registry";\n'),
      ]),
    ).toEqual([]);
  });

  test("reports the line the import is actually on", () => {
    const violations = findViolations([
      file("src/icons/Db.tsx", '\n// nothing here\n\nimport { x } from "../modules/db";\n'),
    ]);

    expect(violations[0].line).toBe(4);
  });
});
