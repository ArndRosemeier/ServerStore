/**
 * PIN O1–O6 — CORS: a browser on ANOTHER origin can call this API.
 *
 * Ledger rows 56 and 57. The trap this file exists for: the key guard matches EVERY
 * path before routing, so an `OPTIONS` preflight that reached it would be answered
 * `401` and the browser would block the real request — and no edge rule can fix that,
 * because a preflight needs a 2xx the origin owns. So the preflight is answered by a
 * middleware registered BEFORE the guard (pin O1), and every other request walks the
 * pipeline unchanged (pin O5).
 *
 * Pins (the NAME is the contract; `docs/TESTING.md` maps them):
 *   PIN O1: a preflight is answered 2xx WITHOUT a key, and names `authorization`
 *   PIN O2: a cross-origin request with a valid key returns the real body plus
 *           `Access-Control-Allow-Origin` (and exposes `x-serverstore-sha256` **and**
 *           `retry-after` — the limiter's back-off header, ledger row 64f)
 *   PIN O3: an allowlist is honoured — a listed origin is echoed, an unlisted one gets
 *           no allow-origin header, and `Vary: Origin` is present either way
 *   PIN O4: credentials are never allowed — no `Access-Control-Allow-Credentials`
 *           and no `Set-Cookie`, on any response
 *   PIN O5: nothing else changed — a request with no `Origin` is unchanged and the
 *           three UI routes still serve
 *   PIN O6: the allowlist is VALIDATED at the boundary (added beyond the brief, like
 *           slice 11's E8: a boundary that silently accepts a policy which can never
 *           match is the fallback AGENTS.md rule 1 forbids)
 *
 * Every server here comes from the ONE fixture set (`tests/helpers/server.ts`); this
 * file never invents a second harness.
 */

import { afterEach, describe, expect, test } from "vitest";
import { parseCorsOrigins, resolveConfig } from "../src/server/config.ts";
import {
  cleanupTestServers,
  createTestServer,
  readError,
  registeredRoutes,
} from "./helpers/server.ts";

afterEach(cleanupTestServers);

const GAME_ORIGIN = "https://game.example.com";
const OTHER_ORIGIN = "http://localhost:5173";
const EVIL_ORIGIN = "https://evil.example.com";

/** The headers a browser sends on a cross-origin call, plus the key when one is used. */
function crossOrigin(origin: string, key?: string): Record<string, string> {
  return origin === "" ? {} : { origin, ...(key === undefined ? {} : { authorization: `Bearer ${key}` }) };
}

/** A whole-value comma list, trimmed and lower-cased — how a browser reads these. */
function headerList(response: Response, name: string): string[] {
  return (response.headers.get(name) ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
}

function preflight(server: { request(path: string, init?: RequestInit): Promise<Response> }, origin: string, method = "PATCH"): Promise<Response> {
  return server.request("/stores", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": method,
      "access-control-request-headers": "authorization, content-type",
    },
  });
}

describe("pin O1: a preflight is answered 2xx WITHOUT a key", () => {
  test("PIN O1: an unkeyed preflight is 2xx, allows PATCH, and names `authorization` as a whole word", async () => {
    const server = createTestServer();
    const response = await preflight(server, GAME_ORIGIN);

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");

    const methods = headerList(response, "access-control-allow-methods");
    for (const method of ["get", "post", "put", "patch", "delete", "options"]) {
      expect(methods).toContain(method);
    }

    // The whole-word check, not a substring: the classic silent failure is
    // `Allow-Headers: *`, which does NOT cover `authorization`.
    const allowHeaders = headerList(response, "access-control-allow-headers");
    expect(allowHeaders).toContain("authorization");
    expect(allowHeaders).toContain("x-api-key");
    expect(allowHeaders).toContain("content-type");
    expect(response.headers.get("access-control-allow-headers")).not.toBe("*");

    expect(Number(response.headers.get("access-control-max-age"))).toBeGreaterThan(0);
  });

  test("PIN O1: an OPTIONS that carries no Access-Control-Request-Method is NOT a preflight — the guard still answers 401", async () => {
    const server = createTestServer();
    const response = await server.request("/stores", {
      method: "OPTIONS",
      headers: { origin: GAME_ORIGIN },
    });
    expect(response.status).toBe(401);
  });

  test("PIN O1: the preflight is answered for a route the app does not register with an OPTIONS method (it precedes routing)", async () => {
    const server = createTestServer();
    const response = await server.request("/stores/game/objects/room-1", {
      method: "OPTIONS",
      headers: { origin: GAME_ORIGIN, "access-control-request-method": "DELETE" },
    });
    expect(response.status).toBe(204);
    expect(headerList(response, "access-control-allow-methods")).toContain("delete");
  });
});

