/**
 * PINS Z1–Z3 and Z6 — the ONE name rule's bound, widened to `NAME_MAX_LENGTH`
 * characters (ledger rows 87 and 87b; row 88 is the landing).
 *
 *   PIN Z1  the boundary holds in BOTH directions: a name of EXACTLY `NAME_MAX_LENGTH`
 *           round-trips (PUT → GET byte-identical → DELETE), and one character MORE is
 *           refused `400 invalid_name` with nothing written
 *   PIN Z2  it is ONE rule, so the `prefix=` filter and a STORE name widen with it: a
 *           `NAME_MAX_LENGTH`-character prefix is accepted (empty list when nothing
 *           matches) and a `NAME_MAX_LENGTH`-character store name can be created and
 *           listed, while the +1 character of each is refused
 *   PIN Z3  the refusal message tells the truth: it states the CONSTANT and quotes the
 *           pattern the parser ENFORCES — the bound is read OUT of the message and the
 *           parser is driven at that bound ±1, so drifting the code while leaving the
 *           message behind FAILS here
 *   PIN Z6  the bound lives in exactly ONE place under `src/`: a grep-level claim (in
 *           the spirit of PIN Y8) that the numeric maximum is not retyped, the expanded
 *           quantifier is not written out, and the pattern text is not copied
 *
 * Every boundary in this file is DERIVED from the exported constant
 * (`NAME_MAX_LENGTH` / `NAME_MAX_LENGTH + 1`), never typed as a literal: the owner's
 * correction (row 87b) is that the limit is one piece of data, and a test that restates
 * it would be another copy of exactly the kind he caught.
 */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { StoreError } from "../src/core/errors.ts";
import {
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  parseObjectName,
} from "../src/core/validate.ts";
import { REPO_ROOT } from "./helpers/child.ts";
import { cleanupTestServers, createTestServer, readError } from "./helpers/server.ts";
import { sourceFiles } from "./helpers/source.ts";

const LONGEST = "a".repeat(NAME_MAX_LENGTH);
const ONE_TOO_LONG = "a".repeat(NAME_MAX_LENGTH + 1);
const PAYLOAD = "the longest-name body\n";

