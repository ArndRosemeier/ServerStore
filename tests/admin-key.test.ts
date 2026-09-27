/**
 * PIN 9 — the local bootstrap mints a key the HTTP API accepts as admin.
 *
 * The script is run as a CHILD PROCESS through the real package script
 * (`pnpm run admin:key`), against the same temp data root the app uses. That is the
 * whole point of the pin: the bootstrap path is not a function that happens to be
 * importable, it is the command an operator types when the master key is lost.
 *
 * It also pins the inverse (brief §7): there is NO HTTP route that mints an admin key
 * without an existing admin key.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { createTestServer, cleanupTestServers, keyId, readError } from "./helpers/server.ts";

afterEach(cleanupTestServers);

const REPO = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = "src/admin/mint-key.ts";

/** Run the operator-facing npm script, the way an operator types it. */
function runAdminKey(
  dataRoot: string,
  extra: readonly string[] = [],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("pnpm", ["run", "--silent", "admin:key", ...extra], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, SERVERSTORE_DATA_ROOT: dataRoot },
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * Run the CLI entrypoint directly. Same file, same flags — used where a test wants
 * the CLI's own arg contract rather than pnpm's forwarding.
 */
function runAdminKeyModule(
  dataRoot: string,
  extra: readonly string[] = [],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("node", ["--experimental-strip-types", SCRIPT, ...extra], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, SERVERSTORE_DATA_ROOT: dataRoot },
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function firstKey(stdout: string): string {
  const key = stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("ssk_"));
  if (key === undefined) throw new Error(`no key printed on stdout:\n${stdout}`);
  return key;
}

describe("the local bootstrap (pin 9, ledger row 7)", () => {
  test("PIN 9: pnpm run admin:key mints a key the HTTP API accepts as admin", async () => {
    const server = createTestServer();
    const run = runAdminKey(server.dataRoot);
    expect(run.status, `admin:key exited ${run.status}:\n${run.stderr}`).toBe(0);
    const key = firstKey(run.stdout);

    // It is a real admin key: it lists stores...
    const listed = await server.get("/stores", key);
    expect(listed.status, await listed.clone().text()).toBe(200);
    // ...and it creates one.
    const created = await server.postJson("/stores", { name: "from-cli" }, key);
    expect(created.status).toBe(201);
  });

  test("PIN 9: the CLI prints the key once and the database holds only its hash", async () => {
    const server = createTestServer();
    const run = runAdminKey(server.dataRoot);
    const key = firstKey(run.stdout);
    expect(server.readDbBytes().includes(key)).toBe(false);
    const row = server.direct(
      (db) =>
        db
          .prepare("SELECT key_hash, subject_kind, perms FROM access_keys WHERE id = ?")
          .get(keyId(key)) as { key_hash: string; subject_kind: string; perms: string } | undefined,
    );
    expect(row?.perms).toBe("admin");
    expect(row?.subject_kind).toBe("token");
  });

  test("the CLI mints a store-scoped key that cannot leave its store", async () => {
    const server = createTestServer();
    const master = server.mint({ store: "*", perms: ["admin"] });
    await server.postJson("/stores", { name: "notes" }, master);

    const run = runAdminKeyModule(server.dataRoot, ["--store", "notes", "--perms", "read,write"]);
    expect(run.status, run.stderr).toBe(0);
    const key = firstKey(run.stdout);

    const put = await server.put("/stores/notes/objects/a.txt", "hi", key);
    expect(put.status).toBe(201);
    expect((await server.get("/stores/master/objects", key)).status).toBe(403);
  });

  test("the CLI refuses a store that does not exist rather than minting a dud key", async () => {
    const server = createTestServer();
    const run = runAdminKeyModule(server.dataRoot, ["--store", "ghost"]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("admin:key failed");
    expect(run.stdout.trim()).toBe("");
  });

  test("the CLI refuses an unknown flag instead of ignoring it", async () => {
    const server = createTestServer();
    const run = runAdminKeyModule(server.dataRoot, ["--nonsense"]);
    expect(run.status).not.toBe(0);
    expect(server.direct((db) => (db.prepare("SELECT COUNT(*) AS n FROM access_keys").get() as { n: number }).n)).toBe(0);
  });

  test("PIN 9 (inverse): no HTTP route mints an admin key without an existing admin key", async () => {
    const server = createTestServer();
    // Without a key: refused.
    const anonymous = await server.postJson("/keys", { store: "*", perms: ["admin"] });
    expect(anonymous.status).toBe(401);

    // With an unknown key: refused.
    const unknown = await server.postJson(
      "/keys",
      { store: "*", perms: ["admin"] },
      `ssk_AAAAAAAAAAAA_${"b".repeat(43)}`,
    );
    expect(unknown.status).toBe(401);

    // And there is no path-shaped way around it either.
    const bypass = await server.request("/admin/keys", { method: "POST", body: "{}" });
    expect([401, 404]).toContain(bypass.status);
    expect(server.direct((db) => (db.prepare("SELECT COUNT(*) AS n FROM access_keys").get() as { n: number }).n)).toBe(0);
  });
});
