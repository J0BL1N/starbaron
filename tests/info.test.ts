import { describe, expect, it } from 'vitest'
import { formatNumber } from '../src/sim/core/format'
import {
  BODY_FIELDS,
  DISPLAY_SCHEMAS,
  FIELD_DEFS,
  GALAXY_FIELDS,
  SYSTEM_FIELDS,
  assertInfoLevel,
  canViewLevel,
  contractFor,
  INFO_KINDS,
  INFO_LEVELS,
  projectInfo,
  summaryLine,
} from '../src/sim/ui/info'
import type {
  DisplaySchema,
  InfoField,
  InfoKind,
  InfoLevel,
  ObjectInfoContract,
  ProjectInfoInput,
} from '../src/sim/ui/info'

const GALAXY_KEYS = [
  'name',
  'id',
  'class',
  'radius',
  'systemCount',
  'ownedBodies',
  'allianceBodies',
  'foreignFleet',
]

const SYSTEM_KEYS = [
  'name',
  'id',
  'type',
  'bodyCount',
  'ownedBodies',
  'allianceHeld',
  'defensePower',
  'fleetStrength',
]

const BODY_KEYS = [
  'name',
  'id',
  'type',
  'class',
  'radius',
  'population',
  'structures',
  'income',
  'allianceHeld',
  'garrison',
  'defensePower',
  'fleetStrength',
  'estimatedOdds',
]

function keys(fields: InfoField[]): string[] {
  return fields.map((field) => field.key)
}

function levelOf(contract: ObjectInfoContract): Readonly<Record<string, InfoLevel>> {
  const out: Record<string, InfoLevel> = {}
  for (const field of contract.fields) {
    out[field.key] = field.level
  }
  return out
}

function bodyValues(): Map<string, string | number | null> {
  return new Map<string, string | number | null>([
    ['name', 'Alpha World'],
    ['id', 'body:slug|alpha|planet|1'],
    ['type', 'planet'],
    ['class', 'Tier 2'],
    ['radius', 2_500_000],
    ['population', 1_200_000],
    ['structures', 7],
    ['income', 2_500],
    ['allianceHeld', 'yes'],
    ['garrison', 5_000],
    ['defensePower', 10_000],
    ['fleetStrength', 300],
    ['estimatedOdds', '2.0:1'],
  ])
}

function project(input: {
  contract?: ObjectInfoContract
  values?: ReadonlyMap<string, string | number | null>
  viewerLevel?: InfoLevel
  staleness?: ReadonlyMap<string, boolean>
}): InfoField[] {
  const full: ProjectInfoInput = {
    contract: input.contract ?? contractFor('body', 'planet'),
    values: input.values ?? bodyValues(),
    viewerLevel: input.viewerLevel ?? 'intel',
    staleness: input.staleness ?? new Map(),
  }
  return projectInfo(full)
}

describe('P4-T03 contractFor — galaxy', () => {
  it('exposes exactly the galaxy field keys in contract order', () => {
    expect(keys(contractFor('galaxy').fields)).toEqual(GALAXY_KEYS)
  })

  it('assigns public levels to spatial/identity fields and gates the rest', () => {
    const levels = levelOf(contractFor('galaxy'))
    for (const key of ['name', 'id', 'class', 'radius', 'systemCount']) {
      expect(levels[key]).toBe('public')
    }
    expect(levels.ownedBodies).toBe('owner')
    expect(levels.allianceBodies).toBe('alliance')
    expect(levels.foreignFleet).toBe('intel')
  })
})

describe('P4-T03 contractFor — system', () => {
  it('exposes exactly the system field keys in contract order', () => {
    expect(keys(contractFor('system').fields)).toEqual(SYSTEM_KEYS)
  })

  it('assigns public levels to identity/type/count fields and gates the rest', () => {
    const levels = levelOf(contractFor('system'))
    for (const key of ['name', 'id', 'type', 'bodyCount']) {
      expect(levels[key]).toBe('public')
    }
    expect(levels.ownedBodies).toBe('owner')
    expect(levels.allianceHeld).toBe('alliance')
    expect(levels.defensePower).toBe('intel')
    expect(levels.fleetStrength).toBe('intel')
  })
})

describe('P4-T03 contractFor — body', () => {
  it('exposes exactly the body field keys in contract order', () => {
    expect(keys(contractFor('body', 'planet').fields)).toEqual(BODY_KEYS)
  })

  it('assigns public/owner/alliance/intel levels per the roadmap tiers', () => {
    const levels = levelOf(contractFor('body', 'planet'))
    for (const key of ['name', 'id', 'type', 'class', 'radius']) {
      expect(levels[key]).toBe('public')
    }
    for (const key of ['population', 'structures', 'income']) {
      expect(levels[key]).toBe('owner')
    }
    expect(levels.allianceHeld).toBe('alliance')
    for (const key of ['garrison', 'defensePower', 'fleetStrength', 'estimatedOdds']) {
      expect(levels[key]).toBe('intel')
    }
  })
})

