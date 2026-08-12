import { describe, expect, it } from 'vitest'
import { STRUCTURE_IDS, STRUCTURES } from '../src/sim/structures/data'
import { productionSummaryFor } from '../src/sim/structures/production'
import { populationCapFor } from '../src/sim/core/population-model'
import { populationCapMultiplier } from '../src/sim/planets/levels'
import {
  BAND_EARLY_SECONDS,
  BAND_MID_SECONDS,
  DEFAULT_TICK_SECONDS,
  INITIAL_POPULATION,
  harnessInvariants,
  harnessTelemetry,
  runEconomySimulation,
} from '../src/sim/balance/harness'
import type { EconomySimulationConfig } from '../src/sim/balance/harness'

const STANDARD: EconomySimulationConfig = {
  tier: 1,
  initialCredits: 1_000,
  initialAlloys: 0,
  horizonSeconds: BAND_MID_SECONDS,
}

const LONG: EconomySimulationConfig = {
  ...STANDARD,
  horizonSeconds: BAND_MID_SECONDS + 7_200,
}

describe('runEconomySimulation', () => {
  it('is deterministic: identical config produces deep-equal runs', () => {
    expect(runEconomySimulation(STANDARD)).toEqual(runEconomySimulation(STANDARD))
  })

  it('records points from t=0 to the horizon in strictly increasing time', () => {
    const run = runEconomySimulation(STANDARD)
    expect(run.points[0].atSeconds).toBe(0)
    expect(run.points[run.points.length - 1].atSeconds).toBe(STANDARD.horizonSeconds)
    for (let i = 1; i < run.points.length; i++) {
      expect(run.points[i].atSeconds).toBeGreaterThan(run.points[i - 1].atSeconds)
    }
  })

  it('classifies every point into the band its time threshold implies', () => {
    const run = runEconomySimulation(LONG)
    for (const point of run.points) {
      const expected =
        point.atSeconds <= BAND_EARLY_SECONDS
          ? 'early'
          : point.atSeconds <= BAND_MID_SECONDS
            ? 'mid'
            : 'late'
      expect(point.band).toBe(expected)
    }
  })

  it('bands appear in order across the run', () => {
    const run = runEconomySimulation(LONG)
    const order: Record<string, number> = { early: 0, mid: 1, late: 2 }
    for (let i = 1; i < run.points.length; i++) {
      expect(order[run.points[i].band]).toBeGreaterThanOrEqual(
        order[run.points[i - 1].band],
      )
    }
  })

  it('produces upgrades for a reasonable 4h tier-1 run (1000 cr)', () => {
    const run = runEconomySimulation(STANDARD)
    expect(run.summary.totalUpgrades).toBeGreaterThan(0)
  })

  it('times the first upgrade, which matches the cheapest build (housing), within a sane window', () => {
    const run = runEconomySimulation(STANDARD)
    expect(run.summary.timeToFirstUpgradeSeconds).toBe(
      DEFAULT_TICK_SECONDS + STRUCTURES.housing.buildTimeSec,
    )
    expect(run.summary.timeToFirstUpgradeSeconds).toBeLessThanOrEqual(
      3 * DEFAULT_TICK_SECONDS,
    )
    const firstBuild = run.points.find((p) =>
      STRUCTURE_IDS.some((id) => p.structureLevels[id] > 0),
    )
    expect(firstBuild?.structureLevels.housing).toBeGreaterThanOrEqual(1)
  })

  it('keeps credits and alloys non-negative at every point', () => {
    const run = runEconomySimulation(LONG)
    for (const point of run.points) {
      expect(point.credits).toBeGreaterThanOrEqual(0)
      expect(point.alloys).toBeGreaterThanOrEqual(0)
    }
  })

  it('keeps population within the tier-scaled cap at every point', () => {
    const run = runEconomySimulation(STANDARD)
    expect(run.points[0].population).toBe(INITIAL_POPULATION)
    for (const point of run.points) {
      const cap = populationCapFor(
        point.structureLevels.housing,
        populationCapMultiplier(1),
      )
      expect(point.population).toBeGreaterThanOrEqual(0)
      expect(point.population).toBeLessThanOrEqual(cap)
    }
  })

  it('records income identical to the locked productionSummaryFor at each point', () => {
    const run = runEconomySimulation({ ...STANDARD, horizonSeconds: 7_200 })
    for (const point of run.points) {
      const locked = productionSummaryFor({
        name: 'Home',
        tier: run.config.tier,
        grid: point.structureLevels,
      }).total
      expect(point.income).toEqual(locked)
    }
  })

  it('defaults tickSeconds to 60 and honours a custom tick', () => {
    const run = runEconomySimulation(STANDARD)
    expect(run.config.tickSeconds).toBe(DEFAULT_TICK_SECONDS)
    const custom = runEconomySimulation({ ...STANDARD, tickSeconds: 30 })
    expect(custom.config.tickSeconds).toBe(30)
    expect(custom.points[1].atSeconds).toBe(30)
  })

  it('handles a high tier with a rich wallet without violating invariants', () => {
    const run = runEconomySimulation({
      tier: 5,
      initialCredits: 1_000_000,
      initialAlloys: 10_000,
      horizonSeconds: BAND_MID_SECONDS,
    })
    expect(run.summary.totalUpgrades).toBeGreaterThan(0)
    expect(harnessInvariants(run).ok).toBe(true)
  })

  it('with zero starting credits builds nothing and reports the horizon as the first-upgrade time', () => {
    const run = runEconomySimulation({ ...STANDARD, initialCredits: 0, initialAlloys: 0 })
    expect(run.summary.totalUpgrades).toBe(0)
    expect(run.summary.timeToFirstUpgradeSeconds).toBe(STANDARD.horizonSeconds)
  })

  it('a tiny horizon only reaches the early band', () => {
    const run = runEconomySimulation({ ...STANDARD, horizonSeconds: 120 })
    expect(run.points.every((p) => p.band === 'early')).toBe(true)
    expect(run.summary.timeToBand.mid).toBe(BAND_EARLY_SECONDS)
    expect(run.summary.timeToBand.late).toBe(BAND_MID_SECONDS)
    expect(harnessInvariants(run).ok).toBe(true)
  })

  it('reports timeToBand.early = 0, observes mid, and reports the nominal late on a 4h run', () => {
    const run = runEconomySimulation(STANDARD)
    expect(run.summary.timeToBand.early).toBe(0)
    expect(run.summary.timeToBand.mid).toBeGreaterThan(BAND_EARLY_SECONDS)
    expect(run.summary.timeToBand.mid).toBeLessThanOrEqual(BAND_MID_SECONDS)
    expect(run.summary.timeToBand.late).toBe(BAND_MID_SECONDS)
  })

  it('observes the late band on a run beyond 4 hours', () => {
    const run = runEconomySimulation(LONG)
    expect(run.points.some((p) => p.band === 'late')).toBe(true)
    expect(run.summary.timeToBand.late).toBeGreaterThan(BAND_MID_SECONDS)
  })

  it('rejects invalid configs', () => {
    expect(() => runEconomySimulation({ ...STANDARD, tier: 0 })).toThrow(RangeError)
    expect(() => runEconomySimulation({ ...STANDARD, tier: 6 })).toThrow(RangeError)
    expect(() => runEconomySimulation({ ...STANDARD, initialCredits: -1 })).toThrow(RangeError)
    expect(() => runEconomySimulation({ ...STANDARD, initialAlloys: -5 })).toThrow(RangeError)
    expect(() => runEconomySimulation({ ...STANDARD, horizonSeconds: 0 })).toThrow(RangeError)
    expect(() => runEconomySimulation({ ...STANDARD, tickSeconds: -10 })).toThrow(RangeError)
  })
})

