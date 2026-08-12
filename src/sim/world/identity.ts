import { fnv1a } from '../planets/hash'

export type BodyType = 'star' | 'planet' | 'moon' | 'asteroid'

const BODY_TYPE_VALUES: readonly BodyType[] = ['star', 'planet', 'moon', 'asteroid']

export type GalaxyId = string & { readonly __galaxy: true }
export type SystemId = string & { readonly __system: true }
export type BodyId = string & { readonly __body: true }
export type CanonicalId = GalaxyId | SystemId | BodyId

export interface SystemRef {
  id: SystemId
  galaxy: GalaxyId
}

export interface BodyRef {
  id: BodyId
  type: BodyType
  parent: SystemId
}

export interface ParsedGalaxyId {
  ok: true
  kind: 'galaxy'
  slug: string
  id: GalaxyId
}

export interface ParsedSystemId {
  ok: true
  kind: 'system'
  galaxySlug: string
  systemSeed: string
  id: SystemId
}

export interface ParsedBodyId {
  ok: true
  kind: 'body'
  galaxySlug: string
  systemSeed: string
  bodyType: BodyType
  ordinal: number
  id: BodyId
}

export interface ParseFailure {
  ok: false
  reason: string
}

export type ParsedCanonicalId =
  | ParsedGalaxyId
  | ParsedSystemId
  | ParsedBodyId
  | ParseFailure

const GALAXY_PREFIX = 'gal:'
const SYSTEM_PREFIX = 'sys:'
const BODY_PREFIX = 'body:'

/**
 * Upper bound of a canonical ordinal: the PostgreSQL int4 max (2^31 - 1), so
 * every body id that parses here can persist unchanged in world_bodies.ordinal
 * (0013_world_schema.sql mirrors this bound in its ordinal CHECK).
 */
export const ORDINAL_MAX = 2_147_483_647

/**
 * Canonical ordinal text grammar: zero alone, or a non-empty digit string
 * with no leading zeros. '01' is rejected so a body id can never encode an
 * ordinal with a distinct string but the same numeric value as the factory
 * output ('...|01' vs '...|1' would be two ids with one identity).
 */
const ORDINAL_PATTERN = /^(0|[1-9][0-9]*)$/

function isBodyType(value: string): value is BodyType {
  return (BODY_TYPE_VALUES as readonly string[]).includes(value)
}

function assertSegment(name: string, value: string): void {
  if (value === '') {
    throw new Error(`${name} must not be empty, got: ${JSON.stringify(value)}`)
  }
  if (value.includes('|')) {
    throw new Error(`${name} must not contain '|', got: ${JSON.stringify(value)}`)
  }
}

function assertOrdinal(ordinal: number): void {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > ORDINAL_MAX) {
    throw new Error(
      `bodyId requires a non-negative integer ordinal within [0, ${ORDINAL_MAX}], got: ${JSON.stringify(ordinal)}`,
    )
  }
}

export function galaxyId(slug: string): GalaxyId {
  assertSegment('galaxy slug', slug)
  return `${GALAXY_PREFIX}${slug}` as GalaxyId
}

export function systemId(galaxySlug: string, systemSeed: string | number): SystemId {
  const seed = String(systemSeed)
  assertSegment('galaxy slug', galaxySlug)
  assertSegment('system seed', seed)
  return `${SYSTEM_PREFIX}${galaxySlug}|${seed}` as SystemId
}

export function bodyId(system: SystemId, type: BodyType, ordinal: number): BodyId {
  const parsed = parseCanonicalId(system)
  if (!parsed.ok || parsed.kind !== 'system') {
    throw new Error(`bodyId requires a valid SystemId, got: ${system}`)
  }
  assertOrdinal(ordinal)
  return `${BODY_PREFIX}${parsed.galaxySlug}|${parsed.systemSeed}|${type}|${ordinal}` as BodyId
}

