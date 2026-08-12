export {
  keplerPosition,
  seededOrbitalElements,
  seededMoonElements,
} from './orbits'
export type { Vec3, OrbitalElements } from './orbits'

export {
  spectralClassOf,
  starModel,
  starModelFromType,
} from './spectral'
export type { SpectralClass, StarModel } from './spectral'

export {
  buildTerrainTexture,
  buildCloudTexture,
  buildRingTexture,
  buildEarthlikeTexture,
  buildSuperEarthTexture,
  buildGasTexture,
  buildRockyTexture,
  buildIceTexture,
  buildVenusTexture,
} from './textures'
export type { TextureResult, TextureBand } from './textures'

export { buildSolarSystem, buildSolarSystemForHost } from './system'
export type {
  SolarSystemData,
  PlanetData,
  MoonData,
  AsteroidData,
} from './system'

export {
  buildHostStars,
  hostByPlanetName,
  hostByName,
  countHostPositionSources,
} from './hosts'
export type { HostStar } from './hosts'

export {
  createPlanetRenderer,
  createSolarSystemRenderer,
  clearTextureCache,
} from './render'
export type {
  PlanetRenderer,
  SolarSystemRenderer,
  GalaxyLocator,
  GalaxyLayer,
} from './render'

export {
  galaxyPositionFor,
  scaleGalaxyPositions,
  solPosition,
  countPositionSources,
  DEFAULT_GALAXY_RADIUS,
} from './galaxy'
export type { GalaxyPosition } from './galaxy'
