import { describe, expect, it } from 'vitest'
import {
  computePlanetDerived,
  gridForPlanet,
} from '../src/sim/player/accrual'
import { emptyStructureLevels } from '../src/sim/player/grid'
import { ownedPlanetIdentity } from '../src/sim/player'
import { createPlayer } from '../src/sim/player'
import { PLANETS } from '../src/sim/data/planets'
import { eligibleHomeWorlds } from '../src/sim/player/claim'
import type { BodyId } from '../src/sim/world/identity'
import { ownershipFor } from '../src/sim/player/ownership'
import type { OwnershipRecord } from '../src/sim/player/ownership'
import type { OwnedPlanet, PlayerState, StructureGrid, WalletState } from '../src/sim/player/types'
import { STRUCTURES, STRUCTURE_IDS } from '../src/sim/structures/data'
import {
  MILITIA_DEFENSE_PER_POPULATION,
  TURRET_DEFENSE_POWER_PER_LEVEL,
  defensePower,
} from '../src/sim/structures/effects'
import { buildCost } from '../src/sim/structures/framework'
import { productionSummaryFor } from '../src/sim/structures/production'
import { queueConstruction } from '../src/sim/structures/queues'
import type { ConstructionJob, ConstructionQueue } from '../src/sim/structures/queues'
import type { StructureId } from '../src/sim/structures/types'
import { HUD_STALE_SECONDS } from '../src/sim/ui/hud'
import { planetPanelStateFor } from '../src/sim/ui/planet-panel'
import type { PanelSection } from '../src/sim/ui/planet-panel'
import type { InfoLevel } from '../src/sim/ui/info'
import { bodyId, systemId } from '../src/sim/world/identity'

const NOW = 1_700_000_000_000
const RICH: WalletState = { credits: 1e9, alloys: 1e9 }
const BODY = bodyId(systemId('planet-panel', 'fixture'), 'planet', 0)

const ELIGIBLE = eligibleHomeWorlds(PLANETS)
const NO_TAKEN: ReadonlySet<BodyId> = new Set<BodyId>()

/** PanelSection with every gated section narrowed to non-null (owner view). */
type OwnerPanel = PanelSection & {
  structures: NonNullable<PanelSection['structures']>
  population: NonNullable<PanelSection['population']>
  production: NonNullable<PanelSection['production']>
  queues: NonNullable<PanelSection['queues']>
  defenses: NonNullable<PanelSection['defenses']>
  activity: NonNullable<PanelSection['activity']>
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = createPlayer('player-panel', NOW, ELIGIBLE, NO_TAKEN)
  return {
    ...player,
    ...overrides,
    wallet: { ...player.wallet, ...(overrides.wallet ?? {}) },
  }
}

function makeColony(overrides: Partial<OwnedPlanet> = {}): OwnedPlanet {
  const base = createPlayer('player-panel', NOW, ELIGIBLE, NO_TAKEN).homePlanet
  return {
    ...base,
    name: 'Colony One',
    isHome: false,
    unconquerable: false,
    claimedAt: NOW,
    population: 500,
    garrison: 0,
    fleet: 0,
    ...overrides,
  }
}

function gridWith(overrides: Partial<Record<StructureId, number>>): StructureGrid {
  return { ...emptyStructureLevels(), ...overrides }
}

function buildJob(
  structure: StructureId,
  fromLevel: number,
  startedAt: number,
  grid: StructureGrid = gridWith({ [structure]: fromLevel }),
): ConstructionJob {
  return queueConstruction({
    planet: 'fixture-planet',
    structure,
    fromLevel,
    toLevel: fromLevel + 1,
    startedAt,
    wallet: RICH,
    existingJobs: [],
    grid,
  }).job
}

function assertOwnerSections(state: PanelSection): OwnerPanel {
  if (
    state.structures === null ||
    state.population === null ||
    state.production === null ||
    state.queues === null ||
    state.defenses === null ||
    state.activity === null
  ) {
    throw new Error('owner-level panel section unexpectedly null')
  }
  return state as OwnerPanel
}

function panel(
  player: PlayerState,
  jobs: readonly ConstructionJob[] = [],
  at: number = NOW,
  ownership?: OwnershipRecord,
): OwnerPanel {
  return assertOwnerSections(
    planetPanelStateFor({
      player,
      planetName: player.homePlanet.name,
      queue: { planet: player.homePlanet.name, jobs: [...jobs] },
      at,
      viewerLevel: 'owner',
      ownership,
    }),
  )
}

