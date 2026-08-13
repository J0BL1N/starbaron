import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REPORT_SOURCE,
  REVEAL_MATRIX,
  SCANNED_SUMMARY_KEYS,
  buildIntelReport,
  revealKeysFor,
  reportInvariants,
  reportsForTarget,
} from '../src/sim/intel/reports'
import { fnv1a } from '../src/sim/planets/hash'
import { INTEL_LEVELS } from '../src/sim/intel/levels'
import { contractFor } from '../src/sim/ui/info'
import type { IntelReport } from '../src/sim/intel/reports'
import type { BuildIntelReportInput } from '../src/sim/intel/reports'
import type { InfoField, InfoKind } from '../src/sim/ui/info'
import type { IntelLevel } from '../src/sim/intel/levels'

const OBSERVER = 'jay'
const TARGET_ID = 'body:slug|alpha|planet|1'
const AT = 150_000

function reportId(observerId: string, targetId: string, observedAt: number): string {
  return fnv1a(`${observerId}|${targetId}|${observedAt}`).toString(16)
}

function keys(fields: InfoField[]): string[] {
  return fields.map((field) => field.key)
}

function field(key: string, value: string): InfoField {
  return { key, label: key, value, level: 'public', state: 'verified' }
}

function bodyValues(): Map<string, string | number | null> {
  return new Map<string, string | number | null>([
    ['name', 'Alpha World'],
    ['id', TARGET_ID],
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

function systemValues(): Map<string, string | number | null> {
  return new Map<string, string | number | null>([
    ['name', 'Alpha'],
    ['id', 'sys|alpha|1'],
    ['type', 'G-class'],
    ['bodyCount', 4],
    ['ownedBodies', 2],
    ['allianceHeld', 'no'],
    ['defensePower', 8_000],
    ['fleetStrength', 120],
  ])
}

function galaxyValues(): Map<string, string | number | null> {
  return new Map<string, string | number | null>([
    ['name', 'Milky Way'],
    ['id', 'gal|1'],
    ['class', 'Spiral'],
    ['radius', 50_000],
    ['systemCount', 42],
    ['ownedBodies', 5],
    ['allianceBodies', 9],
    ['foreignFleet', 3],
  ])
}

function buildInput(overrides: Partial<BuildIntelReportInput> = {}): BuildIntelReportInput {
  return {
    observerId: OBSERVER,
    targetRef: { kind: 'body', id: TARGET_ID },
    targetName: 'Alpha World',
    intelLevel: 'full intelligence',
    observedAt: AT,
    fields: bodyValues(),
    ...overrides,
  }
}

function valuesFor(kind: InfoKind): Map<string, string | number | null> {
  if (kind === 'galaxy') return galaxyValues()
  if (kind === 'system') return systemValues()
  return bodyValues()
}

function buildFor(
  kind: InfoKind,
  level: IntelLevel,
  overrides: Partial<BuildIntelReportInput> = {},
): IntelReport {
  return buildIntelReport({
    ...buildInput(),
    targetRef: { kind, id: `${kind}:t1` },
    intelLevel: level,
    fields: valuesFor(kind),
    ...overrides,
  })
}

function report(overrides: Partial<IntelReport> = {}): IntelReport {
  return {
    id: reportId(OBSERVER, TARGET_ID, AT),
    observerId: OBSERVER,
    targetRef: { kind: 'body', id: TARGET_ID },
    targetName: 'Alpha World',
    intelLevel: 'full intelligence',
    observedAt: AT,
    revealedFields: [],
    source: DEFAULT_REPORT_SOURCE,
    ...overrides,
  }
}

const T1 = 'body:alpha'
const T2 = 'body:beta'

function reportAt(observerId: string, targetId: string, observedAt: number): IntelReport {
  return {
    id: reportId(observerId, targetId, observedAt),
    observerId,
    targetRef: { kind: 'body', id: targetId },
    targetName: 'World',
    intelLevel: 'scouted',
    observedAt,
    revealedFields: [],
    source: DEFAULT_REPORT_SOURCE,
  }
}

const REVEAL_SETS: Readonly<Record<InfoKind, Readonly<Record<IntelLevel, readonly string[]>>>> = {
  galaxy: {
    none: [],
    observed: ['name', 'id', 'class', 'radius', 'systemCount'],
    scanned: ['name', 'id', 'class', 'radius', 'systemCount'],
    scouted: ['name', 'id', 'class', 'radius', 'systemCount', 'foreignFleet'],
    'deep recon': ['name', 'id', 'class', 'radius', 'systemCount', 'foreignFleet'],
    'full intelligence': [
      'name',
      'id',
      'class',
      'radius',
      'systemCount',
      'ownedBodies',
      'allianceBodies',
      'foreignFleet',
    ],
  },
  system: {
    none: [],
    observed: ['name', 'id', 'type', 'bodyCount'],
    scanned: ['name', 'id', 'type', 'bodyCount', 'defensePower'],
    scouted: ['name', 'id', 'type', 'bodyCount', 'defensePower', 'fleetStrength'],
    'deep recon': ['name', 'id', 'type', 'bodyCount', 'defensePower', 'fleetStrength'],
    'full intelligence': [
      'name',
      'id',
      'type',
      'bodyCount',
      'ownedBodies',
      'allianceHeld',
      'defensePower',
      'fleetStrength',
    ],
  },
  body: {
    none: [],
    observed: ['name', 'id', 'type', 'class', 'radius'],
    scanned: ['name', 'id', 'type', 'class', 'radius', 'garrison', 'defensePower'],
    scouted: [
      'name',
      'id',
      'type',
      'class',
      'radius',
      'garrison',
      'defensePower',
      'fleetStrength',
      'estimatedOdds',
    ],
    'deep recon': [
      'name',
      'id',
      'type',
      'class',
      'radius',
      'garrison',
      'defensePower',
      'fleetStrength',
      'estimatedOdds',
    ],
    'full intelligence': [
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
    ],
  },
}

describe('P6-T05 REVEAL_MATRIX — the per-kind field-key reveal policy', () => {
  it('defines the exact revealed field keys per ladder rung for every kind', () => {
    for (const kind of ['galaxy', 'system', 'body'] as const) {
      for (const level of INTEL_LEVELS) {
        if (level === 'none') {
          continue
        }
        expect([...REVEAL_MATRIX[kind][level]]).toEqual([
          ...REVEAL_SETS[kind][level],
        ])
      }
    }
  })

  it('covers exactly the ladder rungs above none for every kind and is deep-frozen', () => {
    const rungs = INTEL_LEVELS.filter(
      (level): level is Exclude<IntelLevel, 'none'> => level !== 'none',
    )
    for (const kind of ['galaxy', 'system', 'body'] as const) {
      expect(Object.keys(REVEAL_MATRIX[kind]).sort()).toEqual([...rungs].sort())
      expect(Object.isFrozen(REVEAL_MATRIX[kind])).toBe(true)
    }
    expect(Object.isFrozen(REVEAL_MATRIX)).toBe(true)
  })

  it('is monotonic non-decreasing: a deeper rung never hides a field an earlier rung revealed', () => {
    const rungs: Exclude<IntelLevel, 'none'>[] = [
      'observed',
      'scanned',
      'scouted',
      'deep recon',
      'full intelligence',
    ]
    for (const kind of ['galaxy', 'system', 'body'] as const) {
      for (let i = 1; i < rungs.length; i++) {
        const earlier = REVEAL_MATRIX[kind][rungs[i - 1]]
        const deeper = REVEAL_MATRIX[kind][rungs[i]]
        for (const key of earlier) {
          expect(deeper).toContain(key)
        }
      }
    }
  })

  it('stranger-visible rungs draw ONLY on the public + intel field sets — never an alliance-tier key', () => {
    for (const kind of ['galaxy', 'system', 'body'] as const) {
      for (const level of ['observed', 'scanned', 'scouted', 'deep recon'] as const) {
        const allianceKeys = contractFor(kind)
          .fields.filter((f) => f.level === 'alliance')
          .map((f) => f.key)
        for (const key of REVEAL_MATRIX[kind][level]) {
          expect(allianceKeys).not.toContain(key)
        }
        const ownerKeys = contractFor(kind)
          .fields.filter((f) => f.level === 'owner')
          .map((f) => f.key)
        for (const key of REVEAL_MATRIX[kind][level]) {
          expect(ownerKeys).not.toContain(key)
        }
      }
    }
  })

  it('scanned reveals exactly the public keys plus SCANNED_SUMMARY_KEYS from the intel tier', () => {
    for (const kind of ['galaxy', 'system', 'body'] as const) {
      const contract = contractFor(kind)
      const publicKeys = contract.fields
        .filter((f) => f.level === 'public')
        .map((f) => f.key)
      const intelKeys = contract.fields
        .filter((f) => f.level === 'intel')
        .map((f) => f.key)
      const expected = [
        ...publicKeys,
        ...intelKeys.filter((key) => SCANNED_SUMMARY_KEYS.includes(key)),
      ]
      expect([...REVEAL_MATRIX[kind].scanned]).toEqual(expected)
    }
    expect(SCANNED_SUMMARY_KEYS).toEqual(['garrison', 'defensePower'])
  })

  it('revealKeysFor matches the materialised table for every kind and rung', () => {
    for (const kind of ['galaxy', 'system', 'body'] as const) {
      const contract = contractFor(kind)
      for (const level of INTEL_LEVELS) {
        if (level === 'none') {
          continue
        }
        expect([...revealKeysFor(contract.fields, level)]).toEqual([
          ...REVEAL_MATRIX[kind][level],
        ])
      }
    }
  })
})

describe('P6-T05 reveal sets — the documented field list per rung', () => {
  it('reveals exactly the documented field set per ladder rung for every kind', () => {
    for (const kind of ['galaxy', 'system', 'body'] as const) {
      for (const level of INTEL_LEVELS) {
        expect(keys(buildFor(kind, level).revealedFields)).toEqual([
          ...REVEAL_SETS[kind][level],
        ])
      }
    }
  })

  it('hand-check: observed reveals only the public contract fields, full intelligence reveals every contract field', () => {
    for (const kind of ['galaxy', 'system', 'body'] as const) {
      const contract = contractFor(kind)
      const contractFields = contract.fields.map((f) => f.key)
      const publicKeys = contract.fields
        .filter((f) => f.level === 'public')
        .map((f) => f.key)
      const observedKeys = keys(buildFor(kind, 'observed').revealedFields)
      const fullKeys = keys(buildFor(kind, 'full intelligence').revealedFields)
      expect(observedKeys).toEqual(publicKeys)
      expect(fullKeys).toEqual(contractFields)
      expect(observedKeys.length).toBeLessThan(fullKeys.length)
    }
  })

  it("a 'none' report reveals no fields", () => {
    expect(buildFor('body', 'none').revealedFields).toEqual([])
  })

  it('deep recon reveals the same field set as scouted (one scouting tier in the info contract)', () => {
    for (const kind of ['galaxy', 'system', 'body'] as const) {
      expect(keys(buildFor(kind, 'deep recon').revealedFields)).toEqual(
        keys(buildFor(kind, 'scouted').revealedFields),
      )
    }
  })
})

describe('P6-T05 buildIntelReport — field projection', () => {
  it('revealed fields carry the values from the fields map, formatted per the contract', () => {
    const r = buildFor('body', 'full intelligence')
    const byKey = new Map(r.revealedFields.map((f) => [f.key, f]))
    expect(byKey.get('name')?.value).toBe('Alpha World')
    expect(byKey.get('class')?.value).toBe('Tier 2')
    expect(byKey.get('population')?.value).toBe('1.2M')
    expect(byKey.get('structures')?.value).toBe('7')
    expect(byKey.get('estimatedOdds')?.value).toBe('2.0:1')
  })

  it('a public-only report excludes owner and intel fields entirely', () => {
    const r = buildFor('body', 'observed')
    expect(keys(r.revealedFields)).toEqual(['name', 'id', 'type', 'class', 'radius'])
    expect(r.revealedFields.some((f) => f.key === 'population')).toBe(false)
    expect(r.revealedFields.some((f) => f.key === 'garrison')).toBe(false)
  })

  it('number fields pass through the locked formatNumber', () => {
    const r = buildFor('body', 'full intelligence')
    const radius = r.revealedFields.find((f) => f.key === 'radius')
    expect(radius?.value).toBe('2.5M')
  })

  it('a missing or null value projects to state unknown with value null', () => {
    const fields = bodyValues()
    fields.set('population', null)
    fields.delete('income')
    const r = buildIntelReport(buildInput({ fields }))
    const population = r.revealedFields.find((f) => f.key === 'population')
    const income = r.revealedFields.find((f) => f.key === 'income')
    expect(population?.state).toBe('unknown')
    expect(population?.value).toBeNull()
    expect(income?.state).toBe('unknown')
    expect(income?.value).toBeNull()
  })

  it('a stale key projects to state stale while keeping its value', () => {
    const r = buildIntelReport(
      buildInput({
        staleness: new Map<string, boolean>([['population', true]]),
      }),
    )
    const population = r.revealedFields.find((f) => f.key === 'population')
    expect(population?.state).toBe('stale')
    expect(population?.value).toBe('1.2M')
  })

  it('an intel-tier estimate keeps its estimated base state when fresh', () => {
    const r = buildFor('body', 'full intelligence')
    const odds = r.revealedFields.find((f) => f.key === 'estimatedOdds')
    expect(odds?.state).toBe('estimated')
    expect(odds?.value).toBe('2.0:1')
  })

  it('preserves the contract field order and defaults the source when omitted', () => {
    expect(keys(buildFor('system', 'full intelligence').revealedFields)).toEqual(
      keys(contractFor('system').fields),
    )
    expect(buildIntelReport(buildInput()).source).toBe(DEFAULT_REPORT_SOURCE)
    expect(buildIntelReport(buildInput({ source: 'mission-7' })).source).toBe(
      'mission-7',
    )
  })
})

describe('P6-T05 buildIntelReport — identity (dedup hook)', () => {
  it('the id is the fnv1a formula over observer|targetId|observedAt', () => {
    const r = buildIntelReport(buildInput())
    expect(r.id).toBe(reportId(OBSERVER, TARGET_ID, AT))
  })

  it('identical inputs yield identical ids and deep-equal reports', () => {
    const a = buildIntelReport(buildInput())
    const b = buildIntelReport(buildInput())
    expect(a.id).toBe(b.id)
    expect(a).toEqual(b)
    expect(reportInvariants(a)).toEqual(reportInvariants(b))
  })

  it('the id varies across observer, target and timestamp', () => {
    const ids = new Set([
      buildIntelReport(buildInput()).id,
      buildIntelReport(buildInput({ observerId: 'kim' })).id,
      buildIntelReport(
        buildInput({ targetRef: { kind: 'body', id: 'body|beta|planet|2' } }),
      ).id,
      buildIntelReport(buildInput({ observedAt: 200_000 })).id,
    ])
    expect(ids.size).toBe(4)
  })
})

describe('P6-T05 buildIntelReport — validation', () => {
  it('rejects a blank observerId, targetRef.id, targetName or source', () => {
    expect(() => buildIntelReport(buildInput({ observerId: '   ' }))).toThrow(RangeError)
    expect(() =>
      buildIntelReport(buildInput({ targetRef: { kind: 'body', id: '' } })),
    ).toThrow(RangeError)
    expect(() => buildIntelReport(buildInput({ targetName: '  ' }))).toThrow(RangeError)
    expect(() => buildIntelReport(buildInput({ source: '  ' }))).toThrow(RangeError)
  })

  it('rejects an unknown target kind', () => {
    expect(() =>
      buildIntelReport(
        buildInput({ targetRef: { kind: 'planet' as InfoKind, id: 'x' } }),
      ),
    ).toThrow(RangeError)
  })

  it('rejects an invalid intel level and a non-positive or non-finite observedAt', () => {
    expect(() =>
      buildIntelReport(buildInput({ intelLevel: 'bogus' as IntelLevel })),
    ).toThrow(RangeError)
    for (const observedAt of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => buildIntelReport(buildInput({ observedAt }))).toThrow(RangeError)
    }
  })
})

describe('P6-T05 buildIntelReport — immutability', () => {
  it('never mutates the input and copies the targetRef', () => {
    const fields = bodyValues()
    const staleness = new Map<string, boolean>([['population', true]])
    const targetRef = { kind: 'body' as const, id: TARGET_ID }
    const beforeFields = JSON.stringify([...fields])
    const beforeStale = JSON.stringify([...staleness])
    const r = buildIntelReport({ ...buildInput({ fields, staleness, targetRef }) })
    expect(r.targetRef).not.toBe(targetRef)
    expect(r.targetRef).toEqual(targetRef)
    expect(JSON.stringify([...fields])).toBe(beforeFields)
    expect(JSON.stringify([...staleness])).toBe(beforeStale)
  })
})

describe('P6-T05 reportInvariants — accepted reports', () => {
  it('passes reports built across every kind and level', () => {
    for (const kind of ['galaxy', 'system', 'body'] as const) {
      for (const level of INTEL_LEVELS) {
        const result = reportInvariants(buildFor(kind, level))
        expect(result.ok).toBe(true)
        expect(result.problems).toEqual([])
      }
    }
  })

  it('passes a built report carrying staleness and an explicit source', () => {
    const r = buildIntelReport(
      buildInput({
        source: 'mission-7',
        staleness: new Map<string, boolean>([['population', true]]),
      }),
    )
    expect(reportInvariants(r).ok).toBe(true)
  })
})

describe('P6-T05 reportInvariants — tamper classes', () => {
  it('flags a mismatched id', () => {
    const result = reportInvariants(report({ id: reportId(OBSERVER, TARGET_ID, 1) }))
    expect(result.ok).toBe(false)
    expect(result.problems[0]).toMatch(/does not match the deterministic formula/)
  })

  it('flags a blank observerId', () => {
    const result = reportInvariants(report({ observerId: '   ' }))
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('observerId must be a non-empty string')
  })

  it('flags a blank targetRef.id, targetName and source', () => {
    expect(
      reportInvariants(report({ targetRef: { kind: 'body', id: '' } })).problems,
    ).toContain('targetRef.id must be a non-empty string')
    expect(reportInvariants(report({ targetName: '' })).problems).toContain(
      'targetName must be a non-empty string',
    )
    expect(reportInvariants(report({ source: '   ' })).problems).toContain(
      'source must be a non-empty string',
    )
  })

  it('flags an unknown target kind', () => {
    const result = reportInvariants(
      report({ targetRef: { kind: 'planet' as InfoKind, id: TARGET_ID } }),
    )
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('targetRef.kind'))).toBe(true)
  })

  it('flags an invalid intel level', () => {
    const result = reportInvariants(report({ intelLevel: 'bogus' as IntelLevel }))
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('intelLevel'))).toBe(true)
  })

  it('flags a non-positive or non-finite observedAt', () => {
    for (const observedAt of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = reportInvariants(report({ observedAt }))
      expect(result.ok).toBe(false)
      expect(result.problems).toContain('observedAt must be a positive finite number')
    }
  })

  it('flags a duplicate revealed field key and a key outside the contract', () => {
    const dup = report({
      revealedFields: [field('name', 'Alpha'), field('name', 'Beta')],
    })
    expect(reportInvariants(dup).problems).toContain(
      'duplicate revealed field key "name"',
    )
    const foreign = report({ revealedFields: [field('bogusKey', 'x')] })
    expect(reportInvariants(foreign).problems.some((p) => p.includes('bogusKey'))).toBe(
      true,
    )
  })

  it('collects multiple problems and flips ok to false', () => {
    const tampered = report({
      observerId: ' ',
      source: '',
      revealedFields: [field('bogus', 'x')],
    })
    const result = reportInvariants(tampered)
    expect(result.ok).toBe(false)
    expect(result.problems.length).toBeGreaterThanOrEqual(3)
  })
})

