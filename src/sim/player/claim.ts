/**
 * Legacy UI compatibility layer (phase-2 whole-phase audit, round 5).
 *
 * LEGACY COMPATIBILITY WRAPPER over the canonical ownership flow — the
 * canonical ownership lives in colonisation.ts / assignment.ts /
 * onboarding.ts; new callers must use those (onboarding.entryFlow +
 * assignment.selectHomeWorld for home worlds, colonisation.colonise for
 * colonies). Nothing is removed from the exports: the legacy UI and save
 * layer compile against these signatures.
 *
 * Purity: no nondeterministic APIs, no module-level MUTABLE state. Every
 * function is a pure function of its inputs.
 *
 * IMPORT BOUNDARY (finding 1): this module does NOT import the planet
 * catalogue. Every catalogue-dependent call takes the catalogue (or a
 * caller-derived eligible set) as an injected parameter; callers own the
 * catalogue import. claimHomePlanet delegates the home selection exclusively
 * to assignment.selectHomeWorld over the injected eligible + taken sets; the
 * canonical new-player entry flow is onboarding.entryFlow.
 *
 * DELEGATION (finding 2): colonise / coloniseFirstUnclaimed delegate their
 * ownership decision and duplicate rejection to the canonical colonise
 * (colonisation.ts). The target entry is mapped to its canonical body id and
 * EVERY ColonisationResult rejection is propagated before an OwnedPlanet is
 * built (previously only 'already-owned' was). The caller supplies the
 * all-player ownership overlay (existingOwners across player states),
 * protection, and requirement flags; the player's own owned planets are
 * added internally, so two player states can never claim the same canonical
 * body through any exported path.
 */

import { makePlanet } from '../planets'
import { fnv1a } from '../planets/hash'
import type { PlanetCatalogueEntry } from '../data/planets'
import { bodyId, systemId } from '../world/identity'
import type { BodyId } from '../world/identity'
import { CATALOGUE_SLUG, hostGroupIndex, selectHomeWorld } from './assignment'
import { colonise as coloniseCanonical } from './colonisation'
import type {
  ColoniseInput,
  ColonisationRejectionReason,
  ColonisationRequirement,
} from './colonisation'
import type { HomeProtection } from './protection'
import { emptyStructureLevels } from './grid'
import { STARTER_POPULATION } from './wallet'
import type { OwnedPlanet, PlayerState } from './types'

export const CLAIM_SALT = 'starbaron-claim-v1'

/** A caller-built home-world candidate: canonical body id + catalogue entry. */
export interface HomeWorldCandidate {
  bodyId: BodyId
  entry: PlanetCatalogueEntry
}

