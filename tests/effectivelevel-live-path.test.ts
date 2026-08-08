import { describe, expect, it } from 'vitest'
import { effectiveLevel } from '../src/sim/planets/levels'
import {
  accruePlayer,
  computePlanetDerived,
  createPlayer,
  emptyStructureLevels,
  gridForPlanet,
} from '../src/sim/player'
import type { PlayerState } from '../src/sim/player'
import { defensePower } from '../src/sim/structures/effects'
import type { StructureId } from '../src/sim/structures/types'

const NOW = 1_700_000_000_000

// 'fixture-player' deterministically claims Kepler-1087 b (tier 1, no quirks):
// a stable plain anchor so no quirk multiplier interferes with the numbers.
const ANCHOR = 'fixture-player'

function withGrid(
  player: PlayerState,
  name: string,
  id: StructureId,
  level: number,
): PlayerState {
  return {
    ...player,
    structureLevels: {
      ...player.structureLevels,
      [name]: { ...gridForPlanet(player, name), [id]: level },
    },
  }
}

function homeGrid(player: PlayerState, id: StructureId, level: number): PlayerState {
  return withGrid(player, player.homePlanet.name, id, level)
}

function derivedFor(player: PlayerState) {
  return computePlanetDerived(player.homePlanet, gridForPlanet(player, player.homePlanet.name))
}

describe('P2 whole-phase correction — effectiveLevel in the LIVE sim (not just structureEffect direct)', () => {
  it('defensePower() itself halves turret levels beyond 10 (level 11 and 21)', () => {
    const pop = 1_000
    expect(defensePower(11, pop)).toBe(
      500 * effectiveLevel(11) + 0.15 * pop,
    )
    expect(defensePower(11, pop)).toBe(5_400)
    expect(defensePower(21, pop)).toBe(
      500 * effectiveLevel(21) + 0.15 * pop,
    )
    expect(defensePower(21, pop)).toBe(7_900)
  })

  it('computePlanetDerived defensePower respects the half-after-10 rule at turret level 11', () => {
    const player = homeGrid(createPlayer(ANCHOR, NOW), 'defenseTurret', 11)
    const derived = derivedFor(player)
    expect(gridForPlanet(player, player.homePlanet.name).defenseTurret).toBe(11)
    expect(derived.defensePower).toBe(5_400)
    expect(derived.defensePower).not.toBe(5_500 + 0.15 * 1_000)
  })

  it('computePlanetDerived defensePower respects the half-after-10 rule at turret level 21', () => {
    const player = homeGrid(createPlayer(ANCHOR, NOW), 'defenseTurret', 21)
    const derived = derivedFor(player)
    expect(derived.defensePower).toBe(
      500 * effectiveLevel(21) + 0.15 * 1_000,
    )
    expect(derived.defensePower).toBe(7_900)
    expect(derived.defensePower).not.toBe(500 * 21 + 0.15 * 1_000)
  })

  it('computePlanetDerived housing growth uses effectiveLevel beyond 10', () => {
    const at10 = derivedFor(homeGrid(createPlayer(ANCHOR, NOW), 'housing', 10))
    const at11 = derivedFor(homeGrid(createPlayer(ANCHOR, NOW), 'housing', 11))
    expect(at10.populationPerSec).toBe(2 + 2 * effectiveLevel(10))
    expect(at11.populationPerSec).toBe(2 + 2 * effectiveLevel(11))
    expect(at11.populationPerSec).toBe(23)
    // the 10 -> 11 marginal growth is halved: +1/sec, not +2/sec
    expect(at11.populationPerSec - at10.populationPerSec).toBeCloseTo(1, 12)
    expect(at11.populationPerSec).not.toBe(2 + 2 * 11)
  })

  it('computePlanetDerived housing pop cap uses effectiveLevel beyond 10', () => {
    const player = homeGrid(createPlayer(ANCHOR, NOW), 'housing', 11)
    const derived = derivedFor(player)
    expect(derived.populationCap).toBe(5_000 * (1 + 0.2 * effectiveLevel(11)))
    expect(derived.populationCap).toBe(15_500)
    expect(derived.populationCap).not.toBe(5_000 * (1 + 0.2 * 11))
  })

  it('computePlanetDerived hydroponics multiplier uses effectiveLevel beyond 10', () => {
    const player = homeGrid(createPlayer(ANCHOR, NOW), 'hydroponics', 11)
    const derived = derivedFor(player)
    // growth = base 2/sec x (1 + 0.5 x effectiveLevel(11))
    expect(derived.populationPerSec).toBeCloseTo(2 * (1 + 0.5 * effectiveLevel(11)), 12)
    expect(derived.populationPerSec).toBeCloseTo(12.5, 12)
    expect(derived.populationPerSec).not.toBeCloseTo(2 * (1 + 0.5 * 11), 12)
  })

  it('accruePlayer live accrual path respects half-after-10 housing growth', () => {
    const player = homeGrid(createPlayer(ANCHOR, NOW), 'housing', 11)
    const growth = 2 + 2 * effectiveLevel(11)
    const after = accruePlayer(player, 10_000)
    expect(after.homePlanet.population).toBeCloseTo(1_000 + growth * 10, 12)
    expect(after.homePlanet.population).toBe(1_230)
    expect(after.homePlanet.population).not.toBe(1_000 + (2 + 2 * 11) * 10)
  })

  it('accruePlayer live accrual path respects half-after-10 hydroponics growth', () => {
    const player = homeGrid(createPlayer(ANCHOR, NOW), 'hydroponics', 11)
    const growth = 2 * (1 + 0.5 * effectiveLevel(11))
    const after = accruePlayer(player, 10_000)
    expect(after.homePlanet.population).toBeCloseTo(1_000 + growth * 10, 12)
    expect(after.homePlanet.population).toBe(1_125)
    expect(after.homePlanet.population).not.toBe(1_000 + 2 * (1 + 0.5 * 11) * 10)
  })

  it('accruePlayer at turret level 21 derives the effective-level defense power', () => {
    const player = homeGrid(createPlayer(ANCHOR, NOW), 'defenseTurret', 21)
    const after = accruePlayer(player, 1_000)
    const derived = derivedFor(after)
    expect(derived.defensePower).toBe(
      500 * effectiveLevel(21) + 0.15 * after.homePlanet.population,
    )
    expect(derived.defensePower).toBe(500 * effectiveLevel(21) + 0.15 * 1_002)
    expect(derived.defensePower).not.toBe(500 * 21 + 0.15 * 1_002)
  })

  it('accruePlayer at turret level 11 derives the effective-level defense power (live accrual)', () => {
    const player = homeGrid(createPlayer(ANCHOR, NOW), 'defenseTurret', 11)
    const after = accruePlayer(player, 1_000)
    const derived = derivedFor(after)
    expect(500 * effectiveLevel(11)).toBe(5_250)
    expect(derived.defensePower).toBe(
      500 * effectiveLevel(11) + 0.15 * after.homePlanet.population,
    )
    expect(derived.defensePower).toBe(5_400.3)
    expect(derived.defensePower).not.toBe(500 * 11 + 0.15 * 1_002)
  })

  it('a level-0 grid still produces the pre-change numbers (no regression below 10)', () => {
    const player = createPlayer(ANCHOR, NOW)
    const grid = gridForPlanet(player, player.homePlanet.name)
    expect(grid).toEqual(emptyStructureLevels())
    const derived = derivedFor(player)
    expect(derived.populationPerSec).toBe(2)
    expect(derived.populationCap).toBe(5_000)
    expect(derived.defensePower).toBe(0.15 * 1_000)
  })
})
