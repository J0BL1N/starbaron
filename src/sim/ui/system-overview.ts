/**
 * System overview contract (P4-T05): the pure UI-state view of ONE star
 * system — a star summary, the deterministic body list (planets / moons /
 * asteroids), per-body cards (type, radius, tier, ownership), colonisable
 * flags with their cost, and the system's selected-body state.
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no wall-clock. `at` is
 * a caller-supplied INPUT (milliseconds since epoch) validated with the same
 * discipline as ./hover, but it is never echoed into the payload — it exists
 * so a caller can pin the tick at which a snapshot was taken. The same inputs
 * always produce the same (deep-equal) result.
 *
 * Contract scope: this module delivers the SYSTEM-OVERVIEW CONTRACT and its
 * projections only — React components consume them in later tasks. No
 * rendering wiring exists here.
 *
 * TIER MAPPING (design note): the brief references a `planetTier` helper in
 * ../planets/levels.ts. That function does not exist in this repo (verified
 * by grep at P4-T05). This module therefore provides the equivalent LOCKED
 * mapping itself, deriving tier from the pinned catalogue (../data/planets)
 * by body name — the single source of tier truth, locked at import time —
 * with the DESIGN gas-giant exclusion. A body is a gas giant when it is a
 * tier-5 catalogue planet with density < GAS_GIANT_DENSITY_MAX (the exact
 * locked rule in ../planets/quirks.ts, reused here). Gas giants and
 * non-planets (and catalogue misses: procedural bodies with no entry) get
 * tier null, so they are never colonisable.
 *
 * COLONISATION COST (design note): the brief types `coloniseCost` as
 * number|null while also naming the locked COLONISATION_BASE_COST constant,
 * which is a { credits, alloys } pair. The card exposes the credits component
 * as the single-number cost (matching the P2-T03 UI's credits-only colonise
 * display); the alloy component is not carried by this contract.
 *
 * ORDERING: body cards are emitted in RADIUS-DESCENDING order (largest first),
 * ties broken by body id ascending — deterministic, never the registry order.
 *
 * STAR SUMMARY: `<star class> · <count> <body|bodies>`, where the star class
 * mirrors the hover contract ('G2 V' → 'G-class star'; missing or blank →
 * 'Unknown star') and the count is the number of body cards (resolved bodies).
 *
 * SELECTION: `selectedBodyId` is passed through only when it names a body in
 * the card list; otherwise it projects to null. `selectBody` is the immutable
 * selection update and throws for an unknown body id.
 *
 * INFO-GATING: `viewerLevel` is a REQUIRED input (info.ts's InfoLevel
 * contract). ownerId/colonisable/coloniseCost are exposed only for an
 * owner-or-above viewer; a public (or lower) viewer gets the public subset —
 * ownerId null, colonisable false, coloniseCost null — so hidden truth never
 * reaches the client.
 */

import type { UniverseState } from '../world/reconstruct'
import { queryBodiesBySystem, querySystem } from '../world/api'
import type { BodyRecord } from '../world/body'
import type { BodyType, SystemId } from '../world/identity'
import { PLANETS } from '../data/planets'
import type { PlanetCatalogueEntry } from '../data/planets'
import { GAS_GIANT_DENSITY_MAX, densityProxy } from '../planets/quirks'
import { COLONISATION_BASE_COST } from '../player/colonisation'
import { starSummaryFor } from './display'
import { assertInfoLevel, canViewLevel } from './info'
import type { InfoLevel } from './info'
import { assertPositiveAt } from './validate'

export interface BodyCard {
  id: string
  name: string
  type: BodyType
  radiusKm: number
  tier: number | null
  ownerId: string | null
  colonisable: boolean
  coloniseCost: number | null
}

export interface SystemOverview {
  systemId: string
  systemName: string
  starSummary: string
  bodies: BodyCard[]
  selectedBodyId: string | null
}