describe('P6-T05 reportsForTarget', () => {
  it('returns only reports for the target id', () => {
    const list = [
      reportAt('jay', T1, 100),
      reportAt('jay', T2, 100),
      reportAt('kim', T1, 200),
    ]
    const result = reportsForTarget(list, T1, 300)
    expect(result.map((r) => r.id)).toEqual([list[2].id, list[0].id])
  })

  it('orders newest first by observedAt descending', () => {
    const list = [
      reportAt('jay', T1, 100),
      reportAt('jay', T1, 300),
      reportAt('jay', T1, 200),
    ]
    const result = reportsForTarget(list, T1, 400)
    expect(result.map((r) => r.observedAt)).toEqual([300, 200, 100])
  })

  it('tie-breaks equal observedAt by ascending id', () => {
    const list = [reportAt('kim', T1, 100), reportAt('jay', T1, 100)]
    const result = reportsForTarget(list, T1, 200)
    expect(result.map((r) => r.id)).toEqual([list[0].id, list[1].id].sort())
  })

  it('returns a fresh array, never mutates the input and is deterministic', () => {
    const list = [reportAt('jay', T1, 200), reportAt('jay', T1, 100)]
    const before = list.map((r) => r.id)
    const result = reportsForTarget(list, T1, 300)
    expect(result).not.toBe(list)
    expect(list.map((r) => r.id)).toEqual(before)
    expect(result).toEqual(reportsForTarget(list, T1, 300))
  })

  it('rejects a non-positive or non-finite at and a blank targetId', () => {
    for (const at of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => reportsForTarget([], T1, at)).toThrow(RangeError)
    }
    expect(() => reportsForTarget([], '   ', 100)).toThrow(RangeError)
  })
})
