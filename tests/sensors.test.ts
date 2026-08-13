import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SHIP_CLASSES } from '../src/sim/fleet/ships'
import { fleetCompositionSize } from '../src/sim/fleet/fleet'
import { scoutProfileFor } from '../src/sim/intel/scouts'
import { SENSOR_RANGE_BASE_PC as SCOUT_RANGE_BASE_PC } from '../src/sim/intel/scouts'
import {
  COUNTER_INTEL_UNDETECTED_FACTOR,
  SENSOR_RANGE_DRAFT_BASE_PC,
  SENSOR_RANGE_POWER_SCALE_PC,
  SENSOR_RANGE_SCOUTING_DIVISOR,
  SIGNATURE_BASE,
  SIGNATURE_PER_SHIP,
  STEALTH_FACTOR_DEFAULT,
  counterIntel,
  detectionOutcome,
  sensorRange,
  signatureOf,
  stealthFactor,
} from '../src/sim/intel/sensors'
import type { FleetComposition } from '../src/sim/fleet/fleet'
import type { ScoutProfile } from '../src/sim/intel/scouts'

const SENSORS_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/sim/intel/sensors.ts', import.meta.url)),
  'utf8',
)

function composition(overrides: Partial<FleetComposition> = {}): FleetComposition {
  return { scout: 0, corvette: 0, frigate: 0, cruiser: 0, battleship: 0, ...overrides }
}

const BAD_COMPOSITIONS: readonly {
  label: string
  overrides: Partial<FleetComposition>
}[] = [
  { label: 'a negative scout count', overrides: { scout: -1 } },
  { label: 'a fractional scout count', overrides: { scout: 1.5 } },
  { label: 'a negative corvette count', overrides: { corvette: -2 } },
  { label: 'a fractional frigate count', overrides: { frigate: 2.5 } },
  { label: 'a non-finite battleship count', overrides: { battleship: Number.NaN } },
]

describe('P6-T10 draft balance-harness constants', () => {
  it('exposes the documented draft constants', () => {
    expect(SENSOR_RANGE_DRAFT_BASE_PC).toBe(3)
    expect(SENSOR_RANGE_SCOUTING_DIVISOR).toBe(100)
    expect(SENSOR_RANGE_POWER_SCALE_PC).toBe(0.5)
    expect(SIGNATURE_BASE).toBe(1)
    expect(SIGNATURE_PER_SHIP).toBe(0.1)
    expect(STEALTH_FACTOR_DEFAULT).toBe(1)
    expect(COUNTER_INTEL_UNDETECTED_FACTOR).toBe(0.05)
  })

  it('keeps the sensor draft base distinct from the scout profile base', () => {
    expect(SENSOR_RANGE_DRAFT_BASE_PC).toBeLessThan(SCOUT_RANGE_BASE_PC)
  })
})

describe('P6-T10 sensorRange — draft math + delegation', () => {
  it('a scout-less fleet resolves to the draft base', () => {
    expect(sensorRange(composition())).toBe(SENSOR_RANGE_DRAFT_BASE_PC)
    expect(sensorRange(composition({ corvette: 2, frigate: 1 }))).toBe(
      SENSOR_RANGE_DRAFT_BASE_PC,
    )
  })

  it('1 scout: hand-computed range', () => {
    expect(sensorRange(composition({ scout: 1 }))).toBeCloseTo(3.5, 6)
  })

  it('3 scouts: hand-computed range', () => {
    expect(sensorRange(composition({ scout: 3 }))).toBeCloseTo(4.5, 6)
  })

  it('10 scouts: hand-computed range', () => {
    expect(sensorRange(composition({ scout: 10 }))).toBeCloseTo(8, 6)
  })

  it('non-scout ships add no sensor range', () => {
    const fleet = composition({ scout: 1, cruiser: 2, battleship: 1 })
    expect(sensorRange(fleet)).toBe(sensorRange(composition({ scout: 1 })))
  })

  it('derives range from the delegated scout scouting power', () => {
    const fleet = composition({ scout: 3, frigate: 1 })
    const scoutingPower = scoutProfileFor(fleet).scoutingPower
    expect(scoutingPower).toBe(3 * SHIP_CLASSES.scout.scoutingPower)
    const expected =
      SENSOR_RANGE_DRAFT_BASE_PC +
      (scoutingPower / SENSOR_RANGE_SCOUTING_DIVISOR) *
        SENSOR_RANGE_POWER_SCALE_PC
    expect(sensorRange(fleet)).toBe(expected)
  })

  it.each(BAD_COMPOSITIONS)('rejects $label', ({ overrides }) => {
    expect(() => sensorRange(composition(overrides))).toThrow(RangeError)
  })
})