function panelFor(
  player: PlayerState,
  planetName: string,
  jobs: readonly ConstructionJob[] = [],
  at: number = NOW,
): OwnerPanel {
  return assertOwnerSections(
    planetPanelStateFor({
      player,
      planetName,
      queue: { planet: planetName, jobs: [...jobs] },
      at,
      viewerLevel: 'owner',
    }),
  )
}

describe('P4-T04 structures rows', () => {
  it('follows the canonical STRUCTURE_IDS roster order with names from data', () => {
    const state = panel(makePlayer())
    expect(state.structures.map((row) => row.id)).toEqual(STRUCTURE_IDS)
    for (const row of state.structures) {
      expect(row.name).toBe(STRUCTURES[row.id].name)
    }
  })

  it('mirrors the grid levels exactly', () => {
    const grid = gridWith({ oreMine: 3, housing: 2, defenseTurret: 1 })
    const player = makePlayer({
      structureLevels: { [makePlayer().homePlanet.name]: grid },
    })
    const state = panel(player)
    for (const row of state.structures) {
      expect(row.level).toBe(grid[row.id])
    }
  })

  it('nextCost is the locked buildCost at the current level', () => {
    const grid = gridWith({ oreMine: 3, tradeHub: 2, shipyard: 1 })
    const player = makePlayer({
      structureLevels: { [makePlayer().homePlanet.name]: grid },
    })
    const state = panel(player)
    for (const row of state.structures) {
      expect(row.nextCost).toBe(buildCost(row.id, row.level))
    }
  })

  it('buildable ladder with the starter wallet: only oreMine/housing/hydroponics', () => {
    const state = panel(makePlayer())
    const buildable = state.structures.filter((row) => row.buildable).map((r) => r.id)
    expect(buildable).toEqual(['oreMine', 'housing', 'hydroponics'])
  })

  it('every structure is buildable with a rich wallet', () => {
    const state = panel(makePlayer({ wallet: RICH }))
    for (const row of state.structures) {
      expect(row.buildable, row.id).toBe(true)
    }
  })

  it('the alloy gate blocks defenseTurret when alloys are 0, regardless of credits', () => {
    const state = panel(makePlayer({ wallet: { credits: 1e9, alloys: 0 } }))
    for (const row of state.structures) {
      if (row.id === 'defenseTurret') {
        expect(row.buildable).toBe(false)
      } else {
        expect(row.buildable, row.id).toBe(true)
      }
    }
  })

  it('a missing grid entry falls back to the empty grid (all levels 0, base costs)', () => {
    const player = makePlayer({ structureLevels: {} })
    const state = panel(player)
    for (const row of state.structures) {
      expect(row.level).toBe(0)
      expect(row.nextCost).toBe(buildCost(row.id, 0))
    }
  })
})

describe('P4-T04 population section', () => {
  it('current equals the OwnedPlanet population', () => {
    const player = makePlayer({
      homePlanet: { ...makePlayer().homePlanet, population: 4_242 },
    })
    expect(panel(player).population.current).toBe(4_242)
  })

  it('cap and growthPerSec are the LOCKED computePlanetDerived numbers', () => {
    const player = makePlayer()
    const derived = computePlanetDerived(
      player.homePlanet,
      gridForPlanet(player, player.homePlanet.name),
    )
    const state = panel(player)
    expect(state.population.cap).toBe(derived.populationCap)
    expect(state.population.growthPerSec).toBe(derived.populationPerSec)
  })

  it('is well-formed for the starter home (finite positive cap, non-negative growth)', () => {
    const state = panel(makePlayer())
    expect(Number.isFinite(state.population.cap)).toBe(true)
    expect(state.population.cap).toBeGreaterThan(0)
    expect(state.population.growthPerSec).toBeGreaterThanOrEqual(0)
    expect(state.population.current).toBeGreaterThanOrEqual(0)
  })
})

describe('P4-T04 production section', () => {
  it('totals equal the LOCKED productionSummaryFor totals for the grid/tier/quirks', () => {
    const player = makePlayer()
    const grid = gridForPlanet(player, player.homePlanet.name)
    const summary = productionSummaryFor({
      name: player.homePlanet.name,
      tier: player.homePlanet.tier,
      quirks: ownedPlanetIdentity(player.homePlanet).quirks.map((quirk) => quirk.id),
      grid,
    })
    expect(panel(player).production).toEqual({
      creditsPerSec: summary.total.creditsPerSec,
      alloysPerSec: summary.total.alloysPerSec,
    })
  })

  it('is positive with income-producing structures on the grid', () => {
    const grid = gridWith({ oreMine: 3, tradeHub: 2, shipyard: 1, housing: 2 })
    const player = makePlayer({
      structureLevels: { [makePlayer().homePlanet.name]: grid },
    })
    const state = panel(player)
    expect(state.production.creditsPerSec).toBeGreaterThan(0)
    expect(state.production.alloysPerSec).toBeGreaterThan(0)
  })

  it('is zero on the housing-only starter grid (structure production only)', () => {
    expect(panel(makePlayer()).production).toEqual({
      creditsPerSec: 0,
      alloysPerSec: 0,
    })
  })
})

