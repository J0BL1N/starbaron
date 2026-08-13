/**
 * Invasion force model (P7-T02) — population recruitment for an invasion,
 * the recruitment ledger, and the committed marker. DESIGN §4a/§5 lock the
 * semantics: the attack cost is population + fleet; recruited troops are
 * committed whether the invasion wins or loses ("launch invasion of 5,000
 * troops — those 5,000 are gone whether you win or lose"). This module is
 * the recruitment half — the credit cost stays with the launch model (T01,
 * attackLaunchCost), so recruitmentCost.credits is 0 by design.
 *
 * PURE module — deterministic, no time-source reads (every timestamp is an
 * input), no nondeterministic APIs, no module-level mutable state, strictly
 * typed.
 *
 * DESIGN decisions (documented):
 * - **Recruitable pool:** per planet, min(population, garrison cap). The
 *   garrison cap DELEGATES to the locked `garrisonCapFor` helper
 *   (src/sim/player/estimator.ts) — BARRACKS_GARRISON_CAP_PER_LEVEL ×
 *   effectiveLevel(barracks) — the same formula structureEffect('barracks')
 *   and computePlanetDerived use (effects.ts:60, accrual.ts:105). No cap is
 *   re-derived here; the caller's barracks level is the input.
 * - **Fleet capacity:** the fleet carries the committed force, so
 *   `recruitTroops` REJECTS `desiredTroops > fleetSize` (RangeError
 *   'cannot recruit N troops into a fleet of M') — a recruited force can
 *   always be carried into launchAttack (troopsCommitted ≤ fleetSize, T01).
 *   `desiredTroops == fleetSize` is the whole-fleet edge and is accepted.
 * - **Structure levels:** the sim OwnedPlanet type (locked, P2-era) carries
 *   no structure levels, so recruitTroops takes a REQUIRED per-planet
 *   barracks-level map (planet name → level). The caller resolves it from
 *   player.structureLevels[name].barracks (the gridForPlanet pattern). A
 *   planet missing from the map defaults to level 0 (garrison cap 0 → no
 *   recruits), mirroring gridForPlanet's empty-grid fallback.
 * - **Credit cost:** recruitmentCost.credits is 0 — the launch cost is T01's
 *   model. Population is the real price (DESIGN: lives are the real price).
 * - **Draw order:** deterministic — larger pools first (available descending),
 *   name ascending as the tie-break (plain string comparison); each planet
 *   contributes min(its pool, remaining).
 * - **Deficiency:** when desired > available, deficiencies carries one
 *   message and the force is raised with ALL available troops (recruits =
 *   available); when the pool suffices, deficiencies is empty.
 * - **Zero pool:** recruitTroops throws when no troops are recruitable (the
 *   pool is 0) — a force with zero troops would violate the "troops positive"
 *   invariant, so raising one is rejected up front.
 * - **Committed marker:** commitInvasion moves 'ready' → 'committed'.
 *   Another status (assembling, committed, destroyed) throws — only a ready
 *   force may be committed, and the troops are gone whether win or lose.
 * - **Identity:** the force carries no hash id — attackerId + raisedAt + the
 *   recruitment ledger identify it; a deterministic id belongs to the launch
 *   model (T01).
 */

import { garrisonCapFor } from '../player/estimator'
import { assertPositiveAt } from '../ui/validate'
import type { OwnedPlanet } from '../player/types'

export type InvasionStatus = 'assembling' | 'ready' | 'committed' | 'destroyed'

export interface InvasionForce {
  attackerId: string
  troops: number
  recruitedFrom: ReadonlyMap<string, number>
  fleetSize: number
  raisedAt: number
  status: InvasionStatus
}

export interface RecruitmentResult {
  force: InvasionForce
  recruitmentCost: {
    credits: number
    population: number
  }
  deficiencies: string[]
}

export interface RecruitTroopsInput {
  attackerId: string
  planets: readonly OwnedPlanet[]
  desiredTroops: number
  fleetSize: number
  raisedAt: number
  at: number
  barracksLevels: ReadonlyMap<string, number>
}

