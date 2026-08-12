import { describe, expect, it } from 'vitest'
import { baselinePassiveIncome } from '../src/sim/core/economy'
import type { PlanetCatalogueEntry, PlanetTier } from '../src/sim/data/planets'
import { populationCapMultiplier } from '../src/sim/planets/levels'
import {
  computePlanetDerived,
  empireRates,
  gridForPlanet,
  planetTotals,
} from '../src/sim/player/accrual'
import { CATALOGUE_SLUG } from '../src/sim/player/assignment'
import { emptyStructureLevels } from '../src/sim/player/grid'
import type { OwnedPlanet, PlayerState, StructureGrid } from '../src/sim/player/types'
import { defensePower } from '../src/sim/structures/effects'
import type { StructureId } from '../src/sim/structures/types'
import { systemId } from '../src/sim/world/identity'
import { empireOverviewFor, filterEmpire, sortEmpire } from '../src/sim/ui/empire-overview'
import type { EmpireOverview, EmpireRow } from '../src/sim/ui/empire-overview'

const NOW = 1_700_000_000_000

function catalogueEntry(
  name: string,
  hostname: string,
  tier: PlanetTier,
): PlanetCatalogueEntry {
  return { name, hostname, systemCount: 1, tier }
}

/**
 * Quirk-free OwnedPlanet fixture: the minimal entry (systemCount 1, no
 * radius/mass/starType) triggers no quirks, so computePlanetDerived runs the
 * pure locked composition — income is the tier baseline (10 x tier) unless a
 * grid adds structures.
 */
function owned(
  name: string,
  hostname: string,
  tier: PlanetTier,
  overrides: Partial<OwnedPlanet> = {},
): OwnedPlanet {
  const entry = catalogueEntry(name, hostname, tier)
  return {
    name,
    entry: structuredClone(entry),
    tier,
    baselineIncomePerSec: baselinePassiveIncome(tier),
    populationCapMultiplier: populationCapMultiplier(tier),
    claimedAt: NOW,
    isHome: false,
    unconquerable: false,
    population: 1_000,
    garrison: 0,
    fleet: 0,
    ...overrides,
  }
}

function home(overrides: Partial<OwnedPlanet> = {}): OwnedPlanet {
  return owned('Home Prime', 'Alpha Star', 2, {
    isHome: true,
    unconquerable: true,
    population: 2_000,
    ...overrides,
  })
}

function homeAt(
  name: string,
  hostname: string,
  overrides: Partial<OwnedPlanet> = {},
): OwnedPlanet {
  return owned(name, hostname, 2, {
    isHome: true,
    unconquerable: true,
    population: 2_000,
    ...overrides,
  })
}

function colony(
  name: string,
  hostname: string,
  tier: PlanetTier,
  overrides: Partial<OwnedPlanet> = {},
): OwnedPlanet {
  return owned(name, hostname, tier, overrides)
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const homePlanet = home()
  return {
    playerId: 'player-empire',
    homePlanet,
    colonies: [],
    wallet: { credits: 0, alloys: 0 },
    structureLevels: { [homePlanet.name]: emptyStructureLevels() },
    lastTickAt: NOW,
    ...overrides,
  }
}

function gridWith(overrides: Partial<Record<StructureId, number>>): StructureGrid {
  return { ...emptyStructureLevels(), ...overrides }
}

function withGrids(player: PlayerState, grids: Record<string, StructureGrid>): PlayerState {
  return { ...player, structureLevels: { ...player.structureLevels, ...grids } }
}

function overviewWith(rows: EmpireRow[]): EmpireOverview {
  return {
    playerId: 'player-empire',
    empireName: 'Fixture Empire',
    totals: {
      planets: rows.length,
      systems: 1,
      population: 0,
      creditsPerSec: 0,
      alloysPerSec: 0,
      defense: 0,
    },
    rows,
    topPlanet: null,
    sortedBy: 'population',
    filter: 'all',
  }
}

