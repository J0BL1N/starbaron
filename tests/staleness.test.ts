import { describe, expect, it } from 'vitest'
import {
  AGING_WINDOW_SECONDS,
  FRESH_WINDOW_SECONDS,
  STALE_WINDOW_SECONDS,
  applyDecay,
  decayedLevel,
  freshnessFor,
  needsRescout,
  stalenessSummary,
} from '../src/sim/intel/staleness'
import * as staleness from '../src/sim/intel/staleness'
import type { Freshness } from '../src/sim/intel/staleness'
import { INTEL_LEVEL_RANK } from '../src/sim/intel/levels'
import type { IntelLevel, TargetIntel } from '../src/sim/intel/levels'

const HOUR_MS = 60 * 60 * 1000
const BASE = 1_000_000_000

function target(overrides: Partial<TargetIntel> = {}): TargetIntel {
  return {
    targetId: 'body:slug|alpha|planet|1',
    level: 'scanned',
    lastUpdatedAt: BASE,
    sources: [],
    ...overrides,
  }
}

/** A reference timestamp inside each freshness band: 0 / 12h / 48h / 72h. */
function stampFor(freshness: Freshness, base: number): number {
  switch (freshness) {
    case 'fresh':
      return base
    case 'aging':
      return base + 12 * HOUR_MS
    case 'stale':
      return base + 48 * HOUR_MS
    case 'expired':
      return base + 72 * HOUR_MS
  }
}

const LADDER: readonly IntelLevel[] = [
  'none',
  'observed',
  'scanned',
  'scouted',
  'deep recon',
  'full intelligence',
]

const FRESHNESSES: readonly Freshness[] = ['fresh', 'aging', 'stale', 'expired']

/** The hand-computed decay table: [stored level, freshness, decayed level]. */
const DECAY_TABLE: ReadonlyArray<readonly [IntelLevel, Freshness, IntelLevel]> = [
  ['none', 'fresh', 'none'],
  ['none', 'aging', 'none'],
  ['none', 'stale', 'none'],
  ['none', 'expired', 'none'],
  ['observed', 'fresh', 'observed'],
  ['observed', 'aging', 'none'],
  ['observed', 'stale', 'none'],
  ['observed', 'expired', 'none'],
  ['scanned', 'fresh', 'scanned'],
  ['scanned', 'aging', 'observed'],
  ['scanned', 'stale', 'none'],
  ['scanned', 'expired', 'none'],
  ['scouted', 'fresh', 'scouted'],
  ['scouted', 'aging', 'scanned'],
  ['scouted', 'stale', 'observed'],
  ['scouted', 'expired', 'none'],
  ['deep recon', 'fresh', 'deep recon'],
  ['deep recon', 'aging', 'scouted'],
  ['deep recon', 'stale', 'scanned'],
  ['deep recon', 'expired', 'none'],
  ['full intelligence', 'fresh', 'full intelligence'],
  ['full intelligence', 'aging', 'deep recon'],
  ['full intelligence', 'stale', 'scouted'],
  ['full intelligence', 'expired', 'none'],
]

describe('P6-T06 decay thresholds — the model constants', () => {
  it('carries the three balance-harness windows in seconds: 6h / 24h / 72h', () => {
    expect(FRESH_WINDOW_SECONDS).toBe(6 * 60 * 60)
    expect(AGING_WINDOW_SECONDS).toBe(24 * 60 * 60)
    expect(STALE_WINDOW_SECONDS).toBe(72 * 60 * 60)
  })

  it('ascends fresh < aging < stale and is deep-frozen (primitive consts)', () => {
    expect(FRESH_WINDOW_SECONDS).toBeLessThan(AGING_WINDOW_SECONDS)
    expect(AGING_WINDOW_SECONDS).toBeLessThan(STALE_WINDOW_SECONDS)
    expect(Object.isFrozen(FRESH_WINDOW_SECONDS)).toBe(true)
    expect(Object.isFrozen(AGING_WINDOW_SECONDS)).toBe(true)
    expect(Object.isFrozen(STALE_WINDOW_SECONDS)).toBe(true)
  })

  it('drops the draft EXPIRED_AFTER_SECONDS constant — expiry is the stale window', () => {
    const secondsConsts = Object.keys(staleness).filter((key) =>
      key.endsWith('_SECONDS'),
    )
    expect(secondsConsts.sort()).toEqual([
      'AGING_WINDOW_SECONDS',
      'FRESH_WINDOW_SECONDS',
      'STALE_WINDOW_SECONDS',
    ])
  })
})

