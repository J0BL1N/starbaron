import { StructureCategory } from './types'
import type { Structure, StructureId } from './types'

export const STRUCTURE_IDS = [
  'oreMine',
  'tradeHub',
  'housing',
  'hydroponics',
  'barracks',
  'shipyard',
  'defenseTurret',
] as const satisfies readonly StructureId[]

const VALID_STRUCTURE_IDS = new Set<StructureId>(STRUCTURE_IDS)

export function isStructureId(value: unknown): value is StructureId {
  return typeof value === 'string' && VALID_STRUCTURE_IDS.has(value as StructureId)
}

export const STRUCTURES: Readonly<Record<StructureId, Structure>> = {
  oreMine: {
    id: 'oreMine',
    name: 'Ore Mine',
    category: StructureCategory.Economy,
    baseCost: 500,
    buildTimeSec: 30,
  },
  tradeHub: {
    id: 'tradeHub',
    name: 'Trade Hub',
    category: StructureCategory.Economy,
    baseCost: 2_000,
    buildTimeSec: 120,
  },
  housing: {
    id: 'housing',
    name: 'Housing',
    category: StructureCategory.Population,
    baseCost: 300,
    buildTimeSec: 20,
  },
  hydroponics: {
    id: 'hydroponics',
    name: 'Hydroponics',
    category: StructureCategory.Population,
    baseCost: 800,
    buildTimeSec: 45,
  },
  barracks: {
    id: 'barracks',
    name: 'Barracks',
    category: StructureCategory.Military,
    baseCost: 1_500,
    buildTimeSec: 60,
  },
  shipyard: {
    id: 'shipyard',
    name: 'Shipyard',
    category: StructureCategory.Military,
    baseCost: 5_000,
    buildTimeSec: 300,
  },
  defenseTurret: {
    id: 'defenseTurret',
    name: 'Defense Turret',
    category: StructureCategory.Defense,
    baseCost: 2_000,
    alloyCost: 1_000,
    buildTimeSec: 180,
  },
}
