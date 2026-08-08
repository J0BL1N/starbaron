export const BASE_GROWTH_PER_SEC = 2
export const BASE_POPULATION_CAP = 5000
export const HOUSING_CAP_MULTIPLIER = 0.2
export const HOUSING_GROWTH_PER_LEVEL = 2
export const HYDROPONICS_GROWTH_BONUS = 0.5

export function populationCap(housingLevels: number): number {
  if (!Number.isInteger(housingLevels) || housingLevels < 0) {
    throw new RangeError(`housingLevels must be a non-negative integer, got ${housingLevels}`)
  }
  return BASE_POPULATION_CAP * (1 + HOUSING_CAP_MULTIPLIER * housingLevels)
}

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
