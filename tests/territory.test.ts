import { describe, expect, it } from 'vitest'
import { bodyId, systemId } from '../src/sim/world/identity'
import type { OwnershipRecord } from '../src/sim/player/ownership'
import { ownershipFor } from '../src/sim/player/ownership'
import type { UniverseState } from '../src/sim/world/reconstruct'
import { buildUniverseState } from '../src/sim/world/reconstruct'
import { buildGalaxyRecord, registerSystem } from '../src/sim/world/galaxy'
import { buildSystemRecord, registerBody } from '../src/sim/world/system'
import { buildBodyRecord } from '../src/sim/world/body'
import { queryBodiesBySystem, queryBody } from '../src/sim/world/api'
import {
  controlledSystemsFor,
  empireSummaryFor,
  ownedBodyIdsFor,
  ownershipOverlayPayload,
  renderNeutralPayload,
  territoryTotalsFor,
} from '../src/sim/player/territory'

const SLUG = 'territory-fixture'
const ALPHA_ID = systemId(SLUG, 'alpha')
const BETA_ID = systemId(SLUG, 'beta')
const GAMMA_ID = systemId(SLUG, 'gamma')
const GHOST_ID = systemId(SLUG, 'ghost')

const ALPHA_HOME = bodyId(ALPHA_ID, 'planet', 0)
const ALPHA_COLONY = bodyId(ALPHA_ID, 'planet', 1)
const ALPHA_MOON = bodyId(ALPHA_ID, 'moon', 2)
const BETA_COLONY = bodyId(BETA_ID, 'planet', 0)
const BETA_WORLD = bodyId(BETA_ID, 'planet', 1)
const GAMMA_WORLD = bodyId(GAMMA_ID, 'planet', 0)
const GHOST_WORLD = bodyId(GHOST_ID, 'planet', 0)

const OWNER_A = 'player-a'
const OWNER_B = 'player-b'
const OWNER_C = 'player-c'
const NOW = 1_700_000_000_000

/**
 * Small deterministic universe with three systems: alpha (home + colony +
 * moon), beta (two planets), gamma (one planet). Ownership splits A across
 * alpha/beta and B across alpha/beta/gamma so controlled-system projections
 * are actually exercised.
 */
function buildFixture(): UniverseState {
  const home = registerSystem(
    registerSystem(
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
    ),
    GAMMA_ID,
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
        ALPHA_HOME,
      ),
      ALPHA_COLONY,
    ),
    ALPHA_MOON,
  )

  const beta = registerBody(
    registerBody(
      buildSystemRecord({
        galaxy: home.id,
        slug: 'beta',
        name: 'Beta',
        position: { x: 0, y: 100, z: 0 },
        starType: 'K5 V',
      }),
      BETA_COLONY,
    ),
    BETA_WORLD,
  )

  const gamma = registerBody(
    buildSystemRecord({
      galaxy: home.id,
      slug: 'gamma',
      name: 'Gamma',
      position: { x: 0, y: 0, z: 100 },
      starType: 'M2 V',
    }),
    GAMMA_WORLD,
  )

  const bodies = [
    buildBodyRecord({ system: alpha.id, type: 'planet', ordinal: 0, name: 'Alpha Home' }),
    buildBodyRecord({ system: alpha.id, type: 'planet', ordinal: 1, name: 'Alpha Colony' }),
    buildBodyRecord({ system: alpha.id, type: 'moon', ordinal: 2, name: 'Alpha Moon' }),
    buildBodyRecord({ system: beta.id, type: 'planet', ordinal: 0, name: 'Beta Colony' }),
    buildBodyRecord({ system: beta.id, type: 'planet', ordinal: 1, name: 'Beta World' }),
    buildBodyRecord({ system: gamma.id, type: 'planet', ordinal: 0, name: 'Gamma World' }),
  ]

  return { galaxy: home, systems: [alpha, beta, gamma], bodies }
}

function recordsFor(): OwnershipRecord[] {
  return [
    ownershipFor(ALPHA_HOME, OWNER_A, null, NOW, 'home-assignment', true, true),
    ownershipFor(ALPHA_COLONY, OWNER_A, null, NOW + 1, 'colonisation', false, false),
    ownershipFor(ALPHA_MOON, OWNER_B, null, NOW, 'colonisation', false, false),
    ownershipFor(BETA_COLONY, OWNER_A, null, NOW + 2, 'colonisation', false, false),
    ownershipFor(BETA_WORLD, OWNER_B, null, NOW, 'colonisation', false, false),
    ownershipFor(GAMMA_WORLD, OWNER_B, null, NOW, 'colonisation', false, false),
  ]
}

/** An ownership record whose body is NOT present in the fixture state. */
function ghostRecord(): OwnershipRecord {
  return ownershipFor(GHOST_WORLD, OWNER_A, null, NOW + 3, 'colonisation', false, false)
}

const OWNER_KEYS = ['owner', 'ownerId']

