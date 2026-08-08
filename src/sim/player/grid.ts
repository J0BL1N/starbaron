import { STRUCTURE_IDS } from '../structures/data'
import type { StructureGrid } from './types'

export function emptyStructureLevels(): StructureGrid {
  const levels = {} as StructureGrid
  for (const id of STRUCTURE_IDS) {
    levels[id] = 0
  }
  return levels
}
