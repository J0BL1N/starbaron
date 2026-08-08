export type StructureId =
  | 'oreMine'
  | 'tradeHub'
  | 'housing'
  | 'hydroponics'
  | 'barracks'
  | 'shipyard'
  | 'defenseTurret'

export const StructureCategory = {
  Economy: 'Economy',
  Population: 'Population',
  Military: 'Military',
  Defense: 'Defense',
} as const

export type StructureCategory =
  (typeof StructureCategory)[keyof typeof StructureCategory]

export interface Structure {
  id: StructureId
  name: string
  category: StructureCategory
  baseCost: number
  alloyCost?: number
  buildTimeSec: number
  maxLevel?: number
}

export type StructureEffect =
  | { kind: 'alloys'; alloysPerSec: number }
  | { kind: 'incomeMultiplier'; multiplier: number }
  | { kind: 'population'; popCapBonus: number; popGrowthBonusPerSec: number }
  | { kind: 'growthMultiplier'; multiplier: number }
  | { kind: 'barracks'; soldierConversionPerSec: number; garrisonCap: number }
  | { kind: 'shipyard'; fleetCap: number; shipbuildingIncomePerSec: number }
  | { kind: 'defense'; defensePower: number }
