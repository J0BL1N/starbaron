import type { PlanetTier } from '../data/planets'

export const EFFECTIVE_LEVEL_CAP = 10
export const DIMINISHING_RETURNS_FACTOR = 0.5

export function effectiveLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0) {
    throw new RangeError(`level must be a non-negative integer, got ${level}`)
  }
  return (
    Math.min(level, EFFECTIVE_LEVEL_CAP) +
    Math.max(0, level - EFFECTIVE_LEVEL_CAP) * DIMINISHING_RETURNS_FACTOR
  )
}

export const TIER_POP_CAP_MULTIPLIER: Readonly<Record<PlanetTier, number>> = {
  1: 1.0,
  2: 1.2,
  3: 1.4,
  4: 1.7,
  5: 2.0,
}

export function populationCapMultiplier(tier: PlanetTier): number {
  return TIER_POP_CAP_MULTIPLIER[tier]
}
