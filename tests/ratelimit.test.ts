/**
 * PIN R1–R8 — the rate limiter (ledger rows 64/65).
 *
 * The problem: since CORS landed (rows 57/58) this API answers browsers from any origin
 * on a public hostname whose only perimeter is a key, and nothing bounds request volume.
 * The trap that makes this more than a counter: a bucket table keyed by a CLIENT-SUPPLIED
 * header is itself a denial-of-service vector, and a limiter placed AFTER the key guard
 * protects only callers who already hold a key.
 *
 * Pins (the NAME is the contract; `docs/TESTING.md` maps them):
 *   PIN R1: under the limit nothing changes — same status, same body, no invented header
 *   PIN R2: the request after the limit is 429 with `Retry-After` and NO side effect, and
 *           the refusal happens BEFORE the key guard (an unkeyed call is 429, not 401)
 *   PIN R3: the window ROLLS — advance the injected clock and the identity is served
 *           again; `Retry-After` is an integer in [1, window]
 *   PIN R4: identities are independent (`CF-Connecting-IP`, then the FIRST
 *           `X-Forwarded-For` hop, then one shared `local`) and never the socket address
 *   PIN R5: `/healthz`, the three UI assets and a CORS preflight keep answering while
 *           the API identity is over its limit
 *   PIN R6: the bucket table is BOUNDED under many distinct identities AND the limiter
 *           still refuses a flooding identity (eviction must not disable the limit)
 *   PIN R7: `SERVERSTORE_RATE_LIMIT=0` disables it completely, the bare default is
 *           600/60 s, and a malformed value fails the BOOT loudly
 *   PIN R8: `docs/API.md` carries the new code, the env var and the exemptions, and the
 *           stale "no rate limit" sentences are gone
 *
 * Every app here comes from the ONE fixture set (`tests/helpers/server.ts`), with a small
 * limit and the fixture's INJECTED clock — never by generating load. The fixture's own
 * default limit is `0` (disabled) so the pre-limiter pins are unaffected.
 */

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  DEFAULT_RATE_LIMIT,
  RATE_LIMIT_WINDOW_MS,
  parseRateLimit,
  resolveConfig,
} from "../src/server/config.ts";
import {
  DEFAULT_MAX_BUCKETS,
  LOCAL_IDENTITY,
  MAX_IDENTITY_LENGTH,
  clientIdentity,
  createRateLimiter,
} from "../src/server/ratelimit.ts";
import { cleanupTestServers, createTestServer, readError } from "./helpers/server.ts";

afterEach(cleanupTestServers);

const WINDOW_SECONDS = RATE_LIMIT_WINDOW_MS / 1000;

/** A `Retry-After` that satisfies the contract: an integer in [1, windowSeconds]. */
function retryAfterOf(response: Response): number {
  const raw = response.headers.get("retry-after");
  expect(raw, "a 429 must carry Retry-After").not.toBeNull();
  const value = Number(raw);
  expect(Number.isInteger(value), `Retry-After must be an integer, got ${String(raw)}`).toBe(true);
  expect(value).toBeGreaterThanOrEqual(1);
  expect(value).toBeLessThanOrEqual(WINDOW_SECONDS);
  return value;
}

describe("pin R1: under the limit, nothing changes", () => {
  test("PIN R1: under the limit, nothing changes — same status, same body, no Retry-After invented", async () => {
    const limited = createTestServer({ rateLimit: 3 });
    const unlimited = createTestServer({ rateLimit: 0 });
    const limitedKey = limited.mint({ stores: ["*"], perms: ["admin"] });
    const unlimitedKey = unlimited.mint({ stores: ["*"], perms: ["admin"] });

    const baseline = await (await unlimited.get("/stores", unlimitedKey)).json();
    for (let i = 0; i < 3; i++) {
      const response = await limited.get("/stores", limitedKey);
      expect(response.status, `request ${i + 1} of 3`).toBe(200);
      // No rate-limit header is invented on a success.
      expect(response.headers.get("retry-after")).toBeNull();
      expect(await response.json()).toEqual(baseline);
    }
  });
});