export function parseCanonicalId(id: string): ParsedCanonicalId {
  if (id === '') {
    return { ok: false, reason: 'empty id' }
  }
  if (id.startsWith(GALAXY_PREFIX)) {
    const slug = id.slice(GALAXY_PREFIX.length)
    if (slug === '') {
      return { ok: false, reason: 'empty galaxy slug' }
    }
    if (slug.includes('|')) {
      return { ok: false, reason: `extra segments in galaxy id: ${id}` }
    }
    return { ok: true, kind: 'galaxy', slug, id: `${GALAXY_PREFIX}${slug}` as GalaxyId }
  }
  if (id.startsWith(SYSTEM_PREFIX)) {
    const rest = id.slice(SYSTEM_PREFIX.length)
    const segments = rest.split('|')
    if (segments.length !== 2) {
      return { ok: false, reason: `malformed system id: ${id}` }
    }
    const galaxySlug = segments[0]
    const systemSeed = segments[1]
    if (galaxySlug === '' || systemSeed === '') {
      return { ok: false, reason: `empty system segment: ${id}` }
    }
    return {
      ok: true,
      kind: 'system',
      galaxySlug,
      systemSeed,
      id: `${SYSTEM_PREFIX}${galaxySlug}|${systemSeed}` as SystemId,
    }
  }
  if (id.startsWith(BODY_PREFIX)) {
    const rest = id.slice(BODY_PREFIX.length)
    const segments = rest.split('|')
    if (segments.length !== 4) {
      return { ok: false, reason: `malformed body id: ${id}` }
    }
    const [galaxySlug, systemSeed, bodyType, ordinalText] = segments
    if (galaxySlug === '' || systemSeed === '' || bodyType === '' || ordinalText === '') {
      return { ok: false, reason: `empty body segment: ${id}` }
    }
    if (!isBodyType(bodyType)) {
      return { ok: false, reason: `invalid body type: ${bodyType}` }
    }
    if (!ORDINAL_PATTERN.test(ordinalText)) {
      return { ok: false, reason: `invalid ordinal: ${ordinalText}` }
    }
    const ordinal = Number(ordinalText)
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > ORDINAL_MAX) {
      return { ok: false, reason: `invalid ordinal: ${ordinalText}` }
    }
    return {
      ok: true,
      kind: 'body',
      galaxySlug,
      systemSeed,
      bodyType,
      ordinal,
      id: `${BODY_PREFIX}${galaxySlug}|${systemSeed}|${bodyType}|${ordinalText}` as BodyId,
    }
  }
  return { ok: false, reason: `unknown prefix: ${id}` }
}

export function parentOf(id: CanonicalId): GalaxyId | SystemId | null {
  const parsed = parseCanonicalId(id)
  if (!parsed.ok) {
    return null
  }
  switch (parsed.kind) {
    case 'body':
      return systemId(parsed.galaxySlug, parsed.systemSeed)
    case 'system':
      return galaxyId(parsed.galaxySlug)
    case 'galaxy':
      return null
  }
}

export function idSeed(id: CanonicalId): number {
  return fnv1a(id)
}

/**
 * Canonical registry order contract (P1-T05/T07/T08).
 *
 * Registries are DERIVED + ordered, never persisted verbatim: the SQL layer
 * (0013_world_schema.sql) stores child rows via FKs only and derives
 * registries at query time with `ORDER BY id` (systems) /
 * `ORDER BY ordinal, id` (bodies). The canonical order is therefore:
 *   - systems: sorted by id string (lexicographic),
 *   - bodies:   sorted by (ordinal, then id string).
 * Every producer (catalogue mapping, universe builder) emits registries in
 * this order, every validator (validateCatalogue, collectUniverseProblems)
 * enforces it, and the query layer (./api) derives results from it rather
 * than trusting stored array order — an exact deterministic round trip.
 * The helpers below are the single implementation of that order, referenced
 * by every module that builds, validates, or projects registries.
 */

/** Sort system ids into canonical registry order (by id string). */
export function canonicalSystemOrder<T extends string>(ids: readonly T[]): T[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** The parsed ordinal of a body id, or null when the id is not a valid body. */
function parsedBodyOrdinal(id: string): number | null {
  const parsed = parseCanonicalId(id)
  if (parsed.ok && parsed.kind === 'body') {
    return parsed.ordinal
  }
  return null
}

/**
 * Sort body ids into canonical registry order: by parsed ordinal ascending,
 * then by id string. Ids that do not parse as bodies sort last, by id string
 * (a malformed id can never be a valid registry member anyway).
 */
export function canonicalBodyOrder<T extends string>(ids: readonly T[]): T[] {
  return [...ids].sort((a, b) => {
    const aOrdinal = parsedBodyOrdinal(a)
    const bOrdinal = parsedBodyOrdinal(b)
    if (aOrdinal !== bOrdinal) {
      if (aOrdinal === null) return 1
      if (bOrdinal === null) return -1
      return aOrdinal - bOrdinal
    }
    return a < b ? -1 : a > b ? 1 : 0
  })
}
