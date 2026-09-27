/**
 * The RUNTIME contract of the source tree.
 *
 * `src/` is executed by plain `node --experimental-strip-types` (see `pnpm run serve`
 * and `pnpm run admin:key`), NOT through vitest's transpiler. Strip-only mode removes
 * types but refuses to TRANSFORM them, so a parameter property
 * (`constructor(readonly x: T)`), an `enum`, or a `namespace` is a **runtime crash**
 * that the suite would still call green.
 *
 * That exact defect was found by probing `pnpm run serve` by hand, which is what this
 * test replaces — but only for the modules that are safe to IMPORT. The two
 * entrypoints (`main.ts` binds a port, the admin CLI mints a key) run side effects at
 * the top level, so they are exercised as child processes elsewhere:
 * `tests/admin-key.test.ts` (pin 9) runs the CLI for real.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

const REPO = fileURLToPath(new URL("../", import.meta.url));

/** Entrypoints whose top level has SIDE EFFECTS: never imported, only executed. */
const ENTRYPOINTS = ["src/server/main.ts", "src/admin/mint-key.ts"];

/** Strip `//` and block comments, so a mention of `process.env` in prose is not a read. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

const allFiles = sourceFiles(join(REPO, "src")).sort();
const importable = allFiles.filter(
  (file) => !ENTRYPOINTS.includes(relative(REPO, file)),
);

describe("the source tree is executable by strip-only Node (what production runs)", () => {
  test("every side-effect-free module imports in a real node process", () => {
    expect(importable.length).toBeGreaterThan(0);

    const script = `
      const files = ${JSON.stringify(importable.map((file) => pathToFileURL(file).href))};
      let failed = 0;
      for (const file of files) {
        try {
          await import(file);
        } catch (error) {
          failed += 1;
          console.log("IMPORT FAILED: " + file + " :: " + error.message);
        }
      }
      console.log(failed === 0 ? "ALL IMPORTS OK" : "FAILURES: " + failed);
    `;

    const result = spawnSync(
      "node",
      ["--experimental-strip-types", "--input-type=module", "-e", script],
      { cwd: REPO, encoding: "utf8", timeout: 60_000 },
    );

    expect(
      result.status,
      `a module failed to import under strip-only Node:\n${result.stdout}${result.stderr}`,
    ).toBe(0);
    expect(result.stdout).toContain("ALL IMPORTS OK");
  });

  test("the entrypoints that cannot be imported are named, so they are not forgotten", () => {
    for (const entrypoint of ENTRYPOINTS) {
      expect(allFiles.map((file) => relative(REPO, file))).toContain(entrypoint);
    }
  });

  test("exactly one module reads process.env, and only inside a function", () => {
    // The data root must be an injected argument, not an import-time global. A
    // module-level `process.env` read would make every consumer depend on import
    // order, and would put a test's temp root out of reach.
    const withEnv = allFiles
      .filter((file) => withoutComments(readFileSync(file, "utf8")).includes("process.env"))
      .map((file) => relative(REPO, file));
    expect(withEnv).toEqual(["src/server/config.ts"]);
  });
});
