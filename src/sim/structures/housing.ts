import {
  BASE_POPULATION_CAP,
  HOUSING_GROWTH_PER_LEVEL,
  populationCap,
} from '../core/population'
import { applyGrowth } from '../core/population-model'
import type { PopulationState } from '../core/population-model'
import { upgradeCost } from './framework'

/**
 * Canonical housing model (P3-T05). Pure module — deterministic, no wall
 * clock (timestamps are inputs), no module-level mutable state.
 *
 * All numeric derivation WRAPS the locked population.ts helpers
 * (populationCap, populationGrowthPerSec) and the locked framework.ts
 * upgradeCost curve; nothing is re-derived here. These wrappers bind the RAW
 * level formulas (the deprecated legacy helpers), not the effectiveLevel-based
 * production path in src/sim/player/accrual.ts (diminishing returns > 10).
 */

export interface HousingSnapshot {
  level: number
  capBonus: number
  growthBonus: number
  nextUpgradeCost: number
  at: number
}

export interface HousingUiState {
  level: number
  capBonus: number
  growthBonus: number
  nextUpgradeCost: number
  display: string
}

function assertValidLevel(level: number): void {
  if (!Number.isInteger(level) || level < 0) {
    throw new RangeError(`level must be a non-negative integer, got ${level}`)
  }
}

function assertValidPlanetMultiplier(planetMultiplier: number): void {
  if (!Number.isFinite(planetMultiplier) || planetMultiplier <= 0) {
    throw new RangeError(
      `planetMultiplier must be a finite number greater than 0, got ${planetMultiplier}`,
    )
  }
}

function assertValidTimestamp(at: number): void {
  if (!Number.isFinite(at) || at <= 0) {
    throw new RangeError(`at must be a finite number greater than 0, got ${at}`)
  }
}

/**
 * Cap bonus contributed by housing levels. WRAPS the locked formula:
 * populationCap(level) - BASE_POPULATION_CAP (raw level, matching the locked
 * population.ts helper exactly). The tier multiplier is NOT applied here.
 */
export function housingCapBonus(level: number): number {
  assertValidLevel(level)
  return populationCap(level) - BASE_POPULATION_CAP
}

/**
 * Per-level growth contribution of housing. WRAPS the locked per-level
 * growth term HOUSING_GROWTH_PER_LEVEL × level — verified against
 * population.ts `populationGrowthPerSec` (its housing term is
 * HOUSING_GROWTH_PER_LEVEL * housingLevels on the raw level).
 */
export function housingGrowthBonus(level: number): number {
  assertValidLevel(level)
  return HOUSING_GROWTH_PER_LEVEL * level
}

/**
 * Total population cap for a housing-bearing planet: locked
 * populationCap(level) × the planet's tier multiplier
 * (OwnedPlanet.populationCapMultiplier). Multiplier must be finite > 0.
 */
export function housingCap(level: number, planetMultiplier: number): number {
  assertValidPlanetMultiplier(planetMultiplier)
  assertValidLevel(level)
  return populationCap(level) * planetMultiplier
}

/**
 * Cost to upgrade housing from `currentLevel` to `currentLevel + 1`.
 * Delegates to the LOCKED framework.upgradeCost curve (structureCost:
 * baseCost × 1.15^level); do NOT re-derive.
 */
export function housingUpgradeCost(currentLevel: number): number {
  return upgradeCost('housing', currentLevel)
}

/**
 * UI-ready snapshot. `planetMultiplier` is the planet's tier modifier: it
 * does not appear in the locked HousingSnapshot shape (capBonus/growthBonus
 * are level-only), but it is validated here so callers binding a housing-
 * bearing planet pass their tier multiplier through the same gate as
 * housingCap. Use housingCap for the multiplier-scaled total.
 */
export function housingSnapshot(
  level: number,
  planetMultiplier: number,
  at: number,
): HousingSnapshot {
  assertValidTimestamp(at)
  assertValidPlanetMultiplier(planetMultiplier)
  return {
    level,
    capBonus: housingCapBonus(level),
    growthBonus: housingGrowthBonus(level),
    nextUpgradeCost: housingUpgradeCost(level),
    at,
  }
}

/**
 * Offline population accrual bound to the housing contract.
 *
 * Housing levels ARE part of PopulationState (population-model.ts), so the
 * wrapper delegates to the LOCKED applyGrowth(state, at): the growth rate and
 * cap are exactly those derived from state.housingLevels and
 * state.hydroponicsLevels via snapshotAt. `at` is validated finite > 0 before
 * delegation (applyGrowth additionally requires at >= lastTickAt). The
 * credit-side banking cap in offline.ts (MAX_OFFLINE_BANK_SECONDS) does NOT
 * apply — that convention governs economy accrual; population grows linearly
 * in elapsed time up to the cap.
 */
export function offlineHousingOutcome(
  state: PopulationState,
  at: number,
): PopulationState {
  assertValidTimestamp(at)
  return applyGrowth(state, at)
}

function groupThousands(value: number): string {
  const digits = String(Math.trunc(Math.abs(value)))
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return value < 0 ? `-${grouped}` : grouped
}

/**
 * UI-ready state for rendering, e.g. `+1,000 pop cap · +2/s`. Display uses
 * deterministic thousand separators (no locale-dependent APIs).
 */
export function housingUiState(
  level: number,
  planetMultiplier: number,
): HousingUiState {
  assertValidPlanetMultiplier(planetMultiplier)
  const capBonus = housingCapBonus(level)
  const growthBonus = housingGrowthBonus(level)
  return {
    level,
    capBonus,
    growthBonus,
    nextUpgradeCost: housingUpgradeCost(level),
    display: `+${groupThousands(capBonus)} pop cap · +${groupThousands(growthBonus)}/s`,
  }
}
