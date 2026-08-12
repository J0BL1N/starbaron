/**
 * Canonical galaxy data model.
 *
 * Pure, deterministic module: every value derives from a string seed via
 * fnv1a. No nondeterministic APIs or timestamps, no global state. This is
 * the source of
 * truth for galaxy records — render-side modules may import FROM here, never
 * the reverse.
 */

import { fnv1a } from '../planets/hash'
import { galaxyId } from './identity'
import type { GalaxyId, SystemId } from './identity'

/** Extensible galaxy morphology union. */
export type GalaxyClass =
  | 'spiral'
  | 'barred-spiral'
  | 'elliptical'
  | 'irregular'
  | 'dwarf'

/** Canonical, persistent galaxy record. No timestamps — determinism. */
export interface GalaxyRecord {
  id: GalaxyId
  seed: string
  name: string
  class: GalaxyClass
  position: { x: number; y: number; z: number }
  radius: number
  systemIds: SystemId[]
  generationVersion: number
  realData: boolean
  provenance: string
}

export const GALAXY_GENERATION_VERSION = 1

/** View radius in world units (Sol-origin convention from planetgen3d/galaxy.ts). */
export const DEFAULT_GALAXY_RADIUS = 600

/** Universe-position spherical shell bounds (world units). */
export const UNIVERSE_POSITION_MIN = 1800
export const UNIVERSE_POSITION_MAX = 6000

/** Seeded pool for procedural galaxy display names. */
export const GALAXY_NAME_POOL: readonly string[] = [
  'Aurelia',
  'Caliburn',
  'Draxis',
  'Erewhon',
  'Farrago',
  'Galindor',
  'Hespera',
  'Icarion',
  'Javanis',
  'Kestrel',
  'Lumina',
  'Meridian',
  'Nyxon',
  'Oriflamme',
  'Palatine',
  'Quasarion',
  'Rhadamanth',
  'Sidereal',
  'Threnody',
  'Vespera',
]

/** Deterministic 0..1 value from a string seed (built on fnv1a). */
function seededUnit(seed: string): number {
  return fnv1a(seed) / 0x100000000
}

/**
 * Build a canonical galaxy record. The id is always the branded slug id from
 * ./identity — never constructed by hand. Same input always yields a
 * deep-equal record.
 */
export function buildGalaxyRecord(input: {
  slug: string
  seed?: string
  name?: string
  class?: GalaxyClass
  position?: { x: number; y: number; z: number }
  radius?: number
  realData?: boolean
  provenance?: string
}): GalaxyRecord {
  return {
    id: galaxyId(input.slug),
    seed: input.seed ?? input.slug,
    name: input.name ?? input.slug,
    class: input.class ?? 'spiral',
    position: { ...(input.position ?? { x: 0, y: 0, z: 0 }) },
    radius: input.radius ?? DEFAULT_GALAXY_RADIUS,
    systemIds: [],
    generationVersion: GALAXY_GENERATION_VERSION,
    realData: input.realData ?? false,
    provenance: input.provenance ?? 'procedural',
  }
}

/**
 * Deterministic galaxy class pick: fnv1a(seed + '|class') % 100 weighted
 * spiral ~45%, barred ~25%, elliptical ~15%, irregular ~10%, dwarf ~5%.
 */
export function seededGalaxyClass(seed: string): GalaxyClass {
  const roll = fnv1a(`${seed}|class`) % 100
  if (roll < 45) return 'spiral'
  if (roll < 70) return 'barred-spiral'
  if (roll < 85) return 'elliptical'
  if (roll < 95) return 'irregular'
  return 'dwarf'
}

/** Deterministic display name from the seeded pool. */
export function seededGalaxyName(seed: string): string {
  return GALAXY_NAME_POOL[fnv1a(`${seed}|name`) % GALAXY_NAME_POOL.length]
}

/**
 * Deterministic universe-space position on a spherical shell between
 * UNIVERSE_POSITION_MIN and UNIVERSE_POSITION_MAX. Direction uses a uniform
 * sphere sampling (theta uniform, cos(phi) uniform) and the radius is seeded
 * independently, so distinct slug/index inputs spread out without clustering.
 */
export function universePositionFor(
  slug: string,
  index: number,
): { x: number; y: number; z: number } {
  const base = `${slug}|${index}`
  const theta = seededUnit(`${base}|theta`) * Math.PI * 2
  const cosPhi = seededUnit(`${base}|cosphi`) * 2 - 1
  const radius =
    UNIVERSE_POSITION_MIN +
    seededUnit(`${base}|radius`) * (UNIVERSE_POSITION_MAX - UNIVERSE_POSITION_MIN)
  const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi))
  return {
    x: radius * sinPhi * Math.cos(theta),
    y: radius * sinPhi * Math.sin(theta),
    z: radius * cosPhi,
  }
}

/**
 * Return a new record with systemId appended. The input is never mutated and
 * the caller always gets a fresh record object, even when the append is
 * rejected. Duplicate ids are skipped (not appended) so systemIds stays a
 * stable, ordered, duplicate-free registry; a rejected duplicate still yields
 * a fresh copy with identical contents.
 */
export function registerSystem(
  galaxy: GalaxyRecord,
  systemId: SystemId,
): GalaxyRecord {
  if (galaxy.systemIds.includes(systemId)) {
    return { ...galaxy, systemIds: [...galaxy.systemIds] }
  }
  return { ...galaxy, systemIds: [...galaxy.systemIds, systemId] }
}