/**
 * The InvasionStatus union as a deep-frozen lookup table (module-level lookup
 * tables are runtime-immutable — treat as read-only).
 */
export const INVASION_STATUSES: readonly InvasionStatus[] = Object.freeze([
  'assembling',
  'ready',
  'committed',
  'destroyed',
])

function assertNonEmptyString(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new RangeError(
      `${field} must be a non-empty string, got ${JSON.stringify(value)}`,
    )
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer, got ${value}`)
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${field} must be a finite non-negative number, got ${value}`,
    )
  }
}

function assertPlanetsArray(planets: readonly OwnedPlanet[]): void {
  if (!Array.isArray(planets)) {
    throw new RangeError(`planets must be an array, got ${planets}`)
  }
}

function assertBarracksLevels(levels: ReadonlyMap<string, number>): void {
  if (!(levels instanceof Map)) {
    throw new RangeError(`barracksLevels must be a Map, got ${levels}`)
  }
}

function assertNoDuplicatePlanetNames(planets: readonly OwnedPlanet[]): void {
  const seen = new Set<string>()
  for (const planet of planets) {
    if (seen.has(planet.name)) {
      throw new RangeError(
        `planets must have unique names, got duplicate ${JSON.stringify(
          planet.name,
        )}`,
      )
    }
    seen.add(planet.name)
  }
}

function planetPool(
  planet: OwnedPlanet,
  barracksLevels: ReadonlyMap<string, number>,
): { name: string; available: number } {
  assertNonEmptyString(planet.name, 'planet.name')
  assertFiniteNonNegative(planet.population, `planet ${planet.name} population`)
  const barracksLevel = barracksLevels.get(planet.name) ?? 0
  const cap = garrisonCapFor(barracksLevel)
  return { name: planet.name, available: Math.min(planet.population, cap) }
}

function comparePoolsDesc(
  a: { name: string; available: number },
  b: { name: string; available: number },
): number {
  if (a.available !== b.available) {
    return b.available - a.available
  }
  if (a.name < b.name) {
    return -1
  }
  if (a.name > b.name) {
    return 1
  }
  return 0
}

function drawLedger(
  pools: ReadonlyArray<{ name: string; available: number }>,
  total: number,
): Map<string, number> {
  const ordered = [...pools].sort(comparePoolsDesc)
  const ledger = new Map<string, number>()
  let remaining = total
  for (const pool of ordered) {
    if (remaining <= 0) {
      break
    }
    const draw = Math.min(pool.available, remaining)
    if (draw > 0) {
      ledger.set(pool.name, draw)
      remaining -= draw
    }
  }
  return ledger
}

/**
 * Recruits troops for an invasion from the owned planets' recruitable pools
 * (per planet: min(population, garrison cap), the cap delegated to the locked
 * garrisonCapFor helper). Validation order (each throws RangeError):
 *   1. `at` finite > 0 (current time — an input, no time-source reads)
 *   2. `raisedAt` finite > 0
 *   3. `attackerId` non-empty
 *   4. `desiredTroops` positive integer
 *   5. `fleetSize` finite >= 0, and `desiredTroops <= fleetSize` (the fleet
 *      carries the committed force — RangeError 'cannot recruit N troops
 *      into a fleet of M' otherwise)
 *   6. `planets` an array, each planet non-empty name + finite non-negative
 *      population, and each barracks level valid for garrisonCapFor
 *   7. duplicate planet names → RangeError — the ledger is keyed by name, so
 *      two same-named planets would corrupt "recruitedFrom sums to troops"
 *   8. a zero recruitable pool (available troops sum 0) → RangeError — a
 *      force with no troops cannot be raised
 *
 * The force is returned status 'ready' with fleetSize recorded. The returned
 * `recruitedFrom` ledger and the input are never shared mutable state: the
 * ledger is a fresh Map and the input planets are read-only. The input's
 * own Map is never mutated.
 */
