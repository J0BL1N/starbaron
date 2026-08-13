import { describe, expect, it } from 'vitest'
import { PLANETS } from '../src/sim/data/planets'
import {
  accruePlayer,
  buildStructure,
  catalogueEntryByName,
  claimColony,
  colonise,
  computePlanetDerived,
  createPlayer,
  emptyStructureLevels,
  empireRates,
  gridForPlanet,
  ownedPlanetByName,
  ownedPlanetIdentity,
  planetTotals,
} from '../src/sim/player'
import type { PlayerState } from '../src/sim/player'
import { eligibleHomeWorlds } from '../src/sim/player/claim'
import type { ColoniseOverlay } from '../src/sim/player/claim'
import type { BodyId } from '../src/sim/world/identity'
import { populationCapMultiplier } from '../src/sim/planets'
import { ORE_ALLOYS_PER_MIN } from '../src/sim/structures/effects'
import type { StructureId } from '../src/sim/structures/types'

const NOW = 1_700_000_000_000
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

const ELIGIBLE = eligibleHomeWorlds(PLANETS)
const NO_TAKEN: ReadonlySet<BodyId> = new Set<BodyId>()
const COLONISE_OVERLAY: ColoniseOverlay = {
  globalOwners: new Set<BodyId>(),
  requirements: { hasFleet: true, hasTravel: true },
}

// 'fixture-player' deterministically claims Kepler-1087 b (tier 1, baseline 10,
// no quirks) — a stable plain anchor for deep multi-planet assertions.
const ANCHOR = 'fixture-player'

// Colony picks used across this suite (verified via ownedPlanetIdentity):
//   Kepler-1606 b          tier 3, baseline 30, no quirks
//   EPIC 201595106 b       tier 2, baseline 20, highGravity (ore mine x1.2)
//   2MASS J02192210-3925225 b  tier 5, baseline 50, denseCore (housing only)
//   16 Cyg B b             tier 5, baseline 50, binarySystem (income x1.1)
//   HD 100546 b            tier 5, baseline 50, gasGiant (shipyard x1.1)

function makeEmpire(playerId: string, colonyNames: string[]): PlayerState {
  const player = createPlayer(playerId, NOW, ELIGIBLE, NO_TAKEN)
  const colonies = colonyNames.map((name) => {
    const entry = catalogueEntryByName(PLANETS, name)
    if (entry === null) {
      throw new Error(`unknown fixture planet: ${name}`)
    }
    return claimColony(entry, NOW)
  })
  const structureLevels = { ...player.structureLevels }
  for (const colony of colonies) {
    structureLevels[colony.name] = emptyStructureLevels()
  }
  return { ...player, colonies, structureLevels }
}

