/**
 * The headless-browser test the admin console and CORS have been owed — now also the
 * proof for the console's FOUR DESTRUCTIVE ACTIONS (ledger rows 81/82).
 *
 * Ledger row 67 is the design authority for the browser seam; ledger rows 49/54 (the
 * console, whose U1–U4 are STATIC scans of served bytes) and 57/58 (CORS, whose
 * blocking half is the BROWSER's) name the two gaps, and slice 18 (rows 81/82) is the
 * first slice whose own deliverable IS this file's subject: the destructive UI. Nothing
 * in this file touches product code: it drives the installed `/usr/bin/google-chrome`
 * over the DevTools protocol (`tests/helpers/browser.ts`, the ONE browser seam — no npm
 * dependency) against the repo's OWN spawned entrypoint.
 *
 * Pins (the NAME is the contract; `docs/TESTING.md` maps them):
 *   PIN B1: the console's JavaScript RUNS in a real browser, with NO page error
 *   PIN B2: a master key typed into the console AUTHENTICATES through the UI, and is not
 *           persisted anywhere (no URL, no storage, no cookie, not left in the field)
 *   PIN B3: the console's EDIT flow really PATCHes — asserted through the API
 *   PIN B4: a real browser on ANOTHER ORIGIN completes an authorized `fetch`
 *   PIN B5: that browser can READ the exposed `x-serverstore-sha256`
 *   PIN B6: a DISALLOWED origin is blocked BY THE BROWSER
 *   PIN B7: nothing outlives the test — the Chrome process TREE is gone
 *   PIN B8: a missing browser FAILS loudly instead of skipping
 *   PIN V1: deleting a KEY through the UI kills its credential (it answers 401)
 *   PIN V2: a store's ENTRIES are listed on demand and the prefix filter is SERVER-side
 *   PIN V3: deleting ONE entry through the UI leaves the other entry readable
 *   PIN V4: emptying needs the TYPED name; a wrong name changes NOTHING
 *   PIN V5: a BLOCKED store delete shows the 409 and the store survives; deleting the
 *           blocking key through the UI then lets the store delete succeed
 *   PIN V6: the console's promises hold with the new controls — nothing persisted, and a
 *           failed destructive action never leaves a stale row looking like a success
 *   PIN V7: the 409 / 400 / 403 / 429 paths each render the SERVER's own message
 *
 * THE TWO TRAPS THIS FILE EXISTS FOR, both named by the brief:
 *
 *   1. **The rate limiter is in the request path** (ledger rows 64/65). The MAIN spawned
 *      service is given `SERVERSTORE_RATE_LIMIT=0` — the operator kill-switch — so a
 *      browser test can never fail for a limiter reason. V7 needs a REAL 429 to prove the
 *      console renders it, so it spawns a SECOND service with `SERVERSTORE_RATE_LIMIT=1`
 *      and reads only the console's error surface from it. The limiter's own boundary is
 *      pinned deterministically in `tests/ratelimit.test.ts` (R1–R8).
 *   2. **Every wait has a DEADLINE that FAILS.** `BrowserPage.waitFor` polls with a hard
 *      deadline and throws with the last thing it saw; there is no `sleep`-and-hope and
 *      no silent retry loop. There is no `describe.skip`/`it.skipIf` in this file. Each
 *      pin also carries a 30s vitest timeout, deliberately LARGER than the seam's own
 *      deadlines (5s), so a stuck page fails on the SEAM's named wait — with what it last
 *      observed — rather than on vitest's generic default.
 *
 * CROSS-ORIGIN IS REAL, not simulated: two tiny stdlib HTTP servers on their OWN loopback
 * ports are two genuinely different origins, the API is spawned under an explicit
 * `SERVERSTORE_CORS_ORIGINS` allowlist naming the FIRST of them, and the `fetch` under
 * test is evaluated in the matching PAGE's context. No fixture HTML file is added.
 *
 * SCRATCH LIVES UNDER THIS WORKTREE (never `/tmp`): the data root is a fresh directory
 * under `<worktree>/.browser-scratch/`, and the Chrome profile is another.
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { openDatabase } from "../src/core/db.ts";
import { keyIdFromRaw, mintKey } from "../src/core/keys.ts";
import type { Permission } from "../src/core/types.ts";
import { ensureMasterStore, createStore } from "../src/stores/registry.ts";
import {
  BrowserMissingError,
  DEFAULT_SCRATCH_ROOT,
  killAllBrowsers,
  launchBrowser,
  liveBrowserPids,
  type Browser,
  type BrowserPage,
} from "./helpers/browser.ts";
import { REPO_ROOT, reapSpawnedServices, startEntrypoint, waitForHealthz, type SpawnedService } from "./helpers/entrypoint.ts";

/** The store and object B4/B5 read; the object's hash is what B5 must find readable. */
const STORE = "game";
const OBJECT = "room-1";
const OBJECT_BODY = '{"score":7}';

/** V2/V3/V4's extra entries: the prefix filter must narrow to the `room-4` pair. */
const OBJECTS: readonly (readonly [string, string])[] = [
  [OBJECT, OBJECT_BODY],
  ["room-4", '{"score":4}'],
  ["room-42.a", '{"score":42}'],
  ["lobby-9", '{"score":9}'],
];
const PREFIX = "room-4";
const PREFIX_MATCHES: readonly string[] = ["room-4", "room-42.a"];
const ALL_ENTRY_NAMES: readonly string[] = ["lobby-9", "room-1", "room-4", "room-42.a"];

/** V7's 400: the store the illegal prefix is typed against, and its entry. */
const GUARDED_STORE = "guarded";
const GUARDED_ENTRY = "g-1";

/** V5's blocked store: a key's scope names it, so the store delete is refused 409. */
const BLOCKED_STORE = "blocked";
const BLOCKER_LABEL = "browser-test-blocker";

/** V6/V7's blocked store, used by both the stale-row pin and the legible-409 pin. */
const BLOCKED_TWO_STORE = "blocked-two";
const BLOCKER_TWO_LABEL = "browser-test-blocker-two";

/** V7's 403: a key that is NOT a master admin cannot even list stores. */
const SCOPED_LABEL = "browser-test-scoped-readonly";
const SCOPED_STORE = "guarded";

/** V1's throwaway key, minted through the UI and then deleted through the UI. */
const THROWAWAY_LABEL = "browser-test-throwaway";

const MASTER_LABEL = "browser-test-master";
const MASTER_TWO_LABEL = "browser-test-master-rate-limited";
const TARGET_LABEL_BEFORE = "browser-test-target";
const TARGET_LABEL_AFTER = "browser-test-renamed";
const TARGET_PERMS_BEFORE: readonly Permission[] = ["read", "write"];
const TARGET_PERMS_AFTER: readonly Permission[] = ["read", "delete"];

const ELLIPSIS = "…";

