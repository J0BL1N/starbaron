import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PLANETS } from '../src/sim/data/planets'
import type { PlanetCatalogueEntry } from '../src/sim/data/planets'
import { QUIRK_TABLE, quirkById, triggeredQuirks } from '../src/sim/planets/quirks'
import { fnv1a } from '../src/sim/planets/hash'
import type { QuirkId } from '../src/sim/planets/types'
import {
  deterministicQuirks,
  PRODUCTION_TARGET,
  QUIRK_CATEGORY,
  quirkCategories,
  quirkEffectOn,
  quirkSummary,
} from '../src/sim/planets/quirk-model'
import type {
  ProductionTarget,
  QuirkCategory,
  QuirkCategoryCounts,
} from '../src/sim/planets/quirk-model'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = readFileSync(join(ROOT, 'src', 'sim', 'planets', 'quirk-model.ts'), 'utf8')

function bareEntry(overrides: Partial<PlanetCatalogueEntry> = {}): PlanetCatalogueEntry {
  return {
    name: 'Test World',
    hostname: 'Test Host',
    systemCount: 1,
    tier: 3,
    ...overrides,
  }
}

describe('quirkSummary — faithful projection of the locked QUIRK_TABLE', () => {
  it.each(QUIRK_TABLE)('projects the locked row for %s', (definition) => {
    const summary = quirkSummary(quirkById(definition.id))
    expect(summary.id).toBe(definition.id)
    expect(summary.name).toBe(definition.name)
    expect(summary.blurb).toBe(definition.blurb)
    expect(summary.structureModifier).toEqual({
      structure: definition.structureId,
      multiplier: definition.multiplier,
    })
  })

  it('every one of the 7 locked quirks exposes a non-null structureModifier', () => {
    for (const definition of QUIRK_TABLE) {
      expect(quirkSummary(quirkById(definition.id)).structureModifier).not.toBeNull()
    }
  })

  it('is deterministic and does not mutate its input quirk', () => {
    for (const definition of QUIRK_TABLE) {
      const quirk = quirkById(definition.id)
      const before = JSON.stringify(quirk)
      const first = quirkSummary(quirk)
      const second = quirkSummary(quirk)
      expect(second).toEqual(first)
      expect(JSON.stringify(quirk)).toBe(before)
    }
  })
})

describe('category mapping — deterministic and documented', () => {
  const CASES: ReadonlyArray<readonly [QuirkId, QuirkCategory]> = [
    ['highGravity', 'gravity'],
    ['coldStar', 'star'],
    ['hotStar', 'star'],
    ['denseCore', 'density'],
    ['gasGiant', 'density'],
    ['binarySystem', 'environment'],
    ['massiveWorld', 'mass'],
  ]

  it.each(CASES)('maps %s to category %s', (id, category) => {
    expect(quirkSummary(quirkById(id)).category).toBe(category)
  })

  it('no quirk in the locked table maps to atmosphere (reserved future extension)', () => {
    for (const definition of QUIRK_TABLE) {
      expect(quirkSummary(quirkById(definition.id)).category).not.toBe('atmosphere')
    }
  })

  it('the mapping is exhaustive over every locked QuirkId', () => {
    for (const definition of QUIRK_TABLE) {
      expect(quirkSummary(quirkById(definition.id)).category.length).toBeGreaterThan(0)
    }
  })
})

describe('productionModifier — mirrors the locked accrual composition EXACTLY', () => {
  it('binarySystem -> trade-hub-credits x1.1 (creditsPerSec income multiplier)', () => {
    const summary = quirkSummary(quirkById('binarySystem'))
    expect(summary.productionModifier).toEqual({
      target: 'trade-hub-credits',
      multiplier: 1.1,
    })
    expect(summary.productionModifier?.multiplier).toBe(quirkById('binarySystem').multiplier)
  })

  it('highGravity -> ore-mine-alloys x1.2 (alloysPerSec)', () => {
    const summary = quirkSummary(quirkById('highGravity'))
    expect(summary.productionModifier).toEqual({
      target: 'ore-mine-alloys',
      multiplier: 1.2,
    })
    expect(summary.productionModifier?.multiplier).toBe(quirkById('highGravity').multiplier)
  })

  it.each(['coldStar', 'hotStar', 'denseCore', 'gasGiant', 'massiveWorld'] as const)(
    '%s carries no production modifier (none)',
    (id) => {
      expect(quirkSummary(quirkById(id)).productionModifier).toBeNull()
    },
  )

  it('locked table multipliers are 1.1/1.2 so the model can never drift', () => {
    expect(QUIRK_TABLE.find((q) => q.id === 'binarySystem')?.multiplier).toBe(1.1)
    expect(QUIRK_TABLE.find((q) => q.id === 'highGravity')?.multiplier).toBe(1.2)
  })

  it('the summary target type is exactly the accrual production targets', () => {
    const targets = new Set<ProductionTarget>()
    for (const definition of QUIRK_TABLE) {
      const mod = quirkSummary(quirkById(definition.id)).productionModifier
      if (mod !== null) targets.add(mod.target)
    }
    expect(targets).toEqual(new Set(['trade-hub-credits', 'ore-mine-alloys']))
  })
})