export interface SystemOverviewInput {
  systemId: string
  universe: UniverseState
  ownership?: ReadonlyMap<string, string>
  selectedBodyId?: string | null
  viewerLevel: InfoLevel
  at: number
}

/**
 * Immutable name → catalogue-entry lookup over the pinned snapshot, built once
 * at module load and never mutated (plain frozen data — not module state).
 */
const CATALOGUE_BY_NAME: Readonly<Record<string, PlanetCatalogueEntry>> = Object.freeze(
  Object.fromEntries(
    PLANETS.map((entry) => [entry.name, Object.freeze(entry)]),
  ),
)

/**
 * The LOCKED tier mapping for a body: non-planets, gas giants (tier-5 with
 * density below GAS_GIANT_DENSITY_MAX, per the locked quirk rule), and bodies
 * with no pinned catalogue entry all map to null. Planets with a catalogue
 * entry carry that entry's locked tier. Deterministic by construction.
 */
function planetTier(body: BodyRecord): number | null {
  if (body.type !== 'planet') {
    return null
  }
  const entry = CATALOGUE_BY_NAME[body.name]
  if (entry === undefined) {
    return null
  }
  const density = densityProxy(entry)
  if (entry.tier === 5 && density !== null && density < GAS_GIANT_DENSITY_MAX) {
    return null
  }
  return entry.tier
}

function bodyCard(
  body: BodyRecord,
  ownership: ReadonlyMap<string, string> | undefined,
  canSeeOwnership: boolean,
): BodyCard {
  const tier = planetTier(body)
  const ownerId =
    canSeeOwnership && ownership !== undefined
      ? (ownership.get(body.id) ?? null)
      : null
  const colonisable =
    canSeeOwnership && body.type === 'planet' && ownerId === null && tier !== null
  return {
    id: body.id,
    name: body.name,
    type: body.type,
    radiusKm: body.radius,
    tier,
    ownerId,
    colonisable,
    coloniseCost: colonisable ? COLONISATION_BASE_COST.credits : null,
  }
}

function byRadiusDescending(a: BodyCard, b: BodyCard): number {
  if (a.radiusKm !== b.radiusKm) {
    return b.radiusKm - a.radiusKm
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Build the deterministic system-overview projection for one system, or throw
 * a RangeError when the system id does not resolve against the state (a query
 * miss), `at` is not a positive finite number, or `viewerLevel` is not one of
 * the four InfoLevels.
 */
export function systemOverviewFor(input: SystemOverviewInput): SystemOverview {
  assertPositiveAt(input.at)
  assertInfoLevel(input.viewerLevel)
  const system = querySystem(input.universe, input.systemId as SystemId)
  if (system === null) {
    throw new RangeError(
      `unknown system id ${JSON.stringify(input.systemId)}`,
    )
  }
  const bodies = queryBodiesBySystem(input.universe, system.id)
    .map((body) => bodyCard(body, input.ownership, canViewLevel(input.viewerLevel, 'owner')))
    .sort(byRadiusDescending)
  const selectedBodyId =
    input.selectedBodyId === undefined ||
    input.selectedBodyId === null ||
    !bodies.some((card) => card.id === input.selectedBodyId)
      ? null
      : input.selectedBodyId
  const count = bodies.length
  const starSummary = `${starSummaryFor(system.star.starType)} · ${count} ${count === 1 ? 'body' : 'bodies'}`
  return {
    systemId: system.id,
    systemName: system.name,
    starSummary,
    bodies,
    selectedBodyId,
  }
}

/**
 * Immutable selection update: return a new overview with `bodyId` selected,
 * leaving the input untouched. Throws a RangeError when `bodyId` is not one
 * of the overview's body cards.
 */
export function selectBody(overview: SystemOverview, bodyId: string): SystemOverview {
  if (!overview.bodies.some((card) => card.id === bodyId)) {
    throw new RangeError(`unknown body id ${JSON.stringify(bodyId)}`)
  }
  return { ...overview, selectedBodyId: bodyId }
}