/** Caller-supplied canonical ownership inputs for the legacy colony path. */
export interface ColoniseOverlay {
  /**
   * All-player ownership overlay: every canonical body id already owned by
   * OTHER player states. The colonising player's own owned planets are added
   * internally, so a body held elsewhere can never be claimed again.
   */
  globalOwners: ReadonlySet<BodyId>
  /** Requirement flags (fleet/travel); the caller owns the real computation. */
  requirements: ColonisationRequirement
  /** Protection snapshot to consult, when present (legacy callers omit it). */
  protection?: HomeProtection
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
 * Build the injected eligible set for the legacy home claim from a
 * caller-supplied catalogue, in catalogue order. Callers pass the result to
 * claimHomePlanet / createPlayer — the sim layer never imports the catalogue.
 */
export function eligibleHomeWorlds(
  catalogue: readonly PlanetCatalogueEntry[],
): HomeWorldCandidate[] {
  return catalogue.map((entry) => ({
    bodyId: canonicalBodyIdForEntry(catalogue, entry),
    entry,
  }))
}

/** Name → catalogue-entry lookup over a caller-injected catalogue. */
export function catalogueEntryByName(
  catalogue: readonly PlanetCatalogueEntry[],
  name: string,
): PlanetCatalogueEntry | null {
  for (const entry of catalogue) {
    if (entry.name === name) {
      return entry
    }
  }
  return null
}

export function claimIndexForPlayer(
  catalogue: readonly PlanetCatalogueEntry[],
  playerId: string,
): number {
  if (typeof playerId !== 'string' || playerId.length === 0) {
    throw new RangeError(
      `playerId must be a non-empty string, got ${String(playerId)}`,
    )
  }
  if (catalogue.length === 0) {
    throw new RangeError('catalogue must not be empty')
  }
  return fnv1a(`${CLAIM_SALT}|${playerId}`) % catalogue.length
}

/**
 * Canonical body id of a catalogue entry:
 * bodyId(systemId('catalogue', hostname), 'planet', ordinalWithinHost) — the
 * same derivation assignment.eligibleHomeBodies uses (hostGroupIndex = count
 * of prior entries sharing the hostname, in catalogue order). Exported so
 * callers can map a legacy entry to its canonical identity.
 */
export function canonicalBodyIdForEntry(
  catalogue: readonly PlanetCatalogueEntry[],
  entry: PlanetCatalogueEntry,
): BodyId {
  const index = catalogue.findIndex((candidate) => candidate.name === entry.name)
  if (index === -1) {
    throw new RangeError(`unknown planet: ${entry.name}`)
  }
  return bodyId(
    systemId(CATALOGUE_SLUG, entry.hostname),
    'planet',
    hostGroupIndex(catalogue, index),
  )
}

/**
 * @legacy — deterministic home pick for the legacy UI path, now DELEGATED to
 * assignment.selectHomeWorld over the caller-injected eligible + taken sets.
 * The eligible set is supplied by the caller (eligibleHomeWorlds over its own
 * catalogue import); this wrapper only maps the chosen body id back to its
 * entry and builds the OwnedPlanet. The canonical new-player entry flow is
 * onboarding.entryFlow.
 */
export function claimHomePlanet(
  playerId: string,
  now: number,
  eligible: readonly HomeWorldCandidate[],
  taken: ReadonlySet<BodyId>,
): OwnedPlanet {
  if (typeof playerId !== 'string' || playerId.length === 0) {
    throw new RangeError(
      `playerId must be a non-empty string, got ${String(playerId)}`,
    )
  }
  const result = selectHomeWorld({
    playerId,
    eligible: eligible.map((candidate) => candidate.bodyId),
    taken,
    salt: CLAIM_SALT,
  })
  if (!result.ok) {
    throw new RangeError(
      result.reason === 'exhausted'
        ? 'no home worlds available'
        : 'empty eligible home set',
    )
  }
  const candidate = eligible.find((item) => item.bodyId === result.bodyId)
  if (candidate === undefined) {
    throw new RangeError(`selected body not in eligible set: ${result.bodyId}`)
  }
  return buildOwnedPlanet(candidate.entry, now, true)
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

/**
 * The canonical body ids of every planet the player owns (home + colonies),
 * mapped name → entry → canonical body id. This is the per-player portion of
 * the existingOwners set passed to the canonical colonise; the caller's
 * all-player overlay is unioned in, so duplicate rejection is BODY-keyed.
 */
function ownedBodyIds(
  catalogue: readonly PlanetCatalogueEntry[],
  player: PlayerState,
): Set<BodyId> {
  const ids = new Set<BodyId>()
  for (const name of ownedNames(player)) {
    const entry = catalogueEntryByName(catalogue, name)
    if (entry !== null) {
      ids.add(canonicalBodyIdForEntry(catalogue, entry))
    }
  }
  return ids
}

function coloniseRejectionMessage(
  reason: ColonisationRejectionReason,
  name: string,
): string {
  switch (reason) {
    case 'already-owned':
      return `planet already claimed: ${name}`
    case 'protected':
      return `planet is protected: ${name}`
    case 'requirements-not-met':
      return `colonisation requirements not met: ${name}`
    case 'insufficient-funds':
      return `insufficient funds to colonise: ${name}`
    case 'invalid-target':
      return `cannot colonise target: ${name}`
  }
}

/**
 * Run the canonical colonisation eligibility ladder for a legacy entry on
 * behalf of a player: maps the entry + the player's owned planets to
 * canonical body ids, unions the caller's all-player ownership overlay, and
 * delegates to colonisation.ts colonise (the single ownership
 * implementation). EVERY rejection is propagated as a descriptive RangeError
 * — an OwnedPlanet is only built on a canonical ok.
 */
function coloniseEntryForPlayer(
  catalogue: readonly PlanetCatalogueEntry[],
  player: PlayerState,
  entry: PlanetCatalogueEntry,
  now: number,
  overlay: ColoniseOverlay,
): OwnedPlanet {
  const existingOwners = new Set<BodyId>(overlay.globalOwners)
  for (const id of ownedBodyIds(catalogue, player)) {
    existingOwners.add(id)
  }
  const input: ColoniseInput = {
    bodyId: canonicalBodyIdForEntry(catalogue, entry),
    ownerId: player.playerId,
    wallet: player.wallet,
    requirements: overlay.requirements,
    existingOwners,
    at: now,
    protection: overlay.protection,
  }
  const result = coloniseCanonical(input)
  if (!result.ok) {
    throw new RangeError(coloniseRejectionMessage(result.reason, entry.name))
  }
  return buildOwnedPlanet(entry, now, false)
}

export function unclaimedPlanets(
  catalogue: readonly PlanetCatalogueEntry[],
  player: PlayerState,
): PlanetCatalogueEntry[] {
  const owned = ownedNames(player)
  return catalogue.filter((entry) => !owned.has(entry.name))
}

export function firstUnclaimedByIndex(
  catalogue: readonly PlanetCatalogueEntry[],
  player: PlayerState,
): PlanetCatalogueEntry | null {
  const owned = ownedNames(player)
  for (const entry of catalogue) {
    if (!owned.has(entry.name)) {
      return entry
    }
  }
  return null
}

export function colonise(
  catalogue: readonly PlanetCatalogueEntry[],
  player: PlayerState,
  name: string,
  now: number,
  overlay: ColoniseOverlay,
): PlayerState {
  const entry = catalogueEntryByName(catalogue, name)
  if (entry === null) {
    throw new RangeError(`unknown planet: ${name}`)
  }
  const colony = coloniseEntryForPlayer(catalogue, player, entry, now, overlay)
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
  catalogue: readonly PlanetCatalogueEntry[],
  player: PlayerState,
  now: number,
  overlay: ColoniseOverlay,
): { player: PlayerState; colony: OwnedPlanet } {
  const entry = firstUnclaimedByIndex(catalogue, player)
  if (entry === null) {
    throw new RangeError('no unclaimed planets remain in the catalogue')
  }
  const colony = coloniseEntryForPlayer(catalogue, player, entry, now, overlay)
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
