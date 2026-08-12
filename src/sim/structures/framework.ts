import { STRUCTURES, STRUCTURE_IDS, isStructureId } from './data'
import { structureCost } from '../core/economy'
import type { StructureCategory, StructureId } from './types'

/**
 * Structure levels keyed by structure id (all StructureIds present, 0+).
 * Local structural type: grid.ts does not re-export `StructureGrid`, so the
 * framework stays within its authorised import set (./data, ../core/economy,
 * ./types) and mirrors the shape in ../player/types.ts exactly.
 */
export type StructureGrid = Record<StructureId, number>

/**
 * The canonical structure framework: build/upgrade costs, placement
 * validation and build eligibility.
 *
 * DESIGN (locked): structure levels are UNLIMITED — there is NO hard max
 * level and NO numeric prerequisite table. §4d says only "Housing grows
 * population → Barracks turns people into fleet → …" narratively; the
 * economy never locks a number, so nothing here invents one. Levels are
 * simply finite non-negative integers; diminishing returns beyond 10 are an
 * effective-level rule owned by the locked planets/levels.ts, not a cap.
 *
 * Pure module — deterministic, no wall clock, no module-level mutable state.
 *
 * Costs are NOT re-derived here: buildCost/upgradeCost delegate to the LOCKED
 * economy.structureCost formula (baseCost × 1.15^level) and mirror
 * effects.nextBuildCost exactly (see src/sim/core/economy.ts).
 */

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

export type CanBuildReason =
  | 'insufficient-credits'
  | 'insufficient-alloys'
  | 'unknown-structure'

export type CanBuildResult =
  | { ok: true }
  | { ok: false; reason: CanBuildReason }

/**
 * Build-eligibility ladder: unknown → funds (credits, then alloys). There is
 * no prerequisite rung — DESIGN locks no numeric prerequisites (§4d), so any
 * structure is buildable from level 0 the moment its cost is affordable.
 * Alloy cost is the flat per-build `alloyCost` from data.ts (only
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

export interface GridValidation {
  ok: boolean
  problems: string[]
}

/**
 * Validates a structure grid: every StructureId present, levels are finite
 * non-negative integers (NO upper bound — levels are unlimited per DESIGN),
 * and no unknown keys.
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
  }
}
