/**
 * Reading the product's OWN source from a test.
 *
 * ONE walker, because TWO grep-level pins need it: PIN Y8 (`tests/sqlite-core.test.ts`,
 * the item medium is encapsulated under `src/storage/`) and PIN Z6
 * (`tests/name-limit.test.ts`, the name bound lives in exactly one place under `src/`).
 * A second recursive `readdirSync` would be the same duplication AGENTS.md rule 4
 * forbids — and a pin whose file list drifted from its twin's could go quietly blind.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Every `.ts` file under `dir` (recursively), sorted, as absolute paths. */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out.sort();
}
