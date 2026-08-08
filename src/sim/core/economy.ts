export const MIN_TIER = 1
export const MAX_TIER = 5
export const BASE_INCOME_PER_TIER = 10
export const COST_GROWTH_PER_LEVEL = 1.15

export function baselinePassiveIncome(tier: number): number {
  if (!Number.isInteger(tier) || tier < MIN_TIER || tier > MAX_TIER) {
    throw new RangeError(`tier must be an integer in [${MIN_TIER}, ${MAX_TIER}], got ${tier}`)
  }
  return BASE_INCOME_PER_TIER * tier
}

export function structureCost(baseCost: number, level: number): number {
  if (!Number.isFinite(baseCost) || baseCost <= 0) {
    throw new RangeError(`baseCost must be a positive finite number, got ${baseCost}`)
  }
  if (!Number.isInteger(level) || level < 0) {
    throw new RangeError(`level must be a non-negative integer, got ${level}`)
  }
  return baseCost * Math.pow(COST_GROWTH_PER_LEVEL, level)
}