interface OriginServer {
  readonly origin: string;
  close(): Promise<void>;
}

/** One tiny stdlib origin: ANY path answers a minimal page, which is all a page needs. */
async function startOriginServer(): Promise<OriginServer> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body>ok</body></html>");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the origin fixture bound nothing");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined || error === null ? resolve() : reject(error)));
      }),
  };
}

/**
 * Mint through the project's ONE mint path (`openDatabase` → `ensureMasterStore` →
 * `mintKey`), in process, BEFORE the service is spawned.
 *
 * Never a hand-written row: this is the same sequence `pnpm run admin:key` performs, so
 * a key this test authenticates with is a real key of the real shape.
 */
function mintInto(dataRoot: string, options: { label: string; stores: readonly string[]; perms: readonly Permission[] }): string {
  const db = openDatabase(join(dataRoot, "serverstore.db"));
  try {
    ensureMasterStore(db, () => Date.now());
    return mintKey(db, {
      stores: options.stores,
      label: options.label,
      perms: options.perms,
      now: () => Date.now(),
      expiresAt: null,
    }).raw;
  } finally {
    db.close();
  }
}

/**
 * Create a store through the project's ONE registry path, in process, BEFORE the spawn.
 *
 * A key's SCOPE names a real store (a foreign key), so the scoped fixture keys below can
 * only be minted once their store exists — and they must exist before the service boots
 * with them. This is `createStore()` itself, never a hand-written `INSERT`.
 */
function createStoreInto(dataRoot: string, name: string): void {
  const db = openDatabase(join(dataRoot, "serverstore.db"));
  try {
    ensureMasterStore(db, () => Date.now());
    createStore(db, name, undefined, () => Date.now());
  } finally {
    db.close();
  }
}

interface Harness {
  readonly runDir: string;
  readonly api: SpawnedService;
  readonly apiUrl: string;
  readonly allowed: OriginServer;
  readonly disallowed: OriginServer;
  readonly browser: Browser;
  readonly console: BrowserPage;
  readonly masterKey: string;
  readonly masterId: string;
  readonly targetKey: string;
  readonly targetId: string;
  readonly objectSha: string;
}

let harness: Harness | undefined;

/**
 * The same objects `harness` bundles, assigned the moment each one EXISTS.
 *
 * `beforeAll` can fail at any step (a boot poll, a fixture PUT), and `harness` is only
 * assigned at the END — so cleanup must not depend on it, or a failed setup leaks the
 * spawned service. These refs are what `afterAll` reaps, on success and on failure alike.
 */
let runDir: string | undefined;
let api: SpawnedService | undefined;
let api2: SpawnedService | undefined;
let allowed: OriginServer | undefined;
let disallowed: OriginServer | undefined;

// The master key of V7's rate-limited SECOND service (never the main one), so the two
// services' limiter buckets cannot be confused.
let masterKeyTwo: string | undefined;

// V7's 403 subject: a store-scoped, non-admin key, minted in `beforeAll`. Never printed.
let scopedKey: string | undefined;

/** The `<li>` whose summary names `label` — the ONLY way to name a key row. */
function rowExpression(label: string): string {
  // The summary is `<label> — <prefix> — stores …`, so requiring the em dash after the
  // label keeps "browser-test-blocker-one" from matching "browser-test-blocker-one-extra".
  const prefix = JSON.stringify(label + " — ");
  return (
    `Array.from(document.querySelectorAll("#keys li")).find((li) => { ` +
    `const summary = li.querySelector(".key-summary"); ` +
    `return summary !== null && summary.textContent.startsWith(${prefix}); ` +
    `}) ?? null`
  );
}

/** A button with EXACT text inside the key row labelled `label` (Delete, Revoke, …). */
function keyButtonExpression(label: string, text: string): string {
  return (
    `(() => { const row = ${rowExpression(label)}; if (row === null) return null; ` +
    `return Array.from(row.querySelectorAll("button")).find((button) => button.textContent === ${JSON.stringify(text)}) ?? null; })()`
  );
}

/** The armed inline two-step Confirm button inside an enclosing row expression. */
function confirmInExpression(containerExpression: string): string {
  return (
    `(() => { const container = ${containerExpression}; if (container === null) return null; ` +
    `return container.querySelector('button[data-confirm="yes"]') ?? null; })()`
  );
}

/** The `<li>` for the store named `name` in the stores list. */
function storeRowExpression(name: string): string {
  return (
    `Array.from(document.querySelectorAll("#stores li[data-store-row]"))` +
    `.find((li) => li.getAttribute("data-store-row") === ${JSON.stringify(name)}) ?? null`
  );
}

/** A button with EXACT text inside that store's row. */
function storeButtonExpression(name: string, text: string): string {
  return (
    `(() => { const row = ${storeRowExpression(name)}; if (row === null) return null; ` +
    `return Array.from(row.querySelectorAll("button")).find((button) => button.textContent === ${JSON.stringify(text)}) ?? null; })()`
  );
}

/** The typed-name confirmation's submit button inside that store's row. */
function typedConfirmGoExpression(name: string): string {
  return (
    `(() => { const row = ${storeRowExpression(name)}; if (row === null) return null; ` +
    `return row.querySelector('button[data-typed-confirm-go="yes"]') ?? null; })()`
  );
}

/** The typed-name confirmation's field selector inside that store's row. */
function typedConfirmFieldSelector(name: string): string {
  return `li[data-store-row="${name}"] input[data-typed-confirm="yes"]`;
}

/** The entry row whose NAME cell is exactly `name`, inside the open entries pane. */
function entryRowExpression(name: string): string {
  return (
    `Array.from(document.querySelectorAll("#entries .entry-list li")).find((li) => { ` +
    `const cell = li.querySelector(".entry-name"); ` +
    `return cell !== null && cell.textContent === ${JSON.stringify(name)}; }) ?? null`
  );
}

/** A button with EXACT text inside that entry's row. */
function entryButtonExpression(name: string, text: string): string {
  return (
    `(() => { const row = ${entryRowExpression(name)}; if (row === null) return null; ` +
    `return Array.from(row.querySelectorAll("button")).find((button) => button.textContent === ${JSON.stringify(text)}) ?? null; })()`
  );
}

/** The entry NAMES currently rendered, in order. */
function entryNamesExpression(): string {
  return `Array.from(document.querySelectorAll("#entries .entry-list .entry-name")).map((cell) => cell.textContent)`;
}

/** The console's ONE error surface is visible AND carries `needle`. */
function errorSurfaceExpression(needle: string): string {
  return (
    `document.getElementById("error") !== null && ` +
    `document.getElementById("error").hidden === false && ` +
    `document.getElementById("error").textContent.includes(${JSON.stringify(needle)})`
  );
}

