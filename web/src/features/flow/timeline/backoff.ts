/**
 * Pure capped-exponential-backoff-with-jitter scheduler (05-RESEARCH Pattern 4).
 *
 * nextDelay(attempt, opts, rng) is a PURE function — no timers, no Date.now,
 * no side effects. The timer-driving loop lives in the calling hook (Plan 03).
 * Deterministic under an injected rng (default: Math.random) for unit tests.
 *
 * Formula (full-jitter, AWS "Exponential Backoff And Jitter"):
 *   ceiling = min(maxMs, baseMs * factor^attempt)
 *   delay   = floor(rng() * ceiling)
 *
 * Convention (Pitfall 5): attempt index 0..N-1 into nextDelay; badge shows 1..N.
 *
 * Numbers from UI-SPEC IC-2 (locked):
 *   base 1000ms, factor 2, maxDelay 30000ms, cap N=5.
 */

/** Configuration for the backoff scheduler. */
export type BackoffOpts = {
  /** Base delay in milliseconds (attempt 0 ceiling). */
  baseMs: number
  /** Exponential growth factor per attempt. */
  factor: number
  /** Maximum delay cap in milliseconds. */
  maxMs: number
  /** Maximum number of reconnect attempts (1-indexed badge: 1..cap). */
  cap: number
}

/** Default backoff constants (UI-SPEC IC-2 / 05-RESEARCH Pattern 4, locked). */
export const DEFAULT_BACKOFF: BackoffOpts = {
  baseMs: 1000,
  factor: 2,
  maxMs: 30_000,
  cap: 5,
}

/**
 * Returns the next delay (ms) for the given attempt index using full-jitter.
 *
 * @param attempt - Zero-based attempt index (0..cap-1).
 * @param opts    - Backoff configuration (defaults to DEFAULT_BACKOFF).
 * @param rng     - Random number generator in [0, 1) (default: Math.random).
 * @returns       - Integer delay in ms, in [0, min(maxMs, baseMs*factor^attempt)).
 */
export function nextDelay(
  attempt: number,
  opts: BackoffOpts = DEFAULT_BACKOFF,
  rng: () => number = Math.random,
): number {
  const ceiling = Math.min(opts.maxMs, opts.baseMs * opts.factor ** attempt)
  return Math.floor(rng() * ceiling)
}