describe('P6-T06 freshnessFor — the age ladder', () => {
  it('a report read at its own recorded timestamp (age 0) is fresh', () => {
    expect(freshnessFor(target(), BASE)).toBe('fresh')
  })

  it('stays fresh through the fresh window, up to but not including 6h', () => {
    expect(freshnessFor(target(), BASE + FRESH_WINDOW_SECONDS * 1000 - 1)).toBe(
      'fresh',
    )
  })

  it('exactly 6h / 24h / 72h land on the OLDER state (aging / stale / expired)', () => {
    expect(freshnessFor(target(), BASE + FRESH_WINDOW_SECONDS * 1000)).toBe('aging')
    expect(freshnessFor(target(), BASE + AGING_WINDOW_SECONDS * 1000)).toBe('stale')
    expect(freshnessFor(target(), BASE + STALE_WINDOW_SECONDS * 1000)).toBe('expired')
  })

  it('a millisecond before 24h is aging; a millisecond before 72h is stale', () => {
    expect(freshnessFor(target(), BASE + AGING_WINDOW_SECONDS * 1000 - 1)).toBe(
      'aging',
    )
    expect(freshnessFor(target(), BASE + STALE_WINDOW_SECONDS * 1000 - 1)).toBe(
      'stale',
    )
  })

  it('interior ages hit their bands: 12h → aging, 48h → stale, a week → expired', () => {
    expect(freshnessFor(target(), BASE + 12 * HOUR_MS)).toBe('aging')
    expect(freshnessFor(target(), BASE + 48 * HOUR_MS)).toBe('stale')
    expect(freshnessFor(target(), BASE + 7 * 24 * HOUR_MS)).toBe('expired')
  })

  it('a never-updated target (lastUpdatedAt null) is expired', () => {
    expect(freshnessFor(target({ lastUpdatedAt: null }), BASE)).toBe('expired')
  })

  it('throws a RangeError for a non-positive or non-finite at', () => {
    expect(() => freshnessFor(target(), 0)).toThrow(RangeError)
    expect(() => freshnessFor(target(), -1)).toThrow(RangeError)
    expect(() => freshnessFor(target(), Number.NaN)).toThrow(RangeError)
    expect(() => freshnessFor(target(), Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('throws a RangeError for a bogus intel level', () => {
    expect(() =>
      freshnessFor(target({ level: 'bogus' as IntelLevel }), BASE),
    ).toThrow(RangeError)
  })
})

describe('P6-T06 decayedLevel — the decay table', () => {
  it('matches the hand-computed table: every level × every freshness', () => {
    for (const [level, freshness, expected] of DECAY_TABLE) {
      expect(decayedLevel(target({ level }), stampFor(freshness, BASE))).toBe(
        expected,
      )
    }
  })

  it('never improves with age: the decayed rank never exceeds the stored rank', () => {
    for (const level of LADDER) {
      for (const freshness of FRESHNESSES) {
        const result = decayedLevel(target({ level }), stampFor(freshness, BASE))
        expect(INTEL_LEVEL_RANK[result]).toBeLessThanOrEqual(INTEL_LEVEL_RANK[level])
      }
    }
  })

  it('an expired report decays to none regardless of its stored level', () => {
    for (const level of LADDER) {
      expect(decayedLevel(target({ level }), stampFor('expired', BASE))).toBe('none')
    }
  })

  it('throws a RangeError for a bad at or a bogus level', () => {
    expect(() => decayedLevel(target(), 0)).toThrow(RangeError)
    expect(() =>
      decayedLevel(target({ level: 'bogus' as IntelLevel }), BASE),
    ).toThrow(RangeError)
  })
})

describe('P6-T06 needsRescout — the re-scout hook', () => {
  it('a fresh report needs no re-scout', () => {
    expect(needsRescout(target(), BASE)).toBe(false)
    expect(needsRescout(target(), BASE + FRESH_WINDOW_SECONDS * 1000 - 1)).toBe(
      false,
    )
  })

  it('an aging report needs no re-scout yet', () => {
    expect(needsRescout(target(), BASE + 12 * HOUR_MS)).toBe(false)
    expect(needsRescout(target(), BASE + AGING_WINDOW_SECONDS * 1000 - 1)).toBe(
      false,
    )
  })

  it('the boundary: a millisecond before 24h is false, exactly 24h is true', () => {
    expect(needsRescout(target(), BASE + AGING_WINDOW_SECONDS * 1000 - 1)).toBe(
      false,
    )
    expect(needsRescout(target(), BASE + AGING_WINDOW_SECONDS * 1000)).toBe(true)
  })

  it('a stale report (48h), an expired report and a never-updated target all need one', () => {
    expect(needsRescout(target(), BASE + 48 * HOUR_MS)).toBe(true)
    expect(needsRescout(target(), BASE + 72 * HOUR_MS)).toBe(true)
    expect(needsRescout(target({ lastUpdatedAt: null }), BASE)).toBe(true)
  })

  it('throws a RangeError for a bad at', () => {
    expect(() => needsRescout(target(), 0)).toThrow(RangeError)
  })
})

describe('P6-T06 applyDecay — the store decay pass', () => {
  it('a fresh report keeps its level, its timestamp and its sources', () => {
    const result = applyDecay(target({ level: 'scouted', sources: ['a'] }), BASE)
    expect(result).toEqual({
      targetId: 'body:slug|alpha|planet|1',
      level: 'scouted',
      lastUpdatedAt: BASE,
      sources: ['a'],
    })
  })

  it('FINDING 2: decay is a READ PROJECTION — applyDecay keeps the stored level unchanged at every age', () => {
    const aging = applyDecay(
      target({ level: 'full intelligence' }),
      BASE + 12 * HOUR_MS,
    )
    const stale = applyDecay(
      target({ level: 'full intelligence' }),
      BASE + 48 * HOUR_MS,
    )
    expect(aging?.level).toBe('full intelligence')
    expect(stale?.level).toBe('full intelligence')
    expect(aging?.lastUpdatedAt).toBe(BASE)
    expect(stale?.lastUpdatedAt).toBe(BASE)
  })

  it('an expired report returns null — the store drops the record', () => {
    expect(applyDecay(target(), BASE + 72 * HOUR_MS)).toBeNull()
  })

  it('a never-updated target returns null on the first decay pass', () => {
    expect(applyDecay(target({ lastUpdatedAt: null }), BASE)).toBeNull()
  })

  it('FINDING 2: repeated passes keep the level AND the timestamp — decay never compounds or resets', () => {
    const pass1 = applyDecay(target({ level: 'scouted' }), BASE + 12 * HOUR_MS)
    const pass2 = applyDecay(pass1!, BASE + 25 * HOUR_MS)
    expect(pass1?.lastUpdatedAt).toBe(BASE)
    expect(pass2?.lastUpdatedAt).toBe(BASE)
    expect(pass1?.level).toBe('scouted')
    expect(pass2?.level).toBe('scouted')
  })

  it('FINDING 2: decayedLevel still projects the read-time rung subtraction from the stored level', () => {
    const stored = target({ level: 'full intelligence' })
    const pass = applyDecay(stored, BASE + 12 * HOUR_MS)
    expect(pass?.level).toBe('full intelligence')
    expect(decayedLevel(pass!, BASE + 12 * HOUR_MS)).toBe('deep recon')
    expect(decayedLevel(pass!, BASE + 48 * HOUR_MS)).toBe('scouted')
  })

  it('is immutable: the input is never mutated, the result is a fresh object with fresh sources', () => {
    const t = target({ level: 'scouted', sources: ['a', 'b'] })
    const snapshot: TargetIntel = { ...t, sources: [...t.sources] }
    const result = applyDecay(t, BASE + 12 * HOUR_MS)
    expect(t).toEqual(snapshot)
    expect(result).not.toBe(t)
    expect(result?.sources).not.toBe(t.sources)
    expect(result?.sources).toEqual(['a', 'b'])
  })

  it('throws a RangeError for a bad at or a blank targetId', () => {
    expect(() => applyDecay(target(), 0)).toThrow(RangeError)
    expect(() => applyDecay(target({ targetId: '   ' }), BASE)).toThrow(RangeError)
  })
})

describe('P6-T06 stalenessSummary — the deterministic display line', () => {
  it("renders a fresh line: 'Fresh · scanned · updated 2h ago'", () => {
    expect(stalenessSummary(target({ level: 'scanned' }), BASE + 2 * HOUR_MS)).toBe(
      'Fresh · scanned · updated 2h ago',
    )
  })

  it("renders 'Expired — rescout needed' for expired and never-updated targets", () => {
    expect(stalenessSummary(target(), BASE + 72 * HOUR_MS)).toBe(
      'Expired — rescout needed',
    )
    expect(stalenessSummary(target({ lastUpdatedAt: null }), BASE)).toBe(
      'Expired — rescout needed',
    )
  })

  it("renders a stale line: 'Stale · scouted · updated 2d ago'", () => {
    expect(stalenessSummary(target({ level: 'scouted' }), BASE + 48 * HOUR_MS)).toBe(
      'Stale · scouted · updated 2d ago',
    )
  })

  it('picks deterministic age units at the s / m / h / d boundaries', () => {
    expect(stalenessSummary(target(), BASE + 59_999)).toBe(
      'Fresh · scanned · updated 59s ago',
    )
    expect(stalenessSummary(target(), BASE + 60_000)).toBe(
      'Fresh · scanned · updated 1m ago',
    )
    expect(stalenessSummary(target(), BASE + 3_599_999)).toBe(
      'Fresh · scanned · updated 59m ago',
    )
    expect(stalenessSummary(target(), BASE + 3_600_000)).toBe(
      'Fresh · scanned · updated 1h ago',
    )
    expect(stalenessSummary(target(), BASE + 23 * HOUR_MS)).toBe(
      'Aging · scanned · updated 23h ago',
    )
    expect(stalenessSummary(target(), BASE + 24 * HOUR_MS)).toBe(
      'Stale · scanned · updated 1d ago',
    )
  })

  it('capitalises the freshness word for display (Fresh / Aging / Stale)', () => {
    expect(stalenessSummary(target(), BASE).startsWith('Fresh ·')).toBe(true)
    expect(stalenessSummary(target(), BASE + 12 * HOUR_MS).startsWith('Aging ·')).toBe(
      true,
    )
    expect(stalenessSummary(target(), BASE + 48 * HOUR_MS).startsWith('Stale ·')).toBe(
      true,
    )
  })

  it('throws a RangeError for a bad at', () => {
    expect(() => stalenessSummary(target(), 0)).toThrow(RangeError)
  })
})

describe('P6-T06 determinism and purity', () => {
  it('repeated calls with identical inputs are deep-equal, and caller records stay untouched', () => {
    const t = target({ level: 'full intelligence', sources: ['a'] })
    const at = BASE + 48 * HOUR_MS
    expect(freshnessFor(t, at)).toBe(freshnessFor(t, at))
    expect(decayedLevel(t, at)).toBe(decayedLevel(t, at))
    expect(needsRescout(t, at)).toBe(needsRescout(t, at))
    expect(applyDecay(t, at)).toEqual(applyDecay(t, at))
    expect(stalenessSummary(t, at)).toBe(stalenessSummary(t, at))

    const frozen = Object.freeze(target({ level: 'scouted', sources: ['a'] }))
    const frozenAt = BASE + 12 * HOUR_MS
    freshnessFor(frozen, frozenAt)
    decayedLevel(frozen, frozenAt)
    needsRescout(frozen, frozenAt)
    applyDecay(frozen, frozenAt)
    stalenessSummary(frozen, frozenAt)
    expect(frozen.level).toBe('scouted')
    expect(frozen.lastUpdatedAt).toBe(BASE)
    expect(frozen.sources).toEqual(['a'])
  })
})
