import { describe, expect, it } from 'vitest'
import {
  bodySummary,
  galaxySummary,
  queryBody,
  queryBodiesBySystem,
  queryGalaxy,
  querySystem,
  querySystemsByGalaxy,
  regionQuery,
  rendererPayload,
  systemSummary,
} from '../src/sim/world/api'
import type { RendererPayload } from '../src/sim/world/api'
import { buildUniverseState } from '../src/sim/world/reconstruct'
import type { UniverseState } from '../src/sim/world/reconstruct'
import { bodyId, galaxyId, systemId } from '../src/sim/world/identity'
import { buildGalaxyRecord, registerSystem } from '../src/sim/world/galaxy'
import { buildSystemRecord, registerBody } from '../src/sim/world/system'
import { buildBodyRecord } from '../src/sim/world/body'

const SLUG = 'api-fixture'

const ALPHA_ID = systemId(SLUG, 'alpha')
const BETA_ID = systemId(SLUG, 'beta')
const ALPHA_PLANET_0 = bodyId(ALPHA_ID, 'planet', 0)
const ALPHA_PLANET_1 = bodyId(ALPHA_ID, 'planet', 1)
const ALPHA_MOON = bodyId(ALPHA_ID, 'moon', 2)
const BETA_STAR = bodyId(BETA_ID, 'star', 0)
const BETA_PLANET = bodyId(BETA_ID, 'planet', 1)

/**
 * Small deterministic fixture with DELIBERATELY CONFLICTING orders so the
 * query layer's ordering cannot be faked by fixture coincidence:
 * - galaxy.systemIds registry order is ALPHA,BETA while the `systems` array
 *   storage order is BETA,ALPHA (proves registry-order projection).
 * - each system's bodies are stored shuffled relative to both their ordinal
 *   order and their id order, so query-side sorting is actually exercised.
 */
function buildFixture(): UniverseState {
  const home = registerSystem(
    registerSystem(
      buildGalaxyRecord({
        slug: SLUG,
        seed: SLUG,
        name: 'Fixture Home',
        position: { x: 0, y: 0, z: 0 },
      }),
      ALPHA_ID,
    ),
    BETA_ID,
  )

  const alpha = registerBody(
    registerBody(
      registerBody(
        buildSystemRecord({
          galaxy: home.id,
          slug: 'alpha',
          name: 'Alpha',
          position: { x: 100, y: 0, z: 0 },
          starType: 'G2 V',
        }),
        ALPHA_MOON,
      ),
      ALPHA_PLANET_0,
    ),
    ALPHA_PLANET_1,
  )

  const beta = registerBody(
    registerBody(
      buildSystemRecord({
        galaxy: home.id,
        slug: 'beta',
        name: 'Beta',
        position: { x: 0, y: 0, z: 0 },
        starType: 'M4 V',
      }),
      BETA_STAR,
    ),
    BETA_PLANET,
  )

  const bodies = [
    buildBodyRecord({ system: alpha.id, type: 'moon', ordinal: 2, name: 'Alpha Moon' }),
    buildBodyRecord({ system: alpha.id, type: 'planet', ordinal: 0, name: 'Alpha One' }),
    buildBodyRecord({ system: alpha.id, type: 'planet', ordinal: 1, name: 'Alpha Two' }),
    buildBodyRecord({ system: beta.id, type: 'star', ordinal: 0, name: 'Beta Prime' }),
    buildBodyRecord({ system: beta.id, type: 'planet', ordinal: 1, name: 'Beta World' }),
  ]

  return { galaxy: home, systems: [beta, alpha], bodies }
}

function buildEmptyState(): UniverseState {
  return buildUniverseState({ seed: 'api-empty', includeCatalogue: false })
}

const ORIGIN = { x: 0, y: 0, z: 0 }