describe('P4-T03 contractFor — invariants', () => {
  it('every contract has unique field keys', () => {
    for (const kind of INFO_KINDS) {
      const contract = contractFor(kind)
      const fieldKeys = keys(contract.fields)
      expect(new Set(fieldKeys).size).toBe(fieldKeys.length)
    }
  })

  it('every display schema references real, distinct keys for its kind', () => {
    const expected: Readonly<Record<InfoKind, DisplaySchema>> = {
      galaxy: { titleKey: 'name', subtitleKey: 'class', primaryStatKey: 'systemCount' },
      system: { titleKey: 'name', subtitleKey: 'type', primaryStatKey: 'bodyCount' },
      body: { titleKey: 'name', subtitleKey: 'type', primaryStatKey: 'population' },
    }
    for (const kind of INFO_KINDS) {
      const contract = contractFor(kind)
      const fieldKeys = keys(contract.fields)
      const schema = contract.displaySchema
      for (const key of [schema.titleKey, schema.subtitleKey, schema.primaryStatKey]) {
        expect(fieldKeys).toContain(key)
      }
      expect(new Set([schema.titleKey, schema.subtitleKey, schema.primaryStatKey]).size).toBe(3)
      expect(schema).toEqual(expected[kind])
    }
  })

  it('intel fields carry the base state estimated; other levels verified', () => {
    const contract = contractFor('body', 'planet')
    const byKey = new Map(contract.fields.map((field) => [field.key, field.state]))
    for (const key of ['garrison', 'defensePower', 'fleetStrength', 'estimatedOdds']) {
      expect(byKey.get(key)).toBe('estimated')
    }
    for (const key of ['name', 'id', 'radius', 'population', 'income', 'allianceHeld']) {
      expect(byKey.get(key)).toBe('verified')
    }
  })

  it('is deterministic and returns fresh objects (no shared mutable state)', () => {
    const first = contractFor('body', 'planet')
    expect(contractFor('body', 'planet')).toEqual(first)
    first.fields[0].label = 'MUTATED'
    expect(contractFor('body', 'planet').fields[0].label).toBe('Name')
  })
})

describe('P4-T03 contractFor — validation', () => {
  it('throws RangeError on an invalid kind', () => {
    for (const bad of ['planet', 'star', 'universe', '', 'galaxy2']) {
      expect(() => contractFor(bad as InfoKind)).toThrow(RangeError)
    }
  })

  it('throws when a galaxy contract is given a type discriminator', () => {
    expect(() => contractFor('galaxy', 'spiral')).toThrow(RangeError)
  })

  it('carries a trimmed type for system and body contracts', () => {
    expect(contractFor('system', '  G2 V ').type).toBe('G2 V')
    expect(contractFor('body', 'planet').type).toBe('planet')
    expect(contractFor('system').type).toBeUndefined()
    expect(contractFor('body').type).toBeUndefined()
    expect(contractFor('galaxy').type).toBeUndefined()
  })

  it('throws on a blank type for a system contract', () => {
    expect(() => contractFor('system', '   ')).toThrow(RangeError)
  })

  it('accepts any non-empty string as a body type (no whitelist)', () => {
    expect(contractFor('body', 'banana').type).toBe('banana')
    expect(contractFor('body', 'planet').type).toBe('planet')
  })

  it('throws on a blank body type', () => {
    expect(() => contractFor('body', '')).toThrow(RangeError)
    expect(() => contractFor('body', '   ')).toThrow(RangeError)
  })
})

