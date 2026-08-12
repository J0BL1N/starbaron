import { describe, expect, it } from 'vitest'
import { PLANETS } from '../src/sim/data/planets'
import { galaxyId, parentOf } from '../src/sim/world/identity'
import {
  buildUniverseState,
  deserializeUniverse,
  reconstructConsistency,
  serializeUniverse,
} from '../src/sim/world/reconstruct'
import type { UniverseState } from '../src/sim/world/reconstruct'

const SEED = 'seed-prime'

function uniqueHostnames(): string[] {
  return [...new Set(PLANETS.map((entry) => entry.hostname))].sort()
}

function parsePayload(json: string): Record<string, unknown> {
  return JSON.parse(json)
}

describe('P1-T07 buildUniverseState determinism', () => {
  it('the same seed rebuilds a deep-equal universe (catalogue on)', () => {
    const first = buildUniverseState({ seed: SEED })
    const second = buildUniverseState({ seed: SEED })
    expect(second).toEqual(first)
  })

  it('the same seed rebuilds a deep-equal universe (catalogue off)', () => {
    const first = buildUniverseState({ seed: SEED, includeCatalogue: false })
    const second = buildUniverseState({ seed: SEED, includeCatalogue: false })
    expect(second).toEqual(first)
  })

  it('different seeds produce different galaxy ids', () => {
    const alpha = buildUniverseState({ seed: 'seed-alpha' })
    const beta = buildUniverseState({ seed: 'seed-beta' })
    expect(alpha.galaxy.id).not.toBe(beta.galaxy.id)
    expect(serializeUniverse(alpha)).not.toBe(serializeUniverse(beta))
  })
})

describe('P1-T07 catalogue inclusion', () => {
  it('the home galaxy id is the seed slug galaxy', () => {
    const state = buildUniverseState({ seed: SEED })
    expect(state.galaxy.id).toBe(galaxyId(SEED))
  })

  it('adds one body per pinned catalogue row', () => {
    const state = buildUniverseState({ seed: SEED })
    expect(state.bodies.length).toBe(PLANETS.length)
  })

  it('adds one system per unique hostname', () => {
    const state = buildUniverseState({ seed: SEED })
    expect(state.systems.length).toBe(uniqueHostnames().length)
  })

  it('registers every catalogue system id on the home galaxy', () => {
    const state = buildUniverseState({ seed: SEED })
    expect(state.galaxy.systemIds.length).toBe(state.systems.length)
    for (const system of state.systems) {
      expect(state.galaxy.systemIds).toContain(system.id)
    }
  })

  it('roots every catalogue system under the home galaxy', () => {
    const state = buildUniverseState({ seed: SEED })
    for (const system of state.systems) {
      expect(system.galaxy).toBe(state.galaxy.id)
    }
  })

  it('keeps catalogue systems real with provenance intact', () => {
    const state = buildUniverseState({ seed: SEED })
    for (const system of state.systems) {
      expect(system.realData).toBe(true)
      expect(system.provenance).toBe('nasa-exoplanet-archive-2026-08-10')
    }
  })

  it('keeps catalogue bodies real with provenance intact', () => {
    const state = buildUniverseState({ seed: SEED })
    expect(state.bodies.length).toBeGreaterThan(0)
    for (const body of state.bodies) {
      expect(body.realData).toBe(true)
      expect(body.provenance).toBe('nasa-exoplanet-archive-2026-08-10')
    }
  })

  it('keeps bodies attached to their catalogue systems', () => {
    const state = buildUniverseState({ seed: SEED })
    for (const body of state.bodies) {
      expect(parentOf(body.id)).toBe(body.system)
      expect(state.systems.some((system) => system.id === body.system)).toBe(true)
    }
  })
})

