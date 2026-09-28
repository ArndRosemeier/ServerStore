/**
 * The ONE error surface.
 *
 * Every failure the API reports carries a stable code, and every code maps to
 * exactly one HTTP status here. Nothing else in the codebase builds an error
 * response; a new failure mode adds a code to this table.
 */

export const ERROR_CODES = [
  "bad_request",
  "invalid_name",
  "invalid_body",
  "invalid_scope",
  "payload_too_large",
  "unauthorized",
  "forbidden",
  "not_found",
  "rate_limited",
  "store_exists",
  "name_taken",
  // 409 — the request was understood and is well-formed, but the STATE forbids it: the
  // last live admin key cannot be deleted, and a store cannot be deleted while a key's
  // scope names it (ledger row 70(b)/(c)). Distinct from `store_exists` (a creation
  // collision) on purpose: a client branches on the code, and "it already exists" is not
  // "this is refused until something else changes".
  "conflict",
  "unsupported_store_kind",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  invalid_name: 400,
  invalid_body: 400,
  invalid_scope: 400,
  payload_too_large: 413,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  // 429 — the limiter refused this client for now. The response carries `Retry-After`
  // (ledger row 64f); it is the only code emitted from a middleware rather than a route,
  // because the limiter runs in FRONT of the key guard (row 64a).
  rate_limited: 429,
  store_exists: 409,
  name_taken: 409,
  conflict: 409,
  unsupported_store_kind: 500,
  internal: 500,
};

export class StoreError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.status = STATUS[code];
  }
}

/** The single JSON error body shape. `{ error: { code, message } }`. */
export function errorBody(code: ErrorCode, message: string): {
  error: { code: ErrorCode; message: string };
} {
  return { error: { code, message } };
}

/** Normalise anything thrown into the one error surface. */
export function toStoreError(thrown: unknown): StoreError {
  if (thrown instanceof StoreError) return thrown;
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  return new StoreError("internal", message);
}
