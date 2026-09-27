/**
 * PIN S1–S6: the secret tripwire on the TRACKED tree.
 *
 * A public repo is fine for this project (ledger rows 20–21): the code is not the
 * secret. What is NOT fine is the key. "We won't push the key" is an intention, so
 * this file is the mechanism: every pin below is a NAMED check inside the ONE suite,
 * and `scripts/gate.sh` runs it with everything else.
 *
 * The scanner is `tests/helpers/secrets.ts` (side-effect free, no new dependency).
 * Tracked = what a push would PUBLISH (`git ls-files`); an untracked secret is a
 * different, smaller problem and is deliberately out of scope.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { findingsInText, scanTrackedTree, type FindingKind } from "./helpers/secrets.ts";

const REPO = fileURLToPath(new URL("../", import.meta.url));

/**
 * Built from parts, NEVER written as a literal: this file is tracked, so a literal
 * here would make the tripwire flag its own fixture — exactly the trap that makes a
 * bare `ssk_` rule wrong (see the scanner). It is also obviously fake.
 */
const FAKE_GITHUB_TOKEN = "ghp_" + "A".repeat(36);

/**
 * A deliberately NON-GitHub-shaped secret, built from parts for the same reason as the
 * token above: this file is TRACKED, so a literal here would have to dodge the
 * GitHub-token rule by accident. The credential arm compares the host file's VALUE,
 * whatever shape that value happens to have.
 */
const PLANTED_HOST_SECRET = "fixture-" + "Z".repeat(24);

/** A legal `ssk_…` key fixture — the SAME shape `tests/auth.test.ts` and `tests/admin-key.test.ts` mint. */
const LEGAL_KEY_FIXTURE = "ssk_AAAAAAAAAAAA_" + "b".repeat(43);

const scan = scanTrackedTree(REPO);

/** The findings of one kind, as printable strings — the failure message names the file. */
function filesWith(kind: FindingKind): string[] {
  return scan.findings.filter((finding) => finding.kind === kind).map((finding) => `${finding.file}: ${finding.detail}`);
}