/** The console's ONE status surface is visible AND carries `needle`. */
function statusSurfaceExpression(needle: string): string {
  return (
    `document.getElementById("status") !== null && ` +
    `document.getElementById("status").hidden === false && ` +
    `document.getElementById("status").textContent.includes(${JSON.stringify(needle)})`
  );
}

/** Set a checkbox to `wanted` with a TRUSTED click, only when it is not already there. */
async function setChecked(page: BrowserPage, selector: string, wanted: boolean): Promise<void> {
  const current = await page.evaluate<boolean>(
    `document.querySelector(${JSON.stringify(selector)}).checked`,
  );
  if (current !== wanted) await page.click(selector, { description: selector });
  const after = await page.evaluate<boolean>(
    `document.querySelector(${JSON.stringify(selector)}).checked`,
  );
  expect(after, `${selector} did not become ${wanted}`).toBe(wanted);
}

/** Wait until the rendered entry names equal `expected` exactly, or fail with what it saw. */
async function waitForEntryNames(page: BrowserPage, expected: readonly string[], what: string): Promise<void> {
  await page.waitFor(
    `JSON.stringify(${entryNamesExpression()}) === ${JSON.stringify(JSON.stringify(expected))}`,
    { description: `${what} (expected ${JSON.stringify(expected)})` },
  );
}

/** A raw API call with the master key — the effect read BACK, never the DOM's word. */
async function apiJson(
  apiUrl: string,
  master: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { authorization: `Bearer ${master}` },
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

/** The store names `GET /stores` reports. */
async function listedStores(apiUrl: string, master: string): Promise<string[]> {
  const answer = await apiJson(apiUrl, master, "/stores");
  expect(answer.status, "GET /stores did not answer 200").toBe(200);
  return (answer.body as { stores: { name: string }[] }).stores.map((store) => store.name);
}

/** The entry names `GET /stores/<store>/objects` reports. */
async function listedEntries(apiUrl: string, master: string, store: string): Promise<string[]> {
  const answer = await apiJson(apiUrl, master, `/stores/${store}/objects`);
  expect(answer.status, `GET /stores/${store}/objects did not answer 200`).toBe(200);
  return (answer.body as { objects: { name: string }[] }).objects.map((object) => object.name);
}

beforeAll(async () => {
  mkdirSync(DEFAULT_SCRATCH_ROOT, { recursive: true });
  const createdRunDir = mkdtempSync(join(DEFAULT_SCRATCH_ROOT, "run-"));
  runDir = createdRunDir;
  const dataRoot = join(createdRunDir, "data");
  mkdirSync(dataRoot, { recursive: true });

  const masterKey = mintInto(dataRoot, { label: MASTER_LABEL, stores: ["*"], perms: ["admin"] });
  const targetKey = mintInto(dataRoot, {
    label: TARGET_LABEL_BEFORE,
    stores: ["*"],
    perms: TARGET_PERMS_BEFORE,
  });
  // The stores come FIRST, through the registry: a key's scope is a foreign key into
  // `stores`, so a scoped fixture key cannot be minted before the store it names exists.
  for (const name of [STORE, GUARDED_STORE, BLOCKED_STORE, BLOCKED_TWO_STORE]) {
    createStoreInto(dataRoot, name);
  }
  // The keys the destructive pins need, all minted through the ONE mint path:
  //   - a key whose SCOPE names BLOCKED_STORE, so deleting that store is refused 409;
  //   - the same for BLOCKED_TWO_STORE (V6/V7);
  //   - a key that is NOT a master admin, so `GET /stores` refuses it 403 (V7).
  mintInto(dataRoot, { label: BLOCKER_LABEL, stores: [BLOCKED_STORE], perms: ["read", "delete"] });
  mintInto(dataRoot, { label: BLOCKER_TWO_LABEL, stores: [BLOCKED_TWO_STORE], perms: ["read", "delete"] });
  scopedKey = mintInto(dataRoot, { label: SCOPED_LABEL, stores: [SCOPED_STORE], perms: ["read"] });
  const masterId = keyIdFromRaw(masterKey);
  const targetId = keyIdFromRaw(targetKey);
  if (masterId === null || targetId === null) {
    throw new Error("a minted key's id did not parse — the mint path drifted from the parser");
  }

  // The ALLOWED origin first: its port is what `SERVERSTORE_CORS_ORIGINS` must name, so
  // it has to exist before the API is spawned.
  allowed = await startOriginServer();
  disallowed = await startOriginServer();
  if (allowed.origin === disallowed.origin) {
    throw new Error("the two origin fixtures share a port — they would not be two origins");
  }

  const started = await startEntrypoint({
    dataRoot,
    extraEnv: {
      // TRAP 1 (the brief): the limiter is in the request path, so this service is
      // spawned with the kill-switch. A browser test must never fail because a page made
      // a handful of requests. The limiter itself is pinned in `tests/ratelimit.test.ts`;
      // the ONE genuine 429 this file needs comes from the SECOND service below.
      SERVERSTORE_RATE_LIMIT: "0",
      // B6 needs a DISALLOWED origin to exist, so the API runs under an explicit
      // allowlist rather than the wildcard default.
      SERVERSTORE_CORS_ORIGINS: allowed.origin,
    },
  });
  api = started;
  await waitForHealthz(started);
  const apiUrl = `http://127.0.0.1:${started.port}`;

  // V7's REAL 429: a second service on its own data root, with a limit of ONE request
  // per identity per window. Its own master key is minted in process first, through the
  // SAME mint path. Nothing but V7's page ever talks to it.
  const dataRootTwo = join(createdRunDir, "data-rate-limited");
  mkdirSync(dataRootTwo, { recursive: true });
  masterKeyTwo = mintInto(dataRootTwo, {
    label: MASTER_TWO_LABEL,
    stores: ["*"],
    perms: ["admin"],
  });
  api2 = await startEntrypoint({ dataRoot: dataRootTwo, extraEnv: { SERVERSTORE_RATE_LIMIT: "1" } });
  await waitForHealthz(api2);

  // The real entries the destructive pins read, created over HTTP with the master key:
  // B4 reads the listing, B5 reads the object's exposed hash, and V2/V3/V4 read the names
  // back THROUGH THE API after the UI changed them. The stores themselves were created
  // in process above, because the scoped fixture keys depend on them.
  const token = { authorization: `Bearer ${masterKey}`, "content-type": "application/json" };
  const putObject = async (store: string, name: string, body: string): Promise<void> => {
    const put = await fetch(`${apiUrl}/stores/${store}/objects/${name}`, {
      method: "PUT",
      headers: token,
      body,
      signal: AbortSignal.timeout(5_000),
    });
    const text = await put.text();
    expect(put.status, `creating object ${store}/${name} failed: ${text}`).toBe(201);
  };

  for (const [name, body] of OBJECTS) await putObject(STORE, name, body);
  await putObject(GUARDED_STORE, GUARDED_ENTRY, '{"guard":1}');
  await putObject(BLOCKED_STORE, "b-1", '{"blocked":1}');
  await putObject(BLOCKED_TWO_STORE, "b2-1", '{"blocked":2}');

  const objectSha = createHash("sha256").update(OBJECT_BODY).digest("hex");
  const listed = await apiJson(apiUrl, masterKey, `/stores/${STORE}/objects/${OBJECT}`);
  expect(listed.status, "the fixture object is not readable back over HTTP").toBe(200);

  const launched = await launchBrowser();
  // The console page is opened HERE (not in a test) so that B1's "no page error" claim
  // covers the page's FIRST load; every later test reuses this page.
  const consolePage = await launched.openPage();
  await consolePage.navigate(`${apiUrl}/`);
  await consolePage.waitFor('document.getElementById("key-form") !== null', {
    description: "the console's connect form to be present",
  });

  harness = {
    runDir: createdRunDir,
    api: started,
    apiUrl,
    allowed,
    disallowed,
    browser: launched,
    console: consolePage,
    masterKey,
    masterId,
    targetKey,
    targetId,
    objectSha,
  };
}, 60_000);

/** SIGTERM the service and WAIT for the exit, with a deadline; SIGKILL is the escalation. */
async function stopWithin(service: SpawnedService, budgetMs: number): Promise<NodeJS.Signals | null> {
  const outcome = await Promise.race([
    service.stop("SIGTERM"),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), budgetMs)),
  ]);
  // Always: SIGKILL if it is still alive, forget the child, delete the data root.
  service.cleanup();
  if (outcome === "timeout") {
    throw new Error(`the spawned service did not exit on SIGTERM within ${budgetMs}ms`);
  }
  return outcome;
}

