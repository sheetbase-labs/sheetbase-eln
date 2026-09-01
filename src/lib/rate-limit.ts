/**
 * PLAT-03 — bounded request rate limiting for unauthenticated-abuse surfaces
 * (the same-origin data proxy and the file byte routes; credential exchange
 * already has its own per-prefix limiter).
 *
 * Fixed-window in-memory counter keyed by `scope:principal`. The deployment
 * topology is a single app container (see docs/operations/deployment.md), so in-memory
 * state is the correct scope; if the topology ever becomes multi-instance,
 * the counter moves behind the same interface.
 *
 * Posture: fail-open. An internal limiter error must never take the API down;
 * rate limiting bounds abuse, it is not an availability control. Rejected
 * requests return the existing public `rate_limited` envelope (429) and are
 * observable through the PLAT-02 metrics `rate_limited` category and a warn
 * log line — never with the principal's identifiers.
 */

export interface RateLimitDecision {
  allowed: boolean
  /** Seconds until the current window resets (present when blocked). */
  retryAfterSeconds?: number
}

export interface RateLimiter {
  hit: (key: string, now?: number) => RateLimitDecision
}

export interface RateLimitOptions {
  maxRequests: number
  windowSeconds: number
}

export const RATE_LIMIT_SCOPE_DB = 'db'
export const RATE_LIMIT_SCOPE_FILES = 'files'

/** Creates one fixed-window limiter. Windows are UTC-aligned epoch buckets. */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { maxRequests, windowSeconds } = options
  const counters = new Map<string, { window: number; count: number }>()

  return {
    hit(key: string, now: number = Date.now()): RateLimitDecision {
      const window = Math.floor(now / 1000 / windowSeconds)
      const entry = counters.get(key)
      if (!entry || entry.window !== window) {
        // Bound memory: drop stale entries opportunistically.
        if (counters.size > 10_000) {
          for (const [k, v] of counters) {
            if (v.window < window) counters.delete(k)
          }
        }
        counters.set(key, { window, count: 1 })
        return { allowed: true }
      }
      entry.count += 1
      if (entry.count > maxRequests) {
        return {
          allowed: false,
          retryAfterSeconds: windowSeconds - Math.floor((now / 1000) % windowSeconds),
        }
      }
      return { allowed: true }
    },
  }
}

/**
 * Resolves the configuration from validated server env with safe defaults.
 * Exposed for the proxy wiring; tests inject their own limiter directly.
 */
export function defaultRateLimitOptions(envSource: {
  SHEETBASE_RATE_LIMIT_MAX?: number
  SHEETBASE_RATE_LIMIT_WINDOW_SECONDS?: number
}): RateLimitOptions {
  return {
    maxRequests: envSource.SHEETBASE_RATE_LIMIT_MAX ?? 600,
    windowSeconds: envSource.SHEETBASE_RATE_LIMIT_WINDOW_SECONDS ?? 60,
  }
}
