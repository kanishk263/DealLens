/**
 * Maps database/API errors to messages that are safe to show users. Messages raised by DealLens
 * database functions (SQLSTATE 42501/22023/P0002/55000) are authored to be user-facing; anything
 * else is replaced by a generic message and logged server-side without sensitive payloads.
 */
const SAFE_CODES = new Set(["42501", "22023", "P0002", "55000", "23514"]);

export interface ErrorLike {
  code?: string;
  message?: string;
}

export function safeErrorMessage(error: ErrorLike | null | undefined, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  if (error.code === "23505") return "This record already exists or the action was already performed.";
  if (error.code === "23514") return "The submitted values do not satisfy validation rules.";
  if (error.code && SAFE_CODES.has(error.code) && error.message) return error.message;
  return fallback;
}

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

export function fail(error: ErrorLike | null | undefined, fallback?: string): { ok: false; error: string } {
  if (error && !(error.code && SAFE_CODES.has(error.code))) {
    console.error("[deallens] operation failed", { code: error.code });
  }
  return { ok: false, error: safeErrorMessage(error, fallback) };
}
