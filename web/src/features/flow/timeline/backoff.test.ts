import { describe, it, expect } from 'vitest'
import { nextDelay, DEFAULT_BACKOFF, type BackoffOpts } from './backoff'

/**
 * Unit tests for the pure capped-exponential-backoff-with-jitter scheduler (05-02).
 *
 * nextDelay(attempt, opts, rng) is PURE — no timers, no Date.now, no side effects.
 * All timing behavior is deterministic under the injected rng.
 *
 * Numbers from UI-SPEC IC-2 / 05-RESEARCH Pattern 4:
 *   base 1000ms, factor 2, maxDelay 30000ms, cap N=5, full-jitter
 *   delay = floor(rng() * min(maxMs, baseMs * factor^attempt))
 * Convention (Pitfall 5): attempt index 0..N-1 into nextDelay; badge shows 1..N.
 */

describe('DEFAULT_BACKOFF', () => {
  it('exports the locked backoff constants', () => {
    expect(DEFAULT_BACKOFF).toEqual({
      baseMs: 1000,
      factor: 2,
      maxMs: 30_000,
      cap: 5,
    })
  })
})

describe('nextDelay — lower bound (rng=()=>0)', () => {
  const zero = () => 0

  it('returns 0 at attempt 0 when rng=0', () => {
    expect(nextDelay(0, DEFAULT_BACKOFF, zero)).toBe(0)
  })

  it('returns 0 at every attempt when rng=0', () => {
    for (let i = 0; i < DEFAULT_BACKOFF.cap; i++) {
      expect(nextDelay(i, DEFAULT_BACKOFF, zero)).toBe(0)
    }
  })
})

describe('nextDelay — ceiling growth (full-jitter: delay in [0, ceiling))', () => {
  // rng close to 1 → delay near ceiling-1
  const nearOne = () => 0.9999

  it('attempt 0: ceiling = base = 1000; delay < 1000', () => {
    const d = nextDelay(0, DEFAULT_BACKOFF, nearOne)
    expect(d).toBeGreaterThanOrEqual(0)
    expect(d).toBeLessThan(1000)
  })

  it('attempt 1: ceiling = base*factor^1 = 2000; delay < 2000', () => {
    const d = nextDelay(1, DEFAULT_BACKOFF, nearOne)
    expect(d).toBeGreaterThanOrEqual(0)
    expect(d).toBeLessThan(2000)
  })

  it('attempt 2: ceiling = 4000; delay < 4000', () => {
    const d = nextDelay(2, DEFAULT_BACKOFF, nearOne)
    expect(d).toBeLessThan(4000)
  })

  it('ceiling clamps at maxMs=30000 for large attempt', () => {
    // base*2^attempt > 30000 when attempt >= ceil(log2(30)) = 5
    const bigAttempt = 10
    const d = nextDelay(bigAttempt, DEFAULT_BACKOFF, nearOne)
    expect(d).toBeLessThan(DEFAULT_BACKOFF.maxMs)
    expect(d).toBeGreaterThanOrEqual(0)
  })

  it('delay never exceeds maxMs regardless of attempt', () => {
    const almostOne = () => 0.99999
    for (let i = 0; i <= 20; i++) {
      const d = nextDelay(i, DEFAULT_BACKOFF, almostOne)
      expect(d).toBeLessThan(DEFAULT_BACKOFF.maxMs)
    }
  })
})

describe('nextDelay — integer output', () => {
  it('always returns an integer (Math.floor applied)', () => {
    const fractional = () => 0.7777
    for (let i = 0; i < DEFAULT_BACKOFF.cap; i++) {
      const d = nextDelay(i, DEFAULT_BACKOFF, fractional)
      expect(Number.isInteger(d)).toBe(true)
    }
  })
})

describe('nextDelay — custom opts', () => {
  const opts: BackoffOpts = { baseMs: 500, factor: 3, maxMs: 10_000, cap: 4 }

  it('respects custom base: attempt 0 ceiling = 500', () => {
    const d = nextDelay(0, opts, () => 0.5)
    // ceiling = min(10000, 500*3^0) = 500; delay = floor(0.5 * 500) = 250
    expect(d).toBe(250)
  })

  it('respects custom factor: attempt 1 ceiling = 500*3 = 1500', () => {
    const d = nextDelay(1, opts, () => 0.5)
    // ceiling = min(10000, 500*3^1) = 1500; delay = floor(0.5 * 1500) = 750
    expect(d).toBe(750)
  })

  it('clamps to custom maxMs: attempt 3 ceiling = min(10000, 500*27) = 10000', () => {
    const d = nextDelay(3, opts, () => 0.5)
    // 500*3^3 = 13500 > 10000 → clamp to 10000; delay = floor(0.5*10000) = 5000
    expect(d).toBe(5000)
  })
})
