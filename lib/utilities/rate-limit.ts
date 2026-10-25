/**
 * Fixed-window in-memory rate limiter for sensitive operations (uploads, downloads).
 * Limitation: state is per server instance; a multi-instance deployment should back this with a
 * shared store (e.g. Redis/Upstash). Database-level constraints remain the real protection.
 */
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    return { allowed: true, retryAfter: 0 };
  }
  b.count += 1;
  return b.count > limit ? { allowed: false, retryAfter: Math.ceil((b.reset - now) / 1000) } : { allowed: true, retryAfter: 0 };
}