describe('P4-T06 rows per planet', () => {
  it('emits one row for the home planet when there are no colonies', () => {
    const overview = empireOverviewFor({ player: makePlayer(), at: NOW })
    expect(overview.rows).toHaveLength(1)
    expect(overview.rows[0]).toMatchObject({ name: 'Home Prime', isHome: true })
  })

  it('emits one row per owned planet (home + each colony)', () => {
    const player = makePlayer({
      colonies: [colony('Beta One', 'Beta Star', 1), colony('Gamma Two', 'Gamma Star', 3)],
    })
    const overview = empireOverviewFor({ player, at: NOW })
    expect(overview.rows).toHaveLength(3)
    expect(overview.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(['Home Prime', 'Beta One', 'Gamma Two']),
    )
  })

  it('row fields mirror the OwnedPlanet (name, tier, isHome, population)', () => {
    const planet = colony('Beta One', 'Beta Star', 1, { population: 777, tier: 3 })
    const overview = empireOverviewFor({ player: makePlayer({ colonies: [planet] }), at: NOW })
    const row = overview.rows.find((candidate) => candidate.name === 'Beta One')
    expect(row).toMatchObject({ name: 'Beta One', tier: 3, isHome: false, population: 777 })
  })

  it('row income equals the LOCKED computePlanetDerived for the planet grid', () => {
    const player = withGrids(
      makePlayer({ homePlanet: home({ population: 2_500 }) }),
      { 'Home Prime': gridWith({ oreMine: 3, tradeHub: 2, shipyard: 1, housing: 2 }) },
    )
    const overview = empireOverviewFor({ player, at: NOW })
    const derived = computePlanetDerived(player.homePlanet, gridForPlanet(player, 'Home Prime'))
    expect(overview.rows[0].income).toEqual({
      creditsPerSec: derived.creditsPerSec,
      alloysPerSec: derived.alloysPerSec,
    })
    expect(overview.rows[0].income.creditsPerSec).toBeGreaterThan(0)
  })

  it('row defense equals the LOCKED defensePower(turretLevels, population)', () => {
    const player = withGrids(
      makePlayer({ homePlanet: home({ population: 2_500 }) }),
      { 'Home Prime': gridWith({ defenseTurret: 2 }) },
    )
    const overview = empireOverviewFor({ player, at: NOW })
    expect(overview.rows[0].defense).toBe(defensePower(2, 2_500))
  })

  it('row systemId is the LOCKED systemId(CATALOGUE_SLUG, hostname)', () => {
    const planet = colony('Beta One', 'Beta Star', 1)
    const overview = empireOverviewFor({ player: makePlayer({ colonies: [planet] }), at: NOW })
    const row = overview.rows.find((candidate) => candidate.name === 'Beta One')
    expect(row?.systemId).toBe(systemId(CATALOGUE_SLUG, 'Beta Star'))
    expect(row?.systemId).toBe('sys:catalogue|Beta Star')
  })
})

describe('P4-T06 totals', () => {
  it('creditsPerSec/alloysPerSec equal the LOCKED empireRates', () => {
    const player = withGrids(
      makePlayer({
        colonies: [colony('Beta One', 'Beta Star', 1), colony('Gamma Two', 'Gamma Star', 3)],
      }),
      {
        'Home Prime': gridWith({ tradeHub: 2 }),
        'Beta One': gridWith({ oreMine: 1 }),
        'Gamma Two': gridWith({ shipyard: 1 }),
      },
    )
    const overview = empireOverviewFor({ player, at: NOW })
    const rates = empireRates(player)
    expect(overview.totals.creditsPerSec).toBe(rates.creditsPerSec)
    expect(overview.totals.alloysPerSec).toBe(rates.alloysPerSec)
  })

  it('population equals the LOCKED planetTotals.population', () => {
    const player = makePlayer({
      homePlanet: home({ population: 2_500 }),
      colonies: [colony('Beta One', 'Beta Star', 1, { population: 300 })],
    })
    const overview = empireOverviewFor({ player, at: NOW })
    expect(overview.totals.population).toBe(planetTotals(player).population)
    expect(overview.totals.population).toBe(2_800)
  })

  it('planets equals the home + colonies count (single planet edge)', () => {
    expect(empireOverviewFor({ player: makePlayer(), at: NOW }).totals.planets).toBe(1)
    const player = makePlayer({
      colonies: [
        colony('B', 'B Star', 1),
        colony('C', 'C Star', 1),
        colony('D', 'D Star', 1),
      ],
    })
    expect(empireOverviewFor({ player, at: NOW }).totals.planets).toBe(4)
  })

  it('defense equals the sum of the LOCKED per-planet defensePower', () => {
    const player = withGrids(
      makePlayer({
        homePlanet: home({ population: 2_500 }),
        colonies: [colony('Beta One', 'Beta Star', 1, { population: 1_200 })],
      }),
      {
        'Home Prime': gridWith({ defenseTurret: 2 }),
        'Beta One': gridWith({ defenseTurret: 1 }),
      },
    )
    const overview = empireOverviewFor({ player, at: NOW })
    expect(overview.totals.defense).toBe(defensePower(2, 2_500) + defensePower(1, 1_200))
  })

  it('systems equals the count of DISTINCT system ids across home + colonies', () => {
    const player = makePlayer({
      homePlanet: homeAt('Alpha Prime', 'Alpha Star'),
      colonies: [colony('Alpha Two', 'Alpha Star', 1), colony('Beta One', 'Beta Star', 1)],
    })
    const overview = empireOverviewFor({ player, at: NOW })
    expect(overview.totals.systems).toBe(2)
    expect(overview.totals.planets).toBe(3)
  })
})