function collectOwnerKeyHits(value: unknown, path: string, hits: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectOwnerKeyHits(item, `${path}[${index}]`, hits)
    })
    return
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (OWNER_KEYS.includes(key)) {
        hits.push(`${path}.${key}`)
      }
      collectOwnerKeyHits(record[key], `${path}.${key}`, hits)
    }
  }
}

function sortedKeys(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>).sort()
}

describe('P2-T05 ownedBodyIdsFor — membership and order', () => {
  it('returns the owned bodies of a player in input order', () => {
    const records = recordsFor()
    expect(ownedBodyIdsFor(records, OWNER_A)).toEqual([
      ALPHA_HOME,
      ALPHA_COLONY,
      BETA_COLONY,
    ])
  })

  it('never includes bodies owned by another player', () => {
    const records = recordsFor()
    expect(ownedBodyIdsFor(records, OWNER_B)).toEqual([
      ALPHA_MOON,
      BETA_WORLD,
      GAMMA_WORLD,
    ])
    expect(ownedBodyIdsFor(records, OWNER_A)).not.toContain(ALPHA_MOON)
  })

  it('returns an empty array for an owner with no records', () => {
    expect(ownedBodyIdsFor(recordsFor(), OWNER_C)).toEqual([])
    expect(ownedBodyIdsFor([], OWNER_A)).toEqual([])
  })

  it('does not mutate the input and is deterministic across calls', () => {
    const records = recordsFor()
    const before = records.map((record) => ({ ...record }))
    const first = ownedBodyIdsFor(records, OWNER_A)
    expect(ownedBodyIdsFor(records, OWNER_A)).toEqual(first)
    expect(records).toStrictEqual(before)
  })
})

describe('P2-T05 controlledSystemsFor — unique, sorted, state-derived', () => {
  it('returns unique systems containing owned bodies, sorted by id', () => {
    const state = buildFixture()
    const systems = controlledSystemsFor(recordsFor(), state, OWNER_A)
    expect(systems).toEqual([ALPHA_ID, BETA_ID])
    const unique = new Set(systems)
    expect(unique.size).toBe(systems.length)
  })

  it('excludes systems whose owned body is not present in the state', () => {
    const state = buildFixture()
    const systems = controlledSystemsFor([...recordsFor(), ghostRecord()], state, OWNER_A)
    expect(systems).toEqual([ALPHA_ID, BETA_ID])
  })

  it('returns an empty array when the only owned bodies exist outside the state', () => {
    const state = buildFixture()
    expect(controlledSystemsFor([ghostRecord()], state, OWNER_A)).toEqual([])
  })

  it('returns an empty array for an unknown owner or no records', () => {
    const state = buildFixture()
    expect(controlledSystemsFor(recordsFor(), state, OWNER_C)).toEqual([])
    expect(controlledSystemsFor([], state, OWNER_A)).toEqual([])
  })

  it('cross-check: every system is derived from an owned body registered in the state', () => {
    const state = buildFixture()
    const records = [...recordsFor(), ghostRecord()]
    const systems = controlledSystemsFor(records, state, OWNER_A)
    const owned = new Set(ownedBodyIdsFor(records, OWNER_A))
    for (const systemId of systems) {
      expect(
        queryBodiesBySystem(state, systemId).some((body) => owned.has(body.id)),
      ).toBe(true)
    }
    for (const record of records) {
      if (record.ownerId !== OWNER_A) continue
      const body = queryBody(state, record.bodyId)
      if (body !== null) {
        expect(systems).toContain(body.system)
      }
    }
  })
})

describe('P2-T05 territoryTotalsFor — counting', () => {
  it('counts owned bodies, controlled systems, home worlds and colonies', () => {
    const state = buildFixture()
    expect(territoryTotalsFor(recordsFor(), state, OWNER_A)).toEqual({
      ownedBodies: 3,
      controlledSystems: 2,
      homeWorlds: 1,
      colonies: 2,
    })
  })

  it('totals math: homeWorlds + colonies equals ownedBodies', () => {
    const state = buildFixture()
    const totals = territoryTotalsFor(recordsFor(), state, OWNER_B)
    expect(totals.homeWorlds + totals.colonies).toBe(totals.ownedBodies)
  })

  it('counts a body outside the state as owned but never as a controlled system', () => {
    const state = buildFixture()
    const totals = territoryTotalsFor([...recordsFor(), ghostRecord()], state, OWNER_A)
    expect(totals.ownedBodies).toBe(4)
    expect(totals.controlledSystems).toBe(2)
    expect(totals.homeWorlds + totals.colonies).toBe(4)
  })

  it('returns all-zero totals for empty records and is deterministic', () => {
    const state = buildFixture()
    const empty = territoryTotalsFor([], state, OWNER_A)
    expect(empty).toEqual({
      ownedBodies: 0,
      controlledSystems: 0,
      homeWorlds: 0,
      colonies: 0,
    })
    expect(territoryTotalsFor([], state, OWNER_A)).toEqual(empty)
  })
})