describe("the secret tripwire on the tracked tree (ledger row 23)", () => {
  test("the scan actually looked (a broken listing cannot pass vacuously)", () => {
    expect(scan.files, "git ls-files returned no tracked files — the tripwire looked at nothing").toBeGreaterThan(0);
  });

  test("PIN S1: the tracked tree carries no GitHub token shape", () => {
    expect(
      filesWith("github-token"),
      "a GitHub token shape is TRACKED — it is already published: remove it and rotate it",
    ).toEqual([]);
  });

  test("PIN S2: the tracked tree carries no PEM private key", () => {
    expect(
      filesWith("pem-private-key"),
      "a PEM private key is TRACKED — it is already published: remove it and replace the key",
    ).toEqual([]);
  });

  test("PIN S3: the host credential's value appears in no tracked file", () => {
    expect(
      scan.credential.status,
      `PIN S3 cannot check the host credential: ${
        scan.credential.status === "checked" ? "checked" : scan.credential.reason
      }`,
    ).toBe("checked");
    expect(
      filesWith("host-credential"),
      "the host credential's value is TRACKED — rotate it NOW, it is already published",
    ).toEqual([]);
  });

  test("PIN S4: the scanner DETECTS a planted fake token", () => {
    // Falsifiability: a tripwire that cannot go red is decoration. A throwaway git
    // repo is the smallest thing `git ls-files` will list, so the detection runs
    // through the SAME code path the real tree uses.
    const dir = mkdtempSync(join(tmpdir(), "serverstore-tripwire-"));
    try {
      const git = (args: string[]): void => {
        const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
        if (result.status !== 0) {
          throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
        }
      };
      git(["init", "-q"]);
      writeFileSync(join(dir, "planted.txt"), `token = ${FAKE_GITHUB_TOKEN}\n`);
      git(["add", "planted.txt"]);

      const planted = scanTrackedTree(dir, { credentialPath: join(dir, "no-such-credentials") });
      expect(planted.findings.map((finding) => `${finding.kind}:${finding.file}`)).toContain(
        "github-token:planted.txt",
      );
      expect(planted.skippedBinary, "the planted fixture is text, not binary").toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("PIN S3 control: the host credential IS detected when planted", () => {
    // The positive control this pin was MISSING. Measured 2026-09-27 (dispatcher arm J,
    // ledger row 25): with the credential comparison broken the whole suite stayed GREEN,
    // so PIN S3 could not fail and proved nothing — and it is the arm guarding the only
    // real secret on this box. `credentialPath` exists for exactly this.
    const dir = mkdtempSync(join(tmpdir(), "serverstore-credential-"));
    try {
      const credentials = join(dir, "git-credentials");
      writeFileSync(credentials, `https://x-access-token:${PLANTED_HOST_SECRET}@github.com\n`);
      writeFileSync(join(dir, "leaked.txt"), `token=${PLANTED_HOST_SECRET}\n`);
      expect(spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" }).status).toBe(0);
      expect(spawnSync("git", ["add", "leaked.txt"], { cwd: dir, encoding: "utf8" }).status).toBe(0);

      const found = scanTrackedTree(dir, { credentialPath: credentials });
      expect(found.credential.status, "the planted credential file must read and parse").toBe("checked");
      expect(found.findings.map((finding) => `${finding.kind}:${finding.file}`)).toContain(
        "host-credential:leaked.txt",
      );
      const detail = found.findings.find((finding) => finding.kind === "host-credential")?.detail ?? "";
      expect(detail, "a finding names the FILE and never the value").not.toContain(PLANTED_HOST_SECRET);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("PIN S3 direction: a credential file with no github.com line is 'cannot-check', never clean", () => {
    const dir = mkdtempSync(join(tmpdir(), "serverstore-credential-"));
    try {
      const credentials = join(dir, "git-credentials");
      writeFileSync(credentials, "https://user:not-a-github-secret@gitlab.example.com\n");
      const found = scanTrackedTree(REPO, { credentialPath: credentials });
      expect(found.credential.status).toBe("cannot-check");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("PIN S2 control: a planted PEM private-key header IS detected", () => {
    // The positive control PIN S2 was missing (dispatcher arm K, ledger row 25). Built
    // from parts: a literal header here would be TRACKED, and PIN S2 would flag its own
    // fixture — the same trap the token literal avoids.
    const pem = "-----BEGIN " + "RSA " + "PRIVATE KEY-----";
    const found = findingsInText("planted.pem", `${pem}\nMIIEnotarealkey\n`);
    expect(found.map((finding) => finding.kind)).toContain("pem-private-key");
  });

  test("PIN S5: a legal key-shaped fixture is NOT flagged", () => {
    // The anti-cry-wolf direction. Our fixtures are NECESSARILY key-shaped, which is
    // why the scanner has no bare `ssk_` rule; if one is ever added, this goes RED.
    expect(findingsInText("fixture.txt", `Authorization: Bearer ${LEGAL_KEY_FIXTURE}\n`)).toEqual([]);
    // …and the real fixture file itself, which mints an `ssk_` key, is clean too.
    const authTest = readFileSync(join(REPO, "tests", "auth.test.ts"), "utf8");
    expect(findingsInText("tests/auth.test.ts", authTest)).toEqual([]);
  });

  test("PIN S6: no tracked database or blob artifact", () => {
    expect(
      filesWith("database-artifact"),
      "a database file is TRACKED — the data root must stay outside the repo (ledger row 13)",
    ).toEqual([]);
  });

  test("the ignore list carries the database patterns (the preventive half of S6)", () => {
    const patterns = readFileSync(join(REPO, ".gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim());
    for (const pattern of ["*.db", "*.sqlite", "*.sqlite3"]) {
      expect(patterns, `.gitignore must carry ${pattern}`).toContain(pattern);
    }
  });
});
