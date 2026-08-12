/**
 * UI mock/real data boundary (P4-T09).
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no wall-clock. The
 * same inputs always produce the same (deep-equal) outputs.
 *
 * THE BOUNDARY CONTRACT (the roadmap's locked rule: mocks and real data
 * NEVER mix silently — a tagged boundary):
 *   - UiDataSource is the ONE adapter interface the UI consumes. Mock and
 *     real sources both satisfy it by structural typing, so a UI component
 *     cannot tell them apart without reading `kind`.
 *   - kind is the TAG: 'mock' means "demo/dummy data", 'real' means "the
 *     live sim/persistence". Every source carries its tag, and every
 *     production path MUST run its sources through guardReal before use — a
 *     mock source fed to a production path is a THROW, never a silent mix.
 *   - The reverse direction is implicit: real data is never injected into
 *     mock fixtures, because mock fixtures are self-contained by
 *     construction — they build their own player and universe and never
 *     call out to the app.
 *
 * MOCK (mockDataSource) — DETERMINISTIC and STATIC:
 *   - The fixture player is createPlayer-based: the home world comes from
 *     the deterministic catalogue pick (fnv1a over the derived player id)
 *     and the player owns MOCK_COLONY_COUNT colonies picked in pinned
 *     catalogue order (never the home, never a duplicate). Every owned
 *     planet gets a full starter structure grid.
 *   - The fixture universe is exactly 1 galaxy, 1 system, and one planet
 *     body per owned planet (home + colonies), named after the owned
 *     planets so the universe and the player agree.
 *   - `seed` affects ONLY id/label suffixes: the player id, the galaxy
 *     slug, and the galaxy display name embed namespaced fnv1a(seed)
 *     suffixes, so a different seed yields different ids/labels but the
 *     same fixture SHAPE.
 *   - playerAt/universeAt IGNORE `at` except validation (must be a positive
 *     finite number) and return the SAME captured state object on every
 *     call — the mock is static. The captured state is per-source (built
 *     inside mockDataSource), never module-level.
 *
 * REAL (realDataSource) — pure DELEGATION:
 *   - kind 'real', label 'live'. playerAt/universeAt forward `at` verbatim
 *     to the supplied getters, which the app wires to the live sim /
 *     persistence. No caching: every call re-delegates, so distinct getter
 *     results flow straight through. `at` validation is the getter's (and
 *     application's) concern, not this adapter's.
 */

import type { PlanetCatalogueEntry } from '../data/planets'
import { PLANETS } from '../data/planets'
import { fnv1a } from '../planets/hash'
import { claimColony } from '../player/claim'
import { emptyStructureLevels } from '../player/grid'
import { createPlayer } from '../player/player'
import type { OwnedPlanet, PlayerState, StructureGrid } from '../player/types'
import type { BodyRecord } from '../world/body'
import { buildBodyRecord } from '../world/body'
import { buildGalaxyRecord, registerSystem } from '../world/galaxy'
import type { UniverseState } from '../world/reconstruct'
import { buildSystemRecord, registerBody } from '../world/system'

/** The mock/real tag: 'mock' = demo/dummy data, 'real' = live sim/persistence. */
export type DataSourceKind = 'mock' | 'real'

/**
 * The ONE adapter interface the UI consumes. Mock and real sources both
 * satisfy it by structural typing; the `kind` tag is the boundary.
 */
export interface UiDataSource {
  kind: DataSourceKind
  label: string
  playerAt(at: number): PlayerState
  universeAt(at: number): UniverseState
}

/** Per-kind label lists plus the mixed flag for the dev UI. */
export interface BoundaryReport {
  mock: string[]
  real: string[]
  mixed: boolean
}

/** Fixed fixture timestamp for the static mock (documented; never wall-clock). */
export const MOCK_FIXTURE_AT = 1_700_000_000_000

/** Number of colonies the mock fixture owns beyond its home planet. */
export const MOCK_COLONY_COUNT = 2

/** System slug for the mock's single system. */
const MOCK_SYSTEM_SLUG = 'home'

function assertNonEmpty(value: string, name: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new RangeError(
      `${name} must be a non-empty string, got ${JSON.stringify(value)}`,
    )
  }
  return trimmed
}

function assertPositiveAt(at: number): void {
  if (!Number.isFinite(at) || at <= 0) {
    throw new RangeError(
      `at must be a positive finite number (milliseconds), got ${at}`,
    )
  }
}

/** Deterministic mock player id: label plus a namespaced fnv1a(seed) suffix. */
function mockPlayerId(label: string, seed: string): string {
  return `mock-${label}-${fnv1a(`${seed}|player`)}`
}

/** Deterministic mock galaxy slug: namespaced fnv1a(seed) suffix. */
function mockGalaxySlug(seed: string): string {
  return `mock-galaxy-${fnv1a(`${seed}|galaxy`)}`
}

/**
 * The mock's colonies, picked deterministically in PINNED CATALOGUE ORDER
 * (never the home planet, never a duplicate) up to MOCK_COLONY_COUNT.
 */