describe('P6-T10 signatureOf — emission draft math', () => {
  it('an empty fleet has the base signature', () => {
    expect(signatureOf(composition())).toBe(SIGNATURE_BASE)
  })

  it('1 ship: hand-computed signature', () => {
    expect(signatureOf(composition({ corvette: 1 }))).toBeCloseTo(1.1, 6)
  })

  it('10 ships: hand-computed signature', () => {
    expect(signatureOf(composition({ corvette: 10 }))).toBeCloseTo(2, 6)
  })

  it('a mixed fleet of size 5: hand-computed signature', () => {
    expect(signatureOf(composition({ scout: 3, frigate: 2 }))).toBeCloseTo(1.5, 6)
  })

  it('derives size from the locked fleet size helper', () => {
    const fleet = composition({ scout: 3, frigate: 2 })
    const expected = SIGNATURE_BASE + fleetCompositionSize(fleet) * SIGNATURE_PER_SHIP
    expect(signatureOf(fleet)).toBeCloseTo(expected, 6)
  })

  it.each(BAD_COMPOSITIONS)('rejects $label', ({ overrides }) => {
    expect(() => signatureOf(composition(overrides))).toThrow(RangeError)
  })
})

describe('P6-T10 stealthFactor — the stealth hook', () => {
  it.each([
    { label: 'the empty fleet', fleet: composition() },
    { label: 'a scout fleet', fleet: composition({ scout: 3 }) },
    { label: 'a corvette fleet', fleet: composition({ corvette: 5 }) },
    { label: 'a mixed fleet', fleet: composition({ scout: 2, frigate: 1, battleship: 1 }) },
    { label: 'a battleship-only fleet', fleet: composition({ battleship: 3 }) },
  ])('is 1.0 for $label', ({ fleet }) => {
    expect(stealthFactor(fleet)).toBe(STEALTH_FACTOR_DEFAULT)
    expect(stealthFactor(fleet)).toBe(1)
  })

  it('is deterministic', () => {
    const fleet = composition({ scout: 3 })
    expect(stealthFactor(fleet)).toBe(stealthFactor(fleet))
  })

  it.each(BAD_COMPOSITIONS)('rejects $label', ({ overrides }) => {
    expect(() => stealthFactor(composition(overrides))).toThrow(RangeError)
  })
})

describe('P6-T10 detectionOutcome — range gate, reasons, boundaries', () => {
  it('detects an emitter inside the sensor range', () => {
    const outcome = detectionOutcome({
      sensorRangePc: 5,
      signature: 1.2,
      distancePc: 3,
    })
    expect(outcome).toEqual({
      detected: true,
      rangePc: 5,
      signature: 1.2,
      marginPc: 2,
      reason: 'in-range',
    })
  })

  it('does not detect an emitter outside the sensor range', () => {
    const outcome = detectionOutcome({
      sensorRangePc: 5,
      signature: 1.2,
      distancePc: 7,
    })
    expect(outcome.detected).toBe(false)
    expect(outcome.reason).toBe('out-of-range')
    expect(outcome.marginPc).toBe(-2)
  })

  it('detects an emitter exactly at the range boundary (margin 0)', () => {
    const outcome = detectionOutcome({
      sensorRangePc: 5,
      signature: 1,
      distancePc: 5,
    })
    expect(outcome.detected).toBe(true)
    expect(outcome.reason).toBe('in-range')
    expect(outcome.marginPc).toBe(0)
  })

  it('detects a co-located emitter (distance 0, margin = range)', () => {
    const outcome = detectionOutcome({
      sensorRangePc: 5,
      signature: 1,
      distancePc: 0,
    })
    expect(outcome.detected).toBe(true)
    expect(outcome.marginPc).toBe(5)
  })

  it.each([
    { distancePc: 3, note: 'inside range' },
    { distancePc: 5, note: 'exactly at range' },
    { distancePc: 7, note: 'outside range' },
  ])('a cloaked emitter is never detected $note', ({ distancePc }) => {
    const outcome = detectionOutcome({
      sensorRangePc: 5,
      signature: 1.1,
      distancePc,
      cloaked: true,
    })
    expect(outcome.detected).toBe(false)
    expect(outcome.reason).toBe('cloaked')
    expect(outcome.marginPc).toBe(5 - distancePc)
  })

  it('treats cloaked false and cloaked undefined as not cloaked', () => {
    const explicit = detectionOutcome({
      sensorRangePc: 5,
      signature: 1,
      distancePc: 3,
      cloaked: false,
    })
    const omitted = detectionOutcome({ sensorRangePc: 5, signature: 1, distancePc: 3 })
    expect(explicit.detected).toBe(true)
    expect(explicit.reason).toBe('in-range')
    expect(omitted.detected).toBe(true)
    expect(omitted.reason).toBe('in-range')
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a non-positive sensorRangePc of %s',
    (sensorRangePc) => {
      expect(() =>
        detectionOutcome({ sensorRangePc, signature: 1, distancePc: 1 }),
      ).toThrow(RangeError)
    },
  )

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a non-positive signature of %s',
    (signature) => {
      expect(() =>
        detectionOutcome({ sensorRangePc: 5, signature, distancePc: 1 }),
      ).toThrow(RangeError)
    },
  )

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a negative or non-finite distancePc of %s',
    (distancePc) => {
      expect(() =>
        detectionOutcome({ sensorRangePc: 5, signature: 1, distancePc }),
      ).toThrow(RangeError)
    },
  )
})