describe("the name bound (pins Z1-Z3, ledger row 88)", () => {
  test("PIN Z1: the boundary holds in BOTH directions", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });

    // The ACCEPTED half is asserted at EXACTLY the bound, not "long enough": a name one
    // character shorter would pass a laxer pin while a shorter limit slipped in.
    expect(LONGEST).toHaveLength(NAME_MAX_LENGTH);
    const put = await server.put(`/stores/master/objects/${LONGEST}`, PAYLOAD, key);
    expect(put.status, "the name at the bound was refused").toBe(201);
    expect(server.objectContent("master", LONGEST), "the row at the bound was not written").not.toBeNull();

    const got = await server.get(`/stores/master/objects/${LONGEST}`, key);
    expect(got.status).toBe(200);
    expect(await got.text(), "the bytes did not round-trip").toBe(PAYLOAD);

    const del = await server.del(`/stores/master/objects/${LONGEST}`, key);
    expect(del.status).toBe(204);
    expect((await server.get(`/stores/master/objects/${LONGEST}`, key)).status).toBe(404);

    // The REFUSED half: one character past the bound is a named 400 and writes NOTHING.
    const rowsBefore = server.direct(
      (db) => (db.prepare("SELECT COUNT(*) AS n FROM objects").get() as { n: number }).n,
    );
    const over = await server.put(`/stores/master/objects/${ONE_TOO_LONG}`, PAYLOAD, key);
    expect(over.status, "a name one character past the bound was accepted").toBe(400);
    expect((await readError(over)).code).toBe("invalid_name");
    expect(server.objectContent("master", ONE_TOO_LONG)).toBeNull();
    const rowsAfter = server.direct(
      (db) => (db.prepare("SELECT COUNT(*) AS n FROM objects").get() as { n: number }).n,
    );
    expect(rowsAfter, "the refused name left a row behind").toBe(rowsBefore);
    expect(server.listBlobFiles()).toEqual([]);
  });

  test("PIN Z2: it is ONE rule, so the prefix filter and STORE names widen with it", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });

    // The `prefix=` filter is the SAME parser, so it accepts the same bound...
    const accepted = await server.get(`/stores/master/objects?prefix=${LONGEST}`, key);
    expect(accepted.status, "a prefix at the bound was refused").toBe(200);
    expect(await accepted.json()).toEqual({ objects: [] });
    // ...and refuses one character more, with no silent empty list.
    const refusedPrefix = await server.get(`/stores/master/objects?prefix=${ONE_TOO_LONG}`, key);
    expect(refusedPrefix.status).toBe(400);
    expect((await readError(refusedPrefix)).code).toBe("invalid_name");

    // A STORE name at the bound is legal too — the CONSEQUENCE of one rule, deliberately
    // not a second shorter limit for stores.
    const storeName = "s".repeat(NAME_MAX_LENGTH);
    const created = await server.postJson("/stores", { name: storeName }, key);
    expect(created.status, "a store name at the bound was refused").toBe(201);
    const listed = await server.get("/stores", key);
    expect(listed.status).toBe(200);
    const names = ((await listed.json()) as { stores: { name: string }[] }).stores.map(
      (store) => store.name,
    );
    expect(names, "the long store name was not listed").toContain(storeName);

    const refusedStore = await server.postJson(
      "/stores",
      { name: "s".repeat(NAME_MAX_LENGTH + 1) },
      key,
    );
    expect(refusedStore.status).toBe(400);
    expect((await readError(refusedStore)).code).toBe("invalid_name");
  });

  test("PIN Z3: the refusal message tells the truth", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });

    // (a) The LENGTH refusal states the CONSTANT — never a literal that merely matches it.
    const over = await server.put(`/stores/master/objects/${ONE_TOO_LONG}`, "x", key);
    expect(over.status).toBe(400);
    const lengthRefusal = await readError(over);
    expect(lengthRefusal.code).toBe("invalid_name");
    expect(lengthRefusal.message).toContain(String(NAME_MAX_LENGTH));
    const statedMax = /at most (\d+) characters/.exec(lengthRefusal.message)?.[1];
    expect(
      statedMax,
      `the length refusal states no maximum: ${lengthRefusal.message}`,
    ).toBeDefined();
    const boundFromMessage = Number(statedMax);

    // (b) The CHARSET refusal quotes the pattern the parser enforces — read out of the
    // message and compared to the built pattern's own source, so a retyped copy fails.
    const badCharset = await server.put("/stores/master/objects/UPPER", "x", key);
    expect(badCharset.status).toBe(400);
    const charsetRefusal = await readError(badCharset);
    expect(charsetRefusal.code).toBe("invalid_name");
    const patternFromMessage = /must match (\S+); got /.exec(charsetRefusal.message)?.[1];
    expect(
      patternFromMessage,
      `the charset refusal quotes no pattern: ${charsetRefusal.message}`,
    ).toBeDefined();
    expect(patternFromMessage).toBe(NAME_PATTERN.source);

    // (c) THE FALSIFIABILITY HALF: the bound the MESSAGE states is the bound the PARSER
    // enforces, in both directions. A code drifted to a larger bound while the message
    // stays at a smaller one fails the +1 assertion HERE — a hard-coded "1024" in this
    // file could not have caught it.
    const messagePattern = new RegExp(patternFromMessage as string);
    expect(
      messagePattern.test("a".repeat(boundFromMessage)),
      "the message's own pattern rejects a name at the bound it states",
    ).toBe(true);
    expect(
      messagePattern.test("a".repeat(boundFromMessage + 1)),
      "the message's own pattern accepts a name past the bound it states",
    ).toBe(false);
    expect(parseObjectName("a".repeat(boundFromMessage))).toHaveLength(boundFromMessage);

    let refusedPastTheMessage: unknown;
    try {
      parseObjectName("a".repeat(boundFromMessage + 1));
    } catch (error) {
      refusedPastTheMessage = error;
    }
    expect(
      refusedPastTheMessage,
      `the parser ACCEPTED a name one character past the ${boundFromMessage} the message states — the message lies`,
    ).toBeInstanceOf(StoreError);
    expect((refusedPastTheMessage as StoreError).code).toBe("invalid_name");

    // And the constant is the one the message quoted.
    expect(boundFromMessage).toBe(NAME_MAX_LENGTH);
  });
});

