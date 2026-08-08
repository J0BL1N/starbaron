import type { PlanetCatalogueEntry } from '../data/planets'
import type { PlanetIdentity } from './types'
import { seedFromPlanetName, mulberry32 } from './prng'
import { generateVisualProfile, resolveRadius, radiusBandOf } from './visual'
import { pickQuirk } from './quirks'
import { buildDescription } from './description'

export const GENERATOR_VERSION = 'starbaron-v1'

export function generatePlanetIdentity(entry: PlanetCatalogueEntry): PlanetIdentity {
  const seed = seedFromPlanetName(GENERATOR_VERSION, entry.name)
  const rand = mulberry32(seed)

  const radius = resolveRadius(entry, rand)
  const visual = generateVisualProfile(entry, rand, radius)
  const quirks = pickQuirk(entry, rand)
  const description = buildDescription(
    entry,
    radiusBandOf(radius),
    visual,
    quirks,
    rand,
  )

  return { visual, quirks, description }
}
