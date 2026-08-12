import { describe, expect, it } from 'vitest'
import { STRUCTURE_IDS } from '../src/sim/structures/data'
import { computePlanetDerived } from '../src/sim/player/accrual'
import { populationCapFor } from '../src/sim/core/population-model'
import { populationCapMultiplier } from '../src/sim/planets/levels'
import {
  BAND_EARLY_SECONDS,
  BAND_MID_SECONDS,
  DEFAULT_TICK_SECONDS,
  INITIAL_POPULATION,
  harnessInvariants,
  harnessPlanet,
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

  it('times the first upgrade as the first point with levels exceeding 0, which is the cheapest build (housing), within a sane window', () => {
    const run = runEconomySimulation(STANDARD)
    const firstBuild = run.points.find((p) =>
      STRUCTURE_IDS.some((id) => p.structureLevels[id] > 0),
    )
    expect(firstBuild).toBeDefined()
    expect(run.summary.timeToFirstUpgradeSeconds).toBe(firstBuild!.atSeconds)
    expect(run.summary.timeToFirstUpgradeSeconds).toBeLessThanOrEqual(
      3 * DEFAULT_TICK_SECONDS,
    )
    expect(firstBuild!.structureLevels.housing).toBeGreaterThanOrEqual(1)
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

  it('records income identical to the locked computePlanetDerived at each point', () => {
    const run = runEconomySimulation({ ...STANDARD, horizonSeconds: 7_200 })
    for (const point of run.points) {
      const locked = computePlanetDerived(
        harnessPlanet(run.config.tier, point.population),
        point.structureLevels,
      )
      expect(point.income).toEqual({
        creditsPerSec: locked.creditsPerSec,
        alloysPerSec: locked.alloysPerSec,
      })
    }
  })

  it('a tier-1 empty grid earns the locked baseline passive income (10 cr/s), not 0', () => {
    const run = runEconomySimulation({ ...STANDARD, horizonSeconds: 120 })
    const first = run.points[0]
    expect(first.structureLevels).toEqual({
      oreMine: 0,
      tradeHub: 0,
      housing: 0,
      hydroponics: 0,
      barracks: 0,
      shipyard: 0,
      defenseTurret: 0,
    })
    expect(first.income).toEqual({ creditsPerSec: 10, alloysPerSec: 0 })
    const locked = computePlanetDerived(
      harnessPlanet(run.config.tier, first.population),
      first.structureLevels,
    )
    expect(first.income).toEqual({
      creditsPerSec: locked.creditsPerSec,
      alloysPerSec: locked.alloysPerSec,
    })
  })

  it('a tier-2 empty grid earns the locked tier-2 baseline (20 cr/s)', () => {
    const run = runEconomySimulation({
      tier: 2,
      initialCredits: 0,
      initialAlloys: 0,
      horizonSeconds: 120,
    })
    expect(run.points[0].income).toEqual({ creditsPerSec: 20, alloysPerSec: 0 })
    expect(harnessInvariants(run).ok).toBe(true)
  })

  it('tier-3 and tier-5 empty grids earn the locked baselines (30 and 50 cr/s)', () => {
    const t3 = runEconomySimulation({ tier: 3, initialCredits: 0, initialAlloys: 0, horizonSeconds: 60 })
    expect(t3.points[0].income).toEqual({ creditsPerSec: 30, alloysPerSec: 0 })
    const t5 = runEconomySimulation({ tier: 5, initialCredits: 0, initialAlloys: 0, horizonSeconds: 60 })
    expect(t5.points[0].income).toEqual({ creditsPerSec: 50, alloysPerSec: 0 })
  })

  it('alloy income appears once an ore mine is built (locked derived alloysPerSec)', () => {
    const run = runEconomySimulation({
      ...STANDARD,
      initialCredits: 100_000,
      initialAlloys: 10_000,
      horizonSeconds: 3_600,
    })
    const minePoint = run.points.find((p) => p.structureLevels.oreMine >= 1)
    expect(minePoint).toBeDefined()
    expect(minePoint!.income.alloysPerSec).toBeGreaterThan(0)
    const locked = computePlanetDerived(
      harnessPlanet(run.config.tier, minePoint!.population),
      minePoint!.structureLevels,
    )
    expect(minePoint!.income).toEqual({
      creditsPerSec: locked.creditsPerSec,
      alloysPerSec: locked.alloysPerSec,
    })
  })

  it('passes harnessInvariants at every tier', () => {
    for (const tier of [1, 2, 3, 4, 5]) {
      const run = runEconomySimulation({
        tier,
        initialCredits: 1_000_000,
        initialAlloys: 10_000,
        horizonSeconds: BAND_MID_SECONDS,
      })
      expect(harnessInvariants(run).ok, `tier ${tier}`).toBe(true)
    }
  })

  it('income is non-decreasing across the run (structure levels only grow)', () => {
    const run = runEconomySimulation({
      ...STANDARD,
      initialCredits: 1_000_000,
      horizonSeconds: BAND_MID_SECONDS,
    })
    for (let i = 1; i < run.points.length; i++) {
      expect(run.points[i].income.creditsPerSec).toBeGreaterThanOrEqual(
        run.points[i - 1].income.creditsPerSec,
      )
      expect(run.points[i].income.alloysPerSec).toBeGreaterThanOrEqual(
        run.points[i - 1].income.alloysPerSec,
      )
    }
  })

  it('a custom 30s tick still reconciles every point income with the locked derived rates', () => {
    const run = runEconomySimulation({ ...STANDARD, tickSeconds: 30, horizonSeconds: 3_600 })
    for (const point of run.points) {
      const locked = computePlanetDerived(
        harnessPlanet(run.config.tier, point.population),
        point.structureLevels,
      )
      expect(point.income).toEqual({
        creditsPerSec: locked.creditsPerSec,
        alloysPerSec: locked.alloysPerSec,
      })
    }
  })

  it('the first upgrade point shows exactly one cumulative structure level', () => {
    const run = runEconomySimulation(STANDARD)
    const first = run.points.find((p) =>
      STRUCTURE_IDS.some((id) => p.structureLevels[id] > 0),
    )
    expect(first).toBeDefined()
    const cumulative = STRUCTURE_IDS.reduce((sum, id) => sum + first!.structureLevels[id], 0)
    expect(cumulative).toBe(1)
    expect(run.summary.timeToFirstUpgradeSeconds).toBe(first!.atSeconds)
  })

  it('finalCredits equals the last point credits and stays finite', () => {
    const run = runEconomySimulation(LONG)
    expect(run.summary.finalCredits).toBe(run.points[run.points.length - 1].credits)
    expect(Number.isFinite(run.summary.finalCredits)).toBe(true)
  })

  it('telemetry income reflects the locked derived rates for each band', () => {
    const run = runEconomySimulation({
      ...STANDARD,
      initialCredits: 1_000_000,
      horizonSeconds: BAND_MID_SECONDS + 7_200,
    })
    const lines = harnessTelemetry(run).split('\n')
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      const [band, credits, alloys] = line.split(',')
      const point = [...run.points].reverse().find((p) => p.band === band)
      expect(point, `band ${band}`).toBeDefined()
      expect(credits).toBe(String(point!.income.creditsPerSec))
      expect(alloys).toBe(String(point!.income.alloysPerSec))
    }
  })

  it('income reflects the locked trade-hub multiplier increment (tier 1, hub Lv 1 -> 11 cr/s)', () => {
    const grid = {
      oreMine: 0,
      tradeHub: 1,
      housing: 0,
      hydroponics: 0,
      barracks: 0,
      shipyard: 0,
      defenseTurret: 0,
    }
    const derived = computePlanetDerived(harnessPlanet(1, 1_000), grid)
    expect(derived.creditsPerSec).toBe(11)
    const run = runEconomySimulation({
      ...STANDARD,
      initialCredits: 1_000_000,
      horizonSeconds: 3_600,
    })
    const hubPoint = run.points.find((p) => p.structureLevels.tradeHub >= 1)
    expect(hubPoint).toBeDefined()
    const locked = computePlanetDerived(
      harnessPlanet(run.config.tier, hubPoint!.population),
      hubPoint!.structureLevels,
    )
    expect(hubPoint!.income).toEqual({
      creditsPerSec: locked.creditsPerSec,
      alloysPerSec: locked.alloysPerSec,
    })
  })

  it('tier-2 population grows past the legacy raw cap toward the derived cap (no negative delta)', () => {
    const run = runEconomySimulation({
      tier: 2,
      initialCredits: 1_000_000,
      initialAlloys: 10_000,
      horizonSeconds: BAND_MID_SECONDS,
    })
    const last = run.points[run.points.length - 1]
    const derived = computePlanetDerived(
      harnessPlanet(run.config.tier, last.population),
      last.structureLevels,
    )
    expect(last.population).toBeGreaterThan(5_500)
    expect(last.population).toBeLessThanOrEqual(derived.populationCap)
    for (let i = 1; i < run.points.length; i++) {
      expect(run.points[i].population).toBeGreaterThanOrEqual(
        run.points[i - 1].population,
      )
    }
  })

  it('keeps population at or below the LOCKED derived cap at every point', () => {
    const run = runEconomySimulation({
      tier: 2,
      initialCredits: 1_000_000,
      initialAlloys: 10_000,
      horizonSeconds: BAND_MID_SECONDS,
    })
    for (const point of run.points) {
      const derived = computePlanetDerived(
        harnessPlanet(run.config.tier, point.population),
        point.structureLevels,
      )
      expect(point.population, `point ${point.atSeconds}`).toBeLessThanOrEqual(
        derived.populationCap,
      )
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

  it('with zero starting credits, baseline passive income still funds builds (derived timing)', () => {
    const run = runEconomySimulation({ ...STANDARD, initialCredits: 0, initialAlloys: 0 })
    expect(run.summary.totalUpgrades).toBeGreaterThan(0)
    expect(run.summary.timeToFirstUpgradeSeconds).toBeLessThan(run.config.horizonSeconds)
    const first = run.points.find((p) =>
      STRUCTURE_IDS.some((id) => p.structureLevels[id] > 0),
    )
    expect(first).toBeDefined()
    expect(first!.atSeconds).toBe(run.summary.timeToFirstUpgradeSeconds)
    expect(harnessInvariants(run).ok).toBe(true)
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

  it('catches a tampered timeToFirstUpgradeSeconds on a run with upgrades', () => {
    const run = runEconomySimulation(STANDARD)
    expect(run.summary.totalUpgrades).toBeGreaterThan(0)
    run.summary.timeToFirstUpgradeSeconds = run.summary.timeToFirstUpgradeSeconds + 60
    const result = harnessInvariants(run)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/timeToFirstUpgradeSeconds/)
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
