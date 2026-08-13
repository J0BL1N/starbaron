/**
 * PLANET DEFENSE (P7-T04) — the defense model: defense structures (turrets),
 * the population garrison, and the defense readiness state. This is the
 * DEFENSE side of combat — resolution (AP vs DP, outcomes, casualties) is
 * T03's resolver (src/sim/combat/resolution.ts) and the locked estimators
 * (src/sim/player/estimator.ts); this module only models the defended
 * strength and the home-vs-deployed readiness, it never resolves.
 *
 * COMPOSITION DECISION (documented — pinned in tests/defense.test.ts):
 * - The LOCKED §5a DP formula (src/sim/structures/effects.ts `defensePower`)
 *   = turrets × TURRET_DEFENSE_POWER_PER_LEVEL (500, effectiveLevel) +
 *   population × MILITIA_DEFENSE_PER_POPULATION (0.15). This is the
 *   resolver/estimator DP (B5: garrison does NOT enter the resolve DP).
 * - DESIGN's garrison model ("every planet has its own soldiers (garrison)
 *   ... They defend automatically") and the Fleet View ("Garrison (home
 *   defenders) vs deployed") make the garrison a HOME DEFENDER, so this
 *   defense model ADDS garrison power on top of the locked DP:
 *     total = locked defensePower(turrets, population) + garrison ×
 *             GARRISON_DEFENSE_PER_UNIT
 *   The resolver DP (T03) is untouched — it stays the locked turrets+militia
 *   formula; this module models the FULL defended strength the fleet view
 *   presents.
 * - `turretPower` mirrors the locked formula's turret term exactly
 *   (500 × effectiveLevel(turrets)) so `militiaPower = locked − turretPower`
 *   is the militia remainder and the breakdown partitions the locked DP
 *   losslessly (militia power is never double-counted, and never negative —
 *   population is validated ≥ 0).
 * - GARRISON_DEFENSE_PER_UNIT = 0.1 is a DRAFT balance input — DESIGN locks
 *   no per-garrison-soldier defense number — exported as the balance knob.
 * - Readiness: garrisonCoverage = garrison / (garrison + fleet), the share
 *   of the military at home; below READINESS_VULNERABLE_THRESHOLD (0.5,
 *   draft — more than half the military away) the planet is flagged
 *   vulnerable. An EMPTY military (garrison 0 AND fleet 0) yields coverage 0
 *   — no defenders at home means the planet is exposed (DESIGN: "your own DP
 *   drops while they're gone").
 *
 * Validation (each throws RangeError): planetName non-empty (validate.ts),
 * garrison / population / fleet finite non-negative, turretLevels a
 * non-negative integer — turrets and population are additionally validated by
 * the delegated locked `defensePower`. The `readiness` inputs are validated
 * in the same order as `defenseStateFor` so invalid planets fail identically
 * on either surface.
 *
 * PURE module — deterministic, no nondeterministic APIs, no time-source
 * reads, no module-level mutable state (the lookup table is deep-frozen),
 * strictly typed.
 */

import { effectiveLevel } from '../planets/levels'
import { formatNumber } from '../core/format'
import {
  defensePower,
  TURRET_DEFENSE_POWER_PER_LEVEL,
} from '../structures/effects'
import { assertNonEmptyString } from '../ui/validate'

/**
 * GARRISON_DEFENSE_PER_UNIT = 0.1 — the draft defense power contributed by
 * each garrison soldier. DRAFT balance input: DESIGN locks no per-soldier
 * defense number, only that the garrison "defends automatically". The total
 * defended strength is locked defensePower (turrets + militia) + garrison ×
 * this knob.
 */
export const GARRISON_DEFENSE_PER_UNIT = 0.1

/**
 * READINESS_VULNERABLE_THRESHOLD = 0.5 — a planet is flagged vulnerable when
 * less than half of its military (garrison + fleet) is at home
 * (garrisonCoverage < 0.5). Draft threshold, exported as the balance knob.
 */
export const READINESS_VULNERABLE_THRESHOLD = 0.5

export interface DefenseBreakdown {
  turretPower: number
  militiaPower: number
  garrisonPower: number
}

export interface DefenseState {
  planetName: string
  turretLevels: number
  population: number
  garrison: number
  defensePower: number
  breakdown: DefenseBreakdown
}

export interface DefenseStateInput {
  planetName: string
  turretLevels: number
  population: number
  garrison: number
}

