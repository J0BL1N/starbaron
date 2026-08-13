import { describe, expect, it } from 'vitest'
import {
  INTEL_LEVELS,
  INTEL_LEVEL_RANK,
  coverageFor,
  higher,
  isIntelLevel,
  levelFromInfoState,
  promoteIntel,
  recordIntel,
} from '../src/sim/intel/levels'
import type { IntelLevel, TargetIntel } from '../src/sim/intel/levels'
import type { InfoState } from '../src/sim/ui/info'

const LADDER: readonly IntelLevel[] = [
  'none',
  'observed',
  'scanned',
  'scouted',
  'deep recon',
  'full intelligence',
]

function target(overrides: Partial<TargetIntel> = {}): TargetIntel {
  return {
    targetId: 'body:slug|alpha|planet|1',
    level: 'none',
    lastUpdatedAt: null,
    sources: [],
    ...overrides,
  }
}

const MISSIONS = ['1013915384', '614515700', '2545854885']

describe('P6-T02 level ladder — the roadmap names', () => {
  it('is the roadmap T02 subtask ladder (observed → full intelligence) plus the none baseline', () => {
    expect(INTEL_LEVELS).toEqual([
      'none',
      'observed',
      'scanned',
      'scouted',
      'deep recon',
      'full intelligence',
    ])
  })

  it('ranks ascend 0..5 with none lowest and full intelligence highest', () => {
    expect(INTEL_LEVEL_RANK.none).toBe(0)
    expect(INTEL_LEVEL_RANK['full intelligence']).toBe(5)
    for (let i = 1; i < LADDER.length; i++) {
      expect(INTEL_LEVEL_RANK[LADDER[i]]).toBeGreaterThan(
        INTEL_LEVEL_RANK[LADDER[i - 1]],
      )
    }
    expect(Object.keys(INTEL_LEVEL_RANK)).toHaveLength(LADDER.length)
  })

  it('covers exactly the ladder — no extra or missing levels', () => {
    const keys = Object.keys(INTEL_LEVEL_RANK).sort()
    const ladder = [...LADDER].sort()
    expect(keys).toEqual(ladder)
  })

  it('exposes deeply immutable tables (primitives only)', () => {
    expect(Object.isFrozen(INTEL_LEVELS)).toBe(true)
    expect(Object.isFrozen(INTEL_LEVEL_RANK)).toBe(true)
  })
})

describe('P6-T02 higher — max by rank', () => {
  it('returns the greater level by rank', () => {
    expect(higher('none', 'observed')).toBe('observed')
    expect(higher('observed', 'none')).toBe('observed')
    expect(higher('scanned', 'scouted')).toBe('scouted')
    expect(higher('scouted', 'scanned')).toBe('scouted')
    expect(higher('deep recon', 'full intelligence')).toBe('full intelligence')
    expect(higher('full intelligence', 'observed')).toBe('full intelligence')
  })

  it('returns the first argument when both levels are equal', () => {
    for (const level of LADDER) {
      expect(higher(level, level)).toBe(level)
    }
  })

  it('matches the rank comparison at every pair', () => {
    for (const a of LADDER) {
      for (const b of LADDER) {
        const expected = INTEL_LEVEL_RANK[a] >= INTEL_LEVEL_RANK[b] ? a : b
        expect(higher(a, b)).toBe(expected)
      }
    }
  })

  it('throws a RangeError for an invalid level', () => {
    expect(() => higher('bogus' as IntelLevel, 'observed')).toThrow(RangeError)
    expect(() => higher('observed', 'bogus' as IntelLevel)).toThrow(RangeError)
  })
})

