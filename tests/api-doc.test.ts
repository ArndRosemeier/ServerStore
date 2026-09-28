/**
 * PIN A1–A3: `docs/API.md` is the CLIENT CONTRACT, and these pins keep it true.
 *
 * The doc a client developer reads is the one doc that cannot be allowed to rot: a
 * route the server does not have, or a missing error code, is a bug report written in
 * prose. So the truth is DERIVED from the code and compared to the doc **in both
 * directions** — the doc cannot omit a route, and it cannot invent one.
 *
 * Pins (the NAME is the contract; `docs/TESTING.md` maps them):
 *   PIN A1: every route the app registers is in the API doc, and every route in the
 *           doc is registered
 *   PIN A2: every code in ERROR_CODES appears in the doc's error table (with the
 *           status that code maps to) — and the table names nothing outside the
 *           vocabulary
 *   PIN A3: the doc's stated max-bytes default equals the code's
 *   PIN Z4: the docs' stated NAME bound equals the code's `NAME_MAX_LENGTH` (ledger
 *           rows 87/87b) — read from the exported constant, never a literal, so changing
 *           the limit fails this pin until the PROSE moves with it: the docs are not a
 *           fifth copy of the number
 *
 * The doc is parsed, not read by eye: `## Routes`, `## Errors` and `## Limits` each
 * hold one machine-readable table, and this file refuses LOUDLY (rather than passing
 * vacuously) if a section or a row it needs is missing. PIN Z4 reads the CURRENT docs
 * only (`docs/API.md`, `docs/STORAGE.md`, `docs/SEAM-INDEX.md`); the ledger rows, board
 * lines and briefs are HISTORY by design and are never scanned — a record rewritten to
 * match the present is not a record.
 */

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { DEFAULT_MAX_BYTES } from "../src/server/config.ts";
import { ERROR_CODES, StoreError } from "../src/core/errors.ts";
import { NAME_MAX_LENGTH, NAME_PATTERN } from "../src/core/validate.ts";
import { registeredRoutes } from "./helpers/server.ts";

const REPO = resolvePath(fileURLToPath(new URL("../", import.meta.url)));
const DOC_PATH = resolvePath(REPO, "docs/API.md");
const doc = readFileSync(DOC_PATH, "utf8");

