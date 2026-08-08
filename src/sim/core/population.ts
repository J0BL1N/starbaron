export const BASE_GROWTH_PER_SEC = 2
export const BASE_POPULATION_CAP = 5000
export const HOUSING_CAP_MULTIPLIER = 0.2
export const HOUSING_GROWTH_PER_LEVEL = 2
export const HYDROPONICS_GROWTH_BONUS = 0.5

/**
 * @deprecated Legacy raw-level helper — kept for tests only. Production
 * derivation uses effectiveLevel-based population caps via
 * `src/sim/player/accrual.ts` `computePlanetDerived` (denseCore quirk, tier
 * cap multiplier, diminishing returns beyond level 10). Do NOT remove/rename.
 */
export function populationCap(housingLevels: number): number {
  if (!Number.isInteger(housingLevels) || housingLevels < 0) {
    throw new RangeError(`housingLevels must be a non-negative integer, got ${housingLevels}`)
  }
  return BASE_POPULATION_CAP * (1 + HOUSING_CAP_MULTIPLIER * housingLevels)
}

/**
 * @deprecated Legacy raw-level helper — kept for tests only. Production
 * derivation uses effectiveLevel-based growth via
 * `src/sim/player/accrual.ts` `computePlanetDerived` (growth multipliers,
 * diminishing returns beyond level 10). Do NOT remove/rename.
 */
export function populationGrowthPerSec(
  housingLevels: number,
  hydroponicsLevels = 0,
): number {
  if (!Number.isInteger(housingLevels) || housingLevels < 0) {
    throw new RangeError(`housingLevels must be a non-negative integer, got ${housingLevels}`)
  }
  if (!Number.isInteger(hydroponicsLevels) || hydroponicsLevels < 0) {
    throw new RangeError(
      `hydroponicsLevels must be a non-negative integer, got ${hydroponicsLevels}`,
    )
  }
  return (
    (BASE_GROWTH_PER_SEC + HOUSING_GROWTH_PER_LEVEL * housingLevels) *
    (1 + HYDROPONICS_GROWTH_BONUS * hydroponicsLevels)
  )
}
