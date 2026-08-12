/**
 * Legacy UI compatibility layer (phase-2 whole-phase audit, round 4).
 *
 * LEGACY COMPATIBILITY WRAPPER over the canonical ownership flow — the
 * canonical ownership lives in colonisation.ts / assignment.ts /
 * onboarding.ts; new callers must use those (onboarding.entryFlow +
 * assignment.selectHomeWorld for home worlds, colonisation.colonise for
 * colonies). Nothing is removed from the exports: the legacy UI and save
 * layer compile against these signatures unchanged.
 *
 * Purity: no nondeterministic APIs, no module-level MUTABLE state. The only
 * module-level constant is NAME_TO_ENTRY — an IMMUTABLE lookup table
 * (ReadonlyMap) built once from the pinned catalogue and never written after
 * construction; it is a lookup table, not state.
 *
 * DELEGATION (findings 1 + 3): colonise / coloniseFirstUnclaimed delegate
 * their ownership decision and duplicate rejection to the canonical colonise
 * (colonisation.ts). The target entry is mapped to its canonical body id —
 * bodyId(systemId('catalogue', hostname), 'planet', ordinalWithinHost), the
 * same derivation assignment.eligibleHomeBodies uses — the player's owned
 * planets (home + colonies) are mapped to canonical body ids the same way,
 * and the canonical eligibility ladder runs. The legacy path predates
 * protection and the fleet/travel gates, so protection is undefined and
 * requirements are assumed met. On the canonical 'already-owned' rejection
 * the legacy descriptive error is thrown ('planet already claimed: <name>'
 * — the phrasing the legacy tests pin). The legacy path predates the
 * colonisation cost, so 'insufficient-funds' is NOT a legacy rejection: the
 * caller owns the spend (the legacy UI pays COLONISE_COST_CREDITS via
 * walletSpend after colonise returns).
 *
 * claimHomePlanet is @legacy — it keeps its deterministic catalogue pick for
 * the legacy UI path; the canonical new-player entry flow is
 * onboarding.entryFlow.
 */

import { PLANETS } from '../data/planets'
import type { PlanetCatalogueEntry } from '../data/planets'
import { makePlanet } from '../planets'
import { fnv1a } from '../planets/hash'
import { bodyId, systemId } from '../world/identity'
import type { BodyId } from '../world/identity'
import { CATALOGUE_SLUG, hostGroupIndex } from './assignment'
import { colonise as coloniseCanonical } from './colonisation'
import type { ColoniseInput } from './colonisation'
import { emptyStructureLevels } from './grid'
import { STARTER_POPULATION } from './wallet'
import type { OwnedPlanet, PlayerState } from './types'

export const CLAIM_SALT = 'starbaron-claim-v1'

/**
 * Immutable name → catalogue-entry lookup, built once from the pinned
 * catalogue. ReadonlyMap — an immutable lookup TABLE, not mutable module
 * state: it is never written after construction (catalogueEntryByName is the
 * only reader).
 */
const NAME_TO_ENTRY: ReadonlyMap<string, PlanetCatalogueEntry> = new Map(
  PLANETS.map((entry) => [entry.name, entry]),
)

export function catalogueEntryByName(name: string): PlanetCatalogueEntry | null {
  return NAME_TO_ENTRY.get(name) ?? null
}

export function claimIndexForPlayer(playerId: string): number {
  if (typeof playerId !== 'string' || playerId.length === 0) {
    throw new RangeError(
      `playerId must be a non-empty string, got ${String(playerId)}`,
    )
  }
  return fnv1a(`${CLAIM_SALT}|${playerId}`) % PLANETS.length
}

function buildOwnedPlanet(
  entry: PlanetCatalogueEntry,
  now: number,
  isHome: boolean,
): OwnedPlanet {
  const planet = makePlanet(entry)
  return {
    name: entry.name,
    entry: structuredClone(entry),
    tier: entry.tier,
    baselineIncomePerSec: planet.baselineIncomePerSec,
    populationCapMultiplier: planet.populationCapMultiplier,
    claimedAt: now,
    isHome,
    unconquerable: isHome,
    population: isHome ? STARTER_POPULATION : 0,
    garrison: 0,
    fleet: 0,
  }
}

/**
 * Canonical body id of a catalogue entry:
 * bodyId(systemId('catalogue', hostname), 'planet', ordinalWithinHost) — the
 * same derivation assignment.eligibleHomeBodies uses (hostGroupIndex = count
 * of prior entries sharing the hostname, in catalogue order). Exported so the
 * canonical-path tests (and any caller) can map a legacy entry to its
 * canonical identity without importing the world mapping.
 */