/** Keys a renderer payload must never contain (deep scan). */
const PAYLOAD_BANNED_KEYS = [
  'mass',
  'provenance',
  'generationVersion',
  'systemIds',
  'bodyIds',
  'realData',
  'entries',
]

function collectKeyHits(value: unknown, path: string, hits: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectKeyHits(item, `${path}[${index}]`, hits)
    })
    return
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (PAYLOAD_BANNED_KEYS.includes(key)) {
        hits.push(`${path}.${key}`)
      }
      collectKeyHits(record[key], `${path}.${key}`, hits)
    }
  }
}

function sortedKeys(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>).sort()
}

describe('P1-T08 id lookups', () => {
  it('queryGalaxy resolves the home galaxy id', () => {
    const state = buildFixture()
    expect(queryGalaxy(state, state.galaxy.id)).toBe(state.galaxy)
  })

  it('queryGalaxy returns null for a fabricated galaxy id', () => {
    const state = buildFixture()
    expect(queryGalaxy(state, galaxyId('not-present'))).toBeNull()
  })

  it('querySystem resolves an existing system id', () => {
    const state = buildFixture()
    expect(querySystem(state, ALPHA_ID)?.name).toBe('Alpha')
  })

  it('querySystem returns null for a fabricated system id', () => {
    const state = buildFixture()
    expect(querySystem(state, systemId(SLUG, 'nope'))).toBeNull()
  })

  it('queryBody resolves an existing body id', () => {
    const state = buildFixture()
    expect(queryBody(state, ALPHA_MOON)?.name).toBe('Alpha Moon')
  })

  it('queryBody returns null for a fabricated body id', () => {
    const state = buildFixture()
    expect(queryBody(state, bodyId(ALPHA_ID, 'planet', 99))).toBeNull()
  })
})

describe('P1-T08 parent-chain contradiction rejection', () => {
  it('querySystem returns null for a system whose id encodes a different galaxy than its declared galaxy', () => {
    const state = buildFixture()
    const fake: UniverseState['systems'][number] = {
      ...buildSystemRecord({ galaxy: state.galaxy.id, slug: 'fake', name: 'Fake' }),
      id: systemId('other-galaxy', 'fake'),
    }
    const inconsistent = { ...state, systems: [...state.systems, fake] }
    expect(querySystem(inconsistent, fake.id)).toBeNull()
  })

  it('querySystemsByGalaxy skips a registered system whose canonical parent disagrees with its declared galaxy', () => {
    const state = buildFixture()
    const fake: UniverseState['systems'][number] = {
      ...buildSystemRecord({ galaxy: state.galaxy.id, slug: 'fake', name: 'Fake' }),
      id: systemId('other-galaxy', 'fake'),
    }
    const inconsistent = {
      ...state,
      galaxy: { ...state.galaxy, systemIds: [...state.galaxy.systemIds, fake.id] },
      systems: [...state.systems, fake],
    }
    const ids = querySystemsByGalaxy(inconsistent, state.galaxy.id).map((s) => s.id)
    expect(ids).not.toContain(fake.id)
    expect(ids).toEqual([ALPHA_ID, BETA_ID])
  })

  it('queryBody returns null for a body whose id encodes a different system than its declared system', () => {
    const state = buildFixture()
    const other = systemId('other-galaxy', 'seed')
    const lying: UniverseState['bodies'][number] = {
      ...buildBodyRecord({ system: other, type: 'planet', ordinal: 9, name: 'Liar' }),
      system: ALPHA_ID,
    }
    const inconsistent = { ...state, bodies: [...state.bodies, lying] }
    expect(queryBody(inconsistent, lying.id)).toBeNull()
  })

  it('queryBodiesBySystem excludes a contradictory body even when registered in the system', () => {
    const state = buildFixture()
    const other = systemId('other-galaxy', 'seed')
    const lying: UniverseState['bodies'][number] = {
      ...buildBodyRecord({ system: other, type: 'planet', ordinal: 9, name: 'Liar' }),
      system: ALPHA_ID,
    }
    const alpha = state.systems.find((s) => s.id === ALPHA_ID)!
    const patched = registerBody(alpha, lying.id)
    const inconsistent = {
      ...state,
      systems: state.systems.map((s) => (s.id === ALPHA_ID ? patched : s)),
      bodies: [...state.bodies, lying],
    }
    const ids = queryBodiesBySystem(inconsistent, ALPHA_ID).map((b) => b.id)
    expect(ids).not.toContain(lying.id)
    expect(ids).toEqual([ALPHA_PLANET_0, ALPHA_PLANET_1, ALPHA_MOON])
  })
})

