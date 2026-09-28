/**
 * The ONE browser seam.
 *
 * Everything browser-shaped lives here — and ONLY here: launching the installed
 * `/usr/bin/google-chrome` headless, speaking just enough of the Chrome DevTools
 * Protocol (CDP) over Node's BUILT-IN global `WebSocket` (Node 24; NO npm package, by
 * the owner's decision — board row 66 / ledger row 67), interacting with TRUSTED
 * `Input.*` events, and killing the browser's whole PROCESS GROUP.
 *
 * Why it exists at all: two product surfaces have never run in the environment they
 * exist for. `web/app.js` is plain JavaScript that the cheap tier does not typecheck and
 * U1–U4 only scan as SERVED BYTES (ledger rows 49/54), and CORS is enforced by the
 * BROWSER while O1–O6 assert the headers in process (rows 57/58). Ledger row 67 is the
 * design authority for this seam.
 *
 * THE HOST RULES THIS FILE ENCODES (AGENTS.md §Host hygiene, "reap what you start"):
 *
 *   - **A headless browser is a process TREE, not a process.** ONE Chrome run leaves
 *     dozens of processes behind (zygote, GPU, renderers). Killing the launcher does
 *     not kill the tree, so the child is started DETACHED — its own process GROUP — and
 *     the group is signalled (`process.kill(-pid, …)`, SIGTERM then SIGKILL).
 *   - **Cleanup that an error path can skip is not cleanup.** Every launch is registered
 *     in `live`; the kill runs from the `afterAll` hook registered BELOW (so importing
 *     this module is enough — a caller cannot forget it), from `killAllBrowsers()` on a
 *     failure path, and from a synchronous `process.once("exit")` net for an abrupt
 *     exit. `kill()` is idempotent, so all three can fire in any order.
 *   - **Scratch lives under the worktree, never `/tmp`.** The `--user-data-dir` profile
 *     is a fresh directory under `<repo>/.browser-scratch/` (gitignored), and it is
 *     deleted by `kill()`.
 *   - **A missing browser is a LOUD FAILURE, never a skip.** `launchBrowser()` throws a
 *     named `BrowserMissingError` naming the path (pin B8). There is deliberately no
 *     `describe.skip`, no `it.skipIf`, and no catch-into-a-pass anywhere in this file.
 *
 * Every wait has a DEADLINE THAT FAILS (`waitFor`, the DevTools-port poll, each CDP
 * command, and the kill). Nothing here sleeps-and-hopes and nothing here retries
 * silently: a bounded poll reports the last observed state in its failure message.
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll } from "vitest";
import { POLL_INTERVAL_MS, REPO_ROOT, sleep } from "./entrypoint.ts";

/** The browser this box has installed. Not a dependency; not downloaded. */
export const CHROME_PATH = "/usr/bin/google-chrome";

/** Scratch for profiles, under the WORKTREE (never `/tmp`). Gitignored. */
export const DEFAULT_SCRATCH_ROOT = join(REPO_ROOT, ".browser-scratch");

/** How long the DevTools endpoint may take to appear before the launch fails. */
const DEFAULT_LAUNCH_TIMEOUT_MS = 20_000;
/** How long one CDP command may take before it is a failure, not a hang. */
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;
/** How long a page may take to reach `readyState === "complete"`. */
const DEFAULT_NAVIGATE_TIMEOUT_MS = 15_000;
/** How long a `waitFor` polls before it FAILS with the last thing it saw. */
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;
/** SIGTERM → SIGKILL grace for the browser's process group. */
const DEFAULT_KILL_GRACE_MS = 2_000;

/** The binary is not there. A broken environment, not a reason to pass. */
export class BrowserMissingError extends Error {
  constructor(executablePath: string, reason: string) {
    super(
      `the headless browser is REQUIRED and ${JSON.stringify(executablePath)} is not ` +
        `usable: ${reason}. Install google-chrome at that path (this box has it at ` +
        `${CHROME_PATH}); a missing browser must FAIL the run, never skip it ` +
        "(AGENTS.md rule 1 — a skipped pin is a pin that cannot fail).",
    );
    this.name = "BrowserMissingError";
  }
}

/** The browser is there, but something about driving it failed. Always loud. */
export class BrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserError";
  }
}