describe('P6-T10 counterIntel — counter-intelligence hook', () => {
  it('a detected scout keeps its full detection chance (no extra roll)', () => {
    const profile = scoutProfileFor(composition({ scout: 3 }))
    const result = counterIntel(profile, true)
    expect(result.effectiveDetection).toBe(profile.detectionChance)
    expect(result.effectiveRangePc).toBe(profile.sensorRangePc)
  })

  it('an unspotted scout keeps the reduced draft factor of its chance', () => {
    const profile = scoutProfileFor(composition({ scout: 3 }))
    const result = counterIntel(profile, false)
    expect(result.effectiveDetection).toBeCloseTo(
      COUNTER_INTEL_UNDETECTED_FACTOR * profile.detectionChance,
      6,
    )
    expect(result.effectiveDetection).toBeLessThan(profile.detectionChance)
    expect(result.effectiveRangePc).toBe(profile.sensorRangePc)
  })

  it('hand-computed with a real 3-scout profile', () => {
    const profile = scoutProfileFor(composition({ scout: 3 }))
    expect(profile.detectionChance).toBeCloseTo(0.08, 6)
    expect(counterIntel(profile, true).effectiveDetection).toBeCloseTo(0.08, 6)
    expect(counterIntel(profile, false).effectiveDetection).toBeCloseTo(0.004, 6)
  })

  it.each([
    {
      label: 'a negative sensor range',
      profile: {
        scoutCount: 3,
        scoutingPower: 300,
        sensorRangePc: -1,
        scoutSpeedPcPerSec: 1.5,
        detectionChance: 0.08,
        maxIntelLevel: 'scouted',
      },
    },
    {
      label: 'a negative detection chance',
      profile: {
        scoutCount: 3,
        scoutingPower: 300,
        sensorRangePc: 7,
        scoutSpeedPcPerSec: 1.5,
        detectionChance: -0.1,
        maxIntelLevel: 'scouted',
      },
    },
  ])('rejects a malformed profile with $label', ({ profile }) => {
    expect(() =>
      counterIntel(profile as unknown as ScoutProfile, false),
    ).toThrow(RangeError)
  })

  it('is deterministic and never mutates its inputs', () => {
    const profile = scoutProfileFor(composition({ scout: 3 }))
    const before = JSON.stringify(profile)
    const a = counterIntel(profile, true)
    const b = counterIntel(profile, true)
    expect(a).toEqual(b)
    expect(JSON.stringify(profile)).toBe(before)
  })
})

describe('P6-T10 purity — determinism, non-mutation, delegation, banned tokens', () => {
  it('sensorRange and signatureOf are deterministic, non-mutating and fresh', () => {
    const input = composition({ scout: 3, cruiser: 1 })
    const before = JSON.stringify(input)
    const rangeA = sensorRange(input)
    const rangeB = sensorRange(input)
    const sigA = signatureOf(input)
    const sigB = signatureOf(input)
    expect(rangeA).toBe(rangeB)
    expect(sigA).toBe(sigB)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('delegates to the scout profile and fleet size helpers, not re-derived values', () => {
    expect(SENSORS_SOURCE).toContain('scoutProfileFor')
    expect(SENSORS_SOURCE).toContain('fleetCompositionSize')
    expect(SENSORS_SOURCE).not.toMatch(/scout\s*\.\s*scoutingPower/)
    expect(SENSORS_SOURCE).not.toMatch(/SHIP_CLASSES/)
  })

  const BANNED_TOKENS: readonly string[] = [
    'Math' + '.' + 'rand' + 'om',
    'Date' + '.' + 'now',
    'performance' + '.' + 'now',
    'loc' + 'ale' + 'Compare',
    'loc' + 'ale',
    'wa' + 'll',
    'clo' + 'ck',
    'sce' + 'ne',
    'Three' + '.js',
    'global' + ' state',
    'shared mutable' + ' data',
    'rand' + 'om',
    'a' + 'ny',
  ]

  it.each(BANNED_TOKENS)('contains no banned token "%s"', (token: string) => {
    expect(SENSORS_SOURCE).not.toContain(token)
  })
})
