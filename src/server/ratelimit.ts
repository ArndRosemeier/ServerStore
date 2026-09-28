/**
 * The rate limiter — ONE bounded, in-memory, per-IDENTITY fixed window.
 *
 * Ledger rows 64 (the design) and 65 (this landing). The problem it exists for is
 * not "count requests": since rows 57/58 this API answers browsers from any origin on
 * a public hostname whose only perimeter is a key (rows 21/43), and nothing bounds
 * request volume. The two properties that make it more than a counter are:
 *
 * 1. **The clock is INJECTED** (`now`, milliseconds) — never `Date.now()` here. A pin
 *    freezes the clock, drives the exact boundary (the Nth request passes, the N+1th is
 *    refused) and advances the window to watch it recover, so the boundary is proved
 *    DETERMINISTICALLY instead of by generating load (the host rule forbids synthetic
 *    load against the live service).
 * 2. **The bucket table is HARD-CAPPED.** The key is a CLIENT-SUPPLIED header value, so
 *    an unbounded `Map` keyed by it is itself a denial-of-service vector: a flood of
 *    distinct spoofed identities would grow it without limit. The cap plus a sweep of
 *    expired buckets plus least-recently-used eviction bounds the memory, and — because
 *    a USED bucket is re-inserted (recency refresh) — eviction takes COLD identities
 *    first, so a flooding identity keeps its bucket and is still refused. A cap that
 *    silently forgot the flooding identity would be a limiter that stops limiting.
 *
 * `limit === 0` is the operator KILL-SWITCH: `check` always allows and no bucket is
 * ever created. The window is a fixed 60 s in v1 (not configurable — say so rather than
 * leaving a knob nobody set).
 *
 * Node stdlib only, and no third-party limiter: this is tens of lines, and its whole
 * value here is the bounded table, the injected clock and an exact exemption list —
 * all of which must be wired and pinned anyway. An off-the-shelf package would add
 * moving parts to the security-relevant request path and save almost no pinning work.
 */

/**
 * The default bucket-table cap. A judgement, not a measurement: it bounds worst-case
 * memory at roughly `maxBuckets × MAX_IDENTITY_LENGTH` bytes of keys plus the counts,
 * while comfortably holding the distinct client addresses a small public service sees
 * in one window.
 */
export const DEFAULT_MAX_BUCKETS = 4096;

/**
 * The longest identity that is used as a bucket key.
 *
 * An identity is an IP address: 45 characters is the longest legal IPv6 textual form,
 * so 64 is generous and a legitimate caller is never truncated. An over-long value —
 * only a spoof attempt or a proxy chain — shares a bucket with any other value carrying
 * the same 64-character prefix. That is the FAIL-CLOSED direction (they are limited
 * sooner, never later), and it is what keeps the key LENGTH from inflating the table
 * the cap is supposed to bound.
 */
export const MAX_IDENTITY_LENGTH = 64;

/**
 * The identity every request without a usable forwarding header shares — an in-process
 * test, or a direct loopback caller. NEVER the peer socket address: the unit binds
 * loopback and the only ingress is cloudflared, so the socket address is always the
 * tunnel and would put every caller on Earth in one bucket.
 */
export const LOCAL_IDENTITY = "local";

export interface RateLimiterOptions {
  /** Requests allowed per identity per window. `0` disables the limiter entirely. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Injectable clock, milliseconds since epoch. */
  readonly now: () => number;
  /** Hard cap on live buckets. Defaults to {@link DEFAULT_MAX_BUCKETS}. */
  readonly maxBuckets?: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /**
   * Seconds to wait, an integer in `[1, windowSeconds]`. It is only READ (and only sent
   * as `Retry-After`) when `allowed` is false; an allowed request carries it for
   * symmetry and the app never puts it on a success response.
   */
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  /** One request from `identity`. Never reads a body and never awaits anything. */
  check(identity: string): RateLimitDecision;
  /** Live buckets right now — the observation surface pin R6 asserts the cap with. */
  readonly bucketCount: number;
}

interface Bucket {
  /** Requests ADMITTED in this window. `limit` admitted means the next one is refused. */
  count: number;
  /** When this window rolls, milliseconds since epoch. */
  resetAt: number;
}