describe('harnessInvariants', () => {
  it('passes on the standard run', () => {
    const result = harnessInvariants(runEconomySimulation(STANDARD))
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it.each([
    ['zero credits', { ...STANDARD, initialCredits: 0, initialAlloys: 0 }],
    ['tiny horizon', { ...STANDARD, horizonSeconds: 120 }],
    ['high tier rich wallet', {
      tier: 5,
      initialCredits: 1_000_000,
      initialAlloys: 10_000,
      horizonSeconds: BAND_MID_SECONDS,
    }],
    ['long horizon', LONG],
  ] as Array<[string, EconomySimulationConfig]>)(
    'passes on a valid edge config: %s',
    (_name, config) => {
      expect(harnessInvariants(runEconomySimulation(config)).ok).toBe(true)
    },
  )

  it('catches negative credits', () => {
    const run = runEconomySimulation(STANDARD)
    run.points[5].credits = -1
    const result = harnessInvariants(run)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/credits/)
  })

  it('catches unsorted points', () => {
    const run = runEconomySimulation(STANDARD)
    run.points[2].atSeconds = run.points[0].atSeconds
    const result = harnessInvariants(run)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/increasing/)
  })

  it('catches population above the tier-scaled cap', () => {
    const run = runEconomySimulation(STANDARD)
    const last = run.points[run.points.length - 1]
    last.population = last.population + 100_000_000
    const result = harnessInvariants(run)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/population/)
  })

  it('catches non-finite summary numbers and negative levels', () => {
    const run = runEconomySimulation(STANDARD)
    run.summary.finalCredits = Number.NaN
    expect(harnessInvariants(run).ok).toBe(false)
    const run2 = runEconomySimulation(STANDARD)
    run2.points[1].structureLevels.housing = -3
    const result = harnessInvariants(run2)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/housing/)
  })

  it('catches tampered income that disagrees with the locked production model', () => {
    const run = runEconomySimulation(STANDARD)
    run.points[1].income.creditsPerSec += 100
    const result = harnessInvariants(run)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/income/)
  })

  it('catches a tampered band and a tampered totalUpgrades', () => {
    const run = runEconomySimulation(LONG)
    run.points[5].band = 'late'
    expect(harnessInvariants(run).ok).toBe(false)
    const run2 = runEconomySimulation(STANDARD)
    run2.summary.totalUpgrades = 999
    const result = harnessInvariants(run2)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/totalUpgrades/)
  })
})

