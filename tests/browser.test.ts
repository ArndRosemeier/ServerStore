/**
 * The headless-browser test the admin console and CORS have been owed.
 *
 * Ledger row 67 is the design authority; ledger rows 49/54 (the console, whose U1–U4 are
 * STATIC scans of served bytes) and 57/58 (CORS, whose blocking half is the BROWSER's)
 * name the two gaps. Nothing in this file touches product code: it drives the installed
 * `/usr/bin/google-chrome` over the DevTools protocol (`tests/helpers/browser.ts`, the
 * ONE browser seam — no npm dependency) against the repo's OWN spawned entrypoint.
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
 *
 * THE TWO TRAPS THIS FILE EXISTS FOR, both named by the brief:
 *
 *   1. **The rate limiter is in the request path** (ledger rows 64/65). The spawned
 *      service is given `SERVERSTORE_RATE_LIMIT=0` — the operator kill-switch — so a
 *      browser test can never fail for a limiter reason. The limiter has its own pins.
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
import { ensureMasterStore } from "../src/stores/registry.ts";
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

const MASTER_LABEL = "browser-test-master";
const TARGET_LABEL_BEFORE = "browser-test-target";
const TARGET_LABEL_AFTER = "browser-test-renamed";
const TARGET_PERMS_BEFORE: readonly Permission[] = ["read", "write"];
const TARGET_PERMS_AFTER: readonly Permission[] = ["read", "delete"];

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
let allowed: OriginServer | undefined;
let disallowed: OriginServer | undefined;

/** The `<li>` whose summary starts with `label` — the ONLY way to name a key row. */
function rowExpression(label: string): string {
  return (
    `Array.from(document.querySelectorAll("#keys li")).find((li) => { ` +
    `const summary = li.querySelector(".key-summary"); ` +
    `return summary !== null && summary.textContent.startsWith(${JSON.stringify(label)}); ` +
    `}) ?? null`
  );
}

/** The Edit button INSIDE that row. Its absence is a loud failure, never a silent no-op. */
function editButtonExpression(label: string): string {
  return (
    `(() => { const row = ${rowExpression(label)}; if (row === null) return null; ` +
    `return Array.from(row.querySelectorAll("button")).find((button) => button.textContent === "Edit") ?? null; })()`
  );
}

function saveButtonExpression(): string {
  return (
    `Array.from(document.querySelectorAll(".edit-form button"))` +
    `.find((button) => button.textContent === "Save") ?? null`
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
      // a handful of requests. The limiter itself is pinned in `tests/ratelimit.test.ts`.
      SERVERSTORE_RATE_LIMIT: "0",
      // B6 needs a DISALLOWED origin to exist, so the API runs under an explicit
      // allowlist rather than the wildcard default.
      SERVERSTORE_CORS_ORIGINS: allowed.origin,
    },
  });
  api = started;
  await waitForHealthz(started);
  const apiUrl = `http://127.0.0.1:${started.port}`;

  // A real store and a real object, created over HTTP with the master key: B4 reads the
  // listing, B5 reads the object's exposed hash.
  const token = { authorization: `Bearer ${masterKey}`, "content-type": "application/json" };
  const created = await fetch(`${apiUrl}/stores`, {
    method: "POST",
    headers: token,
    body: JSON.stringify({ name: STORE }),
    signal: AbortSignal.timeout(5_000),
  });
  const createdText = await created.text();
  expect(created.status, `creating store ${STORE} failed: ${createdText}`).toBe(201);

  const put = await fetch(`${apiUrl}/stores/${STORE}/objects/${OBJECT}`, {
    method: "PUT",
    headers: token,
    body: OBJECT_BODY,
    signal: AbortSignal.timeout(5_000),
  });
  const putText = await put.text();
  expect(put.status, `creating object ${STORE}/${OBJECT} failed: ${putText}`).toBe(201);
  const objectSha = createHash("sha256").update(OBJECT_BODY).digest("hex");
  const putBody = JSON.parse(putText) as { sha256?: string };
  expect(putBody.sha256, "the fixture's object hash is not the sha256 of its body").toBe(objectSha);

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
    await page.clickElement(editButtonExpression(TARGET_LABEL_BEFORE), {
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
    await page.clickElement(saveButtonExpression(), { description: "the editor's Save button" });

    // The console reports its own success and re-renders the list; the API is the claim.
    await page.waitFor(
      `document.getElementById("status") !== null && ` +
        `document.getElementById("status").hidden === false && ` +
        `document.getElementById("status").textContent.includes("updated")`,
      { description: "the console's own save confirmation" },
    );
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
