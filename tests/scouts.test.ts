import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SHIP_CLASSES } from '../src/sim/fleet/ships'
import {
  DETECTION_CHANCE_BASE,
  DETECTION_CHANCE_MAX,
  DETECTION_CHANCE_MIN,
  DETECTION_POWER_DIVISOR,
  INTEL_DEEP_RECON_MIN_SCOUTS,
  INTEL_SCANNED_MIN_SCOUTS,
  INTEL_SCOUTED_MIN_SCOUTS,
  SENSOR_RANGE_BASE_PC,
  canScout,
  maxIntelLevelForScouts,
  scoutProfileFor,
  scoutSummary,
} from '../src/sim/intel/scouts'
import type { ScoutProfile } from '../src/sim/intel/scouts'
import type { FleetComposition } from '../src/sim/fleet/fleet'
import type { IntelLevel } from '../src/sim/intel/levels'

const SCOUTS_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/sim/intel/scouts.ts', import.meta.url)),
  'utf8',
)

function composition(overrides: Partial<FleetComposition> = {}): FleetComposition {
  return { scout: 0, corvette: 0, frigate: 0, cruiser: 0, battleship: 0, ...overrides }
}

const THRESHOLD_ROWS: readonly [number, IntelLevel][] = [
  [0, 'none'],
  [1, 'scanned'],
  [2, 'scanned'],
  [3, 'scouted'],
  [9, 'scouted'],
  [10, 'deep recon'],
  [25, 'deep recon'],
]

const SUMMARY_ROWS: readonly [number, string][] = [
  [1, '1 scout · power 100 · range 7 pc · detects 6% · scanned intel'],
  [10, '10 scouts · power 1000 · range 8 pc · detects 15% · deep recon intel'],
]

describe('P6-T03 draft balance-harness constants', () => {
  it('exposes the documented sensor-range and detection constants', () => {
    expect(SENSOR_RANGE_BASE_PC).toBe(5)
    expect(DETECTION_CHANCE_BASE).toBe(0.05)
    expect(DETECTION_POWER_DIVISOR).toBe(10_000)
    expect(DETECTION_CHANCE_MIN).toBe(0.05)
    expect(DETECTION_CHANCE_MAX).toBe(0.95)
  })

  it('exposes the intel threshold cutoffs at the documented values', () => {
    expect(INTEL_SCANNED_MIN_SCOUTS).toBe(1)
    expect(INTEL_SCOUTED_MIN_SCOUTS).toBe(3)
    expect(INTEL_DEEP_RECON_MIN_SCOUTS).toBe(10)
    expect(maxIntelLevelForScouts(INTEL_SCANNED_MIN_SCOUTS)).toBe('scanned')
    expect(maxIntelLevelForScouts(INTEL_SCOUTED_MIN_SCOUTS)).toBe('scouted')
    expect(maxIntelLevelForScouts(INTEL_DEEP_RECON_MIN_SCOUTS)).toBe('deep recon')
  })
})

describe('P6-T03 scoutProfileFor — hand-computed profile math', () => {
  it('3 scouts: the full hand-computed profile', () => {
    const p = scoutProfileFor(composition({ scout: 3 }))
    expect(p.scoutCount).toBe(3)
    expect(p.scoutingPower).toBe(300)
    expect(p.sensorRangePc).toBeCloseTo(5 + Math.log10(301), 6)
    expect(p.sensorRangePc).toBeCloseTo(7.4786, 3)
    expect(p.scoutSpeedPcPerSec).toBe(SHIP_CLASSES.scout.speedPcPerSec)
    expect(p.detectionChance).toBeCloseTo(0.08, 6)
    expect(p.maxIntelLevel).toBe('scouted')
  })

  it('0 scouts: baseline profile (no scouts, no intel)', () => {
    const p = scoutProfileFor(composition())
    expect(p.scoutCount).toBe(0)
    expect(p.scoutingPower).toBe(0)
    expect(p.sensorRangePc).toBe(SENSOR_RANGE_BASE_PC)
    expect(p.scoutSpeedPcPerSec).toBe(SHIP_CLASSES.scout.speedPcPerSec)
    expect(p.detectionChance).toBe(DETECTION_CHANCE_MIN)
    expect(p.maxIntelLevel).toBe('none')
  })

  it('range grows sub-linearly and detection is clamped', () => {
    const [r1, r3, r10] = [1, 3, 10].map((n) =>
      scoutProfileFor(composition({ scout: n })),
    )
    expect(r1.sensorRangePc).toBeLessThan(r3.sensorRangePc)
    expect(r3.sensorRangePc).toBeLessThan(r10.sensorRangePc)
    expect(r1.detectionChance).toBeLessThan(r3.detectionChance)
    expect(r3.detectionChance).toBeLessThan(r10.detectionChance)
    expect(scoutProfileFor(composition({ scout: 100 })).detectionChance).toBe(
      DETECTION_CHANCE_MAX,
    )
    expect(scoutProfileFor(composition({ scout: 1_000 })).detectionChance).toBe(
      DETECTION_CHANCE_MAX,
    )
  })
})