describe("pin O2: a cross-origin request with a valid key is readable", () => {
  test("PIN O2: a cross-origin GET /stores with a valid key returns the real body plus Allow-Origin", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });

    const response = await server.request("/stores", { headers: crossOrigin(GAME_ORIGIN, key) });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");

    const body = (await response.json()) as { stores: { name: string }[] };
    expect(body.stores.map((store) => store.name)).toContain("master");
    // The FULL set, by EQUALITY: `retry-after` joined it with the rate limiter (row 64f)
    // because a browser cannot read a 429's back-off instruction otherwise. Never relax
    // this to `toContain` — the complete set is the claim.
    expect(response.headers.get("access-control-expose-headers")).toBe(
      "x-serverstore-sha256, retry-after",
    );
  });

  test("PIN O2: an object's `x-serverstore-sha256` is exposed to the cross-origin reader", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });

    const put = await server.request("/stores/master/objects/room-1", {
      method: "PUT",
      body: '{"score":7}',
      headers: crossOrigin(GAME_ORIGIN, key),
    });
    expect(put.status).toBe(201);

    const got = await server.request("/stores/master/objects/room-1", {
      headers: crossOrigin(GAME_ORIGIN, key),
    });
    expect(got.status).toBe(200);
    expect(got.headers.get("x-serverstore-sha256")).toMatch(/^[0-9a-f]{64}$/);
    expect(got.headers.get("access-control-allow-origin")).toBe("*");
    expect(got.headers.get("access-control-expose-headers")).toBe(
      "x-serverstore-sha256, retry-after",
    );
  });
});

describe("pin O3: an allowlist is honoured", () => {
  test("PIN O3: a listed origin is echoed with Vary: Origin; an unlisted one gets no allow-origin header", async () => {
    const server = createTestServer({ corsOrigins: [GAME_ORIGIN, OTHER_ORIGIN] });
    const key = server.mint({ stores: ["*"], perms: ["admin"] });

    const listed = await server.request("/stores", { headers: crossOrigin(GAME_ORIGIN, key) });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("access-control-allow-origin")).toBe(GAME_ORIGIN);
    expect(listed.headers.get("vary")).toMatch(/(^|,\s*)Origin(\s*,|$)/i);

    const unlisted = await server.request("/stores", { headers: crossOrigin(EVIL_ORIGIN, key) });
    // NOT a 403: CORS is a browser-READ control, not the API perimeter (ledger row 21).
    // The key is valid, so the API answers normally and the BROWSER blocks the read.
    expect(unlisted.status).toBe(200);
    expect(unlisted.headers.get("access-control-allow-origin")).toBeNull();
    expect(unlisted.headers.get("vary")).toMatch(/(^|,\s*)Origin(\s*,|$)/i);
  });

  test("PIN O3: a preflight from a listed origin is 204 echoing that origin; from an unlisted origin it is never authorised", async () => {
    const server = createTestServer({ corsOrigins: [GAME_ORIGIN] });

    const listed = await preflight(server, GAME_ORIGIN, "DELETE");
    expect(listed.status).toBe(204);
    expect(listed.headers.get("access-control-allow-origin")).toBe(GAME_ORIGIN);
    expect(listed.headers.get("access-control-allow-methods")).toContain("DELETE");
    expect(listed.headers.get("vary")).toMatch(/(^|,\s*)Origin(\s*,|$)/i);

    const unlisted = await preflight(server, EVIL_ORIGIN, "DELETE");
    expect(unlisted.headers.get("access-control-allow-origin")).toBeNull();
    // It falls through to the key guard, which owns the refusal.
    expect(unlisted.status).toBe(401);
  });
});

