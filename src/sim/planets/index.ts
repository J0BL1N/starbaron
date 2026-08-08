import { baselinePassiveIncome } from '../core/economy'
import type { PlanetCatalogueEntry } from '../data/planets'
import type { PlanetState } from './types'
import { populationCapMultiplier } from './levels'
import { generatePlanetIdentity } from './generator'

export { fnv1a } from './hash'
export { mulberry32, seedFromPlanetName } from './prng'
export {
  effectiveLevel,
  EFFECTIVE_LEVEL_CAP,
  DIMINISHING_RETURNS_FACTOR,
  TIER_POP_CAP_MULTIPLIER,
  populationCapMultiplier,
} from './levels'
export {
  generateVisualProfile,
  radiusBandOf,
  spectralClassOf,
  spectralLetter,
  isHotStar,
  defaultRadiusForTier,
  resolveRadius,
} from './visual'
export type { SpectralClass, RadiusBand } from './visual'
export {
  QUIRK_TABLE,
  triggeredQuirks,
  pickQuirk,
  applyQuirk,
  densityProxy,
  quirkById,
  HIGH_GRAVITY_DENSITY_THRESHOLD,
  DENSE_CORE_DENSITY_THRESHOLD,
  GAS_GIANT_DENSITY_MAX,
  MASSIVE_WORLD_MASS_MIN,
} from './quirks'
export { buildDescription } from './description'
export { generatePlanetIdentity, GENERATOR_VERSION } from './generator'
export type {
  PlanetState,
  PlanetIdentity,
  PlanetVisualProfile,
  PlanetQuirk,
  QuirkId,
} from './types'

export function makePlanet(entry: PlanetCatalogueEntry): PlanetState {
  // Deep immutable snapshot (structuredClone, not spread): PlanetState owns a
  // private copy so mutations cannot corrupt the shared 6321-planet catalogue.
  const entrySnapshot = structuredClone(entry)
  return {
    entry: entrySnapshot,
    tier: entry.tier,
    baselineIncomePerSec: baselinePassiveIncome(entry.tier),
    populationCapMultiplier: populationCapMultiplier(entry.tier),
    generate: () => generatePlanetIdentity(entrySnapshot),
  }
}