export function canonicalBodyIdForEntry(entry: PlanetCatalogueEntry): BodyId {
  const index = PLANETS.findIndex((candidate) => candidate.name === entry.name)
  if (index === -1) {
    throw new RangeError(`unknown planet: ${entry.name}`)
  }
  return bodyId(
    systemId(CATALOGUE_SLUG, entry.hostname),
    'planet',
    hostGroupIndex(PLANETS, index),
  )
}

/**
 * The canonical body ids of every planet the player owns (home + colonies),
 * mapped name → entry → canonical body id. This is the existingOwners set
 * passed to the canonical colonise, so duplicate rejection is BODY-keyed
 * (global canonical-body uniqueness), not legacy-name-keyed.
 */
function ownedBodyIds(player: PlayerState): Set<BodyId> {
  const ids = new Set<BodyId>()
  for (const name of ownedNames(player)) {
    const entry = catalogueEntryByName(name)
    if (entry !== null) {
      ids.add(canonicalBodyIdForEntry(entry))
    }
  }
  return ids
}

/**
 * Run the canonical colonisation eligibility ladder for a legacy entry on
 * behalf of a player: maps the entry + the player's owned planets to
 * canonical body ids and delegates to colonisation.ts colonise (the single
 * ownership implementation). Legacy assumptions documented above: protection
 * undefined, requirements met, cost is the caller's concern. On the
 * canonical 'already-owned' rejection the legacy descriptive error is thrown.
 */
function coloniseEntryForPlayer(
  player: PlayerState,
  entry: PlanetCatalogueEntry,
  now: number,
): OwnedPlanet {
  const input: ColoniseInput = {
    bodyId: canonicalBodyIdForEntry(entry),
    ownerId: player.playerId,
    wallet: player.wallet,
    requirements: { hasFleet: true, hasTravel: true },
    existingOwners: ownedBodyIds(player),
    at: now,
  }
  const result = coloniseCanonical(input)
  if (!result.ok && result.reason === 'already-owned') {
    throw new RangeError(`planet already claimed: ${entry.name}`)
  }
  return buildOwnedPlanet(entry, now, false)
}

/**
 * @legacy — deterministic catalogue pick for the legacy UI path. The
 * canonical new-player entry flow is onboarding.entryFlow (which assigns a
 * home world via assignment.selectHomeWorld and records it on the profile).
 */
export function claimHomePlanet(playerId: string, now: number): OwnedPlanet {
  return buildOwnedPlanet(PLANETS[claimIndexForPlayer(playerId)], now, true)
}

/**
 * Pure OwnedPlanet BUILDER for a colony (the success-path projection of a
 * delegated colonise). It performs no ownership validation of its own — it
 * has no player context (no owner, wallet, or existing-owner set), so it is
 * a shape constructor, not a second ownership model. Player flows
 * (colonise / coloniseFirstUnclaimed) validate through the canonical
 * colonise first and build here only on ok.
 */
export function claimColony(entry: PlanetCatalogueEntry, now: number): OwnedPlanet {
  return buildOwnedPlanet(entry, now, false)
}

export function ownedNames(player: PlayerState): Set<string> {
  const names = new Set<string>([player.homePlanet.name])
  for (const colony of player.colonies) {
    names.add(colony.name)
  }
  return names
}

export function ownedPlanetByName(
  player: PlayerState,
  name: string,
): OwnedPlanet | null {
  if (player.homePlanet.name === name) {
    return player.homePlanet
  }
  return player.colonies.find((colony) => colony.name === name) ?? null
}

export function unclaimedPlanets(player: PlayerState): PlanetCatalogueEntry[] {
  const owned = ownedNames(player)
  return PLANETS.filter((entry) => !owned.has(entry.name))
}

export function firstUnclaimedByIndex(
  player: PlayerState,
): PlanetCatalogueEntry | null {
  const owned = ownedNames(player)
  for (const entry of PLANETS) {
    if (!owned.has(entry.name)) {
      return entry
    }
  }
  return null
}

export function colonise(player: PlayerState, name: string, now: number): PlayerState {
  const entry = catalogueEntryByName(name)
  if (entry === null) {
    throw new RangeError(`unknown planet: ${name}`)
  }
  const colony = coloniseEntryForPlayer(player, entry, now)
  return {
    ...player,
    colonies: [...player.colonies, colony],
    structureLevels: {
      ...player.structureLevels,
      [colony.name]: emptyStructureLevels(),
    },
  }
}

export function coloniseFirstUnclaimed(
  player: PlayerState,
  now: number,
): { player: PlayerState; colony: OwnedPlanet } {
  const entry = firstUnclaimedByIndex(player)
  if (entry === null) {
    throw new RangeError('no unclaimed planets remain in the catalogue')
  }
  const colony = coloniseEntryForPlayer(player, entry, now)
  return {
    player: {
      ...player,
      colonies: [...player.colonies, colony],
      structureLevels: {
        ...player.structureLevels,
        [colony.name]: emptyStructureLevels(),
      },
    },
    colony,
  }
}