/** A factory argument is a boundary: validate it rather than coercing. */
function assertInteger(value: number, name: string, minimum: number): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}; got ${JSON.stringify(value)}`);
  }
}

/** The bucket key: a bounded-size slice of an attacker-controlled string. */
function bucketKey(identity: string): string {
  return identity.length <= MAX_IDENTITY_LENGTH
    ? identity
    : identity.slice(0, MAX_IDENTITY_LENGTH);
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  assertInteger(options.limit, "limit", 0);
  assertInteger(options.windowMs, "windowMs", 1);
  const maxBuckets = options.maxBuckets ?? DEFAULT_MAX_BUCKETS;
  assertInteger(maxBuckets, "maxBuckets", 1);
  const { limit, windowMs, now } = options;

  const windowSeconds = Math.ceil(windowMs / 1000);
  const buckets = new Map<string, Bucket>();

  /** Clamp into `[1, windowSeconds]`: an integer ≥ 1, never longer than the window. */
  const retryAfterSeconds = (resetAt: number, at: number): number => {
    const remaining = Math.ceil((resetAt - at) / 1000);
    return Math.min(windowSeconds, Math.max(1, remaining));
  };

  /** Drop every bucket whose window has rolled — the cheap half of staying bounded. */
  const sweepExpired = (at: number): void => {
    for (const [key, bucket] of buckets) {
      if (at >= bucket.resetAt) buckets.delete(key);
    }
  };

  /**
   * Drop the LEAST RECENTLY USED bucket. `Map` preserves insertion order and `touch()`
   * re-inserts a bucket on every request it serves, so the first key is the coldest —
   * a flooding identity, which is touched constantly, is evicted LAST.
   */
  const evictOldest = (): void => {
    const oldest = buckets.keys().next();
    if (!oldest.done) buckets.delete(oldest.value);
  };

  const touch = (key: string, bucket: Bucket): void => {
    buckets.delete(key);
    buckets.set(key, bucket);
  };

  return {
    check(identity: string): RateLimitDecision {
      const at = now();
      const key = bucketKey(identity);
      if (limit === 0) {
        // The kill-switch: no bucket, no refusal, no memory.
        return { allowed: true, retryAfterSeconds: windowSeconds };
      }

      const existing = buckets.get(key);
      // The window ROLLS at `resetAt` (inclusive): at exactly the boundary this is a
      // new window, which is what pin R3 advances the clock to.
      const expired = existing !== undefined && at >= existing.resetAt;
      if (existing !== undefined && !expired) {
        touch(key, existing);
        if (existing.count >= limit) {
          return { allowed: false, retryAfterSeconds: retryAfterSeconds(existing.resetAt, at) };
        }
        existing.count += 1;
        return { allowed: true, retryAfterSeconds: retryAfterSeconds(existing.resetAt, at) };
      }

      if (expired) buckets.delete(key);
      // Make room BEFORE inserting, so the table is never one entry over the cap.
      sweepExpired(at);
      if (buckets.size >= maxBuckets) evictOldest();
      const bucket: Bucket = { count: 1, resetAt: at + windowMs };
      buckets.set(key, bucket);
      return { allowed: true, retryAfterSeconds: retryAfterSeconds(bucket.resetAt, at) };
    },

    get bucketCount(): number {
      return buckets.size;
    },
  };
}

/**
 * The identity of a request, in ONE place and ONE order:
 *
 * 1. `CF-Connecting-IP` — the tunnel's own header, the real client address;
 * 2. else the FIRST hop of `X-Forwarded-For` — the client's own leftmost entry, so a
 *    caller cannot evade the limit by appending a second hop;
 * 3. else the single shared {@link LOCAL_IDENTITY}.
 *
 * An empty or whitespace-only header is NOT an identity and falls through to the next
 * source, rather than becoming a bucket keyed by "".
 *
 * The PEER SOCKET ADDRESS IS NEVER USED, deliberately. The unit binds loopback
 * (`AGENTS.md` GUARD g1) and the only ingress is cloudflared, so the peer is always the
 * tunnel: keying on it would put every caller on Earth in one bucket. Do not "fix" this
 * later. The consequence is stated, not hidden (ledger row 64b): a process ON this box
 * can spoof either header and evade the limit — acceptable, because such a process could
 * already reach loopback directly, and the tunnel is the only path from outside.
 */
export function clientIdentity(request: Request): string {
  const connectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (connectingIp !== undefined && connectingIp !== "") return connectingIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor !== null) {
    const firstHop = forwardedFor.split(",")[0]?.trim();
    if (firstHop !== undefined && firstHop !== "") return firstHop;
  }

  return LOCAL_IDENTITY;
}
