/**
 * P2-T02 — deterministic home-world assignment.
 *
 * Pure module: every function is a pure function of its inputs — no
 * nondeterministic APIs, no wall-clock timestamps, no module-level mutable
 * state. The same inputs always produce the same (deep-equal) results.
 *
 * The eligible set is derived directly from the pinned planet catalogue in
 * catalogue order, using the same id construction buildCatalogueMapping uses
 * (bodyId(systemId(galaxySlug, hostname), 'planet', ordinalWithinHost)) —
 * it never depends on a mapping instance, only on the entries themselves.
 *
 * Collision prevention is a two-phase probe scheme (see selectHomeWorld):
 *   - Phase A — player-specific hash probes: up to 2 × n attempts probing
 *     (base + fnv1a(`${salt}|${playerId}|probe|${k}`) % n) % n for k = 1..2n.
 *     The per-attempt offset is a fresh hash keyed by the player id, so
 *     different players that share a base index generally probe different
 *     offsets. Divergence onto distinct fallbacks at non-power-of-two sizes is
 *     an OBSERVED property of the fixtures tested in tests/assignment.test.ts,
 *     not a mathematically guaranteed outcome for every player pair/taken set.
 *     At power-of-two sizes equal base hash state converges instead (see
 *     selectHomeWorld for the conditional property).
 *   - Phase B — complete-coverage rotation: only when Phase A finds nothing,
 *     probe (base + k) % n for k = 1..n — a full rotation that visits every
 *     free body; Phase A can only miss a free body when its offsets skip it.
 * Total attempts never exceed phase A (2n) + phase B (n) = 3 × eligible.length,
 * and exhaustion is only reported after both phases when every id is taken.
 */

import { fnv1a } from '../planets/hash'
import { bodyId, systemId } from '../world/identity'
import type { BodyId } from '../world/identity'
import type { PlanetCatalogueEntry } from '../data/planets'
import { withHomeWorld } from './profile'
import type { PlayerProfile } from './profile'

/** Galaxy slug every eligible home world is rooted under (matches catalogue). */
export const CATALOGUE_SLUG = 'catalogue'

/** Default salt used to namespace the base/probe hashes. */
export const HOME_WORLD_SALT = 'starbaron-home-v1'

export type HomeAssignmentResult =
  | { ok: true; bodyId: BodyId; attempt: number }
  | { ok: false; reason: 'exhausted' | 'invalid-eligible-set'; attempt: number }

export interface SelectHomeWorldInput {
  playerId: string
  eligible: readonly BodyId[]
  taken: ReadonlySet<BodyId>
  salt?: string
}

export interface ResolveExistingHomeResult {
  ok: boolean
  reason?: 'not-assigned' | 'home-not-in-taken'
}

function assertEntryIndex(
  planets: readonly PlanetCatalogueEntry[],
  entryIndex: number,
): void {
  if (!Number.isInteger(entryIndex) || entryIndex < 0 || entryIndex >= planets.length) {
    throw new RangeError(
      `entryIndex must be an integer within [0, ${planets.length - 1}], got: ${String(entryIndex)}`,
    )
  }
}

/**
 * Ordinal of a catalogue entry within its host group, in catalogue order.
 * Every eligible home world's ordinal equals the count of prior entries that
 * share the same hostname — the same per-host index buildCatalogueMapping
 * assigns, so the derived body id is identical.
 */
export function hostGroupIndex(
  planets: readonly PlanetCatalogueEntry[],
  entryIndex: number,
): number {
  assertEntryIndex(planets, entryIndex)
  const hostname = planets[entryIndex].hostname
  let ordinal = 0
  for (let index = 0; index < entryIndex; index += 1) {
    if (planets[index].hostname === hostname) {
      ordinal += 1
    }
  }
  return ordinal
}

/**
 * Deterministic eligible set: every catalogue planet's body id in catalogue
 * order — bodyId(systemId('catalogue', hostname), 'planet', ordinalWithinHost).
 * Derived directly from the entries, never from a mapping instance.
 */