function grid(
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

describe('P2-T04-C multi-planet edge cases', () => {
  it('colonise then immediately derive/accrue the fresh colony (no crash)', () => {
    const base = createPlayer(ANCHOR, NOW, ELIGIBLE, NO_TAKEN)
    const player = { ...base, wallet: { ...base.wallet, alloys: 200 } }
    const next = colonise(PLANETS, player, 'Kepler-1606 b', NOW, COLONISE_OVERLAY)
    const derived = computePlanetDerived(
      next.colonies[0],
      gridForPlanet(next, next.colonies[0].name),
    )
    expect(derived.creditsPerSec).toBeCloseTo(30, 10)
    const after = accruePlayer(next, 1_000)
    expect(after.colonies[0].population).toBe(2)
    expect(after.wallet.credits).toBeCloseTo(1_000 + (10 + 30), 6)
    expect(after.colonies).toHaveLength(1)
  })

  it('a colony with zero structures still earns its baseline income', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b'])
    const colony = player.colonies[0]
    expect(gridForPlanet(player, colony.name)).toEqual(emptyStructureLevels())
    expect(colony.baselineIncomePerSec).toBe(30)
    const rates = empireRates(player)
    expect(rates.creditsPerSec).toBeCloseTo(10 + 30, 10)
    const after = accruePlayer(player, 60_000)
    expect(after.wallet.credits).toBeCloseTo(1_000 + (10 + 30) * 60, 6)
    expect(after.colonies[0].population).toBe(120)
  })

  it('two colonies sharing a structure name keep independent levels and rates (deep isolation)', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b', '16 Cyg B b'])
    const a = 'Kepler-1606 b'
    const b = '16 Cyg B b'
    let p = grid(grid(player, a, 'oreMine', 2), b, 'oreMine', 3)
    expect(gridForPlanet(p, p.homePlanet.name).oreMine).toBe(0)
    expect(gridForPlanet(p, a).oreMine).toBe(2)
    expect(gridForPlanet(p, b).oreMine).toBe(3)
    expect(gridForPlanet(p, a)).not.toBe(gridForPlanet(p, b))
    expect(Object.keys(p.structureLevels).sort()).toEqual(
      [p.homePlanet.name, a, b].sort(),
    )
    const aRates = computePlanetDerived(
      ownedPlanetByName(p, a)!,
      gridForPlanet(p, a),
    )
    const bRates = computePlanetDerived(
      ownedPlanetByName(p, b)!,
      gridForPlanet(p, b),
    )
    expect(aRates.alloysPerSec).toBeCloseTo((ORE_ALLOYS_PER_MIN / 60) * 2, 10)
    expect(bRates.alloysPerSec).toBeCloseTo((ORE_ALLOYS_PER_MIN / 60) * 3, 10)
    const after = accruePlayer(p, 60_000)
    expect(after.wallet.alloys).toBeCloseTo(
      (ORE_ALLOYS_PER_MIN / 60) * (2 + 3) * 60,
      6,
    )
    const funded = { ...p, wallet: { credits: 1_000_000, alloys: 0 } }
    const built = buildStructure(funded, a, 'oreMine')
    expect(gridForPlanet(built, a).oreMine).toBe(3)
    expect(gridForPlanet(built, b).oreMine).toBe(3)
    expect(gridForPlanet(built, built.homePlanet.name).oreMine).toBe(0)
  })

  it('home + 3 colonies accrual sum is exact (hand-computed)', () => {
    const player = makeEmpire(ANCHOR, [
      'Kepler-1606 b',
      'EPIC 201595106 b',
      '2MASS J02192210-3925225 b',
    ])
    // Baselines only: none of these colonies carries an income quirk at level 0.
    const creditsPerSec = 10 + 30 + 20 + 50
    expect(empireRates(player).creditsPerSec).toBeCloseTo(creditsPerSec, 10)
    const before = JSON.parse(JSON.stringify(player))
    const after = accruePlayer(player, 60_000)
    expect(after.wallet.credits).toBeCloseTo(1_000 + creditsPerSec * 60, 6)
    expect(after.wallet.alloys).toBe(0)
    expect(after.homePlanet.population).toBe(1_000 + 2 * 60)
    for (const colony of after.colonies) {
      expect(colony.population).toBe(2 * 60)
    }
    expect(planetTotals(after).population).toBe(
      1_000 + 2 * 60 + 3 * 2 * 60,
    )
    expect(JSON.parse(JSON.stringify(player))).toEqual(before)
  })
})