describe('P1-T07 empty expansion (catalogue off)', () => {
  it('returns no systems or bodies', () => {
    const state = buildUniverseState({ seed: SEED, includeCatalogue: false })
    expect(state.systems).toEqual([])
    expect(state.bodies).toEqual([])
  })

  it('still builds the seed home galaxy with an empty registry', () => {
    const state = buildUniverseState({ seed: SEED, includeCatalogue: false })
    expect(state.galaxy.id).toBe(galaxyId(SEED))
    expect(state.galaxy.systemIds).toEqual([])
  })
})

describe('P1-T07 serialization', () => {
  it('serializes byte-stably (two calls, identical strings)', () => {
    const state = buildUniverseState({ seed: SEED })
    expect(serializeUniverse(state)).toBe(serializeUniverse(state))
  })

  it('sorts object keys canonically', () => {
    const state = buildUniverseState({ seed: SEED })
    const payload = parsePayload(serializeUniverse(state))
    const galaxy = payload.galaxy as Record<string, unknown>
    const system = (payload.systems as unknown[])[0] as Record<string, unknown>
    expect(Object.keys(galaxy)).toEqual([...Object.keys(galaxy)].sort())
    expect(Object.keys(system)).toEqual([...Object.keys(system)].sort())
  })

  it('round-trips to a deep-equal universe (catalogue on)', () => {
    const state = buildUniverseState({ seed: SEED })
    expect(deserializeUniverse(serializeUniverse(state))).toEqual(state)
  })

  it('round-trips to a deep-equal universe (catalogue off)', () => {
    const state = buildUniverseState({ seed: SEED, includeCatalogue: false })
    expect(deserializeUniverse(serializeUniverse(state))).toEqual(state)
  })

  it('re-serializing the deserialized state yields the same string', () => {
    const state = buildUniverseState({ seed: SEED })
    const json = serializeUniverse(state)
    expect(serializeUniverse(deserializeUniverse(json))).toBe(json)
  })
})

describe('P1-T07 corrupt payload negatives', () => {
  it('throws on corrupt JSON', () => {
    expect(() => deserializeUniverse('{ not valid json')).toThrow()
  })

  it('throws on a payload with a bad id', () => {
    const json = serializeUniverse(buildUniverseState({ seed: SEED }))
    const payload = parsePayload(json)
    const systems = (payload.systems as unknown[]).slice()
    const system = systems[0] as Record<string, unknown>
    system.id = 'sys:malformed'
    payload.systems = systems
    expect(() => deserializeUniverse(JSON.stringify(payload))).toThrow()
  })

  it('throws on a payload with a broken parent chain', () => {
    const json = serializeUniverse(buildUniverseState({ seed: SEED }))
    const payload = parsePayload(json)
    const systems = payload.systems as unknown[]
    const bodies = (payload.bodies as unknown[]).slice()
    const body = bodies[0] as Record<string, unknown>
    body.system = (systems[1] as Record<string, unknown>).id
    payload.bodies = bodies
    expect(() => deserializeUniverse(JSON.stringify(payload))).toThrow()
  })

  it('throws on a payload with duplicate ids', () => {
    const json = serializeUniverse(buildUniverseState({ seed: SEED }))
    const payload = parsePayload(json)
    const systems = (payload.systems as unknown[]).slice()
    systems.push({ ...(systems[0] as Record<string, unknown>) })
    payload.systems = systems
    expect(() => deserializeUniverse(JSON.stringify(payload))).toThrow()
  })

  it('throws on a payload whose system id roots under a different galaxy', () => {
    const json = serializeUniverse(buildUniverseState({ seed: SEED }))
    const payload = parsePayload(json)
    const systems = payload.systems as unknown[]
    const bodies = (payload.bodies as unknown[]).slice()

    const original = systems[0] as Record<string, unknown>
    const originalId = original.id as string

    systems[0] = {
      ...original,
      id: 'sys:other|x',
      bodyIds: [],
    }
    payload.systems = systems
    payload.bodies = bodies.filter(
      (entry) => (entry as Record<string, unknown>).system !== originalId,
    )

    const galaxy = payload.galaxy as Record<string, unknown>
    galaxy.systemIds = (galaxy.systemIds as unknown[]).map((id) =>
      id === originalId ? 'sys:other|x' : id,
    )

    expect(() => deserializeUniverse(JSON.stringify(payload))).toThrow(
      /canonical parent/,
    )
  })

  it('throws on a payload with a system whose realData/provenance pair is inconsistent', () => {
    const json = serializeUniverse(buildUniverseState({ seed: SEED }))
    const payload = parsePayload(json)
    const systems = payload.systems as unknown[]
    const system = systems[0] as Record<string, unknown>
    system.provenance = 'procedural'
    payload.systems = systems
    expect(() => deserializeUniverse(JSON.stringify(payload))).toThrow(
      /realData true requires a catalogue provenance/,
    )
  })

  it('throws on a payload with a body whose realData/provenance pair is inconsistent', () => {
    const json = serializeUniverse(buildUniverseState({ seed: SEED }))
    const payload = parsePayload(json)
    const bodies = payload.bodies as unknown[]
    const body = bodies[0] as Record<string, unknown>
    body.realData = false
    payload.bodies = bodies
    expect(() => deserializeUniverse(JSON.stringify(payload))).toThrow(
      /procedural records require provenance 'procedural'/,
    )
  })
})