describe('harnessTelemetry', () => {
  it('is deterministic', () => {
    expect(harnessTelemetry(runEconomySimulation(STANDARD))).toBe(
      harnessTelemetry(runEconomySimulation(STANDARD)),
    )
  })

  it('emits one CSV line per band present, in order, with the documented shape', () => {
    const lines = harnessTelemetry(runEconomySimulation(LONG)).split('\n')
    expect(lines.map((line) => line.split(',')[0])).toEqual(['early', 'mid', 'late'])
    for (const line of lines) {
      const fields = line.split(',')
      expect(fields).toHaveLength(6)
      expect(['early', 'mid', 'late']).toContain(fields[0])
      expect(Number(fields[1])).toBeGreaterThanOrEqual(0)
      expect(Number(fields[2])).toBeGreaterThanOrEqual(0)
      expect(fields[4]).toMatch(/^([a-zA-Z]+=\d+)(;[a-zA-Z]+=\d+)*$/)
      expect(Number.isInteger(Number(fields[5]))).toBe(true)
    }
    const earlyOnly = runEconomySimulation({ ...STANDARD, horizonSeconds: 120 })
    const earlyLines = harnessTelemetry(earlyOnly).split('\n')
    expect(earlyLines).toHaveLength(1)
    expect(earlyLines[0].startsWith('early,')).toBe(true)
  })

  it('uses plain String() values (no locale formatting) and the cumulative level total', () => {
    const run = runEconomySimulation(STANDARD)
    const line = harnessTelemetry(run).split('\n').find((l) => l.startsWith('early,'))
    expect(line).toBeDefined()
    const fields = line!.split(',')
    for (let i = 1; i <= 3; i++) {
      expect(fields[i]).toBe(String(Number(fields[i])))
    }
    let levelSum = 0
    for (const pair of fields[4].split(';')) {
      const level = Number(pair.split('=')[1])
      levelSum += level
    }
    expect(fields[5]).toBe(String(levelSum))
  })
})