export interface BrowserLaunchOptions {
  /** Injectable so pin B8 can point the seam at a path that cannot exist. */
  readonly executablePath?: string;
  /** Where the temp `--user-data-dir` goes. Defaults under THIS worktree. */
  readonly scratchRoot?: string;
  readonly launchTimeoutMs?: number;
  readonly commandTimeoutMs?: number;
  readonly killGraceMs?: number;
}

/** One page-level error the browser reported. */
export interface PageError {
  /** `exception` = an uncaught page exception; `log` = a Log.entryAdded error. */
  readonly kind: "exception" | "log";
  readonly text: string;
  readonly url: string | null;
  readonly source: string | null;
}

interface CdpMessage {
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly sessionId?: string;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string };
}

type CdpListener = (message: CdpMessage) => void;

/**
 * Just enough CDP: numbered commands with a deadline, and an event fan-out.
 *
 * Node's global `WebSocket` is the transport (Node 24 — no package). Every command
 * carries a timer, so a DevTools endpoint that accepts a command and never answers is a
 * FAILURE after `commandTimeoutMs`, not an unbounded wait.
 */
class CdpConnection {
  #socket: WebSocket;
  #nextId = 1;
  #commandTimeoutMs: number;
  #pending = new Map<
    number,
    { method: string; resolve: (message: CdpMessage) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  #listeners = new Set<CdpListener>();
  #closed: Error | null = null;

  private constructor(socket: WebSocket, commandTimeoutMs: number) {
    this.#socket = socket;
    this.#commandTimeoutMs = commandTimeoutMs;
    this.#socket.addEventListener("message", (event: MessageEvent) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      let message: CdpMessage;
      try {
        message = JSON.parse(raw) as CdpMessage;
      } catch (error) {
        this.#break(new BrowserError(`DevTools sent a frame that is not JSON: ${(error as Error).message}`));
        return;
      }
      if (message.id !== undefined && this.#pending.has(message.id)) {
        const waiter = this.#pending.get(message.id);
        if (waiter === undefined) return;
        this.#pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error !== undefined) {
          waiter.reject(
            new BrowserError(`CDP ${waiter.method} failed: ${message.error.message} (code ${message.error.code})`),
          );
        } else {
          waiter.resolve(message);
        }
        return;
      }
      for (const listener of [...this.#listeners]) listener(message);
    });
    this.#socket.addEventListener("close", () => this.#break(new BrowserError("the DevTools socket closed")));
    this.#socket.addEventListener("error", () => this.#break(new BrowserError("the DevTools socket errored")));
  }

  static async open(url: string, timeoutMs: number, commandTimeoutMs: number): Promise<CdpConnection> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new BrowserError(`the DevTools socket at ${url} did not open within ${timeoutMs}ms`));
      }, timeoutMs);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new BrowserError(`the DevTools socket at ${url} could not be opened`));
        },
        { once: true },
      );
    });
    return new CdpConnection(socket, commandTimeoutMs);
  }

  /** Fail every outstanding command and stop delivering events. */
  #break(error: Error): void {
    if (this.#closed === null) this.#closed = error;
    for (const [id, waiter] of [...this.#pending]) {
      this.#pending.delete(id);
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  onMessage(listener: CdpListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  command<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (this.#closed !== null) return Promise.reject(this.#closed);
    return new Promise<T>((resolve, reject) => {
      const id = this.#nextId;
      this.#nextId += 1;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new BrowserError(`CDP ${method} did not answer within ${this.#commandTimeoutMs}ms`));
      }, this.#commandTimeoutMs);
      this.#pending.set(id, {
        method,
        timer,
        resolve: (message) => resolve((message.result ?? {}) as T),
        reject,
      });
      this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
    });
  }

  close(): void {
    // `close()` on a socket that is already CLOSING/CLOSED is a no-op in undici.
    try {
      this.#socket.close();
    } catch {
      // Nothing to do: the socket is gone, which is what `close()` wanted.
    }
  }
}

interface ElementPoint {
  readonly found: boolean;
  readonly reason?: string;
  readonly x?: number;
  readonly y?: number;
  readonly covered?: boolean;
  readonly atop?: string | null;
}

/** One page in the browser: a DevTools target with its own execution context. */
export class BrowserPage {
  readonly targetId: string;
  readonly sessionId: string;
  #connection: CdpConnection;
  #errors: PageError[] = [];
  #detach: () => void;
  #commandTimeoutMs: number;
  #navigateTimeoutMs: number;