describe("pin R2: the request after the limit is 429, and nothing happened", () => {
  test("PIN R2: the request after the limit is 429 with Retry-After and no side effect", async () => {
    const server = createTestServer({ rateLimit: 2 });
    const key = server.mint({ stores: ["*"], perms: ["admin"] });

    expect((await server.get("/stores", key)).status).toBe(200);
    expect((await server.get("/stores", key)).status).toBe(200);

    // A PUT that WOULD have created the object. It is refused, so the proof that nothing
    // happened is a read of the metadata table and the blob floor, not the 429 itself.
    const refused = await server.put("/stores/master/objects/room-1", '{"score":7}', key);
    expect(refused.status).toBe(429);
    const error = await readError(refused);
    expect(error.code).toBe("rate_limited");
    retryAfterOf(refused);

    const rows = server.direct(
      (db) => db.prepare("SELECT COUNT(*) AS n FROM objects").get() as { n: number },
    );
    expect(rows.n, "a refused PUT must not create an object row").toBe(0);
    expect(server.listBlobFiles(), "a refused PUT must not write a blob").toEqual([]);
  });

  test("PIN R2: the refusal happens in FRONT of the key guard — an unkeyed call is 429, not 401", async () => {
    const server = createTestServer({ rateLimit: 1 });
    const identity = { "cf-connecting-ip": "203.0.113.7" };

    // The first request is unauthenticated: it walks to the guard, which answers 401.
    const first = await server.request("/stores", { headers: identity });
    expect(first.status).toBe(401);
    expect((await readError(first)).code).toBe("unauthorized");

    // The SECOND one never reaches the guard — so it is 429, not the 401 a call without
    // a key would otherwise get. That is what "in front of the guard" means, and it is
    // the half that protects the key comparison itself.
    const refused = await server.request("/stores", { headers: identity });
    expect(refused.status).toBe(429);
    expect((await readError(refused)).code).toBe("rate_limited");
  });
});

describe("pin R3: the window rolls", () => {
  test("PIN R3: the window rolls — the same identity is served again and Retry-After never exceeds the window", async () => {
    const server = createTestServer({ rateLimit: 2 });
    const key = server.mint({ stores: ["*"], perms: ["admin"] });

    expect((await server.get("/stores", key)).status).toBe(200);
    expect((await server.get("/stores", key)).status).toBe(200);
    const refused = await server.get("/stores", key);
    expect(refused.status).toBe(429);
    retryAfterOf(refused);

    // One second BEFORE the window ends: still refused, and the back-off instruction is
    // at its floor rather than a zero or a negative.
    server.clock.value += RATE_LIMIT_WINDOW_MS - 1000;
    const stillRefused = await server.get("/stores", key);
    expect(stillRefused.status).toBe(429);
    expect(Number(stillRefused.headers.get("retry-after"))).toBe(1);

    // AT the boundary the window has rolled: the same identity is served again.
    server.clock.value += 1000;
    const served = await server.get("/stores", key);
    expect(served.status).toBe(200);
    expect(served.headers.get("retry-after")).toBeNull();
  });
});

