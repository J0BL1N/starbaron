/**
 * Canonical celestial-body data model.
 *
 * Pure, deterministic module: every value derives from a string id/seed via
 * fnv1a. No nondeterministic APIs or timestamps; no shared mutable data. This is the
 * source of truth for body records — render-side modules may import FROM here,
 * never the reverse.
 *
 * Canonical record contract: BodyRecord excludes persistence-only metadata.
 * A DB-filled created_at-style column is filled by the persistence layer for
 * operational tracing and is NOT part of this contract (see
 * supabase/migrations/0013_world_schema.sql).
 */

import { fnv1a } from '../planets/hash'
import { bodyId, parseCanonicalId } from './identity'
import type { BodyId, BodyType, SystemId } from './identity'
import { assertRealDataProvenance } from './galaxy'

export const BODY_GENERATION_VERSION = 1

const TWO_PI = Math.PI * 2

const BODY_NAME_SEED_PREFIX = 'body-name-v1'
const BODY_RADIUS_SEED_PREFIX = 'body-radius-v1'
const BODY_ORBIT_SEED_PREFIX = 'body-orbit-v1'
const BODY_ASTEROID_CODE_PREFIX = 'body-asteroid-v1'

/** Keplerian orbit for a body around its parent (the system centre). */
export interface BodyOrbit {
  semiMajorAxis: number
  eccentricity: number
  inclination: number
  longitudeOfAscendingNode: number
  argumentOfPeriapsis: number
  meanAnomaly: number
  period: number
}

/** Canonical, persistent body record. No timestamps — determinism. */
export interface BodyRecord {
  id: BodyId
  system: SystemId
  type: BodyType
  name: string
  seed: string
  ordinal: number
  radius: number
  mass?: number
  orbit: BodyOrbit
  realData: boolean
  provenance: string
  generationVersion: number
}

/** Seeded pool for procedural planet display names. */
export const BODY_NAME_POOL: readonly string[] = [
  'Aurorae',
  'Calypso',
  'Cinder',
  'Echo',
  'Helios',
  'Lumen',
  'Mara',
  'Nautilus',
  'Nyxara',
  'Obsidian',
  'Thalassa',
  'Tundra',
  'Verdant',
  'Vespera',
  'Zephyr',
  'Aurelia',
]

const ZERO_ORBIT: BodyOrbit = {
  semiMajorAxis: 0,
  eccentricity: 0,
  inclination: 0,
  longitudeOfAscendingNode: 0,
  argumentOfPeriapsis: 0,
  meanAnomaly: 0,
  period: 0,
}

const ROMAN_NUMERALS: readonly [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]

/** Deterministic 0..1 value from a string seed (built on fnv1a). */
function seededUnit(seed: string): number {
  return fnv1a(seed) / 0x100000000
}

/** Minimal deterministic PRNG built on fnv1a (no shared state, no rngFrom). */
function seededRng(seed: string): () => number {
  let index = 0
  return () => seededUnit(`${seed}|${index++}`)
}

/** Namespaced deterministic PRNG so name/radius/orbit never share a stream. */
function rngFor(namespace: string, id: string): () => number {
  return seededRng(`${namespace}|${id}`)
}

function romanNumeral(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 3999) {
    throw new Error(
      `romanNumeral requires an integer in [1, 3999], got: ${value}`,
    )
  }
  let remaining = value
  let out = ''
  for (const [n, glyph] of ROMAN_NUMERALS) {
    const count = Math.floor(remaining / n)
    out += glyph.repeat(count)
    remaining -= count * n
  }
  return out
}

/**
 * Deterministic default name for a body. Stars are "<system> Prime"; planets
 * pick from BODY_NAME_POOL; moons are "<parent> <roman-numeral>" where the
 * parent is the owning system; asteroids are "SB-####".
 */
export function seededBodyName(
  type: BodyType,
  systemName: string,
  ordinal: number,
  seed: string,
): string {
  switch (type) {
    case 'star':
      return `${systemName} Prime`
    case 'planet':
      return BODY_NAME_POOL[
        fnv1a(`${BODY_NAME_SEED_PREFIX}|${seed}`) % BODY_NAME_POOL.length
      ]
    case 'moon':
      if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 3999) {
        throw new Error(
          `seededBodyName moon ordinal must be a finite integer in [0, 3999], got: ${ordinal}`,
        )
      }
      return `${systemName} ${romanNumeral(ordinal + 1)}`
    case 'asteroid': {
      const code = fnv1a(`${BODY_ASTEROID_CODE_PREFIX}|${seed}`) % 10000
      return `SB-${String(code).padStart(4, '0')}`
    }
  }
}