describe('P1-T08 list queries and ordering', () => {
  it('querySystemsByGalaxy returns systems in stable registry order, not storage order', () => {
    // storage order is BETA,ALPHA; registry order is ALPHA,BETA — only a
    // registry-order projection can produce the expected result.
    const state = buildFixture()
    expect(state.systems.map((s) => s.id)).toEqual([BETA_ID, ALPHA_ID])
    expect(querySystemsByGalaxy(state, state.galaxy.id).map((s) => s.id)).toEqual([
      ALPHA_ID,
      BETA_ID,
    ])
  })

  it('querySystemsByGalaxy returns [] for a galaxy not in the state', () => {
    const state = buildFixture()
    expect(querySystemsByGalaxy(state, galaxyId('elsewhere'))).toEqual([])
  })

  it('queryBodiesBySystem is ordinal-sorted despite shuffled storage', () => {
    const state = buildFixture()
    expect(queryBodiesBySystem(state, ALPHA_ID).map((b) => b.ordinal)).toEqual([
      0, 1, 2,
    ])
    expect(queryBodiesBySystem(state, ALPHA_ID).map((b) => b.id)).toEqual([
      ALPHA_PLANET_0,
      ALPHA_PLANET_1,
      ALPHA_MOON,
    ])
  })

  it('queryBodiesBySystem returns [] for a system not in the state', () => {
    const state = buildFixture()
    expect(queryBodiesBySystem(state, systemId(SLUG, 'ghost'))).toEqual([])
  })

  it('queryBodiesBySystem returns [] for an orphan body whose system id is absent', () => {
    const ghost = systemId(SLUG, 'ghost')
    const orphan = buildBodyRecord({
      system: ghost,
      type: 'planet',
      ordinal: 0,
      name: 'Orphan World',
    })
    const state = buildFixture()
    const inconsistent = { ...state, bodies: [...state.bodies, orphan] }
    expect(queryBodiesBySystem(inconsistent, ghost)).toEqual([])
  })
})

describe('P1-T08 regionQuery', () => {
  it('includes a system centered on its own position and its bodies', () => {
    const state = buildFixture()
    const result = regionQuery(state, ORIGIN, 100)
    expect(result.systems.map((s) => s.id)).toEqual([ALPHA_ID, BETA_ID])
    expect(result.bodies).toHaveLength(5)
    for (const body of result.bodies) {
      expect(result.systems.some((s) => s.id === body.system)).toBe(true)
    }
  })

  it('excludes systems beyond the radius', () => {
    const state = buildFixture()
    const result = regionQuery(state, ORIGIN, 50)
    expect(result.systems.map((s) => s.id)).toEqual([BETA_ID])
    expect(result.bodies.map((b) => b.id)).toEqual([BETA_PLANET, BETA_STAR])
  })

  it('includes a system at exactly the radius boundary (radius 0 on its position)', () => {
    const state = buildFixture()
    const result = regionQuery(state, ORIGIN, 0)
    expect(result.systems.map((s) => s.id)).toEqual([BETA_ID])
  })

  it('returns empty arrays for an empty region', () => {
    const state = buildFixture()
    const result = regionQuery(state, { x: 5000, y: 0, z: 0 }, 10)
    expect(result.systems).toEqual([])
    expect(result.bodies).toEqual([])
  })

  it('throws a descriptive Error on a negative radius', () => {
    const state = buildFixture()
    expect(() => regionQuery(state, ORIGIN, -1)).toThrow(/radius/)
  })

  it('throws a descriptive Error on a non-finite radius', () => {
    const state = buildFixture()
    expect(() => regionQuery(state, ORIGIN, Number.NaN)).toThrow(/radius/)
  })
})

