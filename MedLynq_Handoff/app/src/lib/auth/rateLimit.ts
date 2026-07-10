// Minimal in-memory rate limiter (sliding-window counter).
//
// Sufficient for single-instance deploys. When MedLynq scales to multiple Next
// instances behind a load balancer, swap the Map for Redis (Upstash, Redis Cloud).
// The function signature stays identical — only the storage changes.
//
// Usage in a route:
//   const rl = await rateLimit({ key: `nhcx:${session.user.id}`, limit: 10, windowMs: 60_000 });
//   if (!rl.ok) return rl.response;

import { NextResponse } from "next/server";

type Bucket = { count: number; resetAt: number };

const BUCKETS = new Map<string, Bucket>();

// Periodic cleanup so the Map doesn't grow forever
const CLEANUP_INTERVAL_MS = 60_000;
let _lastCleanup = Date.now();
function maybeCleanup(now: number) {
  if (now - _lastCleanup < CLEANUP_INTERVAL_MS) return;
  _lastCleanup = now;
  for (const [k, b] of BUCKETS) {
    if (b.resetAt < now) BUCKETS.delete(k);
  }
}

export type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; response: NextResponse; remaining: 0; resetAt: number };

export function rateLimit(opts: {
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();
  maybeCleanup(now);

  let b = BUCKETS.get(opts.key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + opts.windowMs };
    BUCKETS.set(opts.key, b);
  }
  b.count++;

  if (b.count > opts.limit) {
    const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return {
      ok: false,
      remaining: 0,
      resetAt: b.resetAt,
      response: NextResponse.json(
        {
          ok: false,
          error: `Rate limit exceeded — ${opts.limit} requests per ${opts.windowMs / 1000}s. Retry in ${retryAfterSec}s.`,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSec),
            "X-RateLimit-Limit": String(opts.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(b.resetAt / 1000)),
          },
        }
      ),
    };
  }

  return { ok: true, remaining: opts.limit - b.count, resetAt: b.resetAt };
}

/** Get the client IP from request headers (X-Forwarded-For first, fallback to direct). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