/** The text of one `## <title>` section, up to the next `## ` heading. */
function section(title: string): string {
  const start = doc.indexOf(`\n## ${title}\n`);
  if (start === -1) {
    throw new Error(
      `${DOC_PATH} has no '## ${title}' section — the pin cannot check a section that is not there`,
    );
  }
  const rest = doc.slice(start + 1);
  const end = rest.indexOf("\n## ", 1);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * The routes the DOC's table lists, as `METHOD /path`.
 *
 * The doc writes placeholders as `{store}` (what a client developer expects to read);
 * Hono registers them as `:store`. That single normalisation is the only difference
 * between the two sets, and it is applied here rather than hidden in prose.
 */
function documentedRoutes(): string[] {
  const rows = section("Routes").split("\n");
  const out: string[] = [];
  for (const line of rows) {
    const match = /^\|\s*`(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)`\s*\|\s*`([^`]+)`/.exec(line);
    if (match === null) continue;
    const path = match[2]!.replace(/\{([A-Za-z0-9_]+)\}/g, ":$1");
    out.push(`${match[1]} ${path}`);
  }
  return out;
}

/** The doc's error table: every `| \`code\` | \`status\` | …` row. */
function documentedErrors(): { code: string; status: number }[] {
  const out: { code: string; status: number }[] = [];
  for (const line of section("Errors").split("\n")) {
    const match = /^\|\s*`([a-z_]+)`\s*\|\s*`(\d{3})`\s*\|/.exec(line);
    if (match === null) continue;
    out.push({ code: match[1]!, status: Number(match[2]) });
  }
  return out;
}

/** The doc's `SERVERSTORE_MAX_BYTES` row: the stated byte default and its MiB rendering. */
function documentedMaxBytes(): { bytes: number; mib: number } {
  const match = /^\|\s*`SERVERSTORE_MAX_BYTES`\s*\|\s*`(\d+)`\s*bytes\s*\((\d+)\s*MiB\)/m.exec(
    section("Limits"),
  );
  if (match === null) {
    throw new Error(
      `${DOC_PATH} has no parseable 'SERVERSTORE_MAX_BYTES | \`<bytes>\` bytes (<mib> MiB)' row — ` +
        `the pin cannot read a limit that is not stated in that shape`,
    );
  }
  return { bytes: Number(match[1]), mib: Number(match[2]) };
}

describe("the client contract (docs/API.md, pins A1-A3)", () => {
  test("PIN A1: every route the app registers is in the API doc, and every route in the doc is registered", () => {
    const registered = registeredRoutes().sort();
    const documented = documentedRoutes().sort();

    // Non-vacuity: a doc with no table, or an app with no routes, must not "agree".
    expect(registered.length, "createApp registered no routes at all — the pin is blind").toBeGreaterThan(0);
    expect(documented.length, "docs/API.md's route table parsed to no rows").toBeGreaterThan(0);

    expect(
      registered.filter((route) => !documented.includes(route)),
      "PIN A1: the app registers these routes and docs/API.md does not list them",
    ).toEqual([]);
    expect(
      documented.filter((route) => !registered.includes(route)),
      "PIN A1: docs/API.md lists these routes and the app does not register them",
    ).toEqual([]);
  });

  test("PIN A2: every code in ERROR_CODES appears in the doc's error table", () => {
    const stated = documentedErrors();
    expect(stated.length, "docs/API.md's error table parsed to no rows").toBeGreaterThan(0);

    const statedCodes = stated.map((row) => row.code);
    expect(
      ERROR_CODES.filter((code) => !statedCodes.includes(code)),
      "PIN A2: ERROR_CODES carries these codes and docs/API.md does not document them",
    ).toEqual([]);
    expect(
      statedCodes.filter((code) => !(ERROR_CODES as readonly string[]).includes(code)),
      "PIN A2: docs/API.md documents these codes and ERROR_CODES does not carry them",
    ).toEqual([]);

    // The status column is part of the contract too, and is read from the code's own
    // mapping (src/core/errors.ts) rather than retyped here or in the doc.
    const mismatched = stated
      .map(({ code, status }) => ({
        code,
        doc: status,
        code_status: new StoreError(code as (typeof ERROR_CODES)[number], "probe").status,
      }))
      .filter((row) => row.doc !== row.code_status)
      .map((row) => `${row.code}: doc says ${row.doc}, errors.ts says ${row.code_status}`);
    expect(mismatched, "PIN A2: the doc's error statuses disagree with src/core/errors.ts").toEqual([]);
  });

  test("PIN A3: the doc's stated max-bytes default equals the code's", () => {
    const stated = documentedMaxBytes();
    expect(
      stated.bytes,
      "PIN A3: docs/API.md's SERVERSTORE_MAX_BYTES default disagrees with " +
        "DEFAULT_MAX_BYTES in src/server/config.ts",
    ).toBe(DEFAULT_MAX_BYTES);
    expect(
      stated.mib,
      "PIN A3: docs/API.md's MiB rendering disagrees with DEFAULT_MAX_BYTES",
    ).toBe(Math.floor(DEFAULT_MAX_BYTES / (1024 * 1024)));
  });

  test("PIN P8: the API doc's stated `prefix` behaviour matches the code", () => {
    // The ROUTE TABLE must carry the parameter on the listing row (the code half is
    // driven in tests/objects.test.ts, pins P1-P4; this is the documented contract).
    const row = section("Routes")
      .split("\n")
      .find((line) => /^\|\s*`GET`\s*\|\s*`\/stores\/\{store\}\/objects`\s*\|/.test(line));
    expect(row, "PIN P8: the route table has no GET /stores/{store}/objects row").toBeDefined();
    expect(row, "PIN P8: the listing row does not name the `prefix` parameter").toMatch(/prefix/);

    // The listing BULLET must state the refusal rule and the empty-result rule.
    const bulletStart = doc.indexOf("- **`GET /stores/{store}/objects`**");
    expect(bulletStart, "PIN P8: the listing bullet is missing from docs/API.md").toBeGreaterThanOrEqual(0);
    const nextBullet = doc.indexOf("\n- **", bulletStart + 1);
    const bullet = doc.slice(bulletStart, nextBullet === -1 ? undefined : nextBullet);
    expect(bullet, "PIN P8: the listing bullet does not name `prefix`").toMatch(/prefix/);
    expect(bullet, "PIN P8: the bullet does not state the 400 invalid_name refusal").toMatch(
      /400 `?invalid_name/,
    );
    expect(bullet, "PIN P8: the bullet does not state the empty-result answer").toMatch(
      /\{\s*"objects"\s*:\s*\[\s*\]\s*\}|empty/i,
    );

    // The STALE sentence is REPLACED, not left standing beside the new one.
    expect(
      doc.includes("a store with many objects returns them all"),
      "PIN P8: docs/API.md still carries the stale 'returns them all' sentence",
    ).toBe(false);
    expect(doc, "PIN P8: docs/API.md does not state that `prefix` is the ONE filter").toMatch(
      /`prefix` is the ONE filter/,
    );
  });

  test("PIN Z4: the docs state the NAME limit the code enforces", () => {
    // Both the bound and the pattern come from the CODE, so this pin cannot become a
    // fifth copy of either: change `NAME_MAX_LENGTH` and the prose must move with it.
    const max = NAME_MAX_LENGTH;
    const rule = NAME_PATTERN.source.replace(/^\^/, "").replace(/\$$/, "");

    // `### Names`, not `## Names`: PIN Z4's section is a sub-heading of the API walkthrough.
    const namesStart = doc.indexOf("\n### Names\n");
    expect(namesStart, "PIN Z4: docs/API.md has no '### Names' section").toBeGreaterThanOrEqual(0);
    const namesRest = doc.slice(namesStart + 1);
    const namesEnd = namesRest.search(/\n#{2,3} /);
    const names = namesEnd === -1 ? namesRest : namesRest.slice(0, namesEnd);

    expect(names, "PIN Z4: the Names section does not state the code's own pattern").toContain(rule);
    expect(names, `PIN Z4: the Names section does not state "1 to ${max}"`).toContain(`1 to ${max}`);
    expect(names, `PIN Z4: the Names section states no "over ${max} characters" refusal`).toContain(
      `over ${max} characters`,
    );

    // The current docs, and ONLY them: the ledger, the board and the briefs are history.
    const current = new Map<string, string>([
      ["docs/API.md", doc],
      ["docs/STORAGE.md", readFileSync(resolvePath(REPO, "docs/STORAGE.md"), "utf8")],
      ["docs/SEAM-INDEX.md", readFileSync(resolvePath(REPO, "docs/SEAM-INDEX.md"), "utf8")],
    ]);
    expect(
      current.get("docs/STORAGE.md"),
      `PIN Z4: docs/STORAGE.md's limits bullet does not state "up to ${max} characters"`,
    ).toContain(`up to ${max} characters`);

    // THE DRIFT GUARD: every name-bound claim in a CURRENT doc must be the bound the code
    // enforces. A writer who bumps the constant and leaves the prose behind fails HERE.
    const stale: string[] = [];
    for (const [file, text] of current) {
      for (const match of text.matchAll(/\[a-z0-9\]\[a-z0-9._-\]\{0,(\d+)\}/g)) {
        if (Number(match[1]) !== max - 1) stale.push(`${file}: the pattern says {0,${match[1]}}`);
      }
      for (const match of text.matchAll(/(\d+)\s*(?:to|–|-)\s*(\d+)\s+chars?/g)) {
        if (Number(match[2]) !== max) stale.push(`${file}: "${match[0].replace(/\s+/g, " ")}"`);
      }
      for (const match of text.matchAll(/(?:up to|over|at most)\s+(\d+)\s+chars?/g)) {
        if (Number(match[1]) !== max) stale.push(`${file}: "${match[0].replace(/\s+/g, " ")}"`);
      }
    }
    expect(
      stale,
      "PIN Z4: a CURRENT doc states a name bound the code does not enforce — move the prose with the constant",
    ).toEqual([]);
  });
});
