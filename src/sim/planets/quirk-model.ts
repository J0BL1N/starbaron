import type { PlanetCatalogueEntry } from '../data/planets'
import type { StructureId } from '../structures/types'
import { fnv1a } from './hash'
import { QUIRK_TABLE, quirkById, triggeredQuirks } from './quirks'
import type { PlanetQuirk, QuirkId } from './types'

export type QuirkCategory =
  | 'atmosphere'
  | 'gravity'
  | 'environment'
  | 'density'
  | 'star'
  | 'mass'

export type ProductionTarget =
  | 'trade-hub-credits'
  | 'ore-mine-alloys'
  | 'population'
  | 'none'

export interface StructureModifier {
  structure: StructureId
  multiplier: number
}

export interface ProductionModifier {
  target: ProductionTarget
  multiplier: number
}

export interface QuirkEffectSummary {
  id: QuirkId
  name: string
  category: QuirkCategory
  structureModifier: StructureModifier | null
  productionModifier: ProductionModifier | null
  blurb: string
}

export interface QuirkCategoryCounts {
  atmosphere: number
  gravity: number
  environment: number
  star: number
  density: number
  mass: number
}

/**
 * Deterministic, documented mapping from the locked QUIRK_TABLE ids to the
 * formal quirk model categories. Every current quirk maps to exactly one
 * category:
 *   highGravity -> gravity
 *   coldStar/hotStar -> star
 *   denseCore/gasGiant -> density
 *   massiveWorld -> mass
 *   binarySystem -> environment
 * There is NO atmosphere quirk in the locked table today; 'atmosphere' is a
 * reserved category for a future extension and every current quirk maps away
 * from it.
 */
const QUIRK_CATEGORY: Readonly<Record<QuirkId, QuirkCategory>> = {
  highGravity: 'gravity',
  coldStar: 'star',
  hotStar: 'star',
  denseCore: 'density',
  gasGiant: 'density',
  binarySystem: 'environment',
  massiveWorld: 'mass',
}

/**
 * Production-modifier targets that mirror the LOCKED accrual composition in
 * computePlanetDerived (src/sim/player/accrual.ts): binarySystem drives the
 * trade hub income multiplier (credits), highGravity drives the ore mine alloy
 * rate. Every other quirk carries no production modifier; the multiplier
 * itself is taken from the locked quirk's own multiplier so the model can
 * never drift from the table.
 */
const PRODUCTION_TARGET: Readonly<Record<QuirkId, ProductionTarget | null>> = {
  highGravity: 'ore-mine-alloys',
  coldStar: null,
  hotStar: null,
  denseCore: null,
  gasGiant: null,
  binarySystem: 'trade-hub-credits',
  massiveWorld: null,
}

export function quirkSummary(quirk: PlanetQuirk): QuirkEffectSummary {
  const target = PRODUCTION_TARGET[quirk.id]
  return {
    id: quirk.id,
    name: quirk.name,
    category: QUIRK_CATEGORY[quirk.id],
    structureModifier: {
      structure: quirk.structureId,
      multiplier: quirk.multiplier,
    },
    productionModifier:
      target === null ? null : { target, multiplier: quirk.multiplier },
    blurb: quirk.blurb,
  }
}

export function deterministicQuirks(entry: PlanetCatalogueEntry): PlanetQuirk[] {
  const triggered = triggeredQuirks(entry)
  const triggeredIds = new Set(triggered.map((quirk) => quirk.id))
  const candidates = QUIRK_TABLE.filter(
    (definition) => !triggeredIds.has(definition.id),
  )
  if (candidates.length === 0) return triggered
  const seed = fnv1a(`${entry.name}|quirk`)
  const picked = candidates[seed % candidates.length]
  return [...triggered, quirkById(picked.id)]
}

export function quirkEffectOn(
  structure: StructureId,
  quirks: readonly PlanetQuirk[],
): number {
  let product = 1
  for (const quirk of quirks) {
    if (quirk.structureId === structure) product *= quirk.multiplier
  }
  return product
}

export function quirkCategories(
  quirks: readonly PlanetQuirk[],
): QuirkCategoryCounts {
  const counts: QuirkCategoryCounts = {
    atmosphere: 0,
    gravity: 0,
    environment: 0,
    star: 0,
    density: 0,
    mass: 0,
  }
  for (const quirk of quirks) {
    counts[QUIRK_CATEGORY[quirk.id]] += 1
  }
  return counts
}
