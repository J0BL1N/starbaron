/**
 * Canonical solar-system data model.
 *
 * Pure, deterministic module: every value derives from a string seed via
 * fnv1a. No nondeterministic APIs or timestamps; calculations are
 * self-contained. This is the
 * source of truth for system records — render-side modules may import FROM
 * here, never the reverse.
 *
 * Canonical record contract: SystemRecord excludes persistence-only metadata.
 * A DB-filled created_at-style column is filled by the persistence layer for
 * operational tracing and is NOT part of this contract (see
 * supabase/migrations/0013_world_schema.sql).
 */

import { fnv1a } from '../planets/hash'
import { parseCanonicalId, systemId } from './identity'
import type { BodyId, GalaxyId, SystemId } from './identity'
import { assertRealDataProvenance, DEFAULT_GALAXY_RADIUS } from './galaxy'

export const SYSTEM_GENERATION_VERSION = 1

export const DEFAULT_STAR_COLOR = '#ffd27a'

/** Galaxy-local disk radius band (fractions of the galaxy radius). */
export const GALAXY_LOCAL_RADIUS_MIN = 0.4
export const GALAXY_LOCAL_RADIUS_MAX = 0.55

const GALAXY_LOCAL_SEED_PREFIX = 'galaxy-local-v1'
const STAR_COLOR_SEED_PREFIX = 'star-color-v1'

/** Stellar colour palette ordered O, B, A, F, G, K, M (spectral.ts reference). */
const STAR_CLASS_COLORS: readonly string[] = [
  '#9db4ff', // O
  '#aabfff', // B
  '#cad8ff', // A
  '#f8f7ff', // F
  '#fff4e8', // G
  '#ffddb4', // K
  '#ffbd81', // M
]

const STAR_CLASSES = 'OBAFGKM'

export interface StarMetadata {
  name: string
  starType: string | undefined
  color: string
}

/** Canonical, persistent system record. No timestamps — determinism. */
export interface SystemRecord {
  id: SystemId
  galaxy: GalaxyId
  seed: string
  name: string
  position: { x: number; y: number; z: number }
  star: StarMetadata
  bodyIds: BodyId[]
  generationVersion: number
  realData: boolean
  provenance: string
}

/** Deterministic 0..1 value from a string seed (built on fnv1a). */
function seededUnit(seed: string): number {
  return fnv1a(seed) / 0x100000000
}

/** Minimal deterministic PRNG built on fnv1a (no shared state, no rngFrom). */
function seededRng(seed: string): () => number {
  let index = 0
  return () => seededUnit(`${seed}|${index++}`)
}

/** Extract the galaxy slug from a branded GalaxyId via parseCanonicalId. */
function galaxySlugOf(galaxy: GalaxyId): string {
  const parsed = parseCanonicalId(galaxy)
  if (!parsed.ok || parsed.kind !== 'galaxy') {
    throw new Error(`buildSystemRecord requires a valid GalaxyId, got: ${galaxy}`)
  }
  return parsed.slug
}

/**
 * Deterministic hex star colour derived from the spectral type via a tiny
 * seeded picker. Unknown or missing spectral types fall back to the default.
 */
export function starColorFor(
  starType: string | undefined,
  seed: string,
): string {
  if (starType === undefined || starType.trim() === '') {
    return DEFAULT_STAR_COLOR
  }
  const letter = starType.trim().charAt(0).toUpperCase()
  const classIndex = STAR_CLASSES.indexOf(letter)
  if (classIndex < 0) {
    return DEFAULT_STAR_COLOR
  }
  const roll = fnv1a(`${STAR_COLOR_SEED_PREFIX}|${seed}|${starType}`)
  const previous =
    (classIndex + STAR_CLASS_COLORS.length - 1) % STAR_CLASS_COLORS.length
  const next = (classIndex + 1) % STAR_CLASS_COLORS.length
  const variants = [classIndex, previous, next]
  return STAR_CLASS_COLORS[variants[roll % variants.length]]
}

/**
 * Build a canonical system record. The id is always the branded id from
 * ./identity — never constructed by hand. Same input always yields a
 * deep-equal record. When realData is true, provenance must be a catalogue
 * provenance (see assertRealDataProvenance) — records cannot be labelled real
 * outside catalogue/reconstruction internals.
 */
export function buildSystemRecord(input: {
  galaxy: GalaxyId
  slug: string
  seed?: string
  name?: string
  position?: { x: number; y: number; z: number }
  starType?: string
  realData?: boolean
  provenance?: string
}): SystemRecord {
  const galaxySlug = galaxySlugOf(input.galaxy)
  const seed = input.seed ?? input.slug
  const starName = input.name ?? input.slug
  const realData = input.realData ?? false
  const provenance = input.provenance ?? 'procedural'
  assertRealDataProvenance(realData, provenance)
  return {
    id: systemId(galaxySlug, seed),
    galaxy: input.galaxy,
    seed,
    name: starName,
    position: { ...(input.position ?? { x: 0, y: 0, z: 0 }) },
    star: {
      name: starName,
      starType: input.starType,
      color: starColorFor(input.starType, seed),
    },
    bodyIds: [],
    generationVersion: SYSTEM_GENERATION_VERSION,
    realData,
    provenance,
  }
}

/**
 * Deterministic galaxy-local position inside the disk, biased onto three
 * logarithmic spiral arms (arm math semantics from the render-side galaxy disk
 * builder). The in-plane magnitude lands in [0.4, 0.55] * galaxyRadius and a
 * thin vertical jitter is folded back so the Euclidean magnitude always stays
 * inside the band.
 */
export function galaxyLocalPositionFor(
  slug: string,
  index: number,
  galaxyRadius = DEFAULT_GALAXY_RADIUS,
): { x: number; y: number; z: number } {
  const r = seededRng(`${GALAXY_LOCAL_SEED_PREFIX}|${slug}|${index}`)
  const radiusFraction =
    GALAXY_LOCAL_RADIUS_MIN +
    r() * (GALAXY_LOCAL_RADIUS_MAX - GALAXY_LOCAL_RADIUS_MIN)
  const armCount = 3
  const armOffset = (Math.PI * 2) / armCount
  const armIndex = Math.floor(r() * armCount)
  const winding = 4.0 + r() * 2.5
  const armJitter = (r() - 0.5) * 0.3
  const yJitter = (r() - 0.5) * galaxyRadius * 0.02
  const spiralAngle =
    armIndex * armOffset + winding * Math.log(radiusFraction + 0.04)
  const angle = spiralAngle + armJitter
  const magnitude = radiusFraction * galaxyRadius
  const inPlane = Math.sqrt(
    Math.max(0, magnitude * magnitude - yJitter * yJitter),
  )
  return {
    x: inPlane * Math.cos(angle),
    y: yJitter,
    z: inPlane * Math.sin(angle),
  }
}

/**
 * Return a new record with bodyId appended. The input is never mutated and the
 * caller always gets a fresh record object, even when the append is rejected.
 * Duplicate ids are skipped so bodyIds stays a stable, ordered, duplicate-free
 * registry (mirrors registerSystem).
 */
export function registerBody(
  system: SystemRecord,
  bodyId: BodyId,
): SystemRecord {
  if (system.bodyIds.includes(bodyId)) {
    return { ...system, bodyIds: [...system.bodyIds] }
  }
  return { ...system, bodyIds: [...system.bodyIds, bodyId] }
}
