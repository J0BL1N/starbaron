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

const ELIGIBLE = eligibleHomeWorlds(PLANETS)
const NO_TAKEN: ReadonlySet<BodyId> = new Set<BodyId>()
const COLONISE_OVERLAY: ColoniseOverlay = {
  globalOwners: new Set<BodyId>(),
  requirements: { hasFleet: true, hasTravel: true },
}

// 'fixture-player' deterministically claims Kepler-1087 b (tier 1, no quirks):
// a stable plain anchor for per-planet tests.
const ANCHOR = 'fixture-player'

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

function grid(player: PlayerState, name: string, id: StructureId, level: number): PlayerState {
  return {
    ...player,
    structureLevels: {
      ...player.structureLevels,
      [name]: { ...gridForPlanet(player, name), [id]: level },
    },
  }
}

describe('P2-T04-B per-planet income sums — shared wallet', () => {
  it('empire creditsPerSec is the sum of every owned planet baseline', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b'])
    const home = player.homePlanet
    const colony = player.colonies[0]
    expect(home.baselineIncomePerSec).toBe(10)
    expect(colony.baselineIncomePerSec).toBe(30)
    expect(empireRates(player).creditsPerSec).toBeCloseTo(
      home.baselineIncomePerSec + colony.baselineIncomePerSec,
      10,
    )
  })

  it('a trade hub on one planet only scales that planet stream; the sum reflects it', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b', '16 Cyg B b'])
    const withHub = grid(player, '16 Cyg B b', 'tradeHub', 1)
    const rates = empireRates(withHub)
    const hubDerived = computePlanetDerived(
      ownedPlanetByName(withHub, '16 Cyg B b')!,
      gridForPlanet(withHub, '16 Cyg B b'),
    )
    expect(hubDerived.creditsPerSec).toBeCloseTo(50 * 1.1 * 1.1, 10)
    expect(rates.creditsPerSec).toBeCloseTo(10 + 30 + 50 * 1.1 * 1.1, 10)
  })

  it('credits accrue into one shared wallet from every planet at once', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b'])
    const after = accruePlayer(player, 60_000)
    expect(after.wallet.credits).toBeCloseTo(1_000 + (10 + 30) * 60, 6)
    expect(after.wallet.alloys).toBe(0)
  })

  it('adding a planet adds exactly its stream to the empire total', () => {
    const player = makeEmpire(ANCHOR, [])
    const before = empireRates(player).creditsPerSec
    const next = colonise(
      PLANETS,
      { ...player, wallet: { ...player.wallet, alloys: 200 } },
      'Kepler-1606 b',
      NOW,
      COLONISE_OVERLAY,
    )
    expect(empireRates(next).creditsPerSec - before).toBeCloseTo(30, 10)
  })
})

describe('P2-T04-B structure isolation — build on A never touches B', () => {
  it('buying an ore mine on A raises A alloys, B stays level 0 with unchanged rate', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b'])
    const a = player.homePlanet.name
    const b = player.colonies[0].name
    const funded = { ...player, wallet: { credits: 5_000, alloys: 0 } }
    const bought = buildStructure(funded, a, 'oreMine')
    const aRates = computePlanetDerived(
      ownedPlanetByName(bought, a)!,
      gridForPlanet(bought, a),
    )
    const bRates = computePlanetDerived(
      ownedPlanetByName(bought, b)!,
      gridForPlanet(bought, b),
    )
    expect(gridForPlanet(bought, a).oreMine).toBe(1)
    expect(gridForPlanet(bought, b).oreMine).toBe(0)
    expect(aRates.alloysPerSec).toBeCloseTo(ORE_ALLOYS_PER_MIN / 60, 10)
    expect(bRates.alloysPerSec).toBe(0)
    expect(bought.wallet.credits).toBe(4_500)
  })

  it('build on A spends the shared wallet and leaves B grid untouched', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b'])
    const a = player.homePlanet.name
    const b = player.colonies[0].name
    const funded = { ...player, wallet: { credits: 5_000, alloys: 0 } }
    const before = { ...gridForPlanet(funded, b) }
    const bought = buildStructure(funded, a, 'tradeHub')
    expect(bought.wallet.credits).toBe(3_000)
    expect(gridForPlanet(bought, a).tradeHub).toBe(1)
    expect(gridForPlanet(bought, b)).toEqual(before)
  })

  it('an insufficient buy throws and leaves wallet and both grids untouched', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b'])
    const a = player.homePlanet.name
    const before = JSON.parse(JSON.stringify(player))
    expect(() => buildStructure(player, a, 'tradeHub')).toThrow(RangeError)
    expect(JSON.parse(JSON.stringify(player))).toEqual(before)
  })

  it('build on an unowned planet name is rejected', () => {
    const player = makeEmpire(ANCHOR, [])
    expect(() => buildStructure(player, 'Not A Real Planet', 'housing')).toThrow(
      RangeError,
    )
  })
})

