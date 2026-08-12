import { describe, expect, it, vi } from 'vitest'
import { createPlayer } from '../src/sim/player'
import type { PlayerState } from '../src/sim/player'
import {
  MOCK_COLONY_COUNT,
  MOCK_FIXTURE_AT,
  boundaryReport,
  guardReal,
  mockDataSource,
  realDataSource,
} from '../src/sim/ui/data-sources'
import type { UiDataSource } from '../src/sim/ui/data-sources'
import { buildUniverseState } from '../src/sim/world/reconstruct'
import type { UniverseState } from '../src/sim/world/reconstruct'

const AT = MOCK_FIXTURE_AT

function makeReal(label: string): UiDataSource {
  return realDataSource(
    (at: number): PlayerState => createPlayer(`live-${label}-${at}`, at),
    (at: number): UniverseState =>
      buildUniverseState({ seed: `live-${label}-${at}`, includeCatalogue: false }),
  )
}

describe('P4-T09 mockDataSource — kind, label, interface', () => {
  it('is tagged mock with the passed label', () => {
    const source = mockDataSource('demo', 'seed-a')
    expect(source.kind).toBe('mock')
    expect(source.label).toBe('demo')
  })

  it('exposes the UiDataSource adapter methods (structural contract)', () => {
    const source = mockDataSource('demo', 'seed-a')
    expect(typeof source.playerAt).toBe('function')
    expect(typeof source.universeAt).toBe('function')
    expect(source.playerAt(AT)).toBeDefined()
    expect(source.universeAt(AT)).toBeDefined()
  })
})

describe('P4-T09 mockDataSource — determinism', () => {
  it('same label+seed → deep-equal player states across separate constructions', () => {
    const a = mockDataSource('demo', 'seed-a')
    const b = mockDataSource('demo', 'seed-a')
    expect(a.playerAt(AT)).toEqual(b.playerAt(AT))
    expect(a.playerAt(AT).playerId).toBe(b.playerAt(AT).playerId)
  })

  it('same label+seed → deep-equal universe states and equal tags', () => {
    const a = mockDataSource('demo', 'seed-a')
    const b = mockDataSource('demo', 'seed-a')
    expect(a.universeAt(AT)).toEqual(b.universeAt(AT))
    expect(a.kind).toBe(b.kind)
    expect(a.label).toBe(b.label)
  })

  it('different seed → different player id', () => {
    const a = mockDataSource('demo', 'seed-a')
    const b = mockDataSource('demo', 'seed-b')
    expect(b.playerAt(AT).playerId).not.toBe(a.playerAt(AT).playerId)
  })

  it('different seed → different universe ids and labels (galaxy/system/body)', () => {
    const a = mockDataSource('demo', 'seed-a')
    const b = mockDataSource('demo', 'seed-b')
    expect(b.universeAt(AT).galaxy.id).not.toBe(a.universeAt(AT).galaxy.id)
    expect(b.universeAt(AT).galaxy.name).not.toBe(a.universeAt(AT).galaxy.name)
    expect(b.universeAt(AT).systems[0].id).not.toBe(a.universeAt(AT).systems[0].id)
    expect(b.universeAt(AT).bodies[0].id).not.toBe(a.universeAt(AT).bodies[0].id)
    expect(b.universeAt(AT)).not.toEqual(a.universeAt(AT))
  })

  it('different label → different label and player id', () => {
    const a = mockDataSource('demo-a', 'seed')
    const b = mockDataSource('demo-b', 'seed')
    expect(b.label).not.toBe(a.label)
    expect(b.playerAt(AT).playerId).not.toBe(a.playerAt(AT).playerId)
  })

  it('repeated construction with identical args is byte-stable', () => {
    const first = mockDataSource('demo', 'seed-a')
    const second = mockDataSource('demo', 'seed-a')
    expect(first.playerAt(AT)).toEqual(second.playerAt(AT))
    expect(first.universeAt(AT)).toEqual(second.universeAt(AT))
  })
})

describe('P4-T09 mockDataSource — static semantics', () => {
  it('playerAt ignores at — deep-equal across distinct at values', () => {
    const source = mockDataSource('demo', 'seed-a')
    expect(source.playerAt(AT)).toEqual(source.playerAt(AT + 86_400_000))
  })

  it('universeAt ignores at — deep-equal across distinct at values', () => {
    const source = mockDataSource('demo', 'seed-a')
    expect(source.universeAt(AT)).toEqual(source.universeAt(AT + 86_400_000))
  })

  it('playerAt returns the SAME captured object on every call (static, documented)', () => {
    const source = mockDataSource('demo', 'seed-a')
    const first = source.playerAt(AT)
    expect(source.playerAt(AT + 86_400_000)).toBe(first)
  })

  it('universeAt returns the SAME captured object on every call (static, documented)', () => {
    const source = mockDataSource('demo', 'seed-a')
    const first = source.universeAt(AT)
    expect(source.universeAt(AT + 86_400_000)).toBe(first)
  })
})

