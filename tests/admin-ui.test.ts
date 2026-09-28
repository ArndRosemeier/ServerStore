/**
 * PIN U1–U4: the admin UI is served BY THIS SERVICE, and the pins scan the bytes the
 * service actually serves.
 *
 * The console is plain JavaScript (ledger row 48: no build step), so nothing here
 * executes it — these pins are the automated half of its security posture, and the
 * behaviour IN a browser is an honest unknown recorded in `docs/TESTING.md` (a
 * headless-browser test is owed):
 *
 *   PIN U1: the three UI routes are served — `GET /` is 200 HTML, `/app.js` and
 *           `/app.css` carry sane content types — and the SERVED bytes carry no
 *           `ssk_`-shaped string. `GET /` is literal: it shadows no API route.
 *   PIN U2: a scan of the SERVED `app.js` finds none of the key-persistence APIs
 *           (`localStorage`, `sessionStorage`, `document.cookie`, `location.search`,
 *           `location.hash`, `history.pushState`).
 *   PIN U3: every path literal the SERVED `app.js` calls matches a route from
 *           `createApp(...).routes` (normalised `:id`), so a renamed route breaks this
 *           pin instead of the operator's click.
 *   PIN U4: the HTML carries no inline key and no remote script — every asset it loads
 *           is same-origin and there is no inline `<script>` body.
 *
 * The server comes from the ONE fixture set (`tests/helpers/server.ts`), and the route
 * set from the ONE derivation (`registeredRoutes()`), which PIN A1 also reads.
 */

import { afterEach, describe, expect, test } from "vitest";
import { cleanupTestServers, createTestServer, registeredRoutes } from "./helpers/server.ts";

afterEach(() => cleanupTestServers());

/** The key shape, assembled from parts so this tracked file is not itself a scan hit. */
const KEY_SHAPE = new RegExp("s" + "sk_[A-Za-z0-9_-]+");

/** Fetch one path from a fresh server and read its body as text. */
async function served(path: string): Promise<{ response: Response; body: string }> {
  const server = createTestServer();
  const response = await server.get(path);
  return { response, body: await response.text() };
}

/**
 * Every path-shaped literal in a source file.
 *
 * Double- and single-quoted strings, plus template literals (whose `${…}` is normalised
 * to `:id` so `/keys/${id}/revoke` matches the route `/keys/:id/revoke`). A literal is
 * a path only when it STARTS with `/`; a trailing slash is normalised away. Comments are
 * scanned too — deliberately: a path mentioned in prose is still a claim about routes.
 */
function calledPaths(source: string): string[] {
  const out = new Set<string>();
  const add = (raw: string): void => {
    if (!raw.startsWith("/")) return;
    out.add(raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw);
  };
  for (const match of source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)) add(match[1] ?? "");
  for (const match of source.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'/g)) add(match[1] ?? "");
  for (const match of source.matchAll(/`([^`\\]*(?:\\.[^`\\]*)*)`/g)) {
    add((match[1] ?? "").replace(/\$\{[^}]*\}/g, ":id"));
  }
  return [...out].sort();
}

/**
 * A route path with its PARAMETER NAMES removed: `:store`, `:name` and `:id` all become
 * `:id`.
 *
 * The path scan below normalises a template hole (`${…}`) to `:id`, because a served
 * module cannot know a route's parameter NAME. Comparing the two sets therefore has to
 * normalise the same way on the REGISTERED side: the pin is about the SHAPE of the path
 * a click would call, not about what Hono named the hole. A path the API does not
 * register still has no shape match, which is the claim U3 makes (arm B of the slice-10
 * differential reddens it with `/no-such-route`; arm (b) of slice 18 leaves it green).
 */
function routeShape(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+/g, ":id");
}