describe('P4-T06 top planet', () => {
  it('topPlanet is the row with the maximum population', () => {
    const player = makePlayer({
      homePlanet: home({ population: 2_000 }),
      colonies: [
        colony('Low', 'L Star', 1, { population: 500 }),
        colony('High', 'H Star', 3, { population: 9_000 }),
      ],
    })
    const overview = empireOverviewFor({ player, at: NOW })
    expect(overview.topPlanet).toMatchObject({ name: 'High', population: 9_000 })
  })

  it('equal populations break ties by name ascending', () => {
    const player = makePlayer({
      homePlanet: home({ population: 1_000 }),
      colonies: [colony('Beta', 'B Star', 1, { population: 1_000 })],
    })
    const overview = empireOverviewFor({ player, at: NOW })
    expect(overview.topPlanet?.name).toBe('Beta')
  })

  it('single planet → topPlanet is that planet', () => {
    const overview = empireOverviewFor({ player: makePlayer(), at: NOW })
    expect(overview.topPlanet).toMatchObject({ name: 'Home Prime' })
  })

  it('is re-derived from the visible set after filtering', () => {
    const player = makePlayer({
      homePlanet: home({ population: 9_000 }),
      colonies: [colony('Small', 'S Star', 1, { population: 100 })],
    })
    const overview = empireOverviewFor({ player, at: NOW })
    expect(overview.topPlanet?.name).toBe('Home Prime')
    const colonies = filterEmpire(overview, 'colonies')
    expect(colonies.topPlanet).toMatchObject({ name: 'Small', population: 100 })
  })
})

describe('P4-T06 sortEmpire', () => {
  it('empireOverviewFor defaults to population descending and filter all', () => {
    const player = makePlayer({
      homePlanet: home({ population: 1_000 }),
      colonies: [
        colony('Mid', 'M Star', 1, { population: 5_000 }),
        colony('Low', 'L Star', 1, { population: 100 }),
      ],
    })
    const overview = empireOverviewFor({ player, at: NOW })
    expect(overview.sortedBy).toBe('population')
    expect(overview.filter).toBe('all')
    expect(overview.rows.map((row) => row.name)).toEqual(['Mid', 'Home Prime', 'Low'])
  })

  it('population sort is descending with name-ascending ties', () => {
    const player = makePlayer({
      homePlanet: home({ population: 1_000 }),
      colonies: [
        colony('Zed', 'Z Star', 1, { population: 5_000 }),
        colony('Alpha', 'A Star', 1, { population: 1_000 }),
      ],
    })
    const overview = sortEmpire(empireOverviewFor({ player, at: NOW }), 'population')
    expect(overview.sortedBy).toBe('population')
    expect(overview.rows.map((row) => row.name)).toEqual(['Zed', 'Alpha', 'Home Prime'])
  })

  it('income sort is creditsPerSec descending (primary income stream)', () => {
    const player = makePlayer({
      homePlanet: home({ population: 1_000 }),
      colonies: [colony('Rich', 'R Star', 3), colony('Poor', 'P Star', 1)],
    })
    const overview = sortEmpire(empireOverviewFor({ player, at: NOW }), 'income')
    expect(overview.rows.map((row) => row.name)).toEqual(['Rich', 'Home Prime', 'Poor'])
  })

  it('name sort is name ascending', () => {
    const player = makePlayer({
      homePlanet: homeAt('Charlie Prime', 'C Star'),
      colonies: [colony('Alpha One', 'A Star', 1), colony('Bravo Two', 'B Star', 2)],
    })
    const overview = sortEmpire(empireOverviewFor({ player, at: NOW }), 'name')
    expect(overview.rows.map((row) => row.name)).toEqual([
      'Alpha One',
      'Bravo Two',
      'Charlie Prime',
    ])
  })

  it('equal primary keys break by name then systemId (deterministic)', () => {
    const twin = (systemIdValue: string): EmpireRow => ({
      name: 'Twin',
      tier: 2,
      isHome: false,
      population: 1_000,
      income: { creditsPerSec: 20, alloysPerSec: 0 },
      defense: 150,
      systemId: systemIdValue,
    })
    const overview = overviewWith([twin('sys:catalogue|Host-B'), twin('sys:catalogue|Host-A')])
    const sorted = sortEmpire(overview, 'population')
    expect(sorted.rows.map((row) => row.systemId)).toEqual([
      'sys:catalogue|Host-A',
      'sys:catalogue|Host-B',
    ])
  })

  it('is immutable — returns a new overview and leaves the input untouched', () => {
    const player = makePlayer({ colonies: [colony('Zed', 'Z Star', 1, { population: 5_000 })] })
    const before = empireOverviewFor({ player, at: NOW })
    const snapshot = structuredClone(before)
    const sorted = sortEmpire(before, 'name')
    expect(sorted).not.toBe(before)
    expect(sorted.rows).not.toBe(before.rows)
    expect(before).toEqual(snapshot)
  })
})