describe("pin R4: identities are independent", () => {
  test("PIN R4: identities are independent — CF-Connecting-IP, then the FIRST X-Forwarded-For hop", async () => {
    const server = createTestServer({ rateLimit: 1 });
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    const call = (headers: Record<string, string>) =>
      server.request("/stores", { headers: { authorization: `Bearer ${key}`, ...headers } });

    // Exhaust one tunnel identity.
    expect((await call({ "cf-connecting-ip": "1.1.1.1" })).status).toBe(200);
    expect((await call({ "cf-connecting-ip": "1.1.1.1" })).status).toBe(429);
    // A different CF-Connecting-IP is a different bucket.
    expect((await call({ "cf-connecting-ip": "2.2.2.2" })).status).toBe(200);

    // X-Forwarded-For: the FIRST hop is the identity, so a second hop cannot evade.
    expect((await call({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" })).status).toBe(200);
    expect((await call({ "x-forwarded-for": "9.9.9.9, 10.0.0.2" })).status).toBe(429);
    expect((await call({ "x-forwarded-for": "8.8.8.8, 10.0.0.1" })).status).toBe(200);

    // CF-Connecting-IP WINS when both are present: a fresh X-Forwarded-For cannot
    // rescue an exhausted tunnel identity.
    expect((await call({ "cf-connecting-ip": "3.3.3.3", "x-forwarded-for": "4.4.4.4" })).status).toBe(200);
    expect((await call({ "cf-connecting-ip": "3.3.3.3", "x-forwarded-for": "5.5.5.5" })).status).toBe(429);

    // No forwarding header at all: the ONE shared `local` bucket.
    expect((await call({})).status).toBe(200);
    expect((await call({})).status).toBe(429);
  });

  test("PIN R4: the identity order and the `local` fallback live in ONE function, and never the socket address", () => {
    const request = (headers: Record<string, string>) =>
      new Request("http://127.0.0.1:8477/stores", { headers });

    expect(clientIdentity(request({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIdentity(request({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIdentity(request({}))).toBe(LOCAL_IDENTITY);
    // An empty header is not an identity: it falls through instead of keying a "" bucket.
    expect(clientIdentity(request({ "cf-connecting-ip": "  ", "x-forwarded-for": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIdentity(request({ "cf-connecting-ip": "  " }))).toBe(LOCAL_IDENTITY);
  });
});

describe("pin R5: the exemptions are real", () => {
  test("PIN R5: the exemptions are real — /healthz, the three UI assets and a preflight answer while the API identity is over its limit", async () => {
    const server = createTestServer({ rateLimit: 1 });
    const key = server.mint({ stores: ["*"], perms: ["admin"] });

    expect((await server.get("/stores", key)).status).toBe(200);
    expect((await server.get("/stores", key)).status).toBe(429);

    // The probe and the operator's console must keep answering...
    for (const route of ["/healthz", "/", "/app.js", "/app.css"]) {
      expect((await server.request(route)).status, `${route} must never be limited`).toBe(200);
    }
    // ...and a preflight is answered 204 with no key (the CORS step answers it before the
    // limiter, which is the structural half of the exemption).
    const preflight = await server.request("/stores", {
      method: "OPTIONS",
      headers: {
        origin: "https://game.example.com",
        "access-control-request-method": "GET",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-expose-headers")).toBe(
      "x-serverstore-sha256, retry-after",
    );

    // The API identity is STILL refused, so these are exemptions rather than a limiter
    // that quietly stopped working.
    expect((await server.get("/stores", key)).status).toBe(429);
  });

  test("PIN R5: a preflight from a DISALLOWED origin is exempt too — it reaches the guard's 401, never a 429", async () => {
    // Under an allowlist a disallowed origin's preflight deliberately FALLS THROUGH the
    // CORS step to the normal pipeline. This is the only path on which a preflight
    // actually reaches the limiter, so it is the only way to pin the limiter's own
    // preflight exemption rather than the CORS step's early answer.
    const server = createTestServer({ rateLimit: 1, corsOrigins: ["https://game.example.com"] });

    expect((await server.request("/stores")).status).toBe(401); // exhausts `local`
    expect((await server.request("/stores")).status).toBe(429);

    const fallthrough = await server.request("/stores", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "GET",
      },
    });
    expect(fallthrough.status, "a preflight must never be rate limited").toBe(401);
    expect(fallthrough.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("pin R6: the table is BOUNDED", () => {
  test("PIN R6: many distinct identities stay at the cap while a flooding identity is STILL refused", () => {
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now: () => 1_000, // one frozen window: nothing here expires
      maxBuckets: 8,
    });

    // Half one: MANY distinct identities never grow the table past the cap.
    for (let i = 0; i < 500; i++) limiter.check(`10.0.0.${i}`);
    expect(limiter.bucketCount).toBeLessThanOrEqual(8);

    // Half two: a flooding identity is refused even though cold identities keep arriving
    // and forcing evictions. Eviction takes the LEAST RECENTLY USED bucket, so the hot
    // bucket survives; a limiter that forgot the flooding identity would pass this.
    for (let i = 0; i < 2; i++) {
      expect(limiter.check("flood"), `admitted flooding request ${i + 1}`).toMatchObject({
        allowed: true,
      });
      limiter.check(`cold-${i}`);
    }
    const refused = limiter.check("flood");
    expect(refused.allowed, "eviction must not silently disable the limit").toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(limiter.bucketCount).toBeLessThanOrEqual(8);
  });

  test("PIN R6: the DEFAULT cap bounds a flood, and an over-long identity cannot inflate the table", () => {
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now: () => 1_000,
    });
    for (let i = 0; i < DEFAULT_MAX_BUCKETS + 500; i++) limiter.check(`identity-${i}`);
    expect(limiter.bucketCount).toBeLessThanOrEqual(DEFAULT_MAX_BUCKETS);

    // The bucket key is the identity's first MAX_IDENTITY_LENGTH characters, so the
    // attacker-controlled LENGTH of the header cannot inflate the table either. A
    // collision is the fail-closed direction: the two spellings share one bucket.
    const prefix = "x".repeat(MAX_IDENTITY_LENGTH);
    expect(limiter.check(prefix + "a").allowed).toBe(true);
    expect(limiter.check(prefix + "b").allowed).toBe(false);
  });
});

describe("pin R7: SERVERSTORE_RATE_LIMIT", () => {
  test("PIN R7: SERVERSTORE_RATE_LIMIT=0 disables it completely", async () => {
    // Unkeyed requests, because an unkeyed flood is exactly what the limiter exists to
    // bound (row 64a): with the kill-switch on, every one of them still reaches the guard
    // and gets its own 401, and not one is a 429.
    const server = createTestServer({ rateLimit: 0 });
    for (let i = 0; i < 700; i++) {
      expect((await server.request("/stores")).status, `request ${i + 1}`).toBe(401);
    }
  });

  test("PIN R7: the bare default is 600 per 60 s — the 600th passes and the 601st is refused", async () => {
    expect(DEFAULT_RATE_LIMIT).toBe(600);
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(resolveConfig({}).rateLimit).toBe(600);

    const server = createTestServer({ rateLimit: resolveConfig({}).rateLimit });
    for (let i = 0; i < 600; i++) {
      expect((await server.request("/stores")).status, `request ${i + 1} of 600`).toBe(401);
    }
    expect((await server.request("/stores")).status).toBe(429);
  });

  test("PIN R7: a malformed value fails the BOOT loudly rather than defaulting", () => {
    for (const bad of ["abc", "-1", "1.5", "", "   ", "NaN", "Infinity", "600x"]) {
      expect(
        () => resolveConfig({ SERVERSTORE_RATE_LIMIT: bad }),
        `${JSON.stringify(bad)} must fail the boot`,
      ).toThrow(/SERVERSTORE_RATE_LIMIT/);
    }
    expect(parseRateLimit(undefined)).toBe(600);
    expect(parseRateLimit("0")).toBe(0);
    expect(parseRateLimit("600")).toBe(600);
    expect(parseRateLimit(" 42 ")).toBe(42);
  });
});

describe("pin R8: the documented contract matches the code", () => {
  const doc = readFileSync(
    resolvePath(fileURLToPath(new URL("../", import.meta.url)), "docs/API.md"),
    "utf8",
  );
  const routeRow = (method: string, path: string): string | undefined =>
    doc.split("\n").find((line) => line.startsWith(`| \`${method}\` | \`${path}\` |`));

  test("PIN R8: docs/API.md documents rate_limited/429, the env var, and the exemptions", () => {
    // The error table row, with the status the code maps it to (PIN A2 checks the rest).
    expect(doc).toMatch(/^\|\s*`rate_limited`\s*\|\s*`429`\s*\|/m);
    // The env table carries the variable and its default.
    expect(doc).toMatch(/^\|\s*`SERVERSTORE_RATE_LIMIT`\s*\|[^|]*`?600/m);
    // API routes gain 429; the exempt ones do NOT (the exemption is part of the contract).
    for (const [method, path] of [
      ["GET", "/whoami"],
      ["GET", "/stores"],
      ["POST", "/keys"],
      ["PATCH", "/keys/{id}"],
      ["PUT", "/stores/{store}/objects/{name}"],
    ] as const) {
      expect(routeRow(method, path), `${method} ${path} must list 429`).toContain("429");
    }
    for (const [method, path] of [
      ["GET", "/healthz"],
      ["GET", "/"],
      ["GET", "/app.js"],
      ["GET", "/app.css"],
    ] as const) {
      expect(routeRow(method, path), `${method} ${path} must NOT list 429`).not.toContain("429");
    }
    // The exposed header that makes Retry-After readable to a browser.
    expect(doc).toMatch(/`?retry-after`?/);
  });

  test("PIN R8: the stale 'no rate limit' sentences are gone", () => {
    expect(doc).not.toContain("There is no rate limit");
    expect(doc).not.toMatch(/No rate limiting/);
  });
});
