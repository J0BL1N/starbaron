import { describe, expect, it } from 'vitest'
import { MAX_OFFLINE_BANK_SECONDS, calculateOfflineEarnings } from '../src/sim/core/offline'
import { populationCap } from '../src/sim/core/population'
import { applyGrowth } from '../src/sim/core/population-model'
import type { PopulationState } from '../src/sim/core/population-model'
import {
  offlineProgress,
  offlineSummary,
  validateOfflineResult,
} from '../src/sim/core/offline-model'
import type { OfflineResult } from '../src/sim/core/offline-model'
import { accruePlayer, empireRates } from '../src/sim/player/accrual'
import { claimColony, firstUnclaimedByIndex } from '../src/sim/player/claim'
import { STARTER_STRUCTURES, emptyStructureLevels } from '../src/sim/player/grid'
import { createPlayer } from '../src/sim/player/player'
import type { PlayerState, StructureGrid } from '../src/sim/player/types'
import { queueConstruction } from '../src/sim/structures/queues'
import type { ConstructionQueue } from '../src/sim/structures/queues'

const NOW = 1_700_000_000_000
const ANCHOR = 'offline-anchor'

function basePlayer(): PlayerState {
  const player = createPlayer(ANCHOR, NOW)
  return {
    ...player,
    homePlanet: { ...player.homePlanet, population: 1_000 },
    wallet: { credits: 0, alloys: 0 },
  }
}

function playerWithColony(): PlayerState {
  const player = basePlayer()
  const entry = firstUnclaimedByIndex(player)
  if (entry === null) {
    throw new Error('fixture needs an unclaimed catalogue planet')
  }
  const colony = claimColony(entry, NOW)
  return {
    ...player,
    colonies: [{ ...colony, population: 2_000 }],
    structureLevels: {
      ...player.structureLevels,
      [colony.name]: emptyStructureLevels(),
    },
  }
}

function emptyQueue(player: PlayerState = basePlayer()): ConstructionQueue {
  return { planet: player.homePlanet.name, jobs: [] }
}

function queuedPlayer(): { player: PlayerState; queue: ConstructionQueue } {
  const player = { ...basePlayer(), wallet: { credits: 100_000, alloys: 5_000 } }
  const grid = player.structureLevels[player.homePlanet.name]
  const first = queueConstruction({
    planet: player.homePlanet.name,
    structure: 'housing',
    fromLevel: grid.housing,
    toLevel: grid.housing + 1,
    startedAt: NOW,
    wallet: player.wallet,
    existingJobs: [],
    grid,
  })
  const second = queueConstruction({
    planet: player.homePlanet.name,
    structure: 'housing',
    fromLevel: grid.housing + 1,
    toLevel: grid.housing + 2,
    startedAt: NOW + 30_000,
    wallet: player.wallet,
    existingJobs: first.queue.jobs,
    grid: { ...grid, housing: grid.housing + 1 },
  })
  return { player, queue: second.queue }
}

function popStateFor(
  planet: PlayerState['homePlanet'],
  grid: StructureGrid,
  lastTickAt: number,
): PopulationState {
  return {
    population: planet.population,
    housingLevels: grid.housing,
    hydroponicsLevels: grid.hydroponics,
    lastTickAt,
  }
}

