import { STRUCTURES, STRUCTURE_IDS, isStructureId } from './data'
import { structureCost } from '../core/economy'
import type { StructureGrid } from '../player/types'
import type { StructureCategory, StructureId } from './types'

/**
 * The canonical structure framework: build/upgrade costs, prerequisites,
 * placement-validation, max levels and build eligibility.
 *
 * Pure module — deterministic, no wall clock, no module-level mutable state
 * (PREREQUISITES is deeply frozen).
 *
 * Costs are NOT re-derived here: buildCost/upgradeCost delegate to the LOCKED
 * economy.structureCost formula (baseCost × 1.15^level) and mirror
 * effects.nextBuildCost exactly (see src/sim/core/economy.ts).
 */

/** A structure that must exist at or above `minLevel` before another can build. */
export interface Prerequisite {
  structure: StructureId
  minLevel: number
}

/**
 * Source of the prerequisite table. DESIGN §4c/§4d defines the dependency
 * chain narratively ("Housing grows population → Barracks turns people into
 * fleet → Shipyard launches bigger invasions … more Turrets") but locks NO
 * numeric prerequisites, so the set below is a minimal sensible draft.
 */
export const PREREQUISITE_SOURCE = 'draft — T10 balancing input' as const

const PREREQUISITE_TABLE: Readonly<Record<StructureId, readonly Prerequisite[]>> = {
  oreMine: [],
  tradeHub: [],
  housing: [],
  hydroponics: [],
  barracks: [{ structure: 'housing', minLevel: 1 }],
  shipyard: [{ structure: 'oreMine', minLevel: 3 }],
  defenseTurret: [{ structure: 'barracks', minLevel: 1 }],
}

function deepFreezePrerequisites(
  table: Readonly<Record<StructureId, readonly Prerequisite[]>>,
): Readonly<Record<StructureId, readonly Prerequisite[]>> {
  for (const id of Object.keys(table) as StructureId[]) {
    for (const prerequisite of table[id]) {
      Object.freeze(prerequisite)
    }
    Object.freeze(table[id])
  }
  return Object.freeze(table)
}

export const PREREQUISITES = deepFreezePrerequisites(PREREQUISITE_TABLE)

/**
 * Engineering max level for the framework. DESIGN is silent on a numeric cap
 * (levels are "unlimited", with diminishing returns after 10 being an
 * effective-level rule, not a cap) — 100 is a guard against runaway grids.
 */
export const MAX_LEVEL = 100

function assertKnownStructure(id: unknown): asserts id is StructureId {
  if (!isStructureId(id)) {
    throw new RangeError(`unknown structure id, got ${String(id)}`)
  }
}

/**
 * Cost to build `structure` at level `level` (i.e. to reach level+1 from the
 * given level). Delegates to the LOCKED structureCost; do NOT re-derive.
 */
export function buildCost(structure: StructureId, level: number): number {
  assertKnownStructure(structure)
  return structureCost(STRUCTURES[structure].baseCost, level)
}

/**
 * Cost to upgrade `structure` from `currentLevel` to `currentLevel + 1`.
 * Mirrors effects.nextBuildCost exactly: structureCost(baseCost, currentLevel).
 */
export function upgradeCost(structure: StructureId, currentLevel: number): number {
  assertKnownStructure(structure)
  return structureCost(STRUCTURES[structure].baseCost, currentLevel)
}

/** Every prerequisite structure is present at or above its minLevel. */
export function prerequisitesMet(
  structure: StructureId,
  grid: StructureGrid,
): boolean {
  assertKnownStructure(structure)
  return PREREQUISITES[structure].every(
    (p) => (grid[p.structure] ?? 0) >= p.minLevel,
  )
}

export type CanBuildReason =
  | 'prerequisites'
  | 'insufficient-credits'
  | 'insufficient-alloys'
  | 'unknown-structure'

export type CanBuildResult =
  | { ok: true }
  | { ok: false; reason: CanBuildReason }

/**
 * Build-eligibility ladder: unknown → prerequisites → funds (credits, then
 * alloys). Alloy cost is the flat per-build `alloyCost` from data.ts (only
 * defenseTurret pays alloys; the locked cost formula scales credits only).
 */
export function canBuild(
  structure: StructureId,
  grid: StructureGrid,
  wallet: { credits: number; alloys: number },
): CanBuildResult {
  if (!isStructureId(structure)) {
    return { ok: false, reason: 'unknown-structure' }
  }
  if (!prerequisitesMet(structure, grid)) {
    return { ok: false, reason: 'prerequisites' }
  }
  const cost = buildCost(structure, grid[structure] ?? 0)
  if (wallet.credits < cost) {
    return { ok: false, reason: 'insufficient-credits' }
  }
  const alloyCost = STRUCTURES[structure].alloyCost
  if (alloyCost !== undefined && wallet.alloys < alloyCost) {
    return { ok: false, reason: 'insufficient-alloys' }
  }
  return { ok: true }
}

/** Max level for a known structure (engineering guard; DESIGN silent on a cap). */
export function maxLevelFor(structure: StructureId): number {
  assertKnownStructure(structure)
  return STRUCTURES[structure].maxLevel ?? MAX_LEVEL
}

export interface GridValidation {
  ok: boolean
  problems: string[]
}

/**
 * Validates a structure grid: every StructureId present, levels are
 * non-negative integers within [0, maxLevelFor], and no unknown keys.
 */
export function validateGrid(grid: StructureGrid): GridValidation {
  const problems: string[] = []
  for (const id of STRUCTURE_IDS) {
    const level = grid[id]
    if (level === undefined) {
      problems.push(`missing structure key: ${id}`)
      continue
    }
    if (!Number.isInteger(level) || level < 0) {
      problems.push(`invalid level for ${id}: ${level}`)
      continue
    }
    if (level > maxLevelFor(id)) {
      problems.push(`level above max for ${id}: ${level}`)
    }
  }
  for (const key of Object.keys(grid)) {
    if (!isStructureId(key)) {
      problems.push(`unknown structure key: ${key}`)
    }
  }
  return { ok: problems.length === 0, problems }
}

export interface StructureSummary {
  id: StructureId
  name: string
  category: StructureCategory
  baseCost: number
  buildTimeSeconds: number
  prerequisites: readonly Prerequisite[]
}

export function structureSummary(structure: StructureId): StructureSummary {
  assertKnownStructure(structure)
  const record = STRUCTURES[structure]
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    baseCost: record.baseCost,
    buildTimeSeconds: record.buildTimeSec,
    prerequisites: PREREQUISITES[structure],
  }
}