describe('P6-T02 promoteIntel — the promotion rule', () => {
  it('raises none to the gained level', () => {
    for (const gained of LADDER) {
      expect(promoteIntel('none', gained)).toBe(gained)
    }
  })

  it('never decreases: the result rank is always >= the current rank', () => {
    for (const current of LADDER) {
      for (const gained of LADDER) {
        const result = promoteIntel(current, gained)
        expect(INTEL_LEVEL_RANK[result]).toBeGreaterThanOrEqual(
          INTEL_LEVEL_RANK[current],
        )
      }
    }
  })

  it('keeps the current level when the gained level is equal or lower', () => {
    expect(promoteIntel('full intelligence', 'full intelligence')).toBe(
      'full intelligence',
    )
    expect(promoteIntel('full intelligence', 'none')).toBe('full intelligence')
    expect(promoteIntel('scouted', 'scanned')).toBe('scouted')
    expect(promoteIntel('deep recon', 'observed')).toBe('deep recon')
  })

  it('is a max over the ladder — matches higher for every pair', () => {
    for (const current of LADDER) {
      for (const gained of LADDER) {
        expect(promoteIntel(current, gained)).toBe(higher(current, gained))
      }
    }
  })

  it('throws a RangeError for an invalid current or gained level', () => {
    expect(() => promoteIntel('bogus' as IntelLevel, 'observed')).toThrow(RangeError)
    expect(() => promoteIntel('observed', 'bogus' as IntelLevel)).toThrow(RangeError)
  })
})

describe('P6-T02 recordIntel — promotion and timestamp', () => {
  it('promotes the target level to the max of current and gained', () => {
    const result = recordIntel(target({ level: 'scanned' }), {
      level: 'deep recon',
      at: 1000,
      source: MISSIONS[0],
    })
    expect(result.level).toBe('deep recon')
  })

  it('records a lower level without demoting the target', () => {
    const result = recordIntel(target({ level: 'scouted' }), {
      level: 'observed',
      at: 1000,
      source: MISSIONS[0],
    })
    expect(result.level).toBe('scouted')
  })

  it('sets lastUpdatedAt to the recorded timestamp', () => {
    const result = recordIntel(target({ lastUpdatedAt: null }), {
      level: 'scanned',
      at: 123456,
      source: MISSIONS[0],
    })
    expect(result.lastUpdatedAt).toBe(123456)
  })

  it('a fresh timestamp updates lastUpdatedAt even when the level is unchanged', () => {
    const first = recordIntel(target(), {
      level: 'scanned',
      at: 1000,
      source: MISSIONS[0],
    })
    const second = recordIntel(first, {
      level: 'scanned',
      at: 9000,
      source: MISSIONS[0],
    })
    expect(second.level).toBe('scanned')
    expect(second.lastUpdatedAt).toBe(9000)
  })
})

describe('P6-T02 recordIntel — sources', () => {
  it('appends a new source to the source list', () => {
    const result = recordIntel(target(), {
      level: 'scanned',
      at: 1000,
      source: MISSIONS[0],
    })
    expect(result.sources).toEqual([MISSIONS[0]])
  })

  it('does not append the same source twice', () => {
    const first = recordIntel(target(), {
      level: 'scanned',
      at: 1000,
      source: MISSIONS[0],
    })
    const second = recordIntel(first, {
      level: 'deep recon',
      at: 2000,
      source: MISSIONS[0],
    })
    expect(second.sources).toEqual([MISSIONS[0]])
  })

  it('preserves distinct sources in record order', () => {
    const a = recordIntel(target(), {
      level: 'observed',
      at: 1000,
      source: MISSIONS[0],
    })
    const b = recordIntel(a, {
      level: 'scanned',
      at: 2000,
      source: MISSIONS[1],
    })
    const c = recordIntel(b, {
      level: 'scouted',
      at: 3000,
      source: MISSIONS[2],
    })
    expect(c.sources).toEqual([MISSIONS[0], MISSIONS[1], MISSIONS[2]])
  })
})

describe('P6-T02 recordIntel — validation', () => {
  it('throws a RangeError for a non-finite at', () => {
    expect(() =>
      recordIntel(target(), { level: 'scanned', at: Number.NaN, source: MISSIONS[0] }),
    ).toThrow(RangeError)
    expect(() =>
      recordIntel(target(), {
        level: 'scanned',
        at: Number.POSITIVE_INFINITY,
        source: MISSIONS[0],
      }),
    ).toThrow(RangeError)
  })

  it('throws a RangeError for a non-positive at', () => {
    expect(() =>
      recordIntel(target(), { level: 'scanned', at: 0, source: MISSIONS[0] }),
    ).toThrow(RangeError)
    expect(() =>
      recordIntel(target(), { level: 'scanned', at: -5, source: MISSIONS[0] }),
    ).toThrow(RangeError)
  })

  it('throws a RangeError for an empty or blank source', () => {
    expect(() =>
      recordIntel(target(), { level: 'scanned', at: 1000, source: '' }),
    ).toThrow(RangeError)
    expect(() =>
      recordIntel(target(), { level: 'scanned', at: 1000, source: '   ' }),
    ).toThrow(RangeError)
  })

  it('throws a RangeError for an empty targetId or an invalid level', () => {
    expect(() =>
      recordIntel(target({ targetId: '   ' }), {
        level: 'scanned',
        at: 1000,
        source: MISSIONS[0],
      }),
    ).toThrow(RangeError)
    expect(() =>
      recordIntel(target(), {
        level: 'bogus' as IntelLevel,
        at: 1000,
        source: MISSIONS[0],
      }),
    ).toThrow(RangeError)
  })
})