describe("the admin UI (pins U1-U4)", () => {
  test("PIN U1: the UI routes are served, and the served bytes carry no secret", async () => {
    const root = await served("/");
    expect(root.response.status, "GET / is not 200 — the console is not being served").toBe(200);
    expect(root.response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(root.body).toMatch(/<html/i);
    expect(root.body, "PIN U1: the served HTML carries a key-shaped string").not.toMatch(KEY_SHAPE);

    const js = await served("/app.js");
    expect(js.response.status).toBe(200);
    expect(js.response.headers.get("content-type")).toMatch(/javascript/);
    expect(js.body.length, "GET /app.js served an empty module").toBeGreaterThan(0);
    expect(js.body, "PIN U1: the served app.js carries a key-shaped string").not.toMatch(KEY_SHAPE);

    const css = await served("/app.css");
    expect(css.response.status).toBe(200);
    expect(css.response.headers.get("content-type")).toMatch(/^text\/css/);
    expect(css.body.length).toBeGreaterThan(0);
    expect(css.body, "PIN U1: the served app.css carries a key-shaped string").not.toMatch(KEY_SHAPE);

    // `GET /` is a LITERAL route, not a catch-all: an API route is untouched, and an
    // unknown path is still the API's envelope, never the console's HTML.
    const stores = await served("/stores");
    expect(stores.response.status, "GET / shadowed the API's /stores route").toBe(401);
    expect(stores.body).toContain("unauthorized");

    const missing = await served("/no-such-ui-asset");
    expect(missing.response.headers.get("content-type")).not.toMatch(/text\/html/);
    expect(missing.body).toContain('"error"');
  });

  test("PIN U2: the served app.js references no key-persistence API", async () => {
    const js = await served("/app.js");
    const forbidden = [
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "location.search",
      "location.hash",
      "history.pushState",
    ];
    const found = forbidden.filter((needle) => js.body.includes(needle));
    expect(
      found,
      "PIN U2: the served app.js references a key-persistence API — the key is not memory-only",
    ).toEqual([]);
    // Non-vacuity: the scan is reading the real served module, not an empty string.
    expect(js.body, "the served app.js does not look like the console module").toContain("ROUTES");
  });

  test("PIN U3: every path the UI calls is a route the API registers", async () => {
    const js = await served("/app.js");
    const called = calledPaths(js.body);
    expect(
      called.length,
      "the path scan found nothing in the served app.js — the pin is blind",
    ).toBeGreaterThan(0);

    const registered = new Set(
      registeredRoutes().map((route) => routeShape(route.slice(route.indexOf(" ") + 1))),
    );
    const unknown = called.filter((path) => !registered.has(path));
    expect(
      unknown,
      "PIN U3: the UI calls paths the API does not register — the console would 404 on a click",
    ).toEqual([]);
  });

  test("PIN U4: the HTML carries no inline key and no remote script", async () => {
    const html = (await served("/")).body;

    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
    const remote = scripts.filter((tag) => /\ssrc\s*=\s*["'](?:https?:)?\/\//i.test(tag));
    expect(remote, "PIN U4: the HTML loads a script from a remote origin").toEqual([]);

    // Every asset the page references is same-origin and explicit.
    const sources = [
      ...html.matchAll(/<(?:script|link)\b[^>]*\s(?:src|href)\s*=\s*["']([^"']+)["']/gi),
    ].map((match) => match[1] ?? "");
    expect(sources.length, "the HTML loads no script or stylesheet at all").toBeGreaterThan(0);
    expect(
      sources.filter((source) => /^(?:https?:)?\/\//i.test(source)),
      "PIN U4: the HTML references a remote asset",
    ).toEqual([]);

    // The page's ONLY script is the same-origin module: no inline body carries a secret.
    const inline = [...html.matchAll(/<script\b(?![^>]*\ssrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => (match[1] ?? "").trim())
      .filter((body) => body !== "");
    expect(inline, "PIN U4: the HTML carries an inline script body").toEqual([]);

    expect(html, "PIN U4: the HTML carries a key-shaped string").not.toMatch(KEY_SHAPE);
  });
});