/** Extract the system seed (its display-name default) from a branded SystemId. */
function systemNameOf(system: SystemId): string {
  const parsed = parseCanonicalId(system)
  if (!parsed.ok || parsed.kind !== 'system') {
    throw new Error(`buildBodyRecord requires a valid SystemId, got: ${system}`)
  }
  return parsed.systemSeed
}

function defaultRadius(type: BodyType, id: BodyId): number {
  const r = rngFor(BODY_RADIUS_SEED_PREFIX, id)
  switch (type) {
    case 'star':
      return 4 + r() * 4
    case 'planet':
      return 0.4 + r() * 2.6
    case 'moon':
      return 0.08 + r() * 0.32
    case 'asteroid':
      return 0.03 + r() * 0.27
  }
}

function defaultOrbit(type: BodyType, id: BodyId): BodyOrbit {
  if (type === 'star') {
    return { ...ZERO_ORBIT }
  }
  const r = rngFor(BODY_ORBIT_SEED_PREFIX, id)
  const angles = {
    inclination: r() * 0.15,
    longitudeOfAscendingNode: r() * TWO_PI,
    argumentOfPeriapsis: r() * TWO_PI,
    meanAnomaly: r() * TWO_PI,
  }
  if (type === 'moon') {
    return {
      semiMajorAxis: 1 + r() * 2.5,
      eccentricity: r() * 0.12,
      ...angles,
      period: 8 + r() * 40,
    }
  }
  const isAsteroid = type === 'asteroid'
  return {
    semiMajorAxis: isAsteroid ? 12 + r() * 14 : 8 + r() * 28,
    eccentricity: r() * (isAsteroid ? 0.2 : 0.12),
    ...angles,
    period: 60 + r() * 540,
  }
}

const ORBIT_FIELDS = [
  'semiMajorAxis',
  'eccentricity',
  'inclination',
  'longitudeOfAscendingNode',
  'argumentOfPeriapsis',
  'meanAnomaly',
  'period',
] as const

function validateOrbit(type: BodyType, orbit: BodyOrbit): void {
  for (const field of ORBIT_FIELDS) {
    if (!Number.isFinite(orbit[field])) {
      throw new Error(
        `invalid orbit for ${type}: ${field} must be finite, got: ${orbit[field]}`,
      )
    }
  }
  if (orbit.semiMajorAxis < 0) {
    throw new Error(
      `invalid orbit for ${type}: semiMajorAxis must be >= 0, got: ${orbit.semiMajorAxis}`,
    )
  }
  if (orbit.eccentricity < 0 || orbit.eccentricity >= 1) {
    throw new Error(
      `invalid orbit for ${type}: eccentricity must be in [0, 1), got: ${orbit.eccentricity}`,
    )
  }
  if (type === 'star') {
    for (const field of ORBIT_FIELDS) {
      if (orbit[field] !== 0) {
        throw new Error(
          `invalid orbit for star: ${field} must be 0, got: ${orbit[field]}`,
        )
      }
    }
  }
  if (type !== 'star' && orbit.period <= 0) {
    throw new Error(
      `invalid orbit for ${type}: period must be > 0, got: ${orbit.period}`,
    )
  }
}

/**
 * Build a canonical body record. The id is always the branded id from
 * ./identity — never constructed by hand. Same input always yields a
 * deep-equal record. When realData is true, provenance must be a catalogue
 * provenance (see assertRealDataProvenance) — records cannot be labelled real
 * outside catalogue/reconstruction internals.
 */
export function buildBodyRecord(input: {
  system: SystemId
  type: BodyType
  ordinal: number
  name?: string
  seed?: string
  radius?: number
  orbit?: Partial<BodyOrbit>
  mass?: number
  realData?: boolean
  provenance?: string
}): BodyRecord {
  const systemName = systemNameOf(input.system)
  const id = bodyId(input.system, input.type, input.ordinal)
  const seed = input.seed ?? id
  const orbit = { ...defaultOrbit(input.type, id), ...input.orbit }
  validateOrbit(input.type, orbit)
  const realData = input.realData ?? false
  const provenance = input.provenance ?? 'procedural'
  assertRealDataProvenance(realData, provenance)
  return {
    id,
    system: input.system,
    type: input.type,
    name: input.name ?? seededBodyName(input.type, systemName, input.ordinal, seed),
    seed,
    ordinal: input.ordinal,
    radius: input.radius ?? defaultRadius(input.type, id),
    ...(input.mass !== undefined ? { mass: input.mass } : {}),
    orbit,
    realData,
    provenance,
    generationVersion: BODY_GENERATION_VERSION,
  }
}

/** One-line human summary for debug/tooling. */
export function describeBody(body: BodyRecord): string {
  const label = body.type.charAt(0).toUpperCase() + body.type.slice(1)
  const radius = body.radius.toFixed(2)
  const period = Math.round(body.orbit.period)
  return `${label} ${body.name} · R ${radius} · P ${period}s · ${body.provenance}`
}