describe('P1-T07 exact system-to-body registry ownership', () => {
  function swappedState(): UniverseState {
    const state = buildUniverseState({ seed: SEED })
    const systems = state.systems.slice()
    const a = systems[0]
    const b = systems[1]
    systems[0] = { ...a, bodyIds: b.bodyIds }
    systems[1] = { ...b, bodyIds: a.bodyIds }
    return { ...state, systems }
  }

  it('deserializeUniverse throws when two systems swap their bodyIds registries', () => {
    const mutated = swappedState()
    expect(() => deserializeUniverse(serializeUniverse(mutated))).toThrow(
      /does not own/,
    )
  })

  it('reconstructConsistency reports swapped bodyIds registries', () => {
    const mutated = swappedState()
    const result = reconstructConsistency(mutated)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toContain('does not own')
  })
})

describe('P1-T07 exact galaxy registry (duplicates + canonical order)', () => {
  function withGalaxyRegistry(ids: string[]): UniverseState {
    const state = buildUniverseState({ seed: SEED })
    return {
      ...state,
      galaxy: {
        ...state.galaxy,
        systemIds: ids as UniverseState['galaxy']['systemIds'],
      },
    }
  }

  it('deserializeUniverse rejects a galaxy registry that repeats one entry ([id,id]) while omitting another', () => {
    const systems = buildUniverseState({ seed: SEED })
    const a = systems.galaxy.systemIds[0]
    const b = systems.galaxy.systemIds[1]
    const mutated = withGalaxyRegistry([a, a])
    expect(mutated.galaxy.systemIds).not.toContain(b)
    expect(() => deserializeUniverse(serializeUniverse(mutated))).toThrow(
      /canonical order/,
    )
  })

  it('reconstructConsistency reports a duplicated galaxy registry entry ([id,id])', () => {
    const systems = buildUniverseState({ seed: SEED })
    const a = systems.galaxy.systemIds[0]
    const mutated = withGalaxyRegistry([a, a])
    const result = reconstructConsistency(mutated)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toContain('canonical order')
  })

  it('deserializeUniverse rejects a galaxy registry in reversed canonical order', () => {
    const systems = buildUniverseState({ seed: SEED })
    const mutated = withGalaxyRegistry([...systems.galaxy.systemIds].reverse())
    expect(() => deserializeUniverse(serializeUniverse(mutated))).toThrow(
      /canonical order/,
    )
  })

  it('reconstructConsistency reports a reversed galaxy registry order', () => {
    const systems = buildUniverseState({ seed: SEED })
    const mutated = withGalaxyRegistry([...systems.galaxy.systemIds].reverse())
    const result = reconstructConsistency(mutated)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toContain('canonical order')
  })

  it('deserializeUniverse rejects a system bodyIds registry that repeats an entry ([id,id])', () => {
    const state = buildUniverseState({ seed: SEED })
    const target = state.systems[0]
    const repeated = target.bodyIds[0] ?? ''
    const mutated: UniverseState = {
      ...state,
      systems: state.systems.map((system) =>
        system.id === target.id
          ? { ...system, bodyIds: [repeated, repeated] }
          : system,
      ),
    }
    expect(() => deserializeUniverse(serializeUniverse(mutated))).toThrow(
      /contains a duplicate/,
    )
  })

  it('deserializeUniverse rejects a system bodyIds registry in reversed canonical order', () => {
    const state = buildUniverseState({ seed: SEED })
    const target = state.systems.find((system) => system.bodyIds.length > 1)
    if (target === undefined) {
      throw new Error('fixture needs at least one multi-body system')
    }
    const reversed = [...target.bodyIds].reverse()
    if (reversed.join() === target.bodyIds.join()) {
      throw new Error('fixture needs a non-palindromic bodyIds registry')
    }
    const mutated: UniverseState = {
      ...state,
      systems: state.systems.map((system) =>
        system.id === target.id ? { ...system, bodyIds: reversed } : system,
      ),
    }
    expect(() => deserializeUniverse(serializeUniverse(mutated))).toThrow(
      /canonical body order/,
    )
  })
})