describe('P4-T03 projectInfo — viewer levels', () => {
  it('a public viewer sees only public fields', () => {
    expect(keys(project({ viewerLevel: 'public' }))).toEqual([
      'name',
      'id',
      'type',
      'class',
      'radius',
    ])
  })

  it('an owner viewer sees public + owner fields', () => {
    expect(keys(project({ viewerLevel: 'owner' }))).toEqual([
      'name',
      'id',
      'type',
      'class',
      'radius',
      'population',
      'structures',
      'income',
    ])
  })

  it('an alliance viewer sees public + owner + alliance fields', () => {
    expect(keys(project({ viewerLevel: 'alliance' }))).toEqual([
      'name',
      'id',
      'type',
      'class',
      'radius',
      'population',
      'structures',
      'income',
      'allianceHeld',
    ])
  })

  it('an intel viewer sees every contract field', () => {
    expect(keys(project({ viewerLevel: 'intel' }))).toEqual(BODY_KEYS)
  })

  it('hidden fields never appear, even as placeholders', () => {
    const visible = keys(project({ viewerLevel: 'public' }))
    expect(visible).not.toContain('population')
    expect(visible).not.toContain('garrison')
    expect(visible).not.toContain('estimatedOdds')
    expect(visible).not.toContain('allianceHeld')
    for (const field of project({ viewerLevel: 'owner' })) {
      expect(INFO_LEVELS.indexOf(field.level)).toBeLessThanOrEqual(
        INFO_LEVELS.indexOf('owner'),
      )
    }
  })

  it('preserves the contract field order in the projection', () => {
    expect(keys(project({ viewerLevel: 'intel' }))).toEqual(BODY_KEYS)
    expect(keys(project({ viewerLevel: 'public' }))).toEqual(
      BODY_KEYS.filter((key) =>
        contractFor('body', 'planet').fields.some(
          (field) => field.key === key && field.level === 'public',
        ),
      ),
    )
  })
})

describe('P4-T03 projectInfo — states', () => {
  it('flags stale keys as stale and leaves the rest at their base state', () => {
    const staleness = new Map([
      ['population', true],
      ['garrison', true],
    ])
    const fields = project({ staleness, viewerLevel: 'intel' })
    const byKey = new Map(fields.map((field) => [field.key, field.state]))
    expect(byKey.get('population')).toBe('stale')
    expect(byKey.get('garrison')).toBe('stale')
    expect(byKey.get('name')).toBe('verified')
    expect(byKey.get('radius')).toBe('verified')
    expect(byKey.get('defensePower')).toBe('estimated')
  })

  it('projects a present intel field with state estimated (base qualifier retained)', () => {
    const fields = project({ viewerLevel: 'intel' })
    const byKey = new Map(fields.map((field) => [field.key, field.state]))
    expect(byKey.get('defensePower')).toBe('estimated')
    expect(byKey.get('fleetStrength')).toBe('estimated')
    expect(byKey.get('garrison')).toBe('estimated')
    expect(byKey.get('estimatedOdds')).toBe('estimated')
    expect(fields.find((field) => field.key === 'defensePower')!.value).toBe('10K')
  })

  it('a stale estimated field stays stale (staleness beats the base qualifier)', () => {
    const staleness = new Map([['garrison', true]])
    const fields = project({ staleness, viewerLevel: 'intel' })
    const garrison = fields.find((field) => field.key === 'garrison')!
    expect(garrison.state).toBe('stale')
  })

  it('marks missing and explicit-null values as unknown with value null', () => {
    const missing = new Map(bodyValues())
    missing.delete('income')
    const missingField = project({ values: missing }).find(
      (field) => field.key === 'income',
    )!
    expect(missingField.value).toBeNull()
    expect(missingField.state).toBe('unknown')

    const explicitNull = new Map(bodyValues())
    explicitNull.set('structures', null)
    const nullField = project({ values: explicitNull }).find(
      (field) => field.key === 'structures',
    )!
    expect(nullField.value).toBeNull()
    expect(nullField.state).toBe('unknown')
  })

  it('unknown wins over a stale flag when the value is absent', () => {
    const values = new Map(bodyValues())
    values.set('income', null)
    const staleness = new Map([['income', true]])
    const fields = project({ values, staleness })
    const income = fields.find((field) => field.key === 'income')!
    expect(income.state).toBe('unknown')
    expect(income.value).toBeNull()
  })
})

describe('P4-T03 projectInfo — values and formatting', () => {
  it('formats number fields with formatNumber, passes strings, strings text-field numbers', () => {
    const fields = project({ viewerLevel: 'intel' })
    const radius = fields.find((field) => field.key === 'radius')!
    expect(radius.value).toBe(formatNumber(2_500_000))
    expect(radius.value).toBe('2.5M')
    const population = fields.find((field) => field.key === 'population')!
    expect(population.value).toBe('1.2M')
    const garrison = fields.find((field) => field.key === 'garrison')!
    expect(garrison.value).toBe('5K')

    const mixed = new Map(bodyValues())
    mixed.set('radius', '12.4K')
    mixed.set('estimatedOdds', 1.5)
    const mixedFields = project({ values: mixed, viewerLevel: 'intel' })
    expect(mixedFields.find((field) => field.key === 'radius')!.value).toBe('12.4K')
    expect(mixedFields.find((field) => field.key === 'estimatedOdds')!.value).toBe('1.5')
  })

  it('is deterministic and never mutates its inputs', () => {
    const values = bodyValues()
    const staleness = new Map([['population', true]])
    const contract = contractFor('body', 'planet')
    const input: ProjectInfoInput = {
      contract,
      values,
      viewerLevel: 'intel',
      staleness,
    }
    const first = projectInfo(input)
    const second = projectInfo(input)
    expect(second).toEqual(first)
    first[0]!.label = 'MUTATED'
    expect(projectInfo(input)[0].label).toBe('Name')
    expect(values.get('population')).toBe(1_200_000)
    expect(values.get('radius')).toBe(2_500_000)
    expect(staleness.get('population')).toBe(true)
    expect(contract.fields.length).toBe(BODY_KEYS.length)
  })

  it('throws RangeError on an invalid viewerLevel', () => {
    for (const bad of ['guest', 'admin', '', 'INTEL']) {
      expect(() => project({ viewerLevel: bad as InfoLevel })).toThrow(RangeError)
    }
  })
})