afterAll(async () => {
  // Unconditional and in this order on purpose: an exception ANYWHERE in `beforeAll`
  // must not be able to leave a browser tree or a spawned service behind. The helper's
  // own `afterAll` kills the browser too; `killAllBrowsers()` is idempotent.
  await killAllBrowsers();
  if (api !== undefined) {
    const signal = await stopWithin(api, 5_000);
    expect(signal, "the spawned service did not exit on SIGTERM").toBe("SIGTERM");
  }
  if (api2 !== undefined) {
    const signal = await stopWithin(api2, 5_000);
    expect(signal, "the rate-limited spawned service did not exit on SIGTERM").toBe("SIGTERM");
  }
  if (allowed !== undefined) await allowed.close();
  if (disallowed !== undefined) await disallowed.close();
  // The net for the case where `beforeAll` failed before `api` was assigned: SIGKILL
  // anything this module registered and forget it.
  reapSpawnedServices();
  if (runDir !== undefined) rmSync(runDir, { recursive: true, force: true });

  if (harness !== undefined) {
    // PIN B7's other half, asserted where it can see the END of the file: no browser is
    // registered any more and the spawned service is really gone.
    expect(liveBrowserPids(), "a browser outlived the file").toEqual([]);
    expect(
      harness.api.child.exitCode !== null || harness.api.child.signalCode !== null,
      "the spawned service outlived the file",
    ).toBe(true);
  }
});

