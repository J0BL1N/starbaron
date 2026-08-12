import { STRUCTURE_IDS } from '../structures/data'
import type { StructureGrid } from './types'

export function emptyStructureLevels(): StructureGrid {
  const levels = {} as StructureGrid
  for (const id of STRUCTURE_IDS) {
    levels[id] = 0
  }
  return levels
}

/**
 * The ONE shared starter-grid contract (phase-2 audit finding 2): every
 * new-player path grants exactly this grid — onboarding.initialStructuresFor,
 * player.createPlayer's home structure grid and the 0016 claim RPCs all
 * produce the identical grid: every structure at 0 EXCEPT housing at level 1
 * (the "does the same inputs -> same grid" contract, asserted in the tests).
 *
 * The grid is FULL (all StructureIds present) — not just `{ housing: 1 }` —
 * because the pure sim and the UI derive from a grid by key
 * (computePlanetDerived/structureEffect validate every level), so a partial
 * grid must never reach them. This constant is SHARED and must never be
 * mutated; consumers copy it (`{ ...STARTER_STRUCTURES }`).
 */
export const STARTER_STRUCTURES: StructureGrid = {
  ...emptyStructureLevels(),
  housing: 1,
}