describe('P6-T02 recordIntel — immutability', () => {
  it('never mutates the caller-provided TargetIntel', () => {
    const t = target({ level: 'scanned', lastUpdatedAt: 5000, sources: [MISSIONS[0]] })
    const snapshot: TargetIntel = {
      targetId: t.targetId,
      level: t.level,
      lastUpdatedAt: t.lastUpdatedAt,
      sources: [...t.sources],
    }
    recordIntel(t, { level: 'deep recon', at: 9000, source: MISSIONS[1] })
    expect(t).toEqual(snapshot)
  })

  it('returns a fresh object and a fresh sources array', () => {
    const t = target({ sources: [MISSIONS[0]] })
    const result = recordIntel(t, {
      level: 'scanned',
      at: 1000,
      source: MISSIONS[1],
    })
    expect(result).not.toBe(t)
    expect(result.sources).not.toBe(t.sources)
    expect(result.sources).toEqual([MISSIONS[0], MISSIONS[1]])
  })
})

describe('P6-T02 coverageFor — the roadmap coverage semantics', () => {
  it('returns the locked coverage string for every level', () => {
    expect(coverageFor('none')).toBe('Nothing known')
    expect(coverageFor('observed')).toBe('Observed: presence + class')
    expect(coverageFor('scanned')).toBe('Scanned: structures + defenses')
    expect(coverageFor('scouted')).toBe('Scouted: fleet presence + composition')
    expect(coverageFor('deep recon')).toBe(
      'Deep recon: fleet activity + defense detail',
    )
    expect(coverageFor('full intelligence')).toBe(
      'Full intelligence: population, resources, production, construction',
    )
  })

  it('throws a RangeError for an invalid level', () => {
    expect(() => coverageFor('bogus' as IntelLevel)).toThrow(RangeError)
  })
})

describe('P6-T02 levelFromInfoState — the HUD interop hook', () => {
  it('maps every InfoState onto the documented intel level', () => {
    expect(levelFromInfoState('unknown')).toBe('none')
    expect(levelFromInfoState('estimated')).toBe('scanned')
    expect(levelFromInfoState('stale')).toBe('observed')
    expect(levelFromInfoState('verified')).toBe('full intelligence')
  })

  it('throws a RangeError for an invalid state', () => {
    expect(() => levelFromInfoState('bogus' as InfoState)).toThrow(RangeError)
  })
})

describe('P6-T02 determinism', () => {
  it('repeated calls with identical inputs produce deep-equal results', () => {
    const t = target({ level: 'scanned', sources: [MISSIONS[0]] })
    const input = { level: 'deep recon', at: 1234, source: MISSIONS[1] } as const
    expect(higher('scanned', 'scouted')).toBe(higher('scanned', 'scouted'))
    expect(promoteIntel('observed', 'full intelligence')).toBe(
      promoteIntel('observed', 'full intelligence'),
    )
    expect(coverageFor('scouted')).toBe(coverageFor('scouted'))
    expect(levelFromInfoState('stale')).toBe(levelFromInfoState('stale'))
    expect(recordIntel(t, input)).toEqual(recordIntel(t, input))
  })

  it('isIntelLevel accepts exactly the ladder levels and rejects everything else', () => {
    for (const level of LADDER) {
      expect(isIntelLevel(level)).toBe(true)
    }
    expect(isIntelLevel('bogus')).toBe(false)
    expect(isIntelLevel(42)).toBe(false)
    expect(isIntelLevel(undefined)).toBe(false)
  })
})
