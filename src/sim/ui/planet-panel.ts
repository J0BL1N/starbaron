/**
 * Planet management panel state contract (P4-T04).
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no wall-clock.
 * `at` is a caller-supplied INPUT (milliseconds since epoch). The same
 * inputs always produce the same (deep-equal) PanelSection.
 *
 * Contract scope: this module delivers the PLANET PANEL STATE CONTRACT and
 * UI-ready projections only — React components consume them in later tasks.
 * No rendering wiring exists here. It is a PURE UI-state contract: every
 * number delegates to the LOCKED modules (no re-derived formulas).
 *
 * Locked-aggregate discipline:
 *   - structures  → player.structureLevels grid via gridForPlanet; buildCost
 *                   + canBuild from the framework; canonical STRUCTURE_IDS order.
 *   - population  → computePlanetDerived (LOCKED cap/rate) + current from the
 *                   OwnedPlanet. Nothing is re-derived or invented here.
 *   - production  → productionSummaryFor totals for the planet's grid/tier.
 *   - queues      → jobsAt over the supplied ConstructionQueue.
 *   - defenses    → the LOCKED defensePower(turretLevels, population).
 *   - ownership   → gated by the REQUIRED `viewerLevel` (info.ts's InfoLevel
 *                   contract): an owner-or-above viewer sees the supplied
 *                   OwnershipRecord (ownerId/isHome/protected; when absent,
 *                   the OwnedPlanet flags + player.playerId); a public viewer
 *                   gets the public subset — ownerId null, isHome false,
 *                   protected false — so hidden truth never reaches the client.
 *   - activity    → one deterministic line: 'Building … → Lv N · completes
 *                   in Xs' (first building job), 'Idle' when no jobs,
 *                   'Offline' when the player is stale (> 24h, reusing the
 *                   HUD_STALE_SECONDS semantics from ./hud).
 *
 * Validation: `at` must be a positive finite number; planetName must be an
 * owned planet (home or colony) or a RangeError is thrown.
 */

import { HUD_STALE_SECONDS } from './hud'
import { computePlanetDerived, gridForPlanet } from '../player/accrual'
import { ownedPlanetByName } from '../player/claim'
import { ownedPlanetIdentity } from '../player/player'
import type { OwnershipRecord } from '../player/ownership'
import type { OwnedPlanet, PlayerState } from '../player/types'
import { STRUCTURES, STRUCTURE_IDS } from '../structures/data'
import { defensePower } from '../structures/effects'
import { buildCost, canBuild } from '../structures/framework'
import { productionSummaryFor } from '../structures/production'
import { jobsAt } from '../structures/queues'
import type { ConstructionQueue } from '../structures/queues'
import type { StructureId } from '../structures/types'
import { assertInfoLevel, canViewLevel } from './info'
import type { InfoLevel } from './info'
import { assertPositiveAt } from './validate'

export interface PanelStructureRow {
  id: StructureId
  name: string
  level: number
  nextCost: number
  buildable: boolean
}

export interface PanelSection {
  structures: PanelStructureRow[]
  population: { current: number; cap: number; growthPerSec: number }
  production: { creditsPerSec: number; alloysPerSec: number }
  queues: { building: number; nextCompletionAt: number | null }
  defenses: { defensePower: number }
  ownership: { ownerId: string | null; isHome: boolean; protected: boolean }
  activity: string
}

export interface PlanetPanelInput {
  player: PlayerState
  planetName: string
  queue: ConstructionQueue
  at: number
  viewerLevel: InfoLevel
  ownership?: OwnershipRecord
}

function resolveOwnedPlanet(player: PlayerState, planetName: string): OwnedPlanet {
  const owned = ownedPlanetByName(player, planetName)
  if (owned === null) {
    throw new RangeError(`unknown owned planet, got ${planetName}`)
  }
  return owned
}

function earliestFinishesAt(jobs: readonly { finishesAt: number }[]): number | null {
  if (jobs.length === 0) {
    return null
  }
  let earliest = jobs[0].finishesAt
  for (const job of jobs) {
    if (job.finishesAt < earliest) {
      earliest = job.finishesAt
    }
  }
  return earliest
}

function secondsRemainingUntil(finishesAt: number, at: number): number {
  return Math.max(0, Math.ceil((finishesAt - at) / 1000))
}

/**
 * Build the full planet-management panel state projection. Every section
 * delegates to the locked modules — no formula is re-derived here. Inputs are
 * never mutated; the same inputs always produce the same PanelSection.
 */
export function planetPanelStateFor(input: PlanetPanelInput): PanelSection {
  assertPositiveAt(input.at)
  assertInfoLevel(input.viewerLevel)

  const owned = resolveOwnedPlanet(input.player, input.planetName)
  const grid = gridForPlanet(input.player, input.planetName)

  const structures = STRUCTURE_IDS.map((id) => {
    const level = grid[id] ?? 0
    return {
      id,
      name: STRUCTURES[id].name,
      level,
      nextCost: buildCost(id, level),
      buildable: canBuild(id, grid, input.player.wallet).ok,
    }
  })

  const derived = computePlanetDerived(owned, grid)
  const summary = productionSummaryFor({
    name: owned.name,
    tier: owned.tier,
    quirks: ownedPlanetIdentity(owned).quirks.map((quirk) => quirk.id),
    grid,
  })

  const building = jobsAt(input.queue, input.at)
  const nextCompletionAt = earliestFinishesAt(building)

  let ownership: PanelSection['ownership']
  if (!canViewLevel(input.viewerLevel, 'owner')) {
    ownership = { ownerId: null, isHome: false, protected: false }
  } else if (input.ownership !== undefined) {
    ownership = {
      ownerId: input.ownership.ownerId,
      isHome: input.ownership.isHome,
      protected: input.ownership.isHome && input.ownership.unconquerable,
    }
  } else {
    ownership = {
      ownerId: input.player.playerId,
      isHome: owned.isHome,
      protected: owned.isHome && owned.unconquerable,
    }
  }

  let activity: string
  if (input.at - input.player.lastTickAt > HUD_STALE_SECONDS * 1000) {
    activity = 'Offline'
  } else if (building.length > 0) {
    const first = building[0]
    activity =
      `Building ${STRUCTURES[first.structure].name} → Lv ${first.toLevel}` +
      ` · completes in ${secondsRemainingUntil(first.finishesAt, input.at)}s`
  } else {
    activity = 'Idle'
  }

  return {
    structures,
    population: {
      current: owned.population,
      cap: derived.populationCap,
      growthPerSec: derived.populationPerSec,
    },
    production: {
      creditsPerSec: summary.total.creditsPerSec,
      alloysPerSec: summary.total.alloysPerSec,
    },
    queues: {
      building: building.length,
      nextCompletionAt,
    },
    defenses: {
      defensePower: defensePower(grid.defenseTurret, owned.population),
    },
    ownership,
    activity,
  }
}