describe('P1-T08 projections', () => {
  it('galaxySummary keeps only id/name/position/class/radius', () => {
    const state = buildFixture()
    const summary = galaxySummary(state.galaxy)
    expect(sortedKeys(summary)).toEqual(['class', 'id', 'name', 'position', 'radius'])
    expect(summary.id).toBe(state.galaxy.id)
    expect(summary.class).toBe(state.galaxy.class)
  })

  it('systemSummary drops registries and provenance', () => {
    const state = buildFixture()
    const alpha = state.systems.find((system) => system.id === ALPHA_ID)
    expect(alpha).toBeDefined()
    const summary = systemSummary(alpha!)
    expect(sortedKeys(summary)).toEqual(['id', 'name', 'position', 'starType'])
    expect(summary.starType).toBe('G2 V')
  })

  it('bodySummary drops mass, orbit, and provenance', () => {
    const state = buildFixture()
    const body = queryBody(state, ALPHA_MOON)
    expect(body).not.toBeNull()
    const summary = bodySummary(body!)
    expect(sortedKeys(summary)).toEqual(['id', 'name', 'radius', 'type'])
    expect(summary.type).toBe('moon')
  })

  it('galaxySummary returns a cloned position isolated from the state', () => {
    const state = buildFixture()
    const summary = galaxySummary(state.galaxy)
    const before = { ...state.galaxy.position }
    summary.position.x += 1
    expect(state.galaxy.position).toEqual(before)
    state.galaxy.position.y += 1
    expect(summary.position.y).toBe(before.y)
  })

  it('systemSummary returns a cloned position isolated from the state', () => {
    const state = buildFixture()
    const alpha = state.systems.find((system) => system.id === ALPHA_ID)
    expect(alpha).toBeDefined()
    const summary = systemSummary(alpha!)
    const before = { ...alpha!.position }
    summary.position.x += 1
    expect(alpha!.position).toEqual(before)
    alpha!.position.y += 1
    expect(summary.position.y).toBe(before.y)
  })
})