describe('P4-T09 mockDataSource — fixture content', () => {
  it('owns a home planet plus MOCK_COLONY_COUNT colonies with full structure grids', () => {
    const source = mockDataSource('demo', 'seed-a')
    const player = source.playerAt(AT)
    expect(player.homePlanet.isHome).toBe(true)
    expect(player.homePlanet.unconquerable).toBe(true)
    expect(player.colonies).toHaveLength(MOCK_COLONY_COUNT)
    for (const colony of player.colonies) {
      expect(colony.isHome).toBe(false)
      expect(colony.unconquerable).toBe(false)
    }
    const ownedNames = [player.homePlanet.name, ...player.colonies.map((c) => c.name)]
    for (const name of ownedNames) {
      expect(player.structureLevels[name]).toBeDefined()
    }
  })

  it('universe is exactly 1 galaxy / 1 system / one body per owned planet', () => {
    const source = mockDataSource('demo', 'seed-a')
    const universe = source.universeAt(AT)
    expect(universe.systems).toHaveLength(1)
    expect(universe.bodies).toHaveLength(1 + MOCK_COLONY_COUNT)
    expect(universe.galaxy.systemIds).toHaveLength(1)
  })

  it('universe bodies align with the owned planets (names + registries)', () => {
    const source = mockDataSource('demo', 'seed-a')
    const player = source.playerAt(AT)
    const universe = source.universeAt(AT)
    const ownedNames = [player.homePlanet.name, ...player.colonies.map((c) => c.name)]
    expect(universe.bodies.map((b) => b.name)).toEqual(ownedNames)
    expect(universe.galaxy.systemIds).toEqual(universe.systems.map((s) => s.id))
    expect(universe.systems[0].bodyIds).toEqual(universe.bodies.map((b) => b.id))
  })
})

describe('P4-T09 mockDataSource — validation', () => {
  const source = mockDataSource('demo', 'seed-a')

  it('playerAt throws RangeError on non-positive or non-finite at', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => source.playerAt(bad)).toThrow(RangeError)
    }
  })

  it('universeAt throws RangeError on non-positive or non-finite at', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => source.universeAt(bad)).toThrow(RangeError)
    }
  })

  it('throws RangeError on an empty or blank label', () => {
    expect(() => mockDataSource('', 'seed-a')).toThrow(RangeError)
    expect(() => mockDataSource('   ', 'seed-a')).toThrow(RangeError)
  })

  it('throws RangeError on an empty or blank seed', () => {
    expect(() => mockDataSource('demo', '')).toThrow(RangeError)
    expect(() => mockDataSource('demo', '   ')).toThrow(RangeError)
  })
})

