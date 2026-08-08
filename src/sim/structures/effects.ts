import { STRUCTURES, isStructureId } from './data'
import { structureCost } from '../core/economy'
import {
  BASE_POPULATION_CAP,
  HOUSING_CAP_MULTIPLIER,
  HOUSING_GROWTH_PER_LEVEL,
  HYDROPONICS_GROWTH_BONUS,
} from '../core/population'
import { effectiveLevel } from '../planets/levels'
import type { StructureEffect, StructureId } from './types'

export const ORE_ALLOYS_PER_MIN = 5
export const TRADE_HUB_INCOME_MULTIPLIER_PER_LEVEL = 0.1
export const BARRACKS_CONVERSION_PER_SEC = 10
export const BARRACKS_GARRISON_CAP_PER_LEVEL = 5_000
export const SHIPYARD_FLEET_CAP_PER_LEVEL = 1_000
export const SHIPYARD_INCOME_PER_MIN = 50
export const TURRET_DEFENSE_POWER_PER_LEVEL = 500
export const MILITIA_DEFENSE_PER_POPULATION = 0.15

function assertKnownStructure(id: unknown): asserts id is StructureId {
  if (!isStructureId(id)) {
    throw new RangeError(`unknown structure id, got ${String(id)}`)
  }
}

function assertValidLevel(level: number): void {
  if (!Number.isInteger(level) || level < 0) {
    throw new RangeError(`level must be a non-negative integer, got ${level}`)
  }
}

export function structureEffect(id: StructureId, level: number): StructureEffect {
  assertKnownStructure(id)
  assertValidLevel(level)
  const effLevel = effectiveLevel(level)
  switch (id) {
    case 'oreMine':
      return { kind: 'alloys', alloysPerSec: (ORE_ALLOYS_PER_MIN / 60) * effLevel }
    case 'tradeHub':
      return {
        kind: 'incomeMultiplier',
        multiplier: 1 + TRADE_HUB_INCOME_MULTIPLIER_PER_LEVEL * effLevel,
      }
    case 'housing':
      return {
        kind: 'population',
        popCapBonus: BASE_POPULATION_CAP * HOUSING_CAP_MULTIPLIER * effLevel,
        popGrowthBonusPerSec: HOUSING_GROWTH_PER_LEVEL * effLevel,
      }
    case 'hydroponics':
      return {
        kind: 'growthMultiplier',
        multiplier: 1 + HYDROPONICS_GROWTH_BONUS * effLevel,
      }
    case 'barracks':
      return {
        kind: 'barracks',
        soldierConversionPerSec: BARRACKS_CONVERSION_PER_SEC * effLevel,
        garrisonCap: BARRACKS_GARRISON_CAP_PER_LEVEL * effLevel,
      }
    case 'shipyard':
      return {
        kind: 'shipyard',
        fleetCap: SHIPYARD_FLEET_CAP_PER_LEVEL * effLevel,
        shipbuildingIncomePerSec: (SHIPYARD_INCOME_PER_MIN / 60) * effLevel,
      }
    case 'defenseTurret':
      return { kind: 'defense', defensePower: TURRET_DEFENSE_POWER_PER_LEVEL * effLevel }
  }
}

export function defensePower(turretLevels: number, population: number): number {
  assertValidLevel(turretLevels)
  if (!Number.isFinite(population) || population < 0) {
    throw new RangeError(
      `population must be a non-negative finite number, got ${population}`,
    )
  }
  return (
    TURRET_DEFENSE_POWER_PER_LEVEL * turretLevels +
    MILITIA_DEFENSE_PER_POPULATION * population
  )
}

export function nextBuildCost(id: StructureId, level: number): number {
  assertKnownStructure(id)
  return structureCost(STRUCTURES[id].baseCost, level)
}