describe('offlineProgress — elapsed / banked / capped mirror offline.ts', () => {
  it('at === lastTickAt yields zero deltas, uncapped, and a valid result', () => {
    const player = playerWithColony()
    const result = offlineProgress({
      player,
      queue: emptyQueue(player),
      at: player.lastTickAt,
    })
    expect(result.elapsedSeconds).toBe(0)
    expect(result.bankedSeconds).toBe(0)
    expect(result.capped).toBe(false)
    expect(result.walletDelta).toEqual({ credits: 0, alloys: 0 })
    expect(result.populationByPlanet[player.homePlanet.name]).toBe(0)
    expect(result.populationByPlanet[player.colonies[0].name]).toBe(0)
    expect(result.completedJobs).toEqual([])
    expect(validateOfflineResult(result)).toEqual({ ok: true, problems: [] })
  })

  it('2h absence → banked equals elapsed, uncapped', () => {
    const player = basePlayer()
    const result = offlineProgress({
      player,
      queue: emptyQueue(player),
      at: player.lastTickAt + 2 * 3600 * 1000,
    })
    expect(result.elapsedSeconds).toBe(7200)
    expect(result.bankedSeconds).toBe(7200)
    expect(result.capped).toBe(false)
  })

  it('10h absence → banked capped at MAX_OFFLINE_BANK_SECONDS, capped true', () => {
    const player = basePlayer()
    const result = offlineProgress({
      player,
      queue: emptyQueue(player),
      at: player.lastTickAt + 10 * 3600 * 1000,
    })
    expect(result.elapsedSeconds).toBe(36_000)
    expect(result.bankedSeconds).toBe(MAX_OFFLINE_BANK_SECONDS)
    expect(result.capped).toBe(true)
  })

  it('exactly 8h → full bank, not capped', () => {
    const player = basePlayer()
    const result = offlineProgress({
      player,
      queue: emptyQueue(player),
      at: player.lastTickAt + MAX_OFFLINE_BANK_SECONDS * 1000,
    })
    expect(result.bankedSeconds).toBe(MAX_OFFLINE_BANK_SECONDS)
    expect(result.capped).toBe(false)
  })

  it('throws when at is earlier than lastTickAt or non-finite', () => {
    const player = basePlayer()
    expect(() =>
      offlineProgress({ player, queue: emptyQueue(player), at: player.lastTickAt - 1 }),
    ).toThrow(RangeError)
    expect(() =>
      offlineProgress({ player, queue: emptyQueue(player), at: Number.NaN }),
    ).toThrow(RangeError)
    expect(() =>
      offlineProgress({ player, queue: emptyQueue(player), at: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError)
  })
})

describe('offlineProgress — credit/alloy delta delegates to calculateOfflineEarnings', () => {
  it('credit delta equals calculateOfflineEarnings for a 2h absence', () => {
    const player = basePlayer()
    const rates = empireRates(player)
    const result = offlineProgress({
      player,
      queue: emptyQueue(player),
      at: player.lastTickAt + 7200 * 1000,
    })
    expect(result.walletDelta.credits).toBe(
      calculateOfflineEarnings(rates.creditsPerSec, 7200),
    )
  })

  it('credit delta is capped at the 8h bank for a 10h absence', () => {
    const player = basePlayer()
    const rates = empireRates(player)
    const result = offlineProgress({
      player,
      queue: emptyQueue(player),
      at: player.lastTickAt + 10 * 3600 * 1000,
    })
    expect(result.walletDelta.credits).toBe(
      calculateOfflineEarnings(rates.creditsPerSec, 36_000),
    )
    expect(result.walletDelta.credits).toBeCloseTo(
      rates.creditsPerSec * MAX_OFFLINE_BANK_SECONDS,
      6,
    )
  })

  it('alloy delta equals calculateOfflineEarnings for the alloy rate', () => {
    const player = basePlayer()
    player.structureLevels = {
      ...player.structureLevels,
      [player.homePlanet.name]: { ...STARTER_STRUCTURES, oreMine: 3 },
    }
    const rates = empireRates(player)
    expect(rates.alloysPerSec).toBeGreaterThan(0)
    const result = offlineProgress({
      player,
      queue: emptyQueue(player),
      at: player.lastTickAt + 3600 * 1000,
    })
    expect(result.walletDelta.alloys).toBeCloseTo(
      calculateOfflineEarnings(rates.alloysPerSec, 3600),
      10,
    )
    expect(result.walletDelta.alloys).toBeCloseTo(rates.alloysPerSec * 3600, 10)
  })

  it('credit delta agrees with accruePlayer at equal elapsed time', () => {
    const player = basePlayer()
    const at = player.lastTickAt + 7200 * 1000
    const result = offlineProgress({ player, queue: emptyQueue(player), at })
    const live = accruePlayer(player, at - player.lastTickAt)
    expect(result.walletDelta.credits).toBeCloseTo(
      live.wallet.credits - player.wallet.credits,
      6,
    )
    expect(result.walletDelta.alloys).toBeCloseTo(
      live.wallet.alloys - player.wallet.alloys,
      6,
    )
  })
})

describe('offlineProgress — population growth', () => {
  it('home planet delta equals applyGrowth over the banked window', () => {
    const player = basePlayer()
    const result = offlineProgress({
      player,
      queue: emptyQueue(player),
      at: player.lastTickAt + 7200 * 1000,
    })
    const grid = player.structureLevels[player.homePlanet.name]
    const base = popStateFor(player.homePlanet, grid, player.lastTickAt)
    const grown = applyGrowth(base, player.lastTickAt + result.bankedSeconds)
    expect(result.populationByPlanet[player.homePlanet.name]).toBe(
      grown.population - player.homePlanet.population,
    )
  })

  it('population grows only within the banked window (excess accrues nothing)', () => {
    const player = basePlayer()
    const result = offlineProgress({
      player,
      queue: emptyQueue(player),
      at: player.lastTickAt + 10 * 3600 * 1000,
    })
    expect(result.capped).toBe(true)
    const grid = player.structureLevels[player.homePlanet.name]
    const base = popStateFor(player.homePlanet, grid, player.lastTickAt)
    const banked = applyGrowth(base, player.lastTickAt + result.bankedSeconds)
    const full = applyGrowth(base, player.lastTickAt + result.elapsedSeconds)
    expect(result.populationByPlanet[player.homePlanet.name]).toBe(
      banked.population - player.homePlanet.population,
    )
    expect(result.populationByPlanet[player.homePlanet.name]).toBeLessThanOrEqual(
      full.population - player.homePlanet.population,
    )
  })

  it('clamps population at the cap (never overshoots)', () => {
    const player = { ...basePlayer() }
    player.homePlanet = { ...player.homePlanet, population: 5_999 }
    const result = offlineProgress({
      player,
      queue: emptyQueue(player),
      at: player.lastTickAt + 2 * 3600 * 1000,
    })
    const delta = result.populationByPlanet[player.homePlanet.name]
    expect(player.homePlanet.population + delta).toBe(populationCap(1))
  })

  it('a planet already at its cap reports a zero population delta', () => {
    const player = { ...basePlayer() }
    player.homePlanet = { ...player.homePlanet, population: populationCap(1) }
    const result = offlineProgress({
      player,
      queue: emptyQueue(player),
      at: player.lastTickAt + 2 * 3600 * 1000,
    })
    expect(result.populationByPlanet[player.homePlanet.name]).toBe(0)
  })

  it('reports a colony delta under the colony name; a zero-population colony still grows', () => {
    const player = playerWithColony()
    const colonyName = player.colonies[0].name
    const result = offlineProgress({
      player,
      queue: emptyQueue(player),
      at: player.lastTickAt + 3600 * 1000,
    })
    expect(Object.keys(result.populationByPlanet).sort()).toEqual(
      [player.homePlanet.name, colonyName].sort(),
    )
    expect(result.populationByPlanet[colonyName]).toBeGreaterThan(0)

    const zero = { ...player, colonies: [{ ...player.colonies[0], population: 0 }] }
    const grown = offlineProgress({
      player: zero,
      queue: emptyQueue(zero),
      at: zero.lastTickAt + 3600 * 1000,
    })
    const delta = grown.populationByPlanet[colonyName]
    expect(Number.isFinite(delta)).toBe(true)
    expect(delta).toBeGreaterThanOrEqual(0)
  })
})

describe('offlineProgress — completedJobs from the queue', () => {
  it('returns due jobs as completed and leaves not-yet-due jobs pending', () => {
    const { player, queue } = queuedPlayer()
    const at = player.lastTickAt + 30_000
    const result = offlineProgress({ player, queue, at })
    expect(result.completedJobs).toHaveLength(1)
    expect(result.completedJobs[0].structure).toBe('housing')
    expect(result.completedJobs[0].status).toBe('complete')
    expect(result.completedJobs[0].finishesAt).toBeLessThanOrEqual(at)
  })

  it('does not mutate the queue', () => {
    const { player, queue } = queuedPlayer()
    const before = queue.jobs.map((job) => ({ ...job }))
    offlineProgress({ player, queue, at: player.lastTickAt + 30_000 })
    expect(queue.jobs).toEqual(before)
    expect(queue.jobs.every((job) => job.status === 'building')).toBe(true)
  })

  it('a job finishing exactly at lastTickAt does NOT complete in a zero window', () => {
    const player = basePlayer()
    const queue: ConstructionQueue = {
      planet: player.homePlanet.name,
      jobs: [
        {
          id: 'job-exact',
          structure: 'housing',
          fromLevel: 1,
          toLevel: 2,
          startedAt: player.lastTickAt - 20_000,
          finishesAt: player.lastTickAt,
          cost: { credits: 345, alloys: 0 },
          status: 'building',
        },
      ],
    }
    const result = offlineProgress({ player, queue, at: player.lastTickAt })
    expect(result.completedJobs).toEqual([])
  })

  it('a job finishing exactly at lastTickAt completes in a NON-zero window', () => {
    const player = basePlayer()
    const queue: ConstructionQueue = {
      planet: player.homePlanet.name,
      jobs: [
        {
          id: 'job-exact',
          structure: 'housing',
          fromLevel: 1,
          toLevel: 2,
          startedAt: player.lastTickAt - 20_000,
          finishesAt: player.lastTickAt,
          cost: { credits: 345, alloys: 0 },
          status: 'building',
        },
      ],
    }
    const result = offlineProgress({ player, queue, at: player.lastTickAt + 1 })
    expect(result.completedJobs.map((job) => job.id)).toEqual(['job-exact'])
    expect(result.completedJobs[0].status).toBe('complete')
  })
})

describe('offlineProgress — anti-duplication delta semantics', () => {
  it('advancing lastTickAt and re-running returns ONLY the second window', () => {
    const player = basePlayer()
    const rates = empireRates(player)
    const t1 = player.lastTickAt + 3600 * 1000
    const t2 = player.lastTickAt + 7200 * 1000
    const first = offlineProgress({ player, queue: emptyQueue(player), at: t1 })
    const advanced = { ...player, lastTickAt: t1 }
    const second = offlineProgress({ player: advanced, queue: emptyQueue(player), at: t2 })
    expect(second.elapsedSeconds).toBe(3600)
    expect(second.walletDelta.credits).toBeCloseTo(rates.creditsPerSec * 3600, 6)
    expect(second.walletDelta.credits).toBeCloseTo(first.walletDelta.credits, 6)
    expect(second.walletDelta.credits).not.toBeCloseTo(rates.creditsPerSec * 7200, 6)
    expect(second.populationByPlanet[player.homePlanet.name]).toBe(
      first.populationByPlanet[player.homePlanet.name],
    )
  })

  it('correct usage (apply each delta once + advance) totals a single full run', () => {
    const player = basePlayer()
    const t1 = player.lastTickAt + 3600 * 1000
    const t2 = player.lastTickAt + 7200 * 1000
    const first = offlineProgress({ player, queue: emptyQueue(player), at: t1 })
    const advanced = { ...player, lastTickAt: t1 }
    const second = offlineProgress({ player: advanced, queue: emptyQueue(player), at: t2 })
    const full = offlineProgress({ player, queue: emptyQueue(player), at: t2 })
    expect(first.walletDelta.credits + second.walletDelta.credits).toBeCloseTo(
      full.walletDelta.credits,
      6,
    )
  })

  it('re-applying the same delta without advancing lastTickAt double-counts', () => {
    const player = basePlayer()
    const t1 = player.lastTickAt + 3600 * 1000
    const t2 = player.lastTickAt + 7200 * 1000
    const first = offlineProgress({ player, queue: emptyQueue(player), at: t1 })
    const full = offlineProgress({ player, queue: emptyQueue(player), at: t2 })
    const buggyTotal = first.walletDelta.credits + full.walletDelta.credits
    expect(buggyTotal).toBeCloseTo(full.walletDelta.credits + first.walletDelta.credits, 6)
    expect(buggyTotal).toBeGreaterThan(full.walletDelta.credits)
  })
})

describe('offlineSummary — deterministic, no locale', () => {
  function result(overrides: Partial<OfflineResult> = {}): OfflineResult {
    return {
      walletDelta: { credits: 0, alloys: 0 },
      populationByPlanet: {},
      completedJobs: [],
      bankedSeconds: 0,
      elapsedSeconds: 0,
      capped: false,
      ...overrides,
    }
  }

  it('renders the reference format', () => {
    expect(
      offlineSummary(
        result({
          walletDelta: { credits: 120_000, alloys: 0 },
          populationByPlanet: { Terra: 3_200 },
          bankedSeconds: 4 * 3600,
          elapsedSeconds: 4 * 3600,
        }),
      ),
    ).toBe('While you were away (4h)… +120,000 cr · +3,200 pop')
  })

  it('comma-groups thousands without locale APIs', () => {
    expect(
      offlineSummary(
        result({
          walletDelta: { credits: 1_234_567, alloys: 89 },
          populationByPlanet: { A: 0 },
          bankedSeconds: 3600,
          elapsedSeconds: 3600,
        }),
      ),
    ).toBe('While you were away (1h)… +1,234,567 cr · +89 alloys')
  })

  it('omits zero segments', () => {
    expect(
      offlineSummary(
        result({
          walletDelta: { credits: 5_000, alloys: 0 },
          populationByPlanet: { A: 0 },
          bankedSeconds: 2 * 3600,
          elapsedSeconds: 2 * 3600,
        }),
      ),
    ).toBe('While you were away (2h)… +5,000 cr')
  })

  it('formats durations under an hour as minutes and seconds', () => {
    expect(
      offlineSummary(
        result({
          walletDelta: { credits: 1, alloys: 0 },
          bankedSeconds: 30 * 60,
          elapsedSeconds: 30 * 60,
        }),
      ),
    ).toBe('While you were away (30m)… +1 cr')
    expect(
      offlineSummary(
        result({
          walletDelta: { credits: 1, alloys: 0 },
          bankedSeconds: 45,
          elapsedSeconds: 45,
        }),
      ),
    ).toBe('While you were away (45s)… +1 cr')
  })

  it('renders a zero-result line', () => {
    expect(offlineSummary(result())).toBe('While you were away (0s)… +0 cr')
  })

  it('is deterministic over a real offlineProgress result', () => {
    const player = basePlayer()
    const progress = offlineProgress({
      player,
      queue: emptyQueue(player),
      at: player.lastTickAt + 7200 * 1000,
    })
    const rendered = offlineSummary(progress)
    expect(rendered).toBe(offlineSummary(progress))
    expect(rendered).toContain('While you were away (2h)')
  })
})

describe('validateOfflineResult', () => {
  const valid: OfflineResult = {
    walletDelta: { credits: 1_000, alloys: 50 },
    populationByPlanet: { Terra: 2_000 },
    completedJobs: [],
    bankedSeconds: 7200,
    elapsedSeconds: 7200,
    capped: false,
  }

  it('reports ok for a valid result', () => {
    expect(validateOfflineResult(valid)).toEqual({ ok: true, problems: [] })
  })

  it('catches a negative credits delta', () => {
    const result = validateOfflineResult({
      ...valid,
      walletDelta: { credits: -1, alloys: 50 },
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain(
      'walletDelta.credits must be a finite non-negative number',
    )
  })

  it('catches non-finite wallet deltas', () => {
    const nan = validateOfflineResult({
      ...valid,
      walletDelta: { credits: Number.NaN, alloys: 50 },
    })
    expect(nan.ok).toBe(false)
    const infinity = validateOfflineResult({
      ...valid,
      walletDelta: { credits: 1, alloys: Number.POSITIVE_INFINITY },
    })
    expect(infinity.ok).toBe(false)
  })

  it('catches bankedSeconds exceeding elapsedSeconds', () => {
    const result = validateOfflineResult({ ...valid, bankedSeconds: 7201 })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('bankedSeconds must not exceed elapsedSeconds')
  })

  it('catches bankedSeconds above the 8h bank', () => {
    const result = validateOfflineResult({
      ...valid,
      bankedSeconds: MAX_OFFLINE_BANK_SECONDS + 1,
      elapsedSeconds: MAX_OFFLINE_BANK_SECONDS + 2,
      capped: true,
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain(
      'bankedSeconds must not exceed MAX_OFFLINE_BANK_SECONDS',
    )
  })

  it('catches an under-banked result that skips banked time', () => {
    const result = validateOfflineResult({
      ...valid,
      bankedSeconds: 3600,
      elapsedSeconds: 7200,
      capped: true,
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain(
      'bankedSeconds must equal min(elapsedSeconds, MAX_OFFLINE_BANK_SECONDS)',
    )
  })

  it('catches a capped flag inconsistent with the seconds', () => {
    const result = validateOfflineResult({
      ...valid,
      bankedSeconds: 7200,
      elapsedSeconds: 7200,
      capped: true,
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain(
      'capped flag inconsistent with elapsed/banked seconds',
    )
  })

  it('catches non-finite population and elapsed fields', () => {
    const population = validateOfflineResult({
      ...valid,
      populationByPlanet: { Terra: Number.NaN },
    })
    expect(population.ok).toBe(false)
    expect(population.problems).toContain('population delta for Terra must be finite')
    const elapsed = validateOfflineResult({
      ...valid,
      elapsedSeconds: Number.NaN,
    })
    expect(elapsed.ok).toBe(false)
    expect(elapsed.problems).toContain('elapsedSeconds must be a finite non-negative number')
  })

  it('catches a negative population delta', () => {
    const result = validateOfflineResult({
      ...valid,
      populationByPlanet: { Terra: -1 },
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('population delta for Terra must be non-negative')
  })
})