describe('P4-T04 queues section', () => {
  it('empty queue → building 0 and nextCompletionAt null', () => {
    expect(panel(makePlayer()).queues).toEqual({
      building: 0,
      nextCompletionAt: null,
    })
  })

  it('single building job → building 1 and nextCompletionAt = its finishesAt', () => {
    const job = buildJob('housing', 1, NOW)
    const state = panel(makePlayer(), [job])
    expect(state.queues.building).toBe(1)
    expect(state.queues.nextCompletionAt).toBe(job.finishesAt)
  })

  it('counts all building jobs; nextCompletionAt is the EARLIEST finishesAt (not the first in start order)', () => {
    const housing = buildJob('housing', 1, NOW + 1_000)
    const oreMine = buildJob('oreMine', 0, NOW)
    expect(housing.finishesAt).toBeLessThan(oreMine.finishesAt)
    const state = panel(makePlayer(), [oreMine, housing])
    expect(state.queues.building).toBe(2)
    expect(state.queues.nextCompletionAt).toBe(housing.finishesAt)
  })

  it('excludes complete and cancelled jobs from the building count', () => {
    const job = buildJob('housing', 1, NOW)
    const complete: ConstructionJob = { ...job, id: 'complete-1', status: 'complete' }
    const cancelled: ConstructionJob = { ...job, id: 'cancelled-1', status: 'cancelled' }
    const state = panel(makePlayer(), [job, complete, cancelled])
    expect(state.queues.building).toBe(1)
    expect(state.queues.nextCompletionAt).toBe(job.finishesAt)
  })
})

describe('P4-T04 defenses section', () => {
  it('equals the LOCKED defensePower: militia-only at turret 0, turret math otherwise', () => {
    const starter = panel(makePlayer())
    expect(starter.defenses.defensePower).toBe(
      MILITIA_DEFENSE_PER_POPULATION * 1_000,
    )

    const grid = gridWith({ defenseTurret: 2 })
    const player = makePlayer({
      structureLevels: { [makePlayer().homePlanet.name]: grid },
      homePlanet: { ...makePlayer().homePlanet, population: 2_500 },
    })
    const state = panel(player)
    expect(state.defenses.defensePower).toBe(
      defensePower(grid.defenseTurret, player.homePlanet.population),
    )
    expect(state.defenses.defensePower).toBe(
      TURRET_DEFENSE_POWER_PER_LEVEL * 2 +
        MILITIA_DEFENSE_PER_POPULATION * 2_500,
    )
  })
})

describe('P4-T04 ownership section', () => {
  it('mirrors the supplied OwnershipRecord (non-home conquest record)', () => {
    const record = ownershipFor(BODY, 'other-player', null, NOW, 'conquest', false, false)
    const state = panel(makePlayer(), [], NOW, record)
    expect(state.ownership).toEqual({ ownerId: 'other-player', isHome: false, protected: false })
  })

  it('marks a protected home record as protected', () => {
    const player = makePlayer()
    const record = ownershipFor(
      BODY,
      player.playerId,
      null,
      NOW,
      'home-assignment',
      true,
      true,
    )
    const state = panel(player, [], NOW, record)
    expect(state.ownership).toEqual({
      ownerId: player.playerId,
      isHome: true,
      protected: true,
    })
  })

  it('falls back to the OwnedPlanet flags + player id when no record is supplied (home)', () => {
    const player = makePlayer()
    expect(panel(player).ownership).toEqual({
      ownerId: player.playerId,
      isHome: true,
      protected: true,
    })
  })

  it('falls back to the OwnedPlanet flags + player id when no record is supplied (colony)', () => {
    const colony = makeColony()
    const player = makePlayer({
      colonies: [colony],
      structureLevels: {
        ...makePlayer().structureLevels,
        [colony.name]: gridWith({}),
      },
    })
    const state = panelFor(player, colony.name)
    expect(state.ownership).toEqual({
      ownerId: player.playerId,
      isHome: false,
      protected: false,
    })
  })
})