/**
 * The DefenseBreakdown fields in canonical display order — a deep-frozen
 * module-level lookup table (runtime-immutable; treat as read-only).
 */
export const DEFENSE_BREAKDOWN_KEYS: ReadonlyArray<
  'turretPower' | 'militiaPower' | 'garrisonPower'
> = Object.freeze(['turretPower', 'militiaPower', 'garrisonPower'])

export interface ReadinessInput {
  turretLevels: number
  population: number
  garrison: number
  fleet: number
}

export interface ReadinessState {
  garrisonCoverage: number
  vulnerable: boolean
  message: string
}

function assertValidLevel(level: number): void {
  if (!Number.isInteger(level) || level < 0) {
    throw new RangeError(`level must be a non-negative integer, got ${level}`)
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${field} must be a finite non-negative number, got ${value}`,
    )
  }
}

/**
 * The defense model for one planet (P7-T04). defensePower = LOCKED
 * `defensePower(turretLevels, population)` from effects.ts (DELEGATED — the
 * §5a turrets+militia formula) + garrison × GARRISON_DEFENSE_PER_UNIT. The
 * breakdown partitions the total losslessly: turretPower mirrors the locked
 * turret term (500 × effectiveLevel), militiaPower is the militia remainder
 * (locked − turretPower), garrisonPower is garrison × GARRISON_DEFENSE_PER_UNIT.
 * Validation order: planetName non-empty → garrison finite non-negative →
 * turretLevels + population via the delegated locked defensePower.
 */
export function defenseStateFor(input: DefenseStateInput): DefenseState {
  assertNonEmptyString(input.planetName, 'planetName')
  assertFiniteNonNegative(input.garrison, 'garrison')
  const locked = defensePower(input.turretLevels, input.population)
  const turretPower = TURRET_DEFENSE_POWER_PER_LEVEL * effectiveLevel(input.turretLevels)
  const militiaPower = locked - turretPower
  const garrisonPower = input.garrison * GARRISON_DEFENSE_PER_UNIT
  return {
    planetName: input.planetName,
    turretLevels: input.turretLevels,
    population: input.population,
    garrison: input.garrison,
    defensePower: locked + garrisonPower,
    breakdown: { turretPower, militiaPower, garrisonPower },
  }
}

/**
 * Defense readiness state: the share of the planet's military (garrison +
 * fleet) at home, whether that share is below the vulnerable threshold, and
 * a deterministic one-line message. garrisonCoverage = garrison / (garrison +
 * fleet) clamped to [0,1] — non-negative validated inputs guarantee the
 * fraction is already inside the interval. An empty military yields coverage
 * 0 (no defenders at home = exposed). vulnerable = garrisonCoverage <
 * READINESS_VULNERABLE_THRESHOLD (strictly less — exactly half is defended).
 * The message percentage is Math.round(coverage × 100).
 */
export function readiness(input: ReadinessInput): ReadinessState {
  assertValidLevel(input.turretLevels)
  assertFiniteNonNegative(input.population, 'population')
  assertFiniteNonNegative(input.garrison, 'garrison')
  assertFiniteNonNegative(input.fleet, 'fleet')

  const totalMilitary = input.garrison + input.fleet
  const raw = totalMilitary > 0 ? input.garrison / totalMilitary : 0
  const garrisonCoverage = Math.min(1, Math.max(0, raw))
  const vulnerable = garrisonCoverage < READINESS_VULNERABLE_THRESHOLD
  const pct = Math.round(garrisonCoverage * 100)
  const message = vulnerable
    ? `VULNERABLE · ${pct}% at home`
    : `Defended · ${pct}% of military at home`
  return { garrisonCoverage, vulnerable, message }
}

/**
 * Deterministic one-line defense summary of a DefenseState, e.g.
 * `3 turrets · 1.5K DP + 1.5K militia + 500 garrison = 3.5K DP`. Numbers use
 * the shared suffix formatter (K/M/B…) — deterministic everywhere.
 */
export function defenseSummary(state: DefenseState): string {
  const { turretPower, militiaPower, garrisonPower } = state.breakdown
  return (
    `${formatNumber(state.turretLevels)} turrets · ${formatNumber(turretPower)} DP + ` +
    `${formatNumber(militiaPower)} militia + ${formatNumber(garrisonPower)} garrison = ` +
    `${formatNumber(state.defensePower)} DP`
  )
}