export function eligibleHomeBodies(
  planets: readonly PlanetCatalogueEntry[],
): BodyId[] {
  const bodies: BodyId[] = []
  for (let index = 0; index < planets.length; index += 1) {
    const entry = planets[index]
    bodies.push(
      bodyId(systemId(CATALOGUE_SLUG, entry.hostname), 'planet', hostGroupIndex(planets, index)),
    )
  }
  return bodies
}

/**
 * Upper bound of probe attempts per eligible body. Selection probes in two
 * phases — Phase A (2 × n player-specific hash probes) plus Phase B (n
 * rotation probes) — so total attempts never exceed 3 × eligible.length.
 */
export const HOME_WORLD_MAX_ATTEMPT_FACTOR = 3

/**
 * Deterministic home-world selection with two-phase collision prevention.
 *
 * The base index is the player's fnv1a hash modulo the eligible count and is
 * returned at attempt 0 when free. Otherwise selection probes in two phases:
 *   - Phase A (attempts 1..2n): probe_k = (base + fnv1a(`${salt}|${playerId}|
 *     probe|${k}`) % n) % n for k = 1..2n. The per-attempt offset is a fresh
 *     hash of the player id, so same-base players probe different sequences
 *     and are OBSERVED to diverge onto distinct fallbacks on the odd-sized
 *     fixture tested in tests/assignment.test.ts. Distinct modulo-n outcomes
 *     are NOT mathematically guaranteed for every player pair/taken set.
 *     Conditional power-of-two property: when two same-base players share equal
 *     base hash state, the low-bit determinism of fnv1a (equal state mod 2^k
 *     survives the identical `|probe|${k}` suffix) keeps them on identical
 *     probe sequences, so they converge on the same fallback.
 *   - Phase B (attempts 2n+1..3n): probe = (base + k) % n for k = 1..n, a
 *     complete-coverage rotation that finds any free body Phase A's offsets
 *     skipped. A free id therefore always resolves, and 'exhausted' (attempt
 *     3n) is only reported after both phases when every eligible id is taken.
 */
export function selectHomeWorld(input: SelectHomeWorldInput): HomeAssignmentResult {
  const salt = input.salt ?? HOME_WORLD_SALT
  const count = input.eligible.length
  if (count === 0) {
    return { ok: false, reason: 'invalid-eligible-set', attempt: 0 }
  }
  const base = fnv1a(`${salt}|${input.playerId}`) % count
  const first = input.eligible[base]
  if (first !== undefined && !input.taken.has(first)) {
    return { ok: true, bodyId: first, attempt: 0 }
  }
  for (let k = 1; k <= 2 * count; k += 1) {
    const index = (base + (fnv1a(`${salt}|${input.playerId}|probe|${k}`) % count)) % count
    const candidate = input.eligible[index]
    if (candidate !== undefined && !input.taken.has(candidate)) {
      return { ok: true, bodyId: candidate, attempt: k }
    }
  }
  for (let k = 1; k <= count; k += 1) {
    const index = (base + k) % count
    const candidate = input.eligible[index]
    if (candidate !== undefined && !input.taken.has(candidate)) {
      return { ok: true, bodyId: candidate, attempt: 2 * count + k }
    }
  }
  return { ok: false, reason: 'exhausted', attempt: 3 * count }
}

/**
 * Immutable application of a home assignment to a profile: applies the body id
 * when the result is ok, otherwise returns the profile unchanged.
 */
export function assignHomeWorld(
  profile: PlayerProfile,
  result: HomeAssignmentResult,
): PlayerProfile {
  if (!result.ok) {
    return profile
  }
  return withHomeWorld(profile, result.bodyId)
}

/**
 * Repeat-login validation of an existing home world. The home world is always
 * claimed by its owner, so it MUST be present in the taken set; its absence is
 * a consistency flag (reason 'home-not-in-taken'). A missing homeWorld is
 * reported as 'not-assigned'.
 */
export function resolveExistingHome(
  profile: PlayerProfile,
  taken: ReadonlySet<BodyId>,
): ResolveExistingHomeResult {
  if (profile.homeWorld === undefined) {
    return { ok: false, reason: 'not-assigned' }
  }
  if (!taken.has(profile.homeWorld)) {
    return { ok: false, reason: 'home-not-in-taken' }
  }
  return { ok: true }
}