describe('P4-T04 info-gating — viewerLevel', () => {
  function panelPublic(
    player: PlayerState,
    ownership?: OwnershipRecord,
  ): PanelSection {
    return planetPanelStateFor({
      player,
      planetName: player.homePlanet.name,
      queue: { planet: player.homePlanet.name, jobs: [] },
      at: NOW,
      viewerLevel: 'public',
      ownership,
    })
  }

  it('a public viewer gets the public ownership subset, ignoring a supplied record', () => {
    const record = ownershipFor(BODY, 'other-player', null, NOW, 'conquest', false, false)
    const state = panelPublic(makePlayer(), record)
    expect(state.ownership).toEqual({
      ownerId: null,
      isHome: false,
      protected: false,
    })
  })

  it('a public viewer gets the public subset for the home planet too', () => {
    expect(panelPublic(makePlayer()).ownership).toEqual({
      ownerId: null,
      isHome: false,
      protected: false,
    })
  })

  it('an owner-level viewer sees the supplied record and the player fallback', () => {
    const player = makePlayer()
    const record = ownershipFor(BODY, 'other-player', null, NOW, 'conquest', false, false)
    const withRecord = panel(player, [], NOW, record)
    expect(withRecord.ownership).toEqual({
      ownerId: 'other-player',
      isHome: false,
      protected: false,
    })
    const fallback = panel(player)
    expect(fallback.ownership).toEqual({
      ownerId: player.playerId,
      isHome: true,
      protected: true,
    })
  })

  it('throws RangeError for an invalid viewerLevel', () => {
    const player = makePlayer()
    const queue: ConstructionQueue = { planet: player.homePlanet.name, jobs: [] }
    for (const bad of ['guest', 'admin', '', 'OWNER']) {
      expect(() =>
        planetPanelStateFor({
          player,
          planetName: player.homePlanet.name,
          queue,
          at: NOW,
          viewerLevel: bad as InfoLevel,
        }),
      ).toThrow(RangeError)
    }
  })
})

describe('P4-T04 viewer-level section gating', () => {
  function panelAs(
    viewerLevel: InfoLevel,
    player: PlayerState,
    ownership?: OwnershipRecord,
  ): PanelSection {
    return planetPanelStateFor({
      player,
      planetName: player.homePlanet.name,
      queue: { planet: player.homePlanet.name, jobs: [] },
      at: NOW,
      viewerLevel,
      ownership,
    })
  }

  it('public viewer: every owner-gated section is null, ownership is the public subset', () => {
    const state = panelAs('public', makePlayer())
    expect(state.structures).toBeNull()
    expect(state.population).toBeNull()
    expect(state.production).toBeNull()
    expect(state.queues).toBeNull()
    expect(state.defenses).toBeNull()
    expect(state.activity).toBeNull()
    expect(state.ownership).toEqual({ ownerId: null, isHome: false, protected: false })
  })

  it('alliance viewer is NOT an owner: identical to public, every section null', () => {
    const state = panelAs('alliance', makePlayer())
    expect(state.structures).toBeNull()
    expect(state.population).toBeNull()
    expect(state.production).toBeNull()
    expect(state.queues).toBeNull()
    expect(state.defenses).toBeNull()
    expect(state.activity).toBeNull()
    expect(state.ownership).toEqual({ ownerId: null, isHome: false, protected: false })
  })

  it('intel viewer: sees defense power (intel is the requirement) but no owner sections', () => {
    const player = makePlayer()
    const state = panelAs('intel', player)
    expect(state.defenses).not.toBeNull()
    expect(state.defenses!.defensePower).toBe(
      MILITIA_DEFENSE_PER_POPULATION * player.homePlanet.population,
    )
    expect(state.structures).toBeNull()
    expect(state.population).toBeNull()
    expect(state.production).toBeNull()
    expect(state.queues).toBeNull()
    expect(state.activity).toBeNull()
    expect(state.ownership).toEqual({ ownerId: null, isHome: false, protected: false })
  })

  it('owner viewer: every section is populated, including defense power', () => {
    const player = makePlayer()
    const state = panelAs('owner', player)
    expect(state).toEqual(panel(player))
    expect(state.structures).not.toBeNull()
    expect(state.population).not.toBeNull()
    expect(state.production).not.toBeNull()
    expect(state.queues).not.toBeNull()
    expect(state.defenses).not.toBeNull()
    expect(state.defenses!.defensePower).toBe(
      MILITIA_DEFENSE_PER_POPULATION * player.homePlanet.population,
    )
    expect(state.activity).toBe('Idle')
    expect(state.ownership).toEqual({
      ownerId: player.playerId,
      isHome: true,
      protected: true,
    })
  })
})