describe('P2-T04-C quirk edges — ore mine', () => {
  const HEAVY = 'EPIC 201595106 b'
  const PLAIN = 'Kepler-1606 b'

  it('a quirked planet alloy rate reflects the quirk; a plain planet is baseline only', () => {
    const player = makeEmpire(ANCHOR, [PLAIN, HEAVY])
    const withMines = grid(grid(player, HEAVY, 'oreMine', 1), PLAIN, 'oreMine', 1)
    const heavyRates = computePlanetDerived(
      ownedPlanetByName(withMines, HEAVY)!,
      gridForPlanet(withMines, HEAVY),
    )
    const plainRates = computePlanetDerived(
      ownedPlanetByName(withMines, PLAIN)!,
      gridForPlanet(withMines, PLAIN),
    )
    expect(heavyRates.alloysPerSec).toBeCloseTo((ORE_ALLOYS_PER_MIN / 60) * 1.2, 10)
    expect(plainRates.alloysPerSec).toBeCloseTo(ORE_ALLOYS_PER_MIN / 60, 10)
    expect(plainRates.creditsPerSec).toBeCloseTo(30, 10)
  })

  it('a planet without any quirk earns exactly its baseline (multiplier 1.0)', () => {
    const player = makeEmpire(ANCHOR, [PLAIN])
    const plain = player.colonies[0]
    const derived = computePlanetDerived(plain, gridForPlanet(player, PLAIN))
    expect(ownedPlanetIdentity(plain).quirks).toEqual([])
    expect(derived.creditsPerSec).toBeCloseTo(30, 10)
    expect(derived.alloysPerSec).toBe(0)
    expect(derived.populationPerSec).toBeCloseTo(2, 10)
    expect(derived.populationCap).toBeCloseTo(5_000 * 1.4, 6)
  })

  it('a quirk never leaks to another planet: only the quirked planet produces boosted alloys', () => {
    const player = makeEmpire(ANCHOR, [PLAIN, HEAVY])
    const withMine = grid(player, HEAVY, 'oreMine', 1)
    const after = accruePlayer(withMine, 60_000)
    expect(after.wallet.alloys).toBeCloseTo((ORE_ALLOYS_PER_MIN / 60) * 1.2 * 60, 6)
    const plainRates = computePlanetDerived(
      ownedPlanetByName(after, PLAIN)!,
      gridForPlanet(after, PLAIN),
    )
    const heavyRates = computePlanetDerived(
      ownedPlanetByName(after, HEAVY)!,
      gridForPlanet(after, HEAVY),
    )
    expect(plainRates.alloysPerSec).toBe(0)
    expect(heavyRates.alloysPerSec).toBeCloseTo((ORE_ALLOYS_PER_MIN / 60) * 1.2, 10)
    const heavyQuirks = ownedPlanetIdentity(ownedPlanetByName(after, HEAVY)!).quirks
    const plainQuirks = ownedPlanetIdentity(ownedPlanetByName(after, PLAIN)!).quirks
    expect(heavyQuirks.map((quirk) => quirk.id)).toContain('highGravity')
    expect(plainQuirks.map((quirk) => quirk.id)).not.toContain('highGravity')
  })
})

describe('P2-T04-C tier cap edges', () => {
  it('T1 vs T5 planet with identical housing: cap difference is the 1.0 vs 2.0 tier multiplier', () => {
    const player = makeEmpire(ANCHOR, ['16 Cyg B b'])
    const t1 = player.homePlanet
    const t5 = player.colonies[0]
    expect(t1.tier).toBe(1)
    expect(t5.tier).toBe(5)
    expect(populationCapMultiplier(t1.tier)).toBe(1.0)
    expect(populationCapMultiplier(t5.tier)).toBe(2.0)
    const withHousing = grid(
      grid(player, t1.name, 'housing', 1),
      t5.name,
      'housing',
      1,
    )
    const t1Rates = computePlanetDerived(
      ownedPlanetByName(withHousing, t1.name)!,
      gridForPlanet(withHousing, t1.name),
    )
    const t5Rates = computePlanetDerived(
      ownedPlanetByName(withHousing, t5.name)!,
      gridForPlanet(withHousing, t5.name),
    )
    expect(t1Rates.populationCap).toBe(6_000)
    expect(t5Rates.populationCap).toBe(12_000)
    expect(t5Rates.populationCap / t1Rates.populationCap).toBeCloseTo(2.0, 10)
  })

  it('population pins at each planet cap even over a very long offline window', () => {
    const player = makeEmpire(ANCHOR, ['16 Cyg B b'])
    const withHousing = grid(
      grid(player, player.homePlanet.name, 'housing', 1),
      player.colonies[0].name,
      'housing',
      1,
    )
    for (const days of [1, 5, 30]) {
      const after = accruePlayer(withHousing, days * DAY_MS)
      expect(after.homePlanet.population).toBe(6_000)
      expect(after.colonies[0].population).toBe(12_000)
      expect(after.homePlanet.population).toBeLessThanOrEqual(6_000)
      expect(after.colonies[0].population).toBeLessThanOrEqual(12_000)
    }
  })
})