describe("the console and CORS, executed in a real browser (pins B1-B8)", () => {
  test("PIN B1: the console's JavaScript RUNS in a real browser, with no page error", async () => {
    const page = harness?.console;
    expect(page).toBeDefined();
    if (page === undefined) return;

    // A page that was SERVED but whose script is broken is exactly what this pin exists
    // to catch. `favicon.ico` is excluded deliberately: Chrome asks for it, the API's key
    // guard answers 401 (there is no such route and no key), and a missing favicon is not
    // a broken console. Every OTHER network error and every page exception is fatal here.
    const errors = page
      .errors()
      .filter((error) => !(error.url !== null && error.url.endsWith("/favicon.ico")));
    expect(
      errors,
      `the console page reported errors: ${JSON.stringify(errors, null, 2)}`,
    ).toEqual([]);

    // The form is in the HTML, so its presence proves nothing about the module. Clicking
    // "Use key" with an EMPTY field exercises `init()`'s submit listener and the module's
    // own validation — the error line below can only come from `web/app.js` having run.
    await page.click('#key-form button[type="submit"]', { description: "the Use key button" });
    await page.waitFor(
      'document.getElementById("error") !== null && document.getElementById("error").hidden === false',
      { description: "the console's own empty-key validation to be rendered" },
    );
    const message = await page.evaluate<string>('document.getElementById("error").textContent');
    expect(message, "the console's empty-key validation did not run").toContain("no_key");
  }, 30_000);

  test("PIN B2: a master key typed into the console AUTHENTICATES through the UI", async () => {
    const page = harness?.console;
    const master = harness?.masterKey;
    const masterId = harness?.masterId;
    expect(page).toBeDefined();
    if (page === undefined || master === undefined || masterId === undefined) return;

    await page.typeInto("#key-input", master, { description: "the master key field" });
    await page.click('#key-form button[type="submit"]', { description: "the Use key button" });

    // The authenticated view appears only after the console's own `GET /whoami` answered.
    await page.waitFor(
      'document.getElementById("app") !== null && document.getElementById("app").hidden === false',
      { description: "the authenticated view after the console's own whoami call" },
    );
    const session = await page.evaluate<string>('document.getElementById("session").textContent');
    expect(session, "the console's whoami answer is not the key that was typed").toContain(masterId);

    // THE C1 PROMISE, now measured in the environment it was made for: the key was typed
    // in and is now nowhere it could be read back from.
    const persisted = await page.evaluate<{
      localStorageEntries: number;
      sessionStorageEntries: number;
      storageDump: string;
      cookie: string;
      href: string;
      hash: string;
      search: string;
      fieldValue: string;
    }>(
      `({
        localStorageEntries: localStorage.length,
        sessionStorageEntries: sessionStorage.length,
        storageDump: JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)]),
        cookie: document.cookie,
        href: location.href,
        hash: location.hash,
        search: location.search,
        fieldValue: document.getElementById("key-input").value,
      })`,
    );
    expect(persisted.localStorageEntries, "the console wrote to localStorage").toBe(0);
    expect(persisted.sessionStorageEntries, "the console wrote to sessionStorage").toBe(0);
    expect(persisted.storageDump, "the key is IN a browser store").not.toContain(master);
    expect(persisted.cookie, "the key reached a cookie").not.toContain(master);
    expect(persisted.href, "the key reached the URL").not.toContain(master);
    expect(persisted.hash, "the key reached the URL fragment").not.toContain(master);
    expect(persisted.search, "the key reached the query string").not.toContain(master);
    expect(persisted.fieldValue, "the key was left sitting in the password field").toBe("");
  }, 30_000);

  test("PIN B3: the console's EDIT flow really PATCHes", async () => {
    const page = harness?.console;
    const targetId = harness?.targetId;
    const apiUrl = harness?.apiUrl;
    const master = harness?.masterKey;
    expect(page).toBeDefined();
    if (page === undefined || targetId === undefined || apiUrl === undefined || master === undefined) {
      return;
    }

    // Open the editor with a TRUSTED click on the Edit button of the TARGET row.
    await page.clickElement(keyButtonExpression(TARGET_LABEL_BEFORE, "Edit"), {
      description: `the Edit button on the "${TARGET_LABEL_BEFORE}" row`,
    });
    await page.waitFor('document.querySelector(".edit-form") !== null', {
      description: "the per-row editor to replace the row",
    });

    // Rename, and change a permission: `write` OFF, `delete` ON.
    await page.typeInto('input[data-edit-label="yes"]', TARGET_LABEL_AFTER, {
      description: "the editor's label field",
    });
    await setChecked(page, 'input[data-edit-perm="yes"][value="write"]', false);
    await setChecked(page, 'input[data-edit-perm="yes"][value="delete"]', true);
    await page.clickElement(
      `Array.from(document.querySelectorAll(".edit-form button")).find((button) => button.textContent === "Save") ?? null`,
      { description: "the editor's Save button" },
    );

    // The console reports its own success and re-renders the list; the API is the claim.
    await page.waitFor(statusSurfaceExpression("updated"), {
      description: "the console's own save confirmation",
    });
    await page.waitFor(`document.querySelector(".edit-form") === null`, {
      description: "the list to be re-rendered after the save",
    });

    // THE EFFECT, through the API — not the DOM.
    const response = await fetch(`${apiUrl}/keys`, {
      headers: { authorization: `Bearer ${master}` },
      signal: AbortSignal.timeout(5_000),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      keys: { id: string; label: string; perms: string[] }[];
    };
    const edited = body.keys.find((entry) => entry.id === targetId);
    expect(edited, `key ${targetId} is not in GET /keys after the edit`).toBeDefined();
    expect(edited?.label, "the label edit did not reach the API").toBe(TARGET_LABEL_AFTER);
    expect(edited?.perms, "the permission edit did not reach the API").toEqual([...TARGET_PERMS_AFTER]);
  }, 30_000);

  test("PIN B4: a real browser on ANOTHER ORIGIN completes an authorized fetch", async () => {
    const page = await harness?.browser.openPage(harness.allowed.origin);
    expect(page).toBeDefined();
    if (page === undefined || harness === undefined) return;

    const url = `${harness.apiUrl}/stores`;
    const outcome = await page.evaluate<{ status: number; text: string }>(
      `(async () => {
        const response = await fetch(${JSON.stringify(url)}, {
          headers: { Authorization: "Bearer " + ${JSON.stringify(harness.masterKey)} },
        });
        return { status: response.status, text: await response.text() };
      })()`,
    );
    expect(outcome.status, `the cross-origin fetch answered ${outcome.status}: ${outcome.text}`).toBe(200);
    const body = JSON.parse(outcome.text) as { stores: { name: string }[] };
    expect(body.stores.map((store) => store.name)).toContain("master");
    expect(body.stores.map((store) => store.name)).toContain(STORE);
  }, 30_000);

  test("PIN B5: that browser can READ the exposed x-serverstore-sha256", async () => {
    const page = await harness?.browser.openPage(harness.allowed.origin);
    expect(page).toBeDefined();
    if (page === undefined || harness === undefined) return;

    const url = `${harness.apiUrl}/stores/${STORE}/objects/${OBJECT}`;
    const outcome = await page.evaluate<{ status: number; sha: string | null; text: string }>(
      `(async () => {
        const response = await fetch(${JSON.stringify(url)}, {
          headers: { Authorization: "Bearer " + ${JSON.stringify(harness.masterKey)} },
        });
        return {
          status: response.status,
          sha: response.headers.get("x-serverstore-sha256"),
          text: await response.text(),
        };
      })()`,
    );
    expect(outcome.status).toBe(200);
    expect(outcome.text).toBe(OBJECT_BODY);
    // THE CLAIM: the header is readable from the cross-origin response OBJECT. It is only
    // readable because it is listed in `Access-Control-Expose-Headers` (ledger row 57).
    expect(
      outcome.sha,
      "x-serverstore-sha256 is not readable from the cross-origin response",
    ).toBe(harness.objectSha);
  }, 30_000);

  test("PIN B6: a DISALLOWED origin is blocked BY THE BROWSER", async () => {
    const page = await harness?.browser.openPage(harness.disallowed.origin);
    expect(page).toBeDefined();
    if (page === undefined || harness === undefined) return;

    const url = `${harness.apiUrl}/stores`;
    // The rejection is returned as DATA rather than letting the promise reject, so the
    // page's own error NAME can be asserted.
    const outcome = await page.evaluate<{ rejected: boolean; name?: string; message?: string }>(
      `(async () => {
        try {
          const response = await fetch(${JSON.stringify(url)}, {
            headers: { Authorization: "Bearer " + ${JSON.stringify(harness.masterKey)} },
          });
          return { rejected: false, status: response.status };
        } catch (error) {
          return { rejected: true, name: error.name, message: String(error.message) };
        }
      })()`,
    );
    expect(
      outcome.rejected,
      `a disallowed origin's fetch RESOLVED instead of being blocked by the browser: ${JSON.stringify(outcome)}`,
    ).toBe(true);
    expect(outcome.name, `the browser's CORS refusal was not a TypeError: ${JSON.stringify(outcome)}`).toBe(
      "TypeError",
    );

    // WHY it was blocked, from the API's own side: the preflight from this origin fell
    // through the CORS step to the key guard's 401 with NO allow-origin header. The
    // browser therefore never sent the real request — the half no in-process pin shows.
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: {
        origin: harness.disallowed.origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
      signal: AbortSignal.timeout(5_000),
    });
    expect(preflight.status, "the disallowed origin's preflight was not the guard's 401").toBe(401);
    expect(
      preflight.headers.get("access-control-allow-origin"),
      "the API authorised an origin it does not allow",
    ).toBeNull();

    // And the ALLOWED origin really is allowed, so this is an allowlist and not a
    // service that refuses every browser.
    const allowedPreflight = await fetch(url, {
      method: "OPTIONS",
      headers: {
        origin: harness.allowed.origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
      signal: AbortSignal.timeout(5_000),
    });
    expect(allowedPreflight.status).toBe(204);
    expect(allowedPreflight.headers.get("access-control-allow-origin")).toBe(harness.allowed.origin);
  }, 30_000);

  test("PIN B8: a missing browser FAILS loudly instead of skipping", async () => {
    const missing = join(REPO_ROOT, ".browser-scratch", "definitely-not-a-browser");
    const error = await launchBrowser({ executablePath: missing }).then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    expect(error, "launching a NON-EXISTENT browser did not throw").not.toBeNull();
    expect(error).toBeInstanceOf(BrowserMissingError);
    expect(error?.name).toBe("BrowserMissingError");
    expect(error?.message, "the failure does not name the path it could not use").toContain(missing);
  }, 30_000);

  test("PIN B7: nothing outlives the test — the Chrome process TREE is gone", async () => {
    const doomed = await launchBrowser();
    const pid = doomed.pid;
    expect(doomed.groupAlive(), "a freshly launched browser's process group is not alive").toBe(true);
    expect(liveBrowserPids()).toContain(pid);

    await doomed.kill();

    // The LAUNCHER is gone...
    expect(() => process.kill(pid, 0), "the Chrome launcher survived its kill").toThrow();
    // ...and so is the whole TREE, which is what a process-GROUP kill buys. Signalling the
    // group is the check: a surviving zygote/renderer keeps `-pid` resolvable.
    expect(
      () => process.kill(-pid, 0),
      "a Chrome child process survived the group kill",
    ).toThrow();
    expect(doomed.groupAlive(), "the group is still signalable after the kill").toBe(false);
    expect(liveBrowserPids(), "the killed browser is still registered").not.toContain(pid);
    // Idempotent: the afterAll hook and a caller's failure path may both run it.
    await expect(doomed.kill()).resolves.toBeUndefined();
  }, 30_000);
});

describe("the console's destructive actions, executed in a real browser (pins V1-V7)", () => {
  test("PIN V1: the console deletes a KEY, and the credential dies", async () => {
    const page = harness?.console;
    const apiUrl = harness?.apiUrl;
    const master = harness?.masterKey;
    expect(page).toBeDefined();
    if (page === undefined || apiUrl === undefined || master === undefined) return;

    // MINT a throwaway key THROUGH THE UI: scope every store, the default read+write.
    await page.typeInto("#label-input", THROWAWAY_LABEL, { description: "the mint label field" });
    await setChecked(page, "#scope-all", true);
    await page.click('#mint-form button[type="submit"]', { description: "the Mint key button" });
    await page.waitFor(
      'document.getElementById("minted-panel") !== null && document.getElementById("minted-panel").hidden === false',
      { description: "the minted-key panel (the key is shown once)" },
    );
    const raw = await page.evaluate<string>('document.getElementById("minted-key").value');
    expect(raw, "the minted key was not shown").toContain("ssk_");

    // The mint panel is shown BEFORE the key list is re-rendered, so wait for the ROW
    // itself: clicking before the refresh would fail on an absent element, not on the
    // console's behaviour.
    await page.waitFor(`(${rowExpression(THROWAWAY_LABEL)}) !== null`, {
      description: "the minted key's row to appear in the refreshed list",
    });

    // DELETE it through the UI: the plain two-step, then Confirm.
    await page.clickElement(keyButtonExpression(THROWAWAY_LABEL, "Delete"), {
      description: `the Delete button on the "${THROWAWAY_LABEL}" row`,
    });
    await page.clickElement(confirmInExpression(rowExpression(THROWAWAY_LABEL)), {
      description: "the inline Confirm delete button",
    });
    // The pane REFRESHES: the row is gone from the DOM, not merely marked.
    await page.waitFor(`(${rowExpression(THROWAWAY_LABEL)}) === null`, {
      description: "the deleted key's row to disappear from the refreshed list",
    });

    // THE EFFECT, through the API: gone from the inventory...
    const inventory = await apiJson(apiUrl, master, "/keys");
    expect(inventory.status).toBe(200);
    const labels = (inventory.body as { keys: { label: string }[] }).keys.map((entry) => entry.label);
    expect(labels, "the deleted key is still in GET /keys").not.toContain(THROWAWAY_LABEL);

    // ...and its CREDENTIAL is dead: the raw key answers 401.
    const whoami = await fetch(`${apiUrl}/whoami`, {
      headers: { authorization: `Bearer ${raw}` },
      signal: AbortSignal.timeout(5_000),
    });
    expect(await whoami.text(), "the deleted key's credential still authenticates").toContain(
      "unauthorized",
    );
    expect(whoami.status, "the deleted key's credential did not answer 401").toBe(401);
  }, 30_000);

  test("PIN V2: the console shows a store's ENTRIES, and the prefix filter is server-side", async () => {
    const page = harness?.console;
    expect(page).toBeDefined();
    if (page === undefined || harness === undefined) return;

    // A fresh resource-timing buffer, so the ONE request this pin reasons about cannot be
    // confused with an earlier one.
    await page.evaluate<void>("performance.clearResourceTimings()");

    await page.clickElement(storeButtonExpression(STORE, "Open"), {
      description: `the Open button on the "${STORE}" store row`,
    });
    await page.waitFor(
      'document.getElementById("entries") !== null && document.getElementById("entries").hidden === false',
      { description: "the entries pane to open" },
    );
    // The WHOLE store's entries, by NAME, fetched on demand.
    await waitForEntryNames(page, ALL_ENTRY_NAMES, "the opened store's entries");
    const count = await page.evaluate<string>(
      'document.querySelector(\'[data-entry-count="yes"]\').textContent',
    );
    expect(count, "the entry count is not shown").toContain(String(ALL_ENTRY_NAMES.length));

    // Type a prefix and Filter. The console must send `prefix=` to the SERVER — the pin
    // is not satisfied by shipping the whole store and filtering it here.
    await page.typeInto('#entries input[data-prefix="yes"]', PREFIX, {
      description: "the prefix field",
    });
    await page.clickElement(
      `Array.from(document.querySelectorAll("#entries form button")).find((button) => button.textContent === "Filter") ?? null`,
      { description: "the Filter button" },
    );
    await waitForEntryNames(page, PREFIX_MATCHES, "the prefix-narrowed entries");

    // THE MECHANISM: the request that produced that list carried `prefix=<PREFIX>`.
    const requested = await page.evaluate<string[]>(
      `performance.getEntriesByType("resource").map((entry) => entry.name)`,
    );
    const wanted = `/stores/${STORE}/objects?prefix=${PREFIX}`;
    expect(
      requested.filter((url) => url.includes(wanted)).length,
      `the narrowed listing did not come from a request carrying "${wanted}"; requests seen: ${JSON.stringify(requested)}`,
    ).toBeGreaterThan(0);
  }, 30_000);

  test("PIN V3: the console deletes ONE entry, and the other survives", async () => {
    const page = harness?.console;
    const apiUrl = harness?.apiUrl;
    const master = harness?.masterKey;
    expect(page).toBeDefined();
    if (page === undefined || apiUrl === undefined || master === undefined) return;

    // V2 left the pane filtered to the `room-4` pair; delete one of them through the UI.
    const doomed = PREFIX_MATCHES[0] as string;
    const survivor = PREFIX_MATCHES[1] as string;
    await page.clickElement(entryButtonExpression(doomed, "Delete"), {
      description: `the Delete button on the "${doomed}" entry`,
    });
    await page.clickElement(confirmInExpression(entryRowExpression(doomed)), {
      description: "the entry's inline Confirm delete button",
    });
    await page.waitFor(`(${entryRowExpression(doomed)}) === null`, {
      description: "the deleted entry to disappear from the refreshed list",
    });
    await waitForEntryNames(page, [survivor], "the surviving entry after the delete");

    // THE EFFECT, through the API: the deleted entry is 404, the OTHER is still readable.
    const gone = await apiJson(apiUrl, master, `/stores/${STORE}/objects/${doomed}`);
    expect(gone.status, `the deleted entry ${doomed} is still readable`).toBe(404);
    const kept = await fetch(`${apiUrl}/stores/${STORE}/objects/${survivor}`, {
      headers: { authorization: `Bearer ${master}` },
      signal: AbortSignal.timeout(5_000),
    });
    expect(kept.status, `the surviving entry ${survivor} was destroyed too`).toBe(200);
  }, 30_000);

  test("PIN V4: emptying needs the TYPED name, and a wrong name changes nothing", async () => {
    const page = harness?.console;
    const apiUrl = harness?.apiUrl;
    const master = harness?.masterKey;
    expect(page).toBeDefined();
    if (page === undefined || apiUrl === undefined || master === undefined) return;

    const before = await listedEntries(apiUrl, master, STORE);
    expect(before.length, "the store was already empty before V4 — the pin would be vacuous").toBeGreaterThan(0);

    await page.clickElement(storeButtonExpression(STORE, "Empty" + ELLIPSIS), {
      description: `the Empty… button on the "${STORE}" store row`,
    });
    await page.waitFor(
      `document.querySelector(${JSON.stringify(typedConfirmFieldSelector(STORE))}) !== null`,
      { description: "the typed-name confirmation to open" },
    );
    // The field is NEVER pre-filled: it must be empty before the operator types.
    const prefill = await page.evaluate<string>(
      `document.querySelector(${JSON.stringify(typedConfirmFieldSelector(STORE))}).value`,
    );
    expect(prefill, "the typed-name field was pre-filled").toBe("");

    // A WRONG name: the client refuses, NOTHING is sent, and every entry survives.
    await page.typeInto(typedConfirmFieldSelector(STORE), STORE + "-wrong", {
      description: "the typed-name field (wrong name)",
    });
    await page.clickElement(typedConfirmGoExpression(STORE), {
      description: `the "Empty store" button with a wrong name`,
    });
    await page.waitFor(errorSurfaceExpression("confirm_mismatch"), {
      description: "the client's own refusal of the mismatched name",
    });
    expect(
      await listedEntries(apiUrl, master, STORE),
      "a WRONG typed name still emptied the store",
    ).toEqual(before);

    // The RIGHT name: the typed text becomes the server's `?confirm=` token.
    await page.typeInto(typedConfirmFieldSelector(STORE), STORE, {
      description: "the typed-name field (right name)",
    });
    await page.clickElement(typedConfirmGoExpression(STORE), {
      description: `the "Empty store" button with the right name`,
    });
    await page.waitFor(statusSurfaceExpression("emptied"), {
      description: "the console's own confirmation that the store was emptied",
    });
    expect(await listedEntries(apiUrl, master, STORE), "the store was not emptied").toEqual([]);
  }, 30_000);

  test("PIN V5: a BLOCKED store delete is shown, and then succeeds once the key is gone", async () => {
    const page = harness?.console;
    const apiUrl = harness?.apiUrl;
    const master = harness?.masterKey;
    expect(page).toBeDefined();
    if (page === undefined || apiUrl === undefined || master === undefined) return;

    // A key's scope names BLOCKED_STORE, so the store delete is refused 409 — SHOWN, never
    // worked around, and the store survives.
    await page.clickElement(storeButtonExpression(BLOCKED_STORE, "Delete" + ELLIPSIS), {
      description: `the Delete… button on the "${BLOCKED_STORE}" store row`,
    });
    await page.typeInto(typedConfirmFieldSelector(BLOCKED_STORE), BLOCKED_STORE, {
      description: "the typed-name field for the blocked store",
    });
    await page.clickElement(typedConfirmGoExpression(BLOCKED_STORE), {
      description: `the "Delete store" button for ${BLOCKED_STORE}`,
    });
    await page.waitFor(errorSurfaceExpression("conflict"), {
      description: "the server's 409 on the blocked store delete",
    });
    const message = await page.evaluate<string>('document.getElementById("error").textContent');
    expect(message, "the 409 does not name the blocking key").toContain(BLOCKER_LABEL);
    expect(
      await listedStores(apiUrl, master),
      "the blocked store was deleted anyway",
    ).toContain(BLOCKED_STORE);

    // Clear the blocker the owner's way: delete that key through the UI (V1's flow).
    await page.clickElement(keyButtonExpression(BLOCKER_LABEL, "Delete"), {
      description: `the Delete button on the "${BLOCKER_LABEL}" row`,
    });
    await page.clickElement(confirmInExpression(rowExpression(BLOCKER_LABEL)), {
      description: "the blocker key's inline Confirm delete button",
    });
    await page.waitFor(`(${rowExpression(BLOCKER_LABEL)}) === null`, {
      description: "the blocking key's row to disappear",
    });

    // Retry the SAME store delete: now it succeeds.
    await page.clickElement(storeButtonExpression(BLOCKED_STORE, "Delete" + ELLIPSIS), {
      description: `the Delete… button on the "${BLOCKED_STORE}" store row again`,
    });
    await page.typeInto(typedConfirmFieldSelector(BLOCKED_STORE), BLOCKED_STORE, {
      description: "the typed-name field on the retry",
    });
    await page.clickElement(typedConfirmGoExpression(BLOCKED_STORE), {
      description: `the "Delete store" button on the retry`,
    });
    await page.waitFor(`(${storeRowExpression(BLOCKED_STORE)}) === null`, {
      description: "the deleted store's row to disappear from the refreshed list",
    });
    await page.waitFor(statusSurfaceExpression("deleted"), {
      description: "the console's own confirmation that the store was deleted",
    });
    expect(
      await listedStores(apiUrl, master),
      "the store is still in GET /stores after the retry",
    ).not.toContain(BLOCKED_STORE);
  }, 30_000);

  test("PIN V6: the console's promises hold with the new controls", async () => {
    const page = harness?.console;
    expect(page).toBeDefined();
    if (page === undefined) return;

    // Drive a FAILING destructive action end to end: a store whose scope-named key makes
    // the delete a 409.
    await page.clickElement(storeButtonExpression(BLOCKED_TWO_STORE, "Delete" + ELLIPSIS), {
      description: `the Delete… button on the "${BLOCKED_TWO_STORE}" store row`,
    });
    await page.typeInto(typedConfirmFieldSelector(BLOCKED_TWO_STORE), BLOCKED_TWO_STORE, {
      description: "the typed-name field for the second blocked store",
    });
    await page.clickElement(typedConfirmGoExpression(BLOCKED_TWO_STORE), {
      description: `the "Delete store" button for ${BLOCKED_TWO_STORE}`,
    });
    await page.waitFor(errorSurfaceExpression("conflict"), {
      description: "the server's 409 on the second blocked store delete",
    });

    // NO STALE ROW LOOKING LIKE A SUCCESS: the pane refreshed, the row is still there, and
    // the status surface does not claim a deletion.
    const stillThere = await page.evaluate<boolean>(
      `(${storeRowExpression(BLOCKED_TWO_STORE)}) !== null`,
    );
    expect(stillThere, "the failed store delete left no row behind — the entity vanished?").toBe(true);
    const status = await page.evaluate<{ hidden: boolean; text: string }>(
      `({ hidden: document.getElementById("status").hidden, text: document.getElementById("status").textContent })`,
    );
    expect(
      status.hidden || !status.text.includes("deleted"),
      `a FAILED store delete left a success status on screen: ${JSON.stringify(status)}`,
    ).toBe(true);

    // THE C1 PROMISE, measured over all of these flows: the key is still nowhere but the
    // module variable — no browser store, no cookie, no URL state.
    const persisted = await page.evaluate<{
      localStorageEntries: number;
      sessionStorageEntries: number;
      cookie: string;
      search: string;
      hash: string;
    }>(
      `({
        localStorageEntries: localStorage.length,
        sessionStorageEntries: sessionStorage.length,
        cookie: document.cookie,
        search: location.search,
        hash: location.hash,
      })`,
    );
    expect(persisted.localStorageEntries, "the console's new controls wrote to localStorage").toBe(0);
    expect(persisted.sessionStorageEntries, "the console's new controls wrote to sessionStorage").toBe(0);
    expect(persisted.cookie, "a cookie appeared during the destructive flows").toBe("");
    expect(persisted.search, "the destructive flows put state in the query string").toBe("");
    expect(persisted.hash, "the destructive flows put state in the fragment").toBe("");
  }, 30_000);

  test("PIN V7: the outcomes are legible — 409, 400, 403 and 429 render the server's message", async () => {
    const page = harness?.console;
    if (page === undefined || harness === undefined) return;

    // 409 — the blocked store delete, re-driven here for its MESSAGE: it names the key.
    await page.clickElement(storeButtonExpression(BLOCKED_TWO_STORE, "Delete" + ELLIPSIS), {
      description: `the Delete… button on the "${BLOCKED_TWO_STORE}" store row (V7 409)`,
    });
    await page.typeInto(typedConfirmFieldSelector(BLOCKED_TWO_STORE), BLOCKED_TWO_STORE, {
      description: "the typed-name field for the 409 (V7)",
    });
    await page.clickElement(typedConfirmGoExpression(BLOCKED_TWO_STORE), {
      description: "the Delete store button for the 409 (V7)",
    });
    await page.waitFor(errorSurfaceExpression("conflict"), {
      description: "the 409 to be rendered (V7)",
    });
    const conflict = await page.evaluate<string>('document.getElementById("error").textContent');
    expect(conflict, "the 409 message does not name the blocking key").toContain(BLOCKER_TWO_LABEL);

    // 400 — an ILLEGAL prefix reaches the server, whose `invalid_name` is rendered.
    await page.clickElement(storeButtonExpression(GUARDED_STORE, "Open"), {
      description: `the Open button on the "${GUARDED_STORE}" store row`,
    });
    await page.waitFor(
      'document.getElementById("entries") !== null && document.getElementById("entries").hidden === false',
      { description: "the guarded store's entries pane to open" },
    );
    await waitForEntryNames(page, [GUARDED_ENTRY], "the guarded store's entry");
    await page.typeInto('#entries input[data-prefix="yes"]', "Room", {
      description: "an ILLEGAL prefix (uppercase is refused by the API)",
    });
    await page.clickElement(
      `Array.from(document.querySelectorAll("#entries form button")).find((button) => button.textContent === "Filter") ?? null`,
      { description: "the Filter button with an illegal prefix" },
    );
    await page.waitFor(errorSurfaceExpression("invalid_name"), {
      description: "the server's 400 invalid_name to be rendered",
    });

    // 403 — a key that is NOT a master admin cannot list stores, so the console's own
    // refresh renders the server's refusal on a FRESH page (the master page keeps its
    // session). The key is store-scoped and read-only: `whoami` accepts it, `GET /stores`
    // does not.
    const scoped = scoped403Key();
    const scopedPage = await harness.browser.openPage();
    await scopedPage.navigate(`${harness.apiUrl}/`);
    await scopedPage.waitFor('document.getElementById("key-form") !== null', {
      description: "the connect form on the scoped key's page",
    });
    await scopedPage.typeInto("#key-input", scoped, {
      description: "the scoped, non-master key",
    });
    await scopedPage.click('#key-form button[type="submit"]', {
      description: "the Use key button on the scoped page",
    });
    await scopedPage.waitFor(errorSurfaceExpression("forbidden"), {
      description: "the server's 403 for a key that cannot list stores",
    });

    // 429 — the SECOND, rate-limited service. Its limit is ONE request per identity, so a
    // real 429 is certain within the first couple of requests the console makes; the pin
    // asserts only that the console RENDERS it from the server's envelope.
    expect(api2, "the rate-limited fixture service is not running").toBeDefined();
    const masterTwo = masterKeyTwo;
    if (api2 === undefined || masterTwo === undefined) return;
    const limited = await harness.browser.openPage();
    await limited.navigate(`http://127.0.0.1:${api2.port}/`);
    await limited.waitFor('document.getElementById("key-form") !== null', {
      description: "the connect form on the rate-limited service's page",
    });
    await limited.typeInto("#key-input", masterTwo, {
      description: "the rate-limited service's master key",
    });
    await limited.click('#key-form button[type="submit"]', {
      description: "the Use key button on the rate-limited page",
    });
    await limited.waitFor(errorSurfaceExpression("rate_limited"), {
      description: "the server's 429 to be rendered by the console",
      timeoutMs: 10_000,
    });
  }, 45_000);
});

/**
 * V7's 403 subject: the store-scoped, non-admin key minted in `beforeAll`. It is kept in
 * a module-level variable rather than on `harness` because only V7 reads it.
 */
function scoped403Key(): string {
  if (scopedKey === undefined) {
    throw new Error("the scoped 403 key was never minted — the fixture drifted");
  }
  return scopedKey;
}