describe('P4-T04 activity string', () => {
  it('is Idle with no building jobs', () => {
    expect(panel(makePlayer()).activity).toBe('Idle')
  })

  it('is the deterministic Building line for the first job, exact format', () => {
    const job = buildJob('housing', 1, NOW)
    const state = panel(makePlayer(), [job])
    expect(state.activity).toBe('Building Housing → Lv 2 · completes in 20s')
  })

  it('drives the line from the first building job (earliest startedAt)', () => {
    const housing = buildJob('housing', 1, NOW + 1_000)
    const oreMine = buildJob('oreMine', 0, NOW)
    const state = panel(makePlayer(), [housing, oreMine])
    expect(state.activity).toBe('Building Ore Mine → Lv 1 · completes in 30s')
  })

  it('reports remaining seconds against the supplied at and clamps due jobs to 0s', () => {
    const job = buildJob('housing', 1, NOW)
    const player = makePlayer()
    expect(panel(player, [job], NOW + 5_000).activity).toBe(
      'Building Housing → Lv 2 · completes in 15s',
    )
    expect(panel(player, [job], NOW + 20_000).activity).toBe(
      'Building Housing → Lv 2 · completes in 0s',
    )
  })

  it('is Offline when the player is stale (> 24h since lastTickAt)', () => {
    const player = makePlayer({
      lastTickAt: NOW - (HUD_STALE_SECONDS * 1000 + 1),
    })
    expect(panel(player).activity).toBe('Offline')
  })

  it('Offline takes precedence over building; the exact 24h boundary is not stale', () => {
    const job = buildJob('housing', 1, NOW)
    const stale = makePlayer({
      lastTickAt: NOW - (HUD_STALE_SECONDS * 1000 + 1),
    })
    expect(panel(stale, [job]).activity).toBe('Offline')

    const boundary = makePlayer({
      lastTickAt: NOW - HUD_STALE_SECONDS * 1000,
    })
    expect(panel(boundary, [job]).activity).toBe(
      'Building Housing → Lv 2 · completes in 20s',
    )
  })
})

describe('P4-T04 determinism and validation', () => {
  it('is deterministic and never mutates player or queue inputs', () => {
    const player = makePlayer({ wallet: { credits: 500, alloys: 100 } })
    const job = buildJob('housing', 1, NOW)
    const record = ownershipFor(BODY, 'someone', null, NOW, 'conquest', false, false)
    const queue: ConstructionQueue = { planet: player.homePlanet.name, jobs: [job] }
    const playerBefore = structuredClone(player)
    const input = {
      player,
      planetName: player.homePlanet.name,
      queue,
      at: NOW,
      viewerLevel: 'owner' as const,
      ownership: record,
    }
    const first = planetPanelStateFor(input)
    const second = planetPanelStateFor(input)
    expect(second).toEqual(first)
    expect(player).toEqual(playerBefore)
    expect(queue.jobs).toEqual([job])
  })

  it('throws RangeError for an unknown planetName', () => {
    const player = makePlayer()
    expect(() => panelFor(player, 'Not A Planet')).toThrow(/unknown owned planet/)
  })

  it('throws RangeError for a non-positive or non-finite at', () => {
    const player = makePlayer()
    const queue: ConstructionQueue = { planet: player.homePlanet.name, jobs: [] }
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        planetPanelStateFor({
          player,
          planetName: player.homePlanet.name,
          queue,
          at: bad,
          viewerLevel: 'owner',
        }),
      ).toThrow(RangeError)
    }
  })

  it('delegates fully for a colony planet (grid, population, production)', () => {
    const colony = makeColony()
    const home = makePlayer()
    const player = makePlayer({
      colonies: [colony],
      structureLevels: {
        [home.homePlanet.name]: home.structureLevels[home.homePlanet.name],
        [colony.name]: gridWith({ oreMine: 1 }),
      },
    })
    const state = panelFor(player, colony.name)
    expect(state.population.current).toBe(colony.population)
    expect(state.structures.find((row) => row.id === 'oreMine')?.level).toBe(1)
    const derived = computePlanetDerived(colony, gridWith({ oreMine: 1 }))
    expect(state.population.cap).toBe(derived.populationCap)
  })
})