  constructor(
    connection: CdpConnection,
    targetId: string,
    sessionId: string,
    commandTimeoutMs: number,
    navigateTimeoutMs: number,
  ) {
    this.#connection = connection;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.#commandTimeoutMs = commandTimeoutMs;
    this.#navigateTimeoutMs = navigateTimeoutMs;

    // Collect the two shapes a broken page reports, from the FIRST command on: the
    // Runtime/Log domains are enabled before the first navigation (see `start`).
    this.#detach = connection.onMessage((message) => {
      if (message.sessionId !== this.sessionId) return;
      if (message.method === "Runtime.exceptionThrown") {
        const details = (message.params?.exceptionDetails ?? {}) as Record<string, unknown>;
        const exception = (details.exception ?? {}) as Record<string, unknown>;
        const text =
          typeof exception.description === "string"
            ? exception.description
            : typeof details.text === "string"
              ? details.text
              : JSON.stringify(details);
        this.#errors.push({
          kind: "exception",
          text,
          url: typeof details.url === "string" ? details.url : null,
          source: "javascript",
        });
      }
      if (message.method === "Log.entryAdded") {
        const entry = (message.params?.entry ?? {}) as Record<string, unknown>;
        const level = typeof entry.level === "string" ? entry.level : "";
        if (level !== "error") return;
        this.#errors.push({
          kind: "log",
          text: typeof entry.text === "string" ? entry.text : JSON.stringify(entry),
          url: typeof entry.url === "string" ? entry.url : null,
          source: typeof entry.source === "string" ? entry.source : null,
        });
      }
    });
  }

  /** Enable Runtime + Log on this target BEFORE anything navigates. */
  async start(): Promise<void> {
    await this.#connection.command("Page.enable", {}, this.sessionId);
    await this.#connection.command("Runtime.enable", {}, this.sessionId);
    await this.#connection.command("Log.enable", {}, this.sessionId);
  }

  /** Every page error seen on this target since it was opened. */
  errors(): readonly PageError[] {
    return this.#errors;
  }

  async navigate(url: string): Promise<void> {
    const result = await this.#connection.command<{ errorText?: string }>(
      "Page.navigate",
      { url },
      this.sessionId,
    );
    if (typeof result.errorText === "string" && result.errorText !== "") {
      throw new BrowserError(`the browser refused to navigate to ${url}: ${result.errorText}`);
    }
    await this.waitFor('document.readyState === "complete"', {
      description: `the page at ${url} to finish loading`,
      timeoutMs: this.#navigateTimeoutMs,
    });
  }

  /**
   * Evaluate `expression` in THIS page's context and return its value.
   *
   * An exception inside the page is a LOUD failure carrying the page's own message —
   * never a silent `undefined`. `awaitPromise` is on, so an expression may return a
   * promise (which is how the cross-origin `fetch` is driven).
   */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.#connection.command<{
      result?: { value?: unknown };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, this.sessionId);
    if (result.exceptionDetails !== undefined) {
      const details = result.exceptionDetails;
      throw new BrowserError(
        `evaluating in the page threw: ${details.exception?.description ?? details.text ?? "unknown page exception"}`,
      );
    }
    return result.result?.value as T;
  }

  /**
   * Poll `expression` until it is truthy, or FAIL with a deadline.
   *
   * A protocol error (e.g. the execution context was destroyed mid-navigation) is
   * treated as "not ready YET" and its message is carried into the failure — it is
   * never swallowed, and there is no unbounded retry.
   */
  async waitFor(
    expression: string,
    options: { description: string; timeoutMs?: number },
  ): Promise<void> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    let last = "the expression was never evaluated";
    while (Date.now() < deadline) {
      try {
        const value = await this.evaluate<unknown>(expression);
        if (value) return;
        last = `the expression is falsy (${JSON.stringify(value)})`;
      } catch (error) {
        last = (error as Error).message;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new BrowserError(
      `timed out after ${timeoutMs}ms waiting for ${options.description}; last: ${last}`,
    );
  }

  /**
   * Click the `index`-th element matching `selector` with a TRUSTED mouse event.
   *
   * The element is located and measured with `Runtime.evaluate` (a read), then the
   * click itself is `Input.dispatchMouseEvent` — the same event a real mouse produces.
   * The measurement refuses to click an element with no box, an element whose centre is
   * outside the viewport, or an element COVERED by another one, so a trusted click can
   * never silently land on the wrong thing.
   */
  async click(selector: string, options: { index?: number; description?: string } = {}): Promise<void> {
    const index = options.index ?? 0;
    const description = options.description ?? `${selector}[${index}]`;
    await this.clickElement(
      `document.querySelectorAll(${JSON.stringify(selector)})[${index}] ?? null`,
      { description },
    );
  }

  /**
   * Click the element a JS expression produces, with a TRUSTED mouse event.
   *
   * This is the escape hatch for an element CSS cannot name — the console's key rows are
   * `<li>`s whose label lives in a text node, so "the Edit button of the row labelled X"
   * is not a selector. The LOOKUP is scripted; the CLICK is still `Input.*`, i.e. the
   * same trusted event a real mouse produces. A `null`/`undefined` result, a
   * zero-size box, an off-viewport centre or a covered element is a LOUD failure.
   */
  async clickElement(
    elementExpression: string,
    options: { description: string },
  ): Promise<void> {
    await this.bringToFront();
    const point = await this.#pointForElementExpression(elementExpression);
    if (!point.found) {
      throw new BrowserError(`cannot click ${options.description}: ${point.reason ?? "not found"}`);
    }
    if (point.covered === true) {
      throw new BrowserError(
        `cannot click ${options.description}: it is covered by ${point.atop ?? "another element"} at its centre`,
      );
    }
    const x = point.x as number;
    const y = point.y as number;
    await this.#connection.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
    }, this.sessionId);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.#connection.command(
        "Input.dispatchMouseEvent",
        { type, x, y, button: "left", clickCount: 1 },
        this.sessionId,
      );
    }
  }

  /**
   * Focus the `index`-th element matching `selector` (a trusted click) and REPLACE its
   * value with trusted input: Ctrl+A via `Input.dispatchKeyEvent`, then
   * `Input.insertText`. The resulting `value` is asserted, so a keystroke that did not
   * land is a failure rather than a later mystery.
   */
  async typeInto(
    selector: string,
    text: string,
    options: { index?: number; description?: string } = {},
  ): Promise<void> {
    const index = options.index ?? 0;
    const description = options.description ?? `${selector}[${index}]`;
    await this.click(selector, { index, description: `focus ${description}` });
    await this.#connection.command(
      "Input.dispatchKeyEvent",
      { type: "rawKeyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 },
      this.sessionId,
    );
    await this.#connection.command(
      "Input.dispatchKeyEvent",
      { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 },
      this.sessionId,
    );
    await this.#connection.command("Input.insertText", { text }, this.sessionId);
    const value = await this.evaluate<unknown>(
      `(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; return el === undefined ? null : el.value; })()`,
    );
    if (value !== text) {
      throw new BrowserError(
        `typing into ${description} did not take: expected the field value to be ` +
          `${JSON.stringify(text)}, got ${JSON.stringify(value)}`,
      );
    }
  }

  async #pointForElementExpression(elementExpression: string): Promise<ElementPoint> {
    const expression = `(() => {
      const el = (${elementExpression});
      if (el === undefined || el === null) return { found: false, reason: "no element matches" };
      if (!(el instanceof Element)) return { found: false, reason: "the expression did not produce an Element" };
      el.scrollIntoView({ block: "center", inline: "center" });
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        return { found: false, reason: "the element has no box (" + rect.width + "x" + rect.height + ")" };
      }
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
        return { found: false, reason: "the element's centre (" + x + "," + y + ") is outside the viewport after scrollIntoView" };
      }
      const top = document.elementFromPoint(x, y);
      const covered = !(top === el || el.contains(top) || (top !== null && top.contains(el)));
      const atop = top === null ? null : top.tagName + (top.id ? "#" + top.id : "");
      return { found: true, x, y, covered, atop };
    })()`;
    const point = await this.evaluate<ElementPoint>(expression);
    if (point === null || point === undefined) {
      throw new BrowserError("measuring a click target returned no measurement");
    }
    return point;
  }

  /**
   * Bring this page to the FRONT.
   *
   * Not cosmetic: `Target.createTarget` (a second console page, a cross-origin fixture)
   * makes the NEW target active and leaves this one in the background, and a browser
   * DEFERS trusted `Input.*` events aimed at a hidden page — measured on this box as a
   * 5001ms stall on every `Input.dispatchMouseEvent`. Every scripted CLICK therefore
   * activates its own page first, so a click can never be delayed by whichever page
   * another pin opened last.
   */
  async bringToFront(): Promise<void> {
    await this.#connection.command("Page.bringToFront", {}, this.sessionId);
  }

  /** Stop listening for this target's events (the target itself is closed by `close`). */
  dispose(): void {
    this.#detach();
  }
}