describe("pin O4: credentials are never allowed", () => {
  test("PIN O4: no response of any kind carries Allow-Credentials or a Set-Cookie", async () => {
    for (const corsOrigins of [undefined, [GAME_ORIGIN]] as const) {
      const server = createTestServer(corsOrigins === undefined ? {} : { corsOrigins });
      const key = server.mint({ stores: ["*"], perms: ["admin"] });
      const responses = [
        await preflight(server, GAME_ORIGIN),
        await preflight(server, EVIL_ORIGIN),
        await server.request("/stores", { headers: crossOrigin(GAME_ORIGIN, key) }),
        await server.request("/stores"),
        await server.request("/nope", { headers: crossOrigin(GAME_ORIGIN, key) }),
        await server.request("/healthz", { headers: crossOrigin(GAME_ORIGIN) }),
        await server.request("/", { headers: crossOrigin(GAME_ORIGIN) }),
      ];
      for (const response of responses) {
        expect(response.headers.get("access-control-allow-credentials")).toBeNull();
        expect(response.headers.get("set-cookie")).toBeNull();
      }
    }
  });
});

describe("pin O5: nothing else changed", () => {
  test("PIN O5: a request with no Origin is unchanged and adds no allow-origin header", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });

    const response = await server.get("/stores", key);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    const body = (await response.json()) as { stores: { name: string }[] };
    expect(body.stores.map((store) => store.name)).toContain("master");

    const unkeyed = await server.request("/stores");
    expect(unkeyed.status).toBe(401);
    expect((await readError(unkeyed)).code).toBe("unauthorized");
  });

  test("PIN O5: the three UI routes still serve with and without an Origin", async () => {
    const server = createTestServer();
    const routes = [
      ["/", /^text\/html/],
      ["/app.js", /javascript/],
      ["/app.css", /^text\/css/],
    ] as const;
    for (const [route, contentType] of routes) {
      const plain = await server.request(route);
      expect(plain.status).toBe(200);
      expect(plain.headers.get("content-type")).toMatch(contentType);

      const cross = await server.request(route, { headers: crossOrigin(GAME_ORIGIN) });
      expect(cross.status).toBe(200);
      expect(cross.headers.get("content-type")).toMatch(contentType);
    }
  });

  test("PIN O5: the CORS step adds NO route — the registered route table has no OPTIONS entry", async () => {
    const routes = registeredRoutes();
    expect(routes.filter((route) => route.startsWith("OPTIONS"))).toEqual([]);
    // And the preflight really is middleware, not a route: the asset and API routes
    // are exactly the ones PIN A1 already compares to docs/API.md.
    expect(routes).toContain("GET /healthz");
    expect(routes).toContain("GET /stores");
  });
});

describe("pin O6: the allowlist is validated at the boundary", () => {
  test("PIN O6: an unset variable is the `*` policy, and named origins are trimmed and kept in order", () => {
    expect(parseCorsOrigins(undefined)).toEqual(["*"]);
    expect(resolveConfig({}).corsOrigins).toEqual(["*"]);
    expect(parseCorsOrigins(" https://game.example.com , http://localhost:5173 ")).toEqual([
      GAME_ORIGIN,
      OTHER_ORIGIN,
    ]);
    expect(parseCorsOrigins("*")).toEqual(["*"]);
  });

  test("PIN O6: a policy that could never match — or that is ambiguous — FAILS LOUDLY instead of silently doing nothing", () => {
    // SET but empty is a misconfiguration, not "unset": falling back to `*` would turn
    // an attempt to lock the service down into the widest possible policy, silently.
    expect(() => parseCorsOrigins("")).toThrow(/names no origin/);
    expect(() => parseCorsOrigins(" , ")).toThrow(/names no origin/);
    // Mixing the wildcard with named origins is ambiguous, exactly like a mixed scope.
    expect(() => parseCorsOrigins("*,https://game.example.com")).toThrow(/may not mix/);
    // A bare hostname or a URL with a path can never equal an `Origin` header.
    expect(() => parseCorsOrigins("game.example.com")).toThrow(/not a URL origin/);
    expect(() => parseCorsOrigins("https://game.example.com/")).toThrow(/bare origin/);
    expect(() => parseCorsOrigins("https://game.example.com/game")).toThrow(/bare origin/);
    expect(() => parseCorsOrigins("ftp://game.example.com")).toThrow(/http or https/);
    expect(() => parseCorsOrigins("https://a.example.com,https://a.example.com")).toThrow(/repeats/);
  });

  test("PIN O6: a rejected allowlist fails the BOOT, not a request — resolveConfig throws", () => {
    expect(() => resolveConfig({ SERVERSTORE_CORS_ORIGINS: "game.example.com" })).toThrow(
      /SERVERSTORE_CORS_ORIGINS/,
    );
  });
});