describe('P4-T03 summaryLine', () => {
  it('joins the title and the primary stat of a visible body field set', () => {
    expect(summaryLine(project({ viewerLevel: 'intel' }))).toBe(
      'Alpha World · 1.2M',
    )
  })

  it('omits a hidden primary stat (public viewer sees title only)', () => {
    expect(summaryLine(project({ viewerLevel: 'public' }))).toBe('Alpha World')
  })

  it('summarises galaxy and system projections by their primary stat', () => {
    const galaxy = projectInfo({
      contract: contractFor('galaxy'),
      values: new Map<string, string | number | null>([
        ['name', 'Aurelia'],
        ['systemCount', 12],
      ]),
      viewerLevel: 'intel',
      staleness: new Map(),
    })
    expect(summaryLine(galaxy)).toBe('Aurelia · 12')

    const system = projectInfo({
      contract: contractFor('system'),
      values: new Map<string, string | number | null>([
        ['name', 'Alpha'],
        ['bodyCount', 3],
      ]),
      viewerLevel: 'intel',
      staleness: new Map(),
    })
    expect(summaryLine(system)).toBe('Alpha · 3')
  })

  it('omits the primary stat when its value is unknown', () => {
    const values = bodyValues()
    values.delete('population')
    expect(summaryLine(project({ values }))).toBe('Alpha World')
  })

  it('is deterministic and empty for an empty field list', () => {
    expect(summaryLine([])).toBe('')
    expect(summaryLine(project({ viewerLevel: 'intel' }))).toBe(
      summaryLine(project({ viewerLevel: 'intel' })),
    )
  })
})

describe('P4-T03 module purity — deep-frozen tables', () => {
  function isDeepFrozen(value: unknown): boolean {
    if (value === null || typeof value !== 'object') {
      return true
    }
    if (!Object.isFrozen(value)) {
      return false
    }
    if (Array.isArray(value)) {
      return value.every(isDeepFrozen)
    }
    return Object.values(value).every(isDeepFrozen)
  }

  it.each([
    ['GALAXY_FIELDS', GALAXY_FIELDS],
    ['SYSTEM_FIELDS', SYSTEM_FIELDS],
    ['BODY_FIELDS', BODY_FIELDS],
    ['FIELD_DEFS', FIELD_DEFS],
    ['DISPLAY_SCHEMAS', DISPLAY_SCHEMAS],
  ])('deep-freezes the %s table (every element and the container)', (_, table) => {
    expect(isDeepFrozen(table)).toBe(true)
  })

  it('contractFor still returns fresh clones from the frozen tables', () => {
    const contract = contractFor('body', 'planet')
    contract.fields[0]!.label = 'MUTATED'
    expect(contractFor('body', 'planet').fields[0]!.label).toBe('Name')
  })
})

describe('P4-T03 gating helpers — canViewLevel / assertInfoLevel', () => {
  it('canViewLevel follows the cumulative rank contract', () => {
    expect(canViewLevel('public', 'public')).toBe(true)
    expect(canViewLevel('public', 'owner')).toBe(false)
    expect(canViewLevel('owner', 'owner')).toBe(true)
    expect(canViewLevel('alliance', 'owner')).toBe(true)
    expect(canViewLevel('intel', 'intel')).toBe(true)
    expect(canViewLevel('intel', 'owner')).toBe(true)
  })

  it('assertInfoLevel passes the four levels and throws for anything else', () => {
    for (const level of INFO_LEVELS) {
      expect(() => assertInfoLevel(level)).not.toThrow()
    }
    for (const bad of ['guest', '', 'OWNER', 7, null, undefined]) {
      expect(() => assertInfoLevel(bad)).toThrow(RangeError)
    }
  })
})