/** A launched Chrome and the DevTools session that drives it. */
export class Browser {
  readonly pid: number;
  readonly port: number;
  readonly webSocketUrl: string;
  readonly profileDir: string;
  readonly executablePath: string;

  #connection: CdpConnection;
  #child: ChildProcess;
  #pages: BrowserPage[] = [];
  #killGraceMs: number;
  #commandTimeoutMs: number;
  #navigateTimeoutMs: number;
  #killed = false;

  constructor(fields: {
    child: ChildProcess;
    pid: number;
    port: number;
    webSocketUrl: string;
    profileDir: string;
    executablePath: string;
    connection: CdpConnection;
    killGraceMs: number;
    commandTimeoutMs: number;
    navigateTimeoutMs: number;
  }) {
    this.#child = fields.child;
    this.pid = fields.pid;
    this.port = fields.port;
    this.webSocketUrl = fields.webSocketUrl;
    this.profileDir = fields.profileDir;
    this.executablePath = fields.executablePath;
    this.#connection = fields.connection;
    this.#killGraceMs = fields.killGraceMs;
    this.#commandTimeoutMs = fields.commandTimeoutMs;
    this.#navigateTimeoutMs = fields.navigateTimeoutMs;
  }

  /** Open a fresh page (its own target and origin) and optionally navigate it. */
  async openPage(url?: string): Promise<BrowserPage> {
    if (this.#killed) throw new BrowserError("this browser has already been killed");
    const created = await this.#connection.command<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
    });
    const attached = await this.#connection.command<{ sessionId: string }>("Target.attachToTarget", {
      targetId: created.targetId,
      flatten: true,
    });
    const page = new BrowserPage(
      this.#connection,
      created.targetId,
      attached.sessionId,
      this.#commandTimeoutMs,
      this.#navigateTimeoutMs,
    );
    await page.start();
    this.#pages.push(page);
    if (url !== undefined) await page.navigate(url);
    return page;
  }

  /** Is the browser's PROCESS GROUP still alive? */
  groupAlive(): boolean {
    return groupAlive(this.pid);
  }

  /**
   * Kill the whole process GROUP (SIGTERM, bounded grace, SIGKILL), delete the profile,
   * and fail if anything survived. Idempotent: the `afterAll` hook, a caller's failure
   * path and the `exit` net can all call it.
   */
  async kill(): Promise<void> {
    if (this.#killed) return;
    this.#killed = true;
    live.delete(this);
    for (const page of this.#pages) page.dispose();
    this.#pages = [];
    this.#connection.close();

    signalGroup(this.pid, "SIGTERM");
    const graceful = Date.now() + this.#killGraceMs;
    while (Date.now() < graceful && groupAlive(this.pid)) await sleep(POLL_INTERVAL_MS);
    if (groupAlive(this.pid)) signalGroup(this.pid, "SIGKILL");

    // A SIGKILL'd group is gone almost immediately; this bound exists so a kernel
    // reaping delay is waited out rather than reported as a leak.
    const hard = Date.now() + 2_000;
    while (Date.now() < hard && groupAlive(this.pid)) await sleep(POLL_INTERVAL_MS);

    rmSync(this.profileDir, { recursive: true, force: true });
    if (groupAlive(this.pid)) {
      throw new BrowserError(
        `the Chrome process group ${this.pid} is STILL alive after SIGKILL — nothing ` +
          "outlives this suite, so this is a failure rather than a note",
      );
    }
  }
}

/** Every browser this module has launched and not yet killed. */
const live = new Set<Browser>();

/** Signal a whole process group; ESRCH (already gone) is not an error. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/** `true` when the process group exists (EPERM means it exists but is not ours to signal). */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Resolve the browser binary, or throw the NAMED error pin B8 asserts.
 *
 * `accessSync` is the check rather than `existsSync`: a path that exists but is not
 * executable cannot be launched either, and calling that "present" would turn the loud
 * failure into a confusing spawn error.
 */
export function resolveChromePath(executablePath?: string): string {
  const path = executablePath ?? CHROME_PATH;
  try {
    accessSync(path, constants.X_OK);
  } catch (error) {
    throw new BrowserMissingError(path, (error as Error).message);
  }
  return path;
}

/**
 * Launch Chrome headless and connect to its browser-level DevTools endpoint.
 *
 * The debugging port is `0` — the OS picks a free one — and the chosen port is read
 * back from the `DevToolsActivePort` file Chrome writes into the temp profile, which is
 * the robust way (a chosen fixed port races, and this box runs other sessions).
 */
export async function launchBrowser(options: BrowserLaunchOptions = {}): Promise<Browser> {
  const executablePath = resolveChromePath(options.executablePath);
  const scratchRoot = options.scratchRoot ?? DEFAULT_SCRATCH_ROOT;
  const launchTimeoutMs = options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
  const commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

  mkdirSync(scratchRoot, { recursive: true });
  const profileDir = mkdtempSync(join(scratchRoot, "chrome-"));
  const child = spawn(
    executablePath,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    // DETACHED: the child becomes the leader of its OWN process group, which is the
    // only handle that can kill Chrome's whole tree (zygote, GPU, renderers).
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );

  let output = "";
  let exited = false;
  child.stdout?.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-8_192);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-8_192);
  });
  child.once("exit", () => {
    exited = true;
  });

  if (child.pid === undefined) {
    rmSync(profileDir, { recursive: true, force: true });
    throw new BrowserError(`spawning ${executablePath} produced no pid`);
  }
  const pid = child.pid;

  const portFile = join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + launchTimeoutMs;
  let port: number | null = null;
  while (Date.now() < deadline) {
    if (exited) break;
    if (existsSync(portFile)) {
      const text = readFileSync(portFile, "utf8").trim();
      const first = text.split("\n")[0];
      if (first !== undefined && first !== "") {
        port = Number(first);
        break;
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (port === null || !Number.isInteger(port) || port <= 0) {
    signalGroup(pid, "SIGKILL");
    rmSync(profileDir, { recursive: true, force: true });
    throw new BrowserError(
      `${executablePath} did not write a usable DevToolsActivePort within ${launchTimeoutMs}ms ` +
        `(exited=${exited}); its output was: ${output === "" ? "<empty>" : output}`,
    );
  }

  let webSocketUrl: string;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const version = (await response.json()) as { webSocketDebuggerUrl?: string };
    if (typeof version.webSocketDebuggerUrl !== "string" || version.webSocketDebuggerUrl === "") {
      throw new Error("the /json/version body carries no webSocketDebuggerUrl");
    }
    webSocketUrl = version.webSocketDebuggerUrl;
  } catch (error) {
    signalGroup(pid, "SIGKILL");
    rmSync(profileDir, { recursive: true, force: true });
    throw new BrowserError(
      `the DevTools endpoint on 127.0.0.1:${port} could not be read: ${(error as Error).message}`,
    );
  }

  let connection: CdpConnection;
  try {
    connection = await CdpConnection.open(webSocketUrl, launchTimeoutMs, commandTimeoutMs);
  } catch (error) {
    signalGroup(pid, "SIGKILL");
    rmSync(profileDir, { recursive: true, force: true });
    throw error;
  }

  const browser = new Browser({
    child,
    pid,
    port,
    webSocketUrl,
    profileDir,
    executablePath,
    connection,
    killGraceMs,
    commandTimeoutMs,
    navigateTimeoutMs: DEFAULT_NAVIGATE_TIMEOUT_MS,
  });
  live.add(browser);
  return browser;
}

/**
 * Kill every live browser. Call this from a failure path (and it is what the `afterAll`
 * hook below runs), so no error route can skip the cleanup.
 */
export async function killAllBrowsers(): Promise<void> {
  const pending = [...live];
  live.clear();
  const failures: string[] = [];
  for (const browser of pending) {
    try {
      await browser.kill();
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  if (failures.length > 0) {
    throw new BrowserError(`browser cleanup failed:\n${failures.join("\n")}`);
  }
}

/** The pids of every live browser — for a report and for a test that must count them. */
export function liveBrowserPids(): number[] {
  return [...live].map((browser) => browser.pid);
}

// THE FAILURE PATH. Importing this module registers the cleanup, so a caller cannot
// forget it; running from `afterAll` means an exception ANYWHERE in the file still
// kills the tree before the worker exits.
afterAll(killAllBrowsers);

// The last-resort net for an abrupt exit, where no hook runs: only synchronous work is
// possible here, so it SIGKILLs each group outright. `kill()` is idempotent and has
// already removed the ones it handled.
process.once("exit", () => {
  for (const browser of live) signalGroup(browser.pid, "SIGKILL");
});
