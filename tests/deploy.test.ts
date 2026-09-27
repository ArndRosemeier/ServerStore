/**
 * The DEPLOYMENT artifacts' contract: the systemd user unit.
 *
 * `tests/entrypoint.test.ts` proves the PROCESS; this file proves the UNIT that will
 * start it. They are deliberately separate: one spawns a real server, the other reads
 * a text file and asks systemd to parse it. A reader looking for "how is this
 * deployed" should find both, and neither should have to run the other.
 *
 * Pins (the NAME is the contract; `docs/TESTING.md` maps them):
 *   PIN D5: the unit file passes systemd-analyze verify
 *   PIN D6: the unit file does not make the bind host configurable
 *
 * PIN D5 is a real check, not a formality. `systemd-analyze verify` resolves
 * `ExecStart`, the working directory and the `Environment=` lines, so a typo in an
 * absolute path is RED here rather than a dead service at install time. It does NOT
 * start or install anything: this file touches no host state, and installing the unit
 * stays a dispatcher/owner action (brief §2).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const REPO = resolvePath(fileURLToPath(new URL("../", import.meta.url)));
const UNIT = resolvePath(REPO, "deploy/serverstore.service");

const unitText = readFileSync(UNIT, "utf8");

/**
 * The unit's DIRECTIVES, with comments and blank lines removed.
 *
 * The pins that read this file are checking what systemd will RUN, and a comment
 * cannot set a variable. This matters here and is not hypothetical: the unit's own
 * header MENTIONS `SERVERSTORE_HOST` and `Environment=HOST=…` in the sentence that
 * forbids them, and a check run over raw text reds on its own warning.
 */
const directives = unitText
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith(";"))
  .join("\n");

/** `[Section]` headers, in order — the unit has exactly the three a user unit needs. */
const sections = unitText
  .split("\n")
  .map((line) => /^\[(.+)\]$/.exec(line.trim())?.[1])
  .filter((name): name is string => name !== undefined);

describe("the systemd user unit (pins D5-D6)", () => {
  test("PIN D5: the unit file passes systemd-analyze verify", () => {
    // `systemd-analyze` is a hard requirement of this pin. A missing binary is a LOUD
    // failure, never a skip: a silently skipped pin is a pin that cannot fail
    // (AGENTS.md rule 1, and ledger row 25's lesson).
    let version: string;
    try {
      version = execFileSync("systemd-analyze", ["--version"], { encoding: "utf8" }).split("\n")[0] ?? "";
    } catch (error) {
      throw new Error(
        `systemd-analyze is required to verify ${UNIT} but could not be run: ${(error as Error).message}`,
      );
    }

    let stdout = "";
    let status = 0;
    try {
      stdout = execFileSync("systemd-analyze", ["verify", UNIT], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      status = failure.status ?? 1;
      stdout = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
    }

    expect(status, `${version}\nsystemd-analyze verify ${UNIT} failed:\n${stdout}`).toBe(0);
    // Quiet success is the normal case; if it ever prints, the text is in the message.
    expect(stdout.trim(), `systemd-analyze verify printed output:\n${stdout}`).not.toContain(
      "Failed to",
    );
  });

  test("PIN D6: the unit file does not make the bind host configurable", () => {
    // The whole deployment design is loopback + tunnel (GUARD g1). `resolveConfig()`
    // hard-codes the host as `DEFAULT_HOST`, and this asserts the unit does not try to
    // reintroduce it through the environment — the one place a host WOULD leak in.
    // Checked on DIRECTIVES, not raw text: the header comment names both of these in
    // the sentence that forbids them.
    expect(
      /SERVERSTORE_HOST|SERVERSTORE_BIND/i.test(directives),
      "the unit sets a bind-host variable; the host is a constant in src/server/config.ts and must stay one",
    ).toBe(false);
    expect(
      /^\s*Environment\s*=\s*"?'?HOST\s*=/im.test(directives),
      "the unit sets HOST=; the host is a constant in src/server/config.ts and must stay one",
    ).toBe(false);
    // ...and the reason is written down where the next editor will hit it.
    expect(unitText).toMatch(/DEFAULT_HOST/);
    expect(unitText).toMatch(/127\.0\.0\.1/);
  });

  test("the unit is the systemd USER-unit shape the runbook installs", () => {
    // Ordering matters: the sections, then one ExecStart that runs the repo's OWN
    // entrypoint, with absolute paths, and a restart policy.
    expect(sections).toEqual(["Unit", "Service", "Install"]);
    expect(unitText).toMatch(/^WorkingDirectory=\/home\/administrator\/projects\/ServerStore$/m);
    expect(unitText).toMatch(/^Environment=SERVERSTORE_DATA_ROOT=\/home\/administrator\/serverstore-data$/m);
    expect(unitText).toMatch(/^Environment=SERVERSTORE_PORT=8477$/m);
    expect(unitText).toMatch(
      /^ExecStart=\/usr\/bin\/node --experimental-strip-types \/home\/administrator\/projects\/ServerStore\/src\/server\/main\.ts$/m,
    );
    expect(unitText).toMatch(/^Restart=on-failure$/m);
    expect(unitText).toMatch(/^RestartSec=3$/m);
    expect(unitText).toMatch(/^WantedBy=default\.target$/m);
    // The data root is OUTSIDE the repo (ledger row 13): it must never be a path
    // under the checkout.
    expect(unitText).not.toMatch(/WorkingDirectory=\/home\/administrator\/projects\/ServerStore\/worktrees/);
  });
});