describe('P4-T09 realDataSource — delegation', () => {
  it('is tagged real with label live', () => {
    const source = makeReal('demo')
    expect(source.kind).toBe('real')
    expect(source.label).toBe('live')
  })

  it('playerAt delegates to the getter with the exact at', () => {
    const getPlayer = vi.fn((at: number): PlayerState => createPlayer('live', at))
    const source = realDataSource(
      getPlayer,
      (): UniverseState => buildUniverseState({ seed: 'x', includeCatalogue: false }),
    )
    const player = source.playerAt(42)
    expect(getPlayer).toHaveBeenCalledTimes(1)
    expect(getPlayer).toHaveBeenCalledWith(42)
    expect(player).toBeDefined()
  })

  it('universeAt delegates to the getter with the exact at', () => {
    const getUniverse = vi.fn(
      (at: number): UniverseState =>
        buildUniverseState({ seed: `live-${at}`, includeCatalogue: false }),
    )
    const source = realDataSource(
      (at: number): PlayerState => createPlayer('live', at),
      getUniverse,
    )
    const universe = source.universeAt(7)
    expect(getUniverse).toHaveBeenCalledTimes(1)
    expect(getUniverse).toHaveBeenCalledWith(7)
    expect(universe).toBeDefined()
  })

  it('forwards every at through and never caches (distinct values per call)', () => {
    const getPlayer = vi.fn((at: number): PlayerState => createPlayer('live', at))
    const getUniverse = vi.fn(
      (at: number): UniverseState =>
        buildUniverseState({ seed: `live-${at}`, includeCatalogue: false }),
    )
    const source = realDataSource(getPlayer, getUniverse)
    const p1 = source.playerAt(1_000)
    const p2 = source.playerAt(2_000)
    expect(getPlayer).toHaveBeenCalledTimes(2)
    expect(getPlayer).toHaveBeenNthCalledWith(1, 1_000)
    expect(getPlayer).toHaveBeenNthCalledWith(2, 2_000)
    expect(p2).not.toBe(p1)
    expect(p2).not.toEqual(p1)
    const u1 = source.universeAt(1_000)
    const u2 = source.universeAt(1_000)
    expect(getUniverse).toHaveBeenCalledTimes(2)
    expect(getUniverse).toHaveBeenNthCalledWith(1, 1_000)
    expect(getUniverse).toHaveBeenNthCalledWith(2, 1_000)
    expect(u2).not.toBe(u1)
    expect(u2).toEqual(u1)
  })

  it('passes getter outputs through untouched (no reshaping)', () => {
    const sentinelPlayer = createPlayer('sentinel', AT)
    const sentinelUniverse = buildUniverseState({ seed: 'sentinel', includeCatalogue: false })
    const source = realDataSource(
      (): PlayerState => sentinelPlayer,
      (): UniverseState => sentinelUniverse,
    )
    expect(source.playerAt(AT)).toBe(sentinelPlayer)
    expect(source.universeAt(AT)).toBe(sentinelUniverse)
  })

  it('playerAt/universeAt throw RangeError on non-positive or non-finite at BEFORE invoking the getter', () => {
    const getPlayer = vi.fn((at: number): PlayerState => createPlayer('live', at))
    const getUniverse = vi.fn(
      (at: number): UniverseState =>
        buildUniverseState({ seed: `live-${at}`, includeCatalogue: false }),
    )
    const source = realDataSource(getPlayer, getUniverse)
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => source.playerAt(bad)).toThrow(RangeError)
      expect(() => source.universeAt(bad)).toThrow(RangeError)
    }
    expect(getPlayer).not.toHaveBeenCalled()
    expect(getUniverse).not.toHaveBeenCalled()
  })

  it('a valid at passes the assert and reaches the getter unchanged', () => {
    const getPlayer = vi.fn((at: number): PlayerState => createPlayer('live', at))
    const getUniverse = vi.fn(
      (at: number): UniverseState =>
        buildUniverseState({ seed: `live-${at}`, includeCatalogue: false }),
    )
    const source = realDataSource(getPlayer, getUniverse)
    expect(source.playerAt(AT)).toBeDefined()
    expect(getPlayer).toHaveBeenCalledExactlyOnceWith(AT)
    expect(source.universeAt(AT)).toBeDefined()
    expect(getUniverse).toHaveBeenCalledExactlyOnceWith(AT)
  })
})

describe('P4-T09 guardReal — boundary guard', () => {
  it('returns a real source unchanged (same reference)', () => {
    const source = makeReal('demo')
    expect(guardReal(source)).toBe(source)
  })

  it('throws for a mock source (mocks must never reach production paths)', () => {
    const source = mockDataSource('demo', 'seed-a')
    expect(() => guardReal(source)).toThrow(RangeError)
    expect(() => guardReal(source)).toThrow(/real/)
  })

  it('throws for an untagged / unknown-kind source', () => {
    const mock = mockDataSource('demo', 'seed-a')
    const bogus = {
      kind: 'not-real',
      label: 'bogus',
      playerAt: mock.playerAt,
      universeAt: mock.universeAt,
    } as unknown as UiDataSource
    expect(() => guardReal(bogus)).toThrow(RangeError)
  })
})

describe('P4-T09 boundaryReport — kind partition', () => {
  it('all-mock: labels listed in order, real empty, mixed false', () => {
    const m1 = mockDataSource('demo-a', 's')
    const m2 = mockDataSource('demo-b', 's')
    expect(boundaryReport([m1, m2])).toEqual({
      mock: ['demo-a', 'demo-b'],
      real: [],
      mixed: false,
    })
  })

  it('all-real: labels listed in order, mock empty, mixed false', () => {
    const r1 = makeReal('one')
    const r2 = makeReal('two')
    expect(boundaryReport([r1, r2])).toEqual({
      mock: [],
      real: ['live', 'live'],
      mixed: false,
    })
  })

  it('mixed mock+real: both lists populated, mixed true', () => {
    const m1 = mockDataSource('demo-a', 's')
    const r1 = makeReal('one')
    const m2 = mockDataSource('demo-b', 's')
    expect(boundaryReport([m1, r1, m2])).toEqual({
      mock: ['demo-a', 'demo-b'],
      real: ['live'],
      mixed: true,
    })
  })

  it('empty input: empty lists, mixed false; preserves input order per kind', () => {
    expect(boundaryReport([])).toEqual({ mock: [], real: [], mixed: false })
    const r1 = makeReal('one')
    const m1 = mockDataSource('demo-a', 's')
    const r2 = makeReal('two')
    const m2 = mockDataSource('demo-b', 's')
    expect(boundaryReport([r1, m1, r2, m2])).toEqual({
      mock: ['demo-a', 'demo-b'],
      real: ['live', 'live'],
      mixed: true,
    })
  })
})
