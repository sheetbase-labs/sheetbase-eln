/**
 * Failed-attempt lockout for credential exchange. Tracks failures per
 * credential prefix; after `maxFailures` failures the prefix is locked for
 * `lockMs`. A success clears the prefix. In memory, because the deployment
 * runs one server process.
 *
 * The prefix comes from the caller, so a stream of made-up prefixes would
 * otherwise leave one entry each for the life of the process. Expired entries
 * are swept out once the store passes `sweepAbove` entries, at most once per
 * `sweepEveryMs`, so memory is bounded by the failures inside one window.
 */
export interface CredentialRateLimitOptions {
  maxFailures?: number
  windowMs?: number
  lockMs?: number
  sweepAbove?: number
  sweepEveryMs?: number
}

export interface CredentialRateLimiter {
  /** True when the prefix is locked out right now. */
  isLocked: (prefix: string, now?: number) => boolean
  recordFailure: (prefix: string, now?: number) => void
  clear: (prefix: string) => void
  /** Entries currently held; for tests and diagnostics. */
  size: () => number
}

interface Bucket {
  failures: number
  lastFailureAt: number
  lockedUntil: number
}

export function createCredentialRateLimiter(
  options: CredentialRateLimitOptions = {},
): CredentialRateLimiter {
  const maxFailures = options.maxFailures ?? 5
  const windowMs = options.windowMs ?? 15 * 60 * 1000
  const lockMs = options.lockMs ?? 15 * 60 * 1000
  const sweepAbove = options.sweepAbove ?? 1_000
  const sweepEveryMs = options.sweepEveryMs ?? 60 * 1000
  const buckets = new Map<string, Bucket>()
  let lastSweepAt = Number.NEGATIVE_INFINITY

  const expired = (bucket: Bucket, now: number) =>
    bucket.lockedUntil <= now && bucket.lastFailureAt < now - windowMs

  function sweep(now: number) {
    if (buckets.size <= sweepAbove || now - lastSweepAt < sweepEveryMs) return
    lastSweepAt = now

    for (const [prefix, bucket] of buckets) {
      if (expired(bucket, now)) buckets.delete(prefix)
    }
  }

  return {
    isLocked(prefix, now = Date.now()) {
      const bucket = buckets.get(prefix)

      if (!bucket) return false

      if (bucket.lockedUntil > now) return true

      if (bucket.lastFailureAt < now - windowMs) buckets.delete(prefix)

      return false
    },
    recordFailure(prefix, now = Date.now()) {
      sweep(now)

      const bucket = buckets.get(prefix) ?? {
        failures: 0,
        lastFailureAt: now,
        lockedUntil: 0,
      }

      bucket.failures += 1
      bucket.lastFailureAt = now

      if (bucket.failures >= maxFailures) bucket.lockedUntil = now + lockMs
      buckets.set(prefix, bucket)
    },
    clear(prefix) {
      buckets.delete(prefix)
    },
    size: () => buckets.size,
  }
}