describe('P1-T08 rendererPayload', () => {
  it('builds the minimal galaxy bundle', () => {
    const state = buildFixture()
    const payload = rendererPayload(state, { galaxyId: state.galaxy.id })
    expect(payload.galaxy).toEqual({
      id: state.galaxy.id,
      name: state.galaxy.name,
      seed: state.galaxy.seed,
      position: state.galaxy.position,
      radius: state.galaxy.radius,
      class: state.galaxy.class,
    })
  })

  it('builds systems with ordinal-ordered bodies and orbit elements only', () => {
    const state = buildFixture()
    const payload = rendererPayload(state, { galaxyId: state.galaxy.id })
    expect(payload.systems.map((s) => s.id)).toEqual([ALPHA_ID, BETA_ID])
    const alpha = payload.systems[0]
    const alphaRecord = state.systems.find((system) => system.id === ALPHA_ID)
    expect(alphaRecord).toBeDefined()
    expect(alpha.starColor).toBe(alphaRecord!.star.color)
    expect(alpha.bodies.map((b) => b.id)).toEqual([
      ALPHA_PLANET_0,
      ALPHA_PLANET_1,
      ALPHA_MOON,
    ])
    const expectedBody = queryBody(state, ALPHA_PLANET_0)
    expect(expectedBody).not.toBeNull()
    expect(alpha.bodies[0]).toEqual({
      id: expectedBody!.id,
      name: expectedBody!.name,
      type: expectedBody!.type,
      radius: expectedBody!.radius,
      orbit: expectedBody!.orbit,
    })
  })

  it('contains only the allowed fields — no mass/provenance/registries anywhere', () => {
    const state = buildFixture()
    const payload = rendererPayload(state, { galaxyId: state.galaxy.id })
    const hits: string[] = []
    collectKeyHits(payload, 'payload', hits)
    expect(hits).toEqual([])
  })

  it('returns empty arrays without throwing for a galaxy with no systems', () => {
    const state = buildEmptyState()
    const payload = rendererPayload(state, { galaxyId: state.galaxy.id })
    expect(payload.galaxy.id).toBe(state.galaxy.id)
    expect(payload.systems).toEqual([])
  })

  it('is deterministic across repeated calls', () => {
    const state = buildFixture()
    const first = rendererPayload(state, { galaxyId: state.galaxy.id })
    const second = rendererPayload(state, { galaxyId: state.galaxy.id })
    expect(second).toEqual(first)
  })

  it('accepts a valid focus systemId without narrowing the payload', () => {
    const state = buildFixture()
    const payload = rendererPayload(state, {
      galaxyId: state.galaxy.id,
      systemId: ALPHA_ID,
    })
    expect(payload.systems.map((s) => s.id)).toEqual([ALPHA_ID, BETA_ID])
  })

  it('throws a descriptive Error for a focus systemId outside the galaxy', () => {
    const state = buildFixture()
    expect(() =>
      rendererPayload(state, {
        galaxyId: state.galaxy.id,
        systemId: systemId('other-galaxy', 'x'),
      }),
    ).toThrow(/focus system/)
  })

  it('returns cloned position/orbit objects isolated from the state in both directions', () => {
    const state = buildFixture()
    const alpha = state.systems.find((system) => system.id === ALPHA_ID)
    expect(alpha).toBeDefined()

    const payload = rendererPayload(state, { galaxyId: state.galaxy.id })
    const galaxyPos = { ...state.galaxy.position }
    const alphaPos = { ...alpha!.position }
    const alphaOrbit = {
      ...state.bodies.find((b) => b.id === ALPHA_PLANET_0)!.orbit,
    }

    const galaxyBody = payload.systems[0].bodies[0]
    payload.galaxy.position.x += 111
    payload.systems[0].position.y += 222
    galaxyBody.orbit.semiMajorAxis += 333
    expect(state.galaxy.position).toEqual(galaxyPos)
    expect(alpha!.position).toEqual(alphaPos)
    expect(state.bodies.find((b) => b.id === ALPHA_PLANET_0)!.orbit).toEqual(
      alphaOrbit,
    )

    const second = rendererPayload(state, { galaxyId: state.galaxy.id })
    const secondGalaxyPos = { ...second.galaxy.position }
    const secondAlphaPos = { ...second.systems[0].position }
    const secondOrbit = { ...second.systems[0].bodies[0].orbit }

    state.galaxy.position.x += 111
    alpha!.position.y += 222
    state.bodies.find((b) => b.id === ALPHA_PLANET_0)!.orbit.semiMajorAxis += 333
    expect(second.galaxy.position).toEqual(secondGalaxyPos)
    expect(second.systems[0].position).toEqual(secondAlphaPos)
    expect(second.systems[0].bodies[0].orbit).toEqual(secondOrbit)
  })
})

describe('P1-T08 catalogue-on scale sanity', () => {
  it('builds a payload over the full real catalogue quickly and minimally', () => {
    const state = buildUniverseState({ seed: 'api-scale' })
    const payload: RendererPayload = rendererPayload(state, {
      galaxyId: state.galaxy.id,
    })
    expect(payload.systems.length).toBe(4746)
    const hits: string[] = []
    collectKeyHits(payload, 'payload', hits)
    expect(hits).toEqual([])
  })
})