export function recruitTroops(input: RecruitTroopsInput): RecruitmentResult {
  assertPositiveAt(input.at)
  assertPositiveAt(input.raisedAt)
  assertNonEmptyString(input.attackerId, 'attackerId')
  assertPositiveInteger(input.desiredTroops, 'desiredTroops')
  assertFiniteNonNegative(input.fleetSize, 'fleetSize')
  if (input.desiredTroops > input.fleetSize) {
    throw new RangeError(
      `cannot recruit ${input.desiredTroops} troops into a fleet of ${input.fleetSize}`,
    )
  }
  assertPlanetsArray(input.planets)
  assertBarracksLevels(input.barracksLevels)
  assertNoDuplicatePlanetNames(input.planets)

  const pools = input.planets.map((planet) => planetPool(planet, input.barracksLevels))
  const available = pools.reduce((sum, pool) => sum + pool.available, 0)

  if (available <= 0) {
    throw new RangeError(
      `cannot recruit an invasion force: recruitable pool is 0 troops ` +
        `(desired ${input.desiredTroops})`,
    )
  }

  const recruited = Math.min(input.desiredTroops, available)
  const deficiencies =
    available >= input.desiredTroops
      ? []
      : [
          `insufficient population: need ${input.desiredTroops}, have ${available}`,
        ]

  const force: InvasionForce = {
    attackerId: input.attackerId,
    troops: recruited,
    recruitedFrom: drawLedger(pools, recruited),
    fleetSize: input.fleetSize,
    raisedAt: input.raisedAt,
    status: 'ready',
  }

  return {
    force,
    recruitmentCost: { credits: 0, population: recruited },
    deficiencies,
  }
}

/**
 * Commits a ready invasion force: 'ready' → 'committed' (the troops are gone
 * whether the invasion wins or loses — DESIGN). `at` must be finite > 0.
 * A force not in status 'ready' (assembling, committed, destroyed) throws —
 * only a ready force may be committed. Returns a fresh force object; the
 * input force is never mutated.
 */
export function commitInvasion(force: InvasionForce, at: number): InvasionForce {
  assertPositiveAt(at)
  if (force.status !== 'ready') {
    throw new RangeError(
      `cannot commit an invasion force in status ${force.status} (only 'ready' forces are committed)`,
    )
  }
  return { ...force, status: 'committed' }
}

/**
 * Structural invariants of an InvasionForce: attackerId non-empty; troops a
 * positive finite number; recruitedFrom a Map of non-empty planet names to
 * finite non-negative draws summing to troops; fleetSize finite >= 0; status
 * in the union; raisedAt finite > 0.
 */
export function invasionInvariants(force: InvasionForce): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []

  if (typeof force.attackerId !== 'string' || force.attackerId.trim().length === 0) {
    problems.push(
      `attackerId must be a non-empty string, got ${String(force.attackerId)}`,
    )
  }

  if (!Number.isFinite(force.troops) || force.troops <= 0) {
    problems.push(
      `troops must be a positive finite number, got ${force.troops}`,
    )
  }

  if (!(force.recruitedFrom instanceof Map)) {
    problems.push('recruitedFrom must be a Map')
  } else {
    let sum = 0
    for (const [name, drawn] of force.recruitedFrom) {
      if (typeof name !== 'string' || name.length === 0) {
        problems.push('recruitedFrom keys must be non-empty planet names')
      }
      if (!Number.isFinite(drawn) || drawn < 0) {
        problems.push(
          `recruitedFrom.${name} must be a finite non-negative number, got ${drawn}`,
        )
      }
      sum += drawn
    }
    if (sum !== force.troops) {
      problems.push(`recruitedFrom sums to ${sum}, but troops is ${force.troops}`)
    }
  }

  if (!Number.isFinite(force.fleetSize) || force.fleetSize < 0) {
    problems.push(
      `fleetSize must be a finite non-negative number, got ${force.fleetSize}`,
    )
  }

  if (!(INVASION_STATUSES as readonly string[]).includes(force.status)) {
    problems.push(
      `status must be one of 'assembling'|'ready'|'committed'|'destroyed', ` +
        `got ${String(force.status)}`,
    )
  }

  if (!Number.isFinite(force.raisedAt) || force.raisedAt <= 0) {
    problems.push(
      `raisedAt must be a finite number > 0, got ${force.raisedAt}`,
    )
  }

  return { ok: problems.length === 0, problems }
}