describe('P4-T06 filterEmpire', () => {
  it("'all' keeps every row and the full totals (identity projection)", () => {
    const player = makePlayer({ colonies: [colony('Beta One', 'Beta Star', 1)] })
    const overview = empireOverviewFor({ player, at: NOW })
    const filtered = filterEmpire(overview, 'all')
    expect(filtered.filter).toBe('all')
    expect(filtered.rows).toHaveLength(2)
    expect(filtered).toEqual(overview)
  })

  it("'home' keeps only the home row and its totals", () => {
    const player = makePlayer({
      homePlanet: home({ population: 2_000 }),
      colonies: [colony('Beta One', 'Beta Star', 3, { population: 1_000 })],
    })
    const overview = empireOverviewFor({ player, at: NOW })
    const filtered = filterEmpire(overview, 'home')
    expect(filtered.rows).toHaveLength(1)
    expect(filtered.rows[0]).toMatchObject({ name: 'Home Prime', isHome: true })
    expect(filtered.totals).toMatchObject({ planets: 1, systems: 1, population: 2_000 })
    expect(filtered.topPlanet?.name).toBe('Home Prime')
  })

  it("'colonies' recomputes totals over the visible rows", () => {
    const player = makePlayer({
      homePlanet: home({ population: 2_000 }),
      colonies: [
        colony('Alpha Two', 'Alpha Star', 2, { population: 1_000 }),
        colony('Beta One', 'Beta Star', 1, { population: 500 }),
      ],
    })
    const overview = empireOverviewFor({ player, at: NOW })
    const filtered = filterEmpire(overview, 'colonies')
    expect(filtered.rows.map((row) => row.name)).toEqual(['Alpha Two', 'Beta One'])
    expect(filtered.totals).toMatchObject({ planets: 2, systems: 2, population: 1_500 })
    expect(filtered.totals.creditsPerSec).toBe(10 * 2 + 10 * 1)
    expect(filtered.topPlanet?.name).toBe('Alpha Two')
  })

  it("'colonies' with no colonies → empty rows, zero totals, topPlanet null", () => {
    const overview = empireOverviewFor({ player: makePlayer(), at: NOW })
    const filtered = filterEmpire(overview, 'colonies')
    expect(filtered.rows).toHaveLength(0)
    expect(filtered.totals).toEqual({
      planets: 0,
      systems: 0,
      population: 0,
      creditsPerSec: 0,
      alloysPerSec: 0,
      defense: 0,
    })
    expect(filtered.topPlanet).toBeNull()
  })

  it('totals reflect the visible set — systems shrink when a host is filtered out', () => {
    const player = makePlayer({
      homePlanet: homeAt('Alpha Prime', 'Alpha Star'),
      colonies: [colony('Alpha Two', 'Alpha Star', 1), colony('Beta One', 'Beta Star', 1)],
    })
    const overview = empireOverviewFor({ player, at: NOW })
    expect(overview.totals.systems).toBe(2)
    const homeOnly = filterEmpire(overview, 'home')
    expect(homeOnly.totals.systems).toBe(1)
  })

  it('is immutable — leaves the input untouched', () => {
    const overview = empireOverviewFor({
      player: makePlayer({ colonies: [colony('Beta One', 'Beta Star', 1)] }),
      at: NOW,
    })
    const snapshot = structuredClone(overview)
    const filtered = filterEmpire(overview, 'colonies')
    expect(filtered).not.toBe(overview)
    expect(overview).toEqual(snapshot)
  })
})

describe('P4-T06 determinism and validation', () => {
  it('is deterministic and never mutates the player input', () => {
    const player = makePlayer({
      homePlanet: home({ population: 1_500 }),
      colonies: [colony('Beta One', 'Beta Star', 3, { population: 800 })],
    })
    const before = structuredClone(player)
    const first = empireOverviewFor({ player, at: NOW })
    const second = empireOverviewFor({ player, at: NOW })
    expect(second).toEqual(first)
    expect(player).toEqual(before)
  })

  it('empireName derives from the home world (PlayerState carries no empire name)', () => {
    const overview = empireOverviewFor({ player: makePlayer(), at: NOW })
    expect(overview.playerId).toBe('player-empire')
    expect(overview.empireName).toBe('Home Prime')
  })

  it('throws RangeError for a non-positive or non-finite at', () => {
    const player = makePlayer()
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => empireOverviewFor({ player, at: bad })).toThrow(RangeError)
    }
  })
})