function colonyEntriesFor(homeName: string): PlanetCatalogueEntry[] {
  const colonies: PlanetCatalogueEntry[] = []
  for (const entry of PLANETS) {
    if (entry.name === homeName) {
      continue
    }
    colonies.push(entry)
    if (colonies.length === MOCK_COLONY_COUNT) {
      break
    }
  }
  return colonies
}

/**
 * The deterministic static fixture player: createPlayer-based home world
 * (the catalogue pick derives from the player id via fnv1a) plus
 * MOCK_COLONY_COUNT colonies and a full starter structure grid for every
 * owned planet.
 */
function buildMockPlayer(label: string, seed: string): PlayerState {
  const playerId = mockPlayerId(label, seed)
  const player = createPlayer(playerId, MOCK_FIXTURE_AT)
  const colonies = colonyEntriesFor(player.homePlanet.name).map((entry) =>
    claimColony(entry, MOCK_FIXTURE_AT),
  )
  const structureLevels: Record<string, StructureGrid> = {
    ...player.structureLevels,
  }
  for (const colony of colonies) {
    structureLevels[colony.name] = emptyStructureLevels()
  }
  return { ...player, colonies, structureLevels }
}

/**
 * The deterministic mock universe: exactly 1 galaxy, 1 system, and one
 * planet body per owned planet (home + colonies), named after the owned
 * planets so the universe agrees with the player fixture.
 */
function buildMockUniverse(
  seed: string,
  owned: readonly OwnedPlanet[],
): UniverseState {
  const galaxySlug = mockGalaxySlug(seed)
  let galaxy = buildGalaxyRecord({
    slug: galaxySlug,
    seed: galaxySlug,
    name: `Mock Home ${fnv1a(`${seed}|galaxy`)}`,
  })
  let system = buildSystemRecord({
    galaxy: galaxy.id,
    slug: MOCK_SYSTEM_SLUG,
    name: 'Mock Home System',
    starType: 'G2 V',
  })
  galaxy = registerSystem(galaxy, system.id)
  const bodies: BodyRecord[] = []
  owned.forEach((planet, ordinal) => {
    const body = buildBodyRecord({
      system: system.id,
      type: 'planet',
      ordinal,
      name: planet.name,
    })
    system = registerBody(system, body.id)
    bodies.push(body)
  })
  return { galaxy, systems: [system], bodies }
}

/**
 * Build the DETERMINISTIC, STATIC mock data source. label and seed must be
 * non-empty strings (RangeError otherwise). The fixture is built once here
 * and the SAME captured player/universe objects are returned by every
 * playerAt/universeAt call after `at` validation.
 */
export function mockDataSource(label: string, seed: string): UiDataSource {
  const trimmedLabel = assertNonEmpty(label, 'label')
  const trimmedSeed = assertNonEmpty(seed, 'seed')
  const player = buildMockPlayer(trimmedLabel, trimmedSeed)
  const universe = buildMockUniverse(trimmedSeed, [
    player.homePlanet,
    ...player.colonies,
  ])
  return {
    kind: 'mock',
    label: trimmedLabel,
    playerAt: (at: number): PlayerState => {
      assertPositiveAt(at)
      return player
    },
    universeAt: (at: number): UniverseState => {
      assertPositiveAt(at)
      return universe
    },
  }
}

/**
 * The REAL adapter: pure delegation to the app's live getters. kind 'real',
 * label 'live'. No caching and no `at` validation here — every call forwards
 * `at` verbatim to the wired getter.
 */
export function realDataSource(
  getPlayer: (at: number) => PlayerState,
  getUniverse: (at: number) => UniverseState,
): UiDataSource {
  return {
    kind: 'real',
    label: 'live',
    playerAt: (at: number): PlayerState => getPlayer(at),
    universeAt: (at: number): UniverseState => getUniverse(at),
  }
}

/**
 * BOUNDARY GUARD: returns the source unchanged when it is 'real'; throws
 * when the source is NOT real — mocks (and anything untagged) must never be
 * fed to production paths. The reverse guard is implicit: real data is never
 * injected into mock fixtures because mock fixtures are self-contained.
 */
export function guardReal(source: UiDataSource): UiDataSource {
  if (source.kind !== 'real') {
    throw new RangeError(
      `guardReal: refusing ${JSON.stringify(source.kind)} data source ${JSON.stringify(source.label)} — only 'real' sources may enter production paths`,
    )
  }
  return source
}

/**
 * Labels per kind in INPUT ORDER, plus the mixed flag: mixed = true when
 * both kinds are present (a signal for the dev UI that mock and real data
 * are live in the same session — they must never mix silently).
 */
export function boundaryReport(
  sources: readonly UiDataSource[],
): BoundaryReport {
  const mock: string[] = []
  const real: string[] = []
  for (const source of sources) {
    if (source.kind === 'mock') {
      mock.push(source.label)
    } else {
      real.push(source.label)
    }
  }
  return { mock, real, mixed: mock.length > 0 && real.length > 0 }
}