describe('P2-T05 empireSummaryFor — aggregation', () => {
  it('aggregates owner id, totals, owned bodies and controlled systems', () => {
    const state = buildFixture()
    const summary = empireSummaryFor(recordsFor(), state, OWNER_A)
    expect(summary.ownerId).toBe(OWNER_A)
    expect(summary.totals).toEqual(territoryTotalsFor(recordsFor(), state, OWNER_A))
    expect(summary.ownedBodyIds).toEqual(ownedBodyIdsFor(recordsFor(), OWNER_A))
    expect(summary.controlledSystemIds).toEqual(
      controlledSystemsFor(recordsFor(), state, OWNER_A),
    )
  })

  it('matches the individually computed values for the other owner', () => {
    const state = buildFixture()
    const summary = empireSummaryFor(recordsFor(), state, OWNER_B)
    expect(summary.ownedBodyIds).toEqual([ALPHA_MOON, BETA_WORLD, GAMMA_WORLD])
    expect(summary.controlledSystemIds).toEqual([ALPHA_ID, BETA_ID, GAMMA_ID])
    expect(summary.totals).toEqual({
      ownedBodies: 3,
      controlledSystems: 3,
      homeWorlds: 0,
      colonies: 3,
    })
  })

  it('returns an empty summary for an unknown owner without crashing', () => {
    const state = buildFixture()
    const summary = empireSummaryFor(recordsFor(), state, OWNER_C)
    expect(summary.ownerId).toBe(OWNER_C)
    expect(summary.ownedBodyIds).toEqual([])
    expect(summary.controlledSystemIds).toEqual([])
    expect(summary.totals.ownedBodies).toBe(0)
  })
})

describe('P2-T05 renderNeutralPayload — ownership-independent rendering', () => {
  it('lists every system with id and name in canonical order', () => {
    const state = buildFixture()
    expect(renderNeutralPayload(state).systems).toEqual([
      { id: ALPHA_ID, name: 'Alpha' },
      { id: BETA_ID, name: 'Beta' },
      { id: GAMMA_ID, name: 'Gamma' },
    ])
  })

  it('lists every body with id, name and type in deterministic order', () => {
    const state = buildFixture()
    expect(renderNeutralPayload(state).bodies).toEqual([
      { id: ALPHA_HOME, name: 'Alpha Home', type: 'planet' },
      { id: ALPHA_COLONY, name: 'Alpha Colony', type: 'planet' },
      { id: ALPHA_MOON, name: 'Alpha Moon', type: 'moon' },
      { id: BETA_COLONY, name: 'Beta Colony', type: 'planet' },
      { id: BETA_WORLD, name: 'Beta World', type: 'planet' },
      { id: GAMMA_WORLD, name: 'Gamma World', type: 'planet' },
    ])
  })

  it('contains no owner fields anywhere (deep scan for owner/ownerId keys)', () => {
    const state = buildFixture()
    const hits: string[] = []
    collectOwnerKeyHits(renderNeutralPayload(state), 'payload', hits)
    expect(hits).toEqual([])
  })

  it('system and body entries carry exactly the neutral keys', () => {
    const state = buildFixture()
    const payload = renderNeutralPayload(state)
    expect(sortedKeys(payload.systems[0])).toEqual(['id', 'name'])
    expect(sortedKeys(payload.bodies[0])).toEqual(['id', 'name', 'type'])
    expect(sortedKeys(payload)).toEqual(['bodies', 'systems'])
  })

  it('returns empty arrays for an empty universe and is deterministic', () => {
    const state = buildUniverseState({ seed: 'territory-empty', includeCatalogue: false })
    const payload = renderNeutralPayload(state)
    expect(payload.systems).toEqual([])
    expect(payload.bodies).toEqual([])
    expect(renderNeutralPayload(state)).toEqual(payload)
  })
})

describe('P2-T05 ownershipOverlayPayload — minimal separate overlay', () => {
  it('returns a compact bodyId → ownerId map for the player', () => {
    const records = recordsFor()
    expect(ownershipOverlayPayload(records, OWNER_A)).toEqual([
      { bodyId: ALPHA_HOME, ownerId: OWNER_A },
      { bodyId: ALPHA_COLONY, ownerId: OWNER_A },
      { bodyId: BETA_COLONY, ownerId: OWNER_A },
    ])
  })

  it('entries carry exactly the two minimal keys — no names', () => {
    const records = recordsFor()
    for (const entry of ownershipOverlayPayload(records, OWNER_B)) {
      expect(sortedKeys(entry)).toEqual(['bodyId', 'ownerId'])
      expect(entry.ownerId).toBe(OWNER_B)
    }
  })

  it('returns an empty array for an owner with no records', () => {
    expect(ownershipOverlayPayload(recordsFor(), OWNER_C)).toEqual([])
    expect(ownershipOverlayPayload([], OWNER_A)).toEqual([])
  })

  it('is deterministic and preserves record input order', () => {
    const records = recordsFor()
    const first = ownershipOverlayPayload(records, OWNER_A)
    expect(ownershipOverlayPayload(records, OWNER_A)).toEqual(first)
    expect(first.map((entry) => entry.bodyId)).toEqual(ownedBodyIdsFor(records, OWNER_A))
  })
})