describe('P2-T04-B population independence + tier caps (D4 wiring)', () => {
  it('home tier 1 caps at 5,000 while a tier 3 colony caps at 5,000 x 1.4', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b'])
    expect(player.homePlanet.tier).toBe(1)
    const homeCap = computePlanetDerived(
      player.homePlanet,
      gridForPlanet(player, player.homePlanet.name),
    ).populationCap
    const colony = player.colonies[0]
    const colonyCap = computePlanetDerived(
      colony,
      gridForPlanet(player, colony.name),
    ).populationCap
    // Home starts with the starter grid (housing 1): effHousing 1 →
    // baseCap = 5000×(1+0.2×1) = 6000, tier-1 multiplier 1.0, no denseCore → 6000.
    expect(homeCap).toBe(6_000)
    expect(colonyCap).toBeCloseTo(5_000 * 1.4, 6)
    expect(populationCapMultiplier(colony.tier)).toBe(1.4)
  })

  it('a fresh zero-pop colony grows at the base 2/sec from 0 (D6)', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b'])
    expect(player.colonies[0].population).toBe(0)
    const after = accruePlayer(player, 60_000)
    expect(after.colonies[0].population).toBe(120)
    // Starter-grid context: the home world now holds housing 1, so its growth is
    // (BASE_GROWTH 2 + HOUSING_GROWTH 2×1) = 4/sec → 1000 + 4×60 = 1240. The
    // colony grid is all-zero (colonise writes emptyStructureLevels) → base 2/sec.
    expect(after.homePlanet.population).toBe(1_000 + 4 * 60)
  })

  it('population grows independently per planet and pins at its own tier cap', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b'])
    const after = accruePlayer(player, 8 * HOUR_MS)
    // Home pins at the housing-1 cap (6000 = 5000×(1+0.2)); the colony pins at
    // its all-zero-grid tier-3 cap (5000×1.4 = 7000).
    expect(after.homePlanet.population).toBe(6_000)
    expect(after.colonies[0].population).toBe(7_000)
    expect(after.homePlanet.population).not.toBe(after.colonies[0].population)
  })

  it('the tier cap multiplier is applied in the per-planet cap math', () => {
    const player = makeEmpire(ANCHOR, ['EPIC 201595106 b'])
    const colony = player.colonies[0]
    const derived = computePlanetDerived(
      colony,
      gridForPlanet(player, colony.name),
    )
    expect(colony.tier).toBe(2)
    expect(derived.populationCap).toBeCloseTo(5_000 * 1.2, 6)
  })

  it('a denseCore planet scales the housing cap bonus by x1.1 before the tier multiplier', () => {
    const player = makeEmpire(ANCHOR, ['2MASS J02192210-3925225 b'])
    const colony = player.colonies[0]
    const withHousing = grid(player, colony.name, 'housing', 1)
    const derived = computePlanetDerived(
      ownedPlanetByName(withHousing, colony.name)!,
      gridForPlanet(withHousing, colony.name),
    )
    expect(colony.tier).toBe(5)
    expect(derived.populationCap).toBeCloseTo(
      (5_000 + 1_000 * 1.1) * 2.0,
      6,
    )
  })
})