describe('P1-T07 reconstructConsistency', () => {
  it('reports ok with no problems for a valid catalogue state', () => {
    const state = buildUniverseState({ seed: SEED })
    const result = reconstructConsistency(state)
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('reports ok with no problems for an empty-expansion state', () => {
    const state = buildUniverseState({ seed: SEED, includeCatalogue: false })
    const result = reconstructConsistency(state)
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('detects a mutated state with problems', () => {
    const state = buildUniverseState({ seed: SEED })
    const mutated: UniverseState = { ...state, bodies: state.bodies.slice(1) }
    const result = reconstructConsistency(mutated)
    expect(result.ok).toBe(false)
    expect(result.problems.length).toBeGreaterThan(0)
  })
})

describe('P1-T07 id chains across the whole state', () => {
  it('holds body-to-system and system-to-galaxy chains', () => {
    const state = buildUniverseState({ seed: SEED })
    for (const body of state.bodies) {
      expect(parentOf(body.id)).toBe(body.system)
    }
    for (const system of state.systems) {
      expect(system.galaxy).toBe(state.galaxy.id)
    }
  })

  it('holds exact canonical parent chains to the home galaxy for every system', () => {
    const state = buildUniverseState({ seed: SEED })
    expect(state.systems.length).toBeGreaterThan(0)
    for (const system of state.systems) {
      expect(parentOf(system.id)).toBe(state.galaxy.id)
    }
  })

  it('holds exact canonical parent chains to the declared system for every body', () => {
    const state = buildUniverseState({ seed: SEED })
    expect(state.bodies.length).toBeGreaterThan(0)
    for (const body of state.bodies) {
      expect(parentOf(body.id)).toBe(body.system)
    }
  })

  it('holds registry membership in both directions', () => {
    const state = buildUniverseState({ seed: SEED })
    for (const systemId of state.galaxy.systemIds) {
      expect(state.systems.some((system) => system.id === systemId)).toBe(true)
    }
    for (const system of state.systems) {
      for (const bodyId of system.bodyIds) {
        expect(state.bodies.some((body) => body.id === bodyId)).toBe(true)
      }
    }
    expect(state.bodies.length).toBe(
      state.systems.reduce((total, system) => total + system.bodyIds.length, 0),
    )
  })
})
