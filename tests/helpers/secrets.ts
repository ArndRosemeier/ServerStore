/**
 * The secret tripwire — the ONE place the TRACKED tree is scanned for secrets.
 *
 * "We won't push the key" is an intention and `.gitignore` is not a mechanism (ledger
 * row 21). TRACKED is the right universe: `git ls-files` lists what a push would
 * PUBLISH, so an untracked secret is a different, smaller problem. This is NOT a step
 * in `scripts/gate.sh`: the gate is the ONE way the suite runs, and a second check
 * path there multiplies the ways a check can be skipped silently. It is a pure
 * scanner, called by ONE test file, where every rule carries a pin NAME.
 *
 * Side-effect free and dependency-free: it runs `git ls-files`, reads bytes, and
 * compares strings in memory. The host credential's VALUE is never returned in a
 * finding, printed, echoed or logged — a finding names the FILE, never the token.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type FindingKind =
  | "github-token"
  | "pem-private-key"
  | "host-credential"
  | "database-artifact";

export interface Finding {
  readonly kind: FindingKind;
  /** Repo-relative path exactly as `git ls-files` reports it (always `/`). */
  readonly file: string;
  /** What was found. NEVER contains a secret value. */
  readonly detail: string;
}

export type CredentialStatus =
  | { readonly status: "checked"; readonly path: string }
  | { readonly status: "cannot-check"; readonly reason: string };

export interface ScanResult {
  readonly repoRoot: string;
  /** How many tracked paths were listed — a scan that looked at nothing is VISIBLE. */
  readonly files: number;
  readonly skippedBinary: readonly string[];
  readonly findings: readonly Finding[];
  readonly credential: CredentialStatus;
}

export interface ScanOptions {
  /** Override the credential file (tests point it at a fixture, or at nothing). */
  readonly credentialPath?: string;
}

/**
 * GitHub token shapes: classic tokens are `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` + 36
 * base62 characters and fine-grained PATs are `github_pat_` + 22+ of base62/`_`.
 * These never appear in our fixtures, so this rule needs no exclusion list.
 */
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g;

/**
 * PEM private-key armor. A key pasted into a doc, a fixture or a patch is a leak
 * whether or not the repo is public. An `ENCRYPTED ` key is still a key: it is in the
 * list even though the brief's pinned shape names only RSA/EC/OPENSSH/DSA/PGP, and it
 * cannot match any legal fixture in this repo.
 */
const PEM_PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/;

/**
 * This module deliberately has NO rule for bare `ssk_`-shaped strings — the obvious
 * rule, and the wrong one. Our own tests mint key-shaped fixtures (`tests/auth.test.ts`,
 * `tests/admin-key.test.ts`), so such a rule would either red on the suite or force an
 * exclusion list covering the very files most likely to hide a real leak. It is the
 * SAME reason the planted fixture in `tests/secrets.test.ts` is built from parts.
 */

/** "Binary" means a NUL byte in the first 8 KiB: those bytes are never decoded. */
const BINARY_SNIFF_BYTES = 8 * 1024;

/** Shorter than this is a placeholder, not a credential, and `includes("")` is chaos. */
const MIN_CREDENTIAL_LENGTH = 8;

function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/**
 * Every secret shape a SINGLE decoded text file can carry. Pure, and exported so the
 * tripwire's falsifiability (PIN S4) and its anti-cry-wolf direction (PIN S5) can be
 * pinned on a fixture string without touching the real tree.
 */
export function findingsInText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  for (const match of text.matchAll(GITHUB_TOKEN)) {
    findings.push({
      kind: "github-token",
      file,
      detail: `GitHub token shape at byte offset ${String(match.index)}`,
    });
  }
  if (PEM_PRIVATE_KEY.test(text)) {
    findings.push({ kind: "pem-private-key", file, detail: "PEM private-key header" });
  }
  return findings;
}

interface LoadedCredentials {
  readonly status: CredentialStatus;
  /** In memory only. Never placed in a Finding, a log or an error message. */
  readonly secrets: readonly string[];
}

/** Percent-decode only when there is something to decode; `null` means "use the raw form". */
function percentDecoded(value: string): string | null {
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape cannot HIDE the credential: the raw form is compared too.
    return null;
  }
}

/**
 * Pull the github.com secrets out of a `~/.git-credentials`-shaped file
 * (`scheme://user:secret@host`, one per line). The raw form is always compared, and
 * the percent-decoded form is ADDED when it differs, so neither encoding slips past.
 */
function loadHostCredentials(path: string): LoadedCredentials {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: { status: "cannot-check", reason: `credential file absent: ${path}` }, secrets: [] };
    }
    // A real read failure is LOUD. It must never look like "no secret here".
    throw error;
  }

  const secrets: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const match = /^[a-z][a-z0-9+.-]*:\/\/([^@/]*)@([^/]+)/i.exec(trimmed);
    if (match === null) continue;
    const userinfo = match[1] ?? "";
    const host = (match[2] ?? "").toLowerCase();
    if (host !== "github.com" && !host.startsWith("github.com:")) continue;
    const colon = userinfo.indexOf(":");
    const secret = colon === -1 ? userinfo : userinfo.slice(colon + 1);
    for (const candidate of [secret, percentDecoded(secret)]) {
      if (candidate !== null && candidate.length >= MIN_CREDENTIAL_LENGTH) secrets.push(candidate);
    }
  }

  if (secrets.length === 0) {
    return {
      status: { status: "cannot-check", reason: `no github.com credential found in ${path}` },
      secrets: [],
    };
  }
  return { status: { status: "checked", path }, secrets };
}

function credentialPath(options: ScanOptions): string {
  return options.credentialPath ?? join(process.env.HOME ?? homedir(), ".git-credentials");
}

/**
 * Scan every file `git ls-files` reports under `repoRoot` and return the findings,
 * loudly (an empty result is impossible to mistake for "clean" — see `files`).
 */
export function scanTrackedTree(repoRoot: string, options: ScanOptions = {}): ScanResult {
  const listed = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.error !== undefined) {
    throw new Error(`cannot list the tracked tree in ${repoRoot}: ${listed.error.message}`);
  }
  if (listed.status !== 0) {
    throw new Error(
      `git ls-files failed in ${repoRoot} (exit ${String(listed.status)}): ${listed.stderr.toString("utf8").trim()}`,
    );
  }

  const tracked = listed.stdout
    .toString("utf8")
    .split("\0")
    .filter((path) => path !== "");

  const credential = loadHostCredentials(credentialPath(options));
  const findings: Finding[] = [];
  const skippedBinary: string[] = [];

  for (const file of tracked) {
    // A tracked file missing from the working tree is a real state, not a skip: LOUD.
    const bytes = readFileSync(join(repoRoot, file));
    if (isBinary(bytes)) {
      skippedBinary.push(file);
      continue;
    }
    const text = bytes.toString("utf8");
    findings.push(...findingsInText(file, text));
    for (const secret of credential.secrets) {
      if (text.includes(secret)) {
        findings.push({
          kind: "host-credential",
          file,
          detail: "the host credential's value appears here (value withheld)",
        });
      }
    }
  }

  // Ledger row 13: the data root lives OUTSIDE the repo, so a tracked database file
  // means user bytes have drifted into what would be published.
  for (const file of tracked) {
    if (/\.(db|sqlite|sqlite3)$/i.test(file)) {
      findings.push({ kind: "database-artifact", file, detail: "database/blob file tracked in the repo" });
    }
  }

  return {
    repoRoot,
    files: tracked.length,
    skippedBinary,
    findings,
    credential: credential.status,
  };
}