describe("PIN Z6: the name bound lives in exactly ONE place (ledger rows 87/87b)", () => {
  test("PIN Z6: the numeric maximum is not retyped anywhere under src/", () => {
    const files = sourceFiles(join(REPO_ROOT, "src"));
    expect(files.length, "the grep must have files to check").toBeGreaterThan(0);

    const owner = join(REPO_ROOT, "src", "core", "validate.ts");
    // Every needle is DERIVED from the exported pieces, so this pin cannot become a copy
    // of the number it exists to keep single.
    const bound = String(NAME_MAX_LENGTH);
    const expandedTail = String(NAME_MAX_LENGTH - 1);
    const retypedPattern = NAME_PATTERN.source.replace(/^\^/, "").replace(/\{0,\d+\}\$$/, "");

    /**
     * The ONE declared exemption, NAMED rather than hidden: `src/server/config.ts` has
     * `DEFAULT_MAX_BYTES`'s binary-MiB factor (`64 * 1024 * 1024`, the item cap of ledger
     * row 86), which shares the digits but is a DIFFERENT number. It is exempt as a FILE
     * — an unrelated edit to the item cap must not be able to redden a pin about the NAME
     * bound — and the exemption is grounded below, not left as a hole.
     */
    const exempt = new Set([join(REPO_ROOT, "src", "server", "config.ts")]);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (file === owner) {
        expect(
          source.split(bound).length - 1,
          `${relative(REPO_ROOT, file)} must declare the bound exactly once`,
        ).toBe(1);
      } else if (!exempt.has(file)) {
        expect(
          source.split(bound).length - 1,
          `${relative(REPO_ROOT, file)} carries the name bound; PIN Z6: the limit is ONE constant, not a copy ` +
            `(declare a legitimate exemption here rather than loosening the pin)`,
        ).toBe(0);
      }
      // The built pattern leaves no expanded quantifier behind anywhere, the owner included.
      expect(
        source,
        `${relative(REPO_ROOT, file)} retypes the expanded bound (the quantifier is BUILT)`,
      ).not.toContain(expandedTail);
      // ...and the rule is never written out as a string beside the built pattern.
      expect(
        source,
        `${relative(REPO_ROOT, file)} retypes the name pattern instead of reading NAME_PATTERN.source`,
      ).not.toContain(retypedPattern);
    }

    // The exemption is a DIFFERENT number, and it is really the MiB factor — not a hole.
    const config = readFileSync(join(REPO_ROOT, "src", "server", "config.ts"), "utf8");
    expect(config, "the declared exemption is not the item cap's DEFAULT_MAX_BYTES").toContain(
      "DEFAULT_MAX_BYTES",
    );

    const all = files.map((file) => readFileSync(file, "utf8")).join("\n");
    // The constant is DECLARED once...
    expect(all.match(/NAME_MAX_LENGTH\s*=/g) ?? [], "NAME_MAX_LENGTH is declared twice under src/").toHaveLength(1);
    // ...the pattern DERIVES its bound from it...
    const validate = readFileSync(owner, "utf8");
    expect(validate, "the pattern does not derive its bound from NAME_MAX_LENGTH").toMatch(
      /NAME_MAX_LENGTH\s*-\s*1/,
    );
    // ...and the refusals read the pattern's own SOURCE rather than retyping it.
    expect(validate, "a refusal message does not read NAME_PATTERN.source").toContain(
      "NAME_PATTERN.source",
    );
  });
});