describe('P2-T04-C garrison/fleet live per planet (deep)', () => {
  it('garrison accrues per planet with barracks and never on a planet without one', () => {
    let player = makeEmpire(ANCHOR, ['HD 100546 b'])
    player = grid(player, player.homePlanet.name, 'barracks', 1)
    const colony = player.colonies[0]
    player = {
      ...player,
      structureLevels: {
        ...player.structureLevels,
        [colony.name]: { ...gridForPlanet(player, colony.name), shipyard: 1 },
      },
    }
    const after = accruePlayer(player, 60_000)
    expect(after.homePlanet.garrison).toBe(10 * 60)
    expect(after.homePlanet.population).toBe(1_000 - 8 * 60)
    expect(after.colonies[0].garrison).toBe(0)
    expect(after.colonies[0].population).toBe(2 * 60)
  })

  it('barracks on one planet converts only that planet civilians (no cross-drain)', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b'])
    const withBarracks = grid(player, player.homePlanet.name, 'barracks', 1)
    const after = accruePlayer(withBarracks, 60_000)
    expect(after.homePlanet.garrison).toBe(600)
    expect(after.colonies[0].garrison).toBe(0)
    expect(after.colonies[0].population).toBe(120)
  })

  it('fleet is stored per planet and never auto-accrues, even with a shipyard', () => {
    const player = makeEmpire(ANCHOR, ['HD 100546 b'])
    const colony = player.colonies[0]
    const withYard = {
      ...player,
      structureLevels: {
        ...player.structureLevels,
        [colony.name]: { ...gridForPlanet(player, colony.name), shipyard: 1 },
      },
    }
    const cap = computePlanetDerived(
      withYard.colonies[0],
      gridForPlanet(withYard, colony.name),
    ).fleetCap
    expect(cap).toBe(1_000 * 1.1)
    const after = accruePlayer(withYard, 8 * HOUR_MS)
    expect(after.colonies[0].fleet).toBe(0)
    expect(after.homePlanet.fleet).toBe(0)
  })

  it('stored fleet is preserved exactly (deviation check), and over-cap stored fleet clamps', () => {
    const player = makeEmpire(ANCHOR, ['HD 100546 b'])
    const colony = player.colonies[0]
    const withYard = {
      ...player,
      structureLevels: {
        ...player.structureLevels,
        [colony.name]: { ...gridForPlanet(player, colony.name), shipyard: 1 },
      },
    }
    const preserved = {
      ...withYard,
      colonies: [{ ...withYard.colonies[0], fleet: 100 }],
    }
    const afterPreserved = accruePlayer(preserved, 60_000)
    expect(afterPreserved.colonies[0].fleet).toBe(100)
    const over = {
      ...withYard,
      colonies: [{ ...withYard.colonies[0], fleet: 10_000 }],
    }
    const afterOver = accruePlayer(over, 60_000)
    expect(afterOver.colonies[0].fleet).toBe(1_000 * 1.1)
  })

  it('fleet values stay per planet through accrual and sum in planetTotals (no bleed)', () => {
    const player = makeEmpire(ANCHOR, ['HD 100546 b'])
    const home = player.homePlanet.name
    const colony = player.colonies[0].name
    const withFleets = {
      ...player,
      homePlanet: { ...player.homePlanet, fleet: 50 },
      colonies: [{ ...player.colonies[0], fleet: 25 }],
      structureLevels: {
        ...player.structureLevels,
        [home]: { ...gridForPlanet(player, home), shipyard: 1 },
        [colony]: { ...gridForPlanet(player, colony), shipyard: 1 },
      },
    }
    expect(planetTotals(withFleets).fleet).toBe(75)
    const after = accruePlayer(withFleets, 1_000)
    expect(after.homePlanet.fleet).toBe(50)
    expect(after.colonies[0].fleet).toBe(25)
    expect(planetTotals(after).fleet).toBe(75)
  })
})