describe('P2-T04-B quirks apply per planet (D3 wiring)', () => {
  it('a highGravity planet alloys rate is x1.2; a normal planet is not', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b', 'EPIC 201595106 b'])
    const heavy = 'EPIC 201595106 b'
    const plain = 'Kepler-1606 b'
    const withMines = grid(
      grid(player, heavy, 'oreMine', 1),
      plain,
      'oreMine',
      1,
    )
    const heavyRates = computePlanetDerived(
      ownedPlanetByName(withMines, heavy)!,
      gridForPlanet(withMines, heavy),
    )
    const plainRates = computePlanetDerived(
      ownedPlanetByName(withMines, plain)!,
      gridForPlanet(withMines, plain),
    )
    expect(heavyRates.alloysPerSec).toBeCloseTo((ORE_ALLOYS_PER_MIN / 60) * 1.2, 10)
    expect(plainRates.alloysPerSec).toBeCloseTo(ORE_ALLOYS_PER_MIN / 60, 10)
  })

  it('a binarySystem planet trade hub multiplier is x1.1 on top of the base', () => {
    const player = makeEmpire(ANCHOR, ['16 Cyg B b'])
    const colony = player.colonies[0]
    const withHub = grid(player, colony.name, 'tradeHub', 1)
    const derived = computePlanetDerived(
      ownedPlanetByName(withHub, colony.name)!,
      gridForPlanet(withHub, colony.name),
    )
    expect(derived.creditsPerSec).toBeCloseTo(50 * 1.1 * 1.1, 10)
  })

  it('a gasGiant planet shipyard fleet cap is x1.1', () => {
    const player = makeEmpire(ANCHOR, ['HD 100546 b'])
    const colony = player.colonies[0]
    const withYard = grid(player, colony.name, 'shipyard', 1)
    const derived = computePlanetDerived(
      ownedPlanetByName(withYard, colony.name)!,
      gridForPlanet(withYard, colony.name),
    )
    expect(derived.fleetCap).toBe(1_000 * 1.1)
  })

  it('a coldStar planet population growth is x0.9', () => {
    const player = makeEmpire(ANCHOR, ['AU Mic b'])
    const colony = player.colonies[0]
    const withHydro = grid(player, colony.name, 'hydroponics', 1)
    const derived = computePlanetDerived(
      ownedPlanetByName(withHydro, colony.name)!,
      gridForPlanet(withHydro, colony.name),
    )
    expect(derived.populationPerSec).toBeCloseTo(2 * 1.5 * 0.9, 10)
  })

  it('quirked alloys accrue into the shared wallet from that planet only', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b', 'EPIC 201595106 b'])
    const withMines = grid(
      grid(player, 'EPIC 201595106 b', 'oreMine', 1),
      'Kepler-1606 b',
      'oreMine',
      1,
    )
    const after = accruePlayer(withMines, 60_000)
    const expectedPerSec = (ORE_ALLOYS_PER_MIN / 60) * (1 + 1.2)
    expect(after.wallet.alloys).toBeCloseTo(expectedPerSec * 60, 6)
  })
})

describe('P2-T04-B defense/garrison/fleet live per planet', () => {
  it('defensePower uses that planet own population, not the shared wallet', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b'])
    const colony = player.colonies[0]
    const withColonyPop = {
      ...player,
      colonies: [{ ...colony, population: 10_000 }],
    }
    const home = computePlanetDerived(
      withColonyPop.homePlanet,
      gridForPlanet(withColonyPop, withColonyPop.homePlanet.name),
    )
    const colonyDerived = computePlanetDerived(
      ownedPlanetByName(withColonyPop, colony.name)!,
      gridForPlanet(withColonyPop, colony.name),
    )
    expect(home.defensePower).toBe(0.15 * 1_000)
    expect(colonyDerived.defensePower).toBe(0.15 * 10_000)
  })

  it('barracks fills that planet garrison only; fleet is stored and clamped per planet', () => {
    let player = makeEmpire(ANCHOR, ['HD 100546 b'])
    player = grid(player, player.homePlanet.name, 'barracks', 1)
    const colony = player.colonies[0]
    player = {
      ...player,
      colonies: [{ ...colony, fleet: 5_000 }],
      structureLevels: {
        ...player.structureLevels,
        [colony.name]: { ...gridForPlanet(player, colony.name), shipyard: 1 },
      },
    }
    const after = accruePlayer(player, 60_000)
    expect(after.homePlanet.garrison).toBeCloseTo(10 * 60, 6)
    expect(after.colonies[0].garrison).toBe(0)
    expect(after.colonies[0].fleet).toBe(1_000 * 1.1)
  })

  it('fleet cap without a shipyard clamps any stray fleet to 0', () => {
    const player = makeEmpire(ANCHOR, ['Kepler-1606 b'])
    const colony = player.colonies[0]
    const withFleet = {
      ...player,
      colonies: [{ ...colony, fleet: 42 }],
    }
    const after = accruePlayer(withFleet, 1_000)
    expect(after.colonies[0].fleet).toBe(0)
  })
})