describe('P6-T03 delegation to the LOCKED SHIP_CLASSES scout', () => {
  it('the roster scout class anchors the draft at 100 power / 1.5 speed', () => {
    expect(SHIP_CLASSES.scout.scoutingPower).toBe(100)
    expect(SHIP_CLASSES.scout.speedPcPerSec).toBe(1.5)
  })

  it('scoutingPower and speed are derived from the roster, not literals', () => {
    for (const n of [0, 1, 3, 10, 25]) {
      const p = scoutProfileFor(composition({ scout: n }))
      expect(p.scoutingPower).toBe(n * SHIP_CLASSES.scout.scoutingPower)
      expect(p.scoutSpeedPcPerSec).toBe(SHIP_CLASSES.scout.speedPcPerSec)
    }
  })

  it('the module references the roster and contains no re-derived 100/1.5 literals', () => {
    expect(SCOUTS_SOURCE).toContain('SHIP_CLASSES.scout.scoutingPower')
    expect(SCOUTS_SOURCE).toContain('SHIP_CLASSES.scout.speedPcPerSec')
    expect(/scoutingPower\s*[:=]\s*100\b/.test(SCOUTS_SOURCE)).toBe(false)
    expect(/speedPcPerSec\s*[:=]\s*1\.5\b/.test(SCOUTS_SOURCE)).toBe(false)
  })
})

describe('P6-T03 maxIntelLevel thresholds', () => {
  it.each(THRESHOLD_ROWS)('%i scouts → %s intel', (count, level) => {
    expect(maxIntelLevelForScouts(count)).toBe(level)
    expect(scoutProfileFor(composition({ scout: count })).maxIntelLevel).toBe(level)
  })

  it("'full intelligence' and 'observed' are unreachable by scouts alone", () => {
    for (let n = 0; n <= 100; n++) {
      const level = maxIntelLevelForScouts(n)
      expect(level).not.toBe('full intelligence')
      expect(level).not.toBe('observed')
    }
  })
})

describe('P6-T03 canScout', () => {
  it('fleets with no scouts cannot scout', () => {
    expect(canScout(composition())).toBe(false)
    expect(canScout(composition({ corvette: 2, frigate: 1 }))).toBe(false)
  })

  it('a single scout can scout', () => {
    expect(canScout(composition({ scout: 1 }))).toBe(true)
  })

  it('a large scout complement can scout', () => {
    expect(canScout(composition({ scout: 10 }))).toBe(true)
  })

  it('a mixed fleet that includes scouts can scout', () => {
    expect(canScout(composition({ scout: 3, cruiser: 2, battleship: 1 }))).toBe(true)
  })
})

describe('P6-T03 validation — bad composition counts', () => {
  it('rejects a negative scout count', () => {
    expect(() => scoutProfileFor(composition({ scout: -1 }))).toThrow(RangeError)
  })

  it('rejects a non-integer scout count', () => {
    expect(() => scoutProfileFor(composition({ scout: 1.5 }))).toThrow(RangeError)
  })

  it('rejects an invalid count in a non-scout class', () => {
    expect(() => scoutProfileFor(composition({ scout: 3, corvette: -2 }))).toThrow(
      RangeError,
    )
    expect(() => scoutProfileFor(composition({ scout: 3, frigate: 2.5 }))).toThrow(
      RangeError,
    )
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a %s scout count',
    (count) => {
      expect(() => scoutProfileFor(composition({ scout: count }))).toThrow(RangeError)
    },
  )

  it('canScout and maxIntelLevelForScouts validate their inputs', () => {
    expect(() => canScout(composition({ scout: -1 }))).toThrow(RangeError)
    expect(() => canScout(composition({ corvette: 0.5 }))).toThrow(RangeError)
    expect(() => maxIntelLevelForScouts(-1)).toThrow(RangeError)
    expect(() => maxIntelLevelForScouts(1.5)).toThrow(RangeError)
  })
})

describe('P6-T03 determinism and scoutSummary', () => {
  it('scoutProfileFor is deterministic, non-mutating and returns fresh objects', () => {
    const input = composition({ scout: 3, cruiser: 1 })
    const before = JSON.stringify(input)
    const a = scoutProfileFor(input)
    const b = scoutProfileFor(input)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('scoutSummary is deterministic', () => {
    const p = scoutProfileFor(composition({ scout: 3 }))
    expect(scoutSummary(p)).toBe(scoutSummary(p))
  })

  it('3 scouts: exact summary', () => {
    expect(scoutSummary(scoutProfileFor(composition({ scout: 3 })))).toBe(
      '3 scouts · power 300 · range 7.5 pc · detects 8% · scouted intel',
    )
  })

  it('0 scouts: exact baseline summary', () => {
    expect(scoutSummary(scoutProfileFor(composition()))).toBe(
      '0 scouts · power 0 · range 5 pc · detects 5% · no intel',
    )
  })

  it.each(SUMMARY_ROWS)('%i scouts: exact summary', (count, expected) => {
    expect(scoutSummary(scoutProfileFor(composition({ scout: count })))).toBe(expected)
  })

  it('rejects a profile with an unknown intel level', () => {
    const bogus = {
      scoutCount: 3,
      scoutingPower: 300,
      sensorRangePc: 7.48,
      scoutSpeedPcPerSec: 1.5,
      detectionChance: 0.08,
      maxIntelLevel: 'bogus',
    } as unknown as ScoutProfile
    expect(() => scoutSummary(bogus)).toThrow(RangeError)
  })
})