describe('deterministicQuirks — seeded, deterministic generation', () => {
  it('same entry (fresh object each call) produces deep-equal quirks', () => {
    const entry = PLANETS[0]
    expect(deterministicQuirks({ ...entry })).toEqual(deterministicQuirks({ ...entry }))
  })

  it('includes every locked triggered quirk for every catalogue entry', () => {
    for (const entry of PLANETS) {
      const triggered = triggeredQuirks(entry)
      const result = deterministicQuirks(entry)
      for (const quirk of triggered) {
        expect(result).toContainEqual(quirk)
      }
    }
  })

  it('never emits a duplicate quirk id for any catalogue entry', () => {
    for (const entry of PLANETS) {
      const ids = deterministicQuirks(entry).map((q) => q.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('adds at most one seeded pick beyond the triggered set for every catalogue entry', () => {
    for (const entry of PLANETS) {
      const triggeredLength = triggeredQuirks(entry).length
      const resultLength = deterministicQuirks(entry).length
      expect(resultLength).toBeGreaterThanOrEqual(triggeredLength)
      expect(resultLength).toBeLessThanOrEqual(triggeredLength + 1)
    }
  })

  it('is fully deterministic across repeated calls for every catalogue entry', () => {
    for (const entry of PLANETS.slice(0, 1000)) {
      expect(deterministicQuirks(entry)).toEqual(deterministicQuirks(entry))
    }
  })

  it('entry with no triggers yields exactly one quirk drawn from the locked table', () => {
    const entry = bareEntry({ name: 'Zero Trigger World', starType: 'G2 V' })
    expect(triggeredQuirks(entry)).toEqual([])
    const result = deterministicQuirks(entry)
    expect(result.length).toBe(1)
    expect(QUIRK_TABLE.some((definition) => definition.id === result[0].id)).toBe(true)
  })

  it('seeded pick derives from fnv1a(`<name>|quirk`) modulo the non-triggered candidates', () => {
    const entry = bareEntry({ name: 'Golden Pick World', starType: 'G2 V' })
    const triggered = triggeredQuirks(entry)
    const candidates = QUIRK_TABLE.filter(
      (definition) => !triggered.some((q) => q.id === definition.id),
    )
    const seed = fnv1a(`${entry.name}|quirk`)
    const expected = candidates[seed % candidates.length].id
    expect(deterministicQuirks(entry).map((q) => q.id)).toEqual([expected])
  })

  it('max-trigger entry keeps every locked trigger and any pick comes only from the remaining ids', () => {
    const entry = bareEntry({
      name: 'Max Trigger World',
      radiusEarth: 1,
      massJup: 5,
      starType: 'M2 V',
      systemCount: 2,
      tier: 5,
    })
    const triggered = triggeredQuirks(entry)
    expect(triggered.map((q) => q.id).sort()).toEqual([
      'binarySystem',
      'coldStar',
      'denseCore',
      'highGravity',
      'massiveWorld',
    ])
    const result = deterministicQuirks(entry)
    expect(result.length).toBe(triggered.length + 1)
    for (const quirk of triggered) {
      expect(result).toContainEqual(quirk)
    }
    const extras = result.filter((q) => !triggered.some((t) => t.id === q.id))
    expect(extras.length).toBe(1)
    expect(['hotStar', 'gasGiant']).toContain(extras[0].id)
  })
})

describe('quirkEffectOn — combined structure multiplier product', () => {
  it('returns 1.0 for an empty quirk list', () => {
    expect(quirkEffectOn('oreMine', [])).toBe(1.0)
  })

  it('returns 1.0 when no quirk targets the given structure', () => {
    const quirks = [quirkById('binarySystem'), quirkById('massiveWorld')]
    expect(quirkEffectOn('housing', quirks)).toBe(1.0)
  })

  it('returns the single matching quirk multiplier', () => {
    expect(quirkEffectOn('oreMine', [quirkById('highGravity')])).toBe(1.2)
  })

  it('multiplies every quirk that targets the same structure', () => {
    const quirks = [quirkById('coldStar'), quirkById('hotStar')]
    expect(quirkEffectOn('hydroponics', quirks)).toBeCloseTo(0.9 * 1.1, 10)
  })

  it('ignores non-matching quirks when combining', () => {
    const quirks = [
      quirkById('binarySystem'),
      quirkById('highGravity'),
      quirkById('massiveWorld'),
    ]
    expect(quirkEffectOn('tradeHub', quirks)).toBeCloseTo(1.1, 10)
    expect(quirkEffectOn('oreMine', quirks)).toBeCloseTo(1.2, 10)
    expect(quirkEffectOn('defenseTurret', quirks)).toBeCloseTo(1.1, 10)
  })

  it('is commutative across quirk order', () => {
    const a = [quirkById('coldStar'), quirkById('hotStar')]
    const b = [quirkById('hotStar'), quirkById('coldStar')]
    expect(quirkEffectOn('hydroponics', a)).toBe(quirkEffectOn('hydroponics', b))
    expect(quirkEffectOn('hydroponics', a)).toBeCloseTo(0.9 * 1.1, 10)
  })
})

describe('quirkCategories — counts per category', () => {
  it('all zero for an empty quirk list', () => {
    const zero: QuirkCategoryCounts = {
      atmosphere: 0,
      gravity: 0,
      environment: 0,
      star: 0,
      density: 0,
      mass: 0,
    }
    expect(quirkCategories([])).toEqual(zero)
  })

  it('every locked quirk lands in exactly its mapped category', () => {
    const all = QUIRK_TABLE.map((definition) => quirkById(definition.id))
    expect(quirkCategories(all)).toEqual({
      atmosphere: 0,
      gravity: 1,
      environment: 1,
      star: 2,
      density: 2,
      mass: 1,
    })
  })

  it('a mixed list accumulates counts deterministically', () => {
    const quirks = [
      quirkById('highGravity'),
      quirkById('coldStar'),
      quirkById('binarySystem'),
      quirkById('highGravity'),
    ]
    expect(quirkCategories(quirks)).toEqual({
      atmosphere: 0,
      gravity: 2,
      environment: 1,
      star: 1,
      density: 0,
      mass: 0,
    })
  })

  it('is deterministic across repeated calls', () => {
    const all = QUIRK_TABLE.map((definition) => quirkById(definition.id))
    expect(quirkCategories(all)).toEqual(quirkCategories(all))
  })
})

describe('module purity — no nondeterministic API anywhere', () => {
  it('freezes both module-level lookup tables (Object.isFrozen)', () => {
    expect(Object.isFrozen(QUIRK_CATEGORY)).toBe(true)
    expect(Object.isFrozen(PRODUCTION_TARGET)).toBe(true)
  })

  it('rejects mutation of both lookup tables at runtime', () => {
    expect(() => {
      ;(QUIRK_CATEGORY as Record<QuirkId, QuirkCategory>).highGravity = 'star'
    }).toThrow(TypeError)
    expect(() => {
      ;(PRODUCTION_TARGET as Record<QuirkId, ProductionTarget | null>).binarySystem =
        'ore-mine-alloys'
    }).toThrow(TypeError)
  })

  it('both tables cover exactly the 7 locked QuirkIds and no others', () => {
    const lockedIds = QUIRK_TABLE.map((definition) => definition.id)
    expect(Object.keys(QUIRK_CATEGORY).sort()).toEqual([...lockedIds].sort())
    expect(Object.keys(PRODUCTION_TARGET).sort()).toEqual([...lockedIds].sort())
    expect(lockedIds).toHaveLength(7)
  })

  it('holds only primitive values, so the shallow freeze makes them fully immutable', () => {
    for (const id of Object.keys(QUIRK_CATEGORY) as QuirkId[]) {
      expect(typeof QUIRK_CATEGORY[id]).toBe('string')
    }
    for (const id of Object.keys(PRODUCTION_TARGET) as QuirkId[]) {
      const target = PRODUCTION_TARGET[id]
      expect(target === null || typeof target === 'string').toBe(true)
    }
  })

  it('quirkSummary projects the frozen tables directly (single source of truth)', () => {
    for (const definition of QUIRK_TABLE) {
      const summary = quirkSummary(quirkById(definition.id))
      expect(summary.category).toBe(QUIRK_CATEGORY[definition.id])
      expect(summary.productionModifier?.target ?? null).toBe(
        PRODUCTION_TARGET[definition.id],
      )
    }
  })

  it('every category value is a valid QuirkCategory and every target is null or a production target', () => {
    const categories = new Set<QuirkCategory>([
      'atmosphere',
      'gravity',
      'environment',
      'star',
      'density',
      'mass',
    ])
    for (const id of Object.keys(QUIRK_CATEGORY) as QuirkId[]) {
      expect(categories.has(QUIRK_CATEGORY[id]), `category for ${id}`).toBe(true)
    }
    const targets = new Set<ProductionTarget>([
      'trade-hub-credits',
      'ore-mine-alloys',
      'population',
      'none',
    ])
    for (const id of Object.keys(PRODUCTION_TARGET) as QuirkId[]) {
      const target = PRODUCTION_TARGET[id]
      expect(target === null || targets.has(target), `target for ${id}`).toBe(true)
    }
  })

  it('source contains no Math.random / Date.now / performance.now', () => {
    expect(SOURCE).not.toMatch(/Math\s*\.\s*random/)
    expect(SOURCE).not.toMatch(/Date\s*\.\s*now/)
    expect(SOURCE).not.toMatch(/performance\s*\.\s*now/)
  })

  it('source contains no rand parameter or other randomness hook', () => {
    expect(SOURCE).not.toMatch(/\brand\b/)
    expect(SOURCE).not.toMatch(/getRandomValues/)
  })
})
