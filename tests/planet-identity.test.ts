import { describe, expect, it } from 'vitest'
import { PLANETS } from '../src/sim/data/planets'
import type { PlanetCatalogueEntry } from '../src/sim/data/planets'
import { structureEffect } from '../src/sim/structures/effects'
import type { StructureEffect } from '../src/sim/structures/types'
import {
  generatePlanetIdentity,
  GENERATOR_VERSION,
  seedFromPlanetName,
  triggeredQuirks,
  QUIRK_TABLE,
  applyQuirk,
  densityProxy,
  isHotStar,
} from '../src/sim/planets'
import type { PlanetIdentity, PlanetQuirk } from '../src/sim/planets'

function asKind<K extends StructureEffect['kind']>(
  effect: StructureEffect,
  kind: K,
): Extract<StructureEffect, { kind: K }> {
  expect(effect.kind).toBe(kind)
  return effect as Extract<StructureEffect, { kind: K }>
}

describe('P2-T02-B generator determinism', () => {
  it('same entry produces byte-equal identity across repeated calls', () => {
    for (const entry of PLANETS.slice(0, 200)) {
      expect(generatePlanetIdentity(entry)).toEqual(generatePlanetIdentity(entry))
    }
  })

  it('seed is a pure FNV-1a of GENERATOR_VERSION | name and is unique per planet', () => {
    const seeds = new Set<number>()
    for (const entry of PLANETS) {
      const seed = seedFromPlanetName(GENERATOR_VERSION, entry.name)
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThanOrEqual(0xffffffff)
      seeds.add(seed)
    }
    expect(seeds.size).toBe(PLANETS.length)
  })

  it('golden test: Kepler-452 b identity is stable (GENERATOR_VERSION locks re-rolls)', () => {
    const entry = PLANETS.find((p) => p.name === 'Kepler-452 b')
    expect(entry).toBeDefined()
    const identity = generatePlanetIdentity(entry as PlanetCatalogueEntry)
    expect(identity).toEqual({
      visual: {
        surfacePalette: ['#fff4c8', '#2f6fb0', '#3a8a4a', '#c8d8a0'],
        atmosphereTint: null,
        ringed: false,
        moons: 0,
        emoji: '🌍',
      },
      quirks: [],
      description:
        'Kepler-452 b is a tier-3 water world orbiting a warm yellow G-class star 551.7 pc from Sol. A verdant, mist-wreathed world. A quiet world with little to recommend it.',
    } satisfies PlanetIdentity)
  })

  it('golden test: Gliese 12 b keeps its Dense Core quirk and dense flavour', () => {
    const entry = PLANETS.find((p) => p.name === 'Gliese 12 b')
    expect(entry).toBeDefined()
    const identity = generatePlanetIdentity(entry as PlanetCatalogueEntry)
    expect(identity.quirks.map((q) => q.id)).toEqual(['denseCore'])
    expect(identity.description).toContain('dense')
  })
})

describe('P2-T02-B all 6321 catalogue entries generate (D4 fallbacks)', () => {
  it('every entry generates a complete, valid identity without throwing', () => {
    for (const entry of PLANETS) {
      const identity = generatePlanetIdentity(entry)
      expect(identity.visual.surfacePalette.length).toBeGreaterThanOrEqual(3)
      for (const hex of identity.visual.surfacePalette) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
      }
      expect(typeof identity.visual.emoji).toBe('string')
      expect(Number.isInteger(identity.visual.moons)).toBe(true)
      expect(identity.visual.moons).toBeGreaterThanOrEqual(0)
      expect(typeof identity.visual.ringed).toBe('boolean')
      expect(identity.visual.atmosphereTint === null || /^#[0-9a-f]{6}$/i.test(identity.visual.atmosphereTint)).toBe(true)
      expect(identity.description.length).toBeGreaterThan(10)
    }
  })

  it('missing radiusEarth still produces a band-derived palette (tier default, D4)', () => {
    const missingRadius = PLANETS.filter((p) => p.radiusEarth === undefined)
    expect(missingRadius.length).toBeGreaterThan(0)
    for (const entry of missingRadius.slice(0, 300)) {
      const identity = generatePlanetIdentity(entry)
      expect(identity.visual.surfacePalette.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('missing starType produces an unknown-spectral-class clause, never a fabricated letter', () => {
    const missingStar = PLANETS.filter((p) => p.starType === undefined)
    expect(missingStar.length).toBeGreaterThan(0)
    for (const entry of missingStar.slice(0, 300)) {
      const identity = generatePlanetIdentity(entry)
      expect(identity.description).toContain('unknown spectral class')
    }
  })

  it('missing distancePc omits the distance clause', () => {
    const missingDistance = PLANETS.filter((p) => p.distancePc === undefined)
    expect(missingDistance.length).toBeGreaterThan(0)
    for (const entry of missingDistance.slice(0, 300)) {
      const identity = generatePlanetIdentity(entry)
      expect(identity.description).not.toContain(' pc from Sol')
    }
  })

  it('at most one quirk per planet (seeded pick) and no two quirks per planet', () => {
    for (const entry of PLANETS) {
      const identity = generatePlanetIdentity(entry)
      expect(identity.quirks.length).toBeLessThanOrEqual(1)
    }
  })

  it('unique seeds produce varied palettes, moons, rings and atmospheres', () => {
    const palettes = new Set<string>()
    const moons = new Set<number>()
    let ringed = 0
    let atmosphered = 0
    for (const entry of PLANETS.slice(0, 500)) {
      const identity = generatePlanetIdentity(entry)
      palettes.add(identity.visual.surfacePalette.join(''))
      moons.add(identity.visual.moons)
      if (identity.visual.ringed) ringed++
      if (identity.visual.atmosphereTint !== null) atmosphered++
    }
    expect(palettes.size).toBeGreaterThan(10)
    expect(moons.size).toBeGreaterThan(1)
    expect(ringed).toBeGreaterThan(0)
    expect(atmosphered).toBeGreaterThan(0)
  })
})

describe('P2-T02-B quirk table matches the locked B3 set', () => {
  const expectedIds = new Set([
    'highGravity',
    'coldStar',
    'hotStar',
    'denseCore',
    'gasGiant',
    'binarySystem',
    'massiveWorld',
  ])

  it('defines exactly the 7 audited quirks', () => {
    expect(QUIRK_TABLE.map((q) => q.id).sort()).toEqual([...expectedIds].sort())
    expect(new Set(QUIRK_TABLE.map((q) => q.id)).size).toBe(7)
  })

  it('every quirk hooks exactly one structure with a positive multiplier', () => {
    for (const quirk of QUIRK_TABLE) {
      expect(typeof quirk.structureId).toBe('string')
      expect(quirk.multiplier).toBeGreaterThan(0)
      expect(quirk.multiplier).not.toBe(1)
      expect(quirk.blurb.length).toBeGreaterThan(10)
    }
  })

  it('each quirk hooks exactly one structure and Cold/Hot Star are mutually exclusive', () => {
    const hookCounts = new Map<string, number>()
    for (const quirk of QUIRK_TABLE) {
      hookCounts.set(quirk.structureId, (hookCounts.get(quirk.structureId) ?? 0) + 1)
    }
    for (const [structureId, count] of hookCounts) {
      expect(count, structureId).toBeLessThanOrEqual(2)
    }
    expect(hookCounts.get('hydroponics')).toBe(2)
    const cold = PLANETS.find((p) => /^[KM]/i.test(p.starType ?? ''))
    const hot = PLANETS.find((p) => /^[OBA]/i.test(p.starType ?? ''))
    expect(cold).toBeDefined()
    expect(hot).toBeDefined()
    const coldTriggers = triggeredQuirks(cold as PlanetCatalogueEntry)
    const hotTriggers = triggeredQuirks(hot as PlanetCatalogueEntry)
    expect(coldTriggers.some((q) => q.id === 'coldStar')).toBe(true)
    expect(coldTriggers.some((q) => q.id === 'hotStar')).toBe(false)
    expect(hotTriggers.some((q) => q.id === 'hotStar')).toBe(true)
    expect(hotTriggers.some((q) => q.id === 'coldStar')).toBe(false)
  })

  it('applyQuirk multiplies the matching structure effect by the quirk multiplier', () => {
    const structureByQuirk: Record<string, string> = {
      highGravity: 'oreMine',
      coldStar: 'hydroponics',
      hotStar: 'hydroponics',
      denseCore: 'housing',
      gasGiant: 'shipyard',
      binarySystem: 'tradeHub',
      massiveWorld: 'defenseTurret',
    }
    for (const quirk of QUIRK_TABLE) {
      const base = structureEffect(quirk.structureId, 3)
      const modified = applyQuirk(quirk as PlanetQuirk, base)
      const multiplier = quirk.multiplier
      switch (quirk.id) {
        case 'highGravity': {
          const before = asKind(base, 'alloys').alloysPerSec
          const after = asKind(modified, 'alloys').alloysPerSec
          expect(after).toBeCloseTo(before * multiplier, 10)
          break
        }
        case 'coldStar':
        case 'hotStar': {
          const before = asKind(base, 'growthMultiplier').multiplier
          const after = asKind(modified, 'growthMultiplier').multiplier
          expect(after).toBeCloseTo(before * multiplier, 10)
          break
        }
        case 'denseCore': {
          const before = asKind(base, 'population').popCapBonus
          const after = asKind(modified, 'population').popCapBonus
          expect(after).toBeCloseTo(before * multiplier, 10)
          break
        }
        case 'gasGiant': {
          const before = asKind(base, 'shipyard').fleetCap
          const after = asKind(modified, 'shipyard').fleetCap
          expect(after).toBeCloseTo(before * multiplier, 10)
          break
        }
        case 'binarySystem': {
          const before = asKind(base, 'incomeMultiplier').multiplier
          const after = asKind(modified, 'incomeMultiplier').multiplier
          expect(after).toBeCloseTo(before * multiplier, 10)
          break
        }
        case 'massiveWorld': {
          const before = asKind(base, 'defense').defensePower
          const after = asKind(modified, 'defense').defensePower
          expect(after).toBeCloseTo(before * multiplier, 10)
          break
        }
      }
      expect(structureByQuirk[quirk.id]).toBe(quirk.structureId)
    }
  })

  it('applyQuirk returns the effect unchanged for a non-matching kind', () => {
    const denseCore = QUIRK_TABLE.find((q) => q.id === 'denseCore')
    expect(denseCore).toBeDefined()
    const oreEffect = structureEffect('oreMine', 1)
    expect(applyQuirk(denseCore as PlanetQuirk, oreEffect)).toEqual(oreEffect)
  })

  it('triggers fire only when the real data is present (no fabrication, D4)', () => {
    const missingBoth = PLANETS.filter(
      (p) => p.radiusEarth === undefined && p.massJup === undefined,
    )
    for (const entry of missingBoth) {
      const triggered = triggeredQuirks(entry)
      for (const quirk of triggered) {
        expect(['binarySystem', 'coldStar', 'hotStar']).toContain(quirk.id)
      }
    }
  })

  it('HighGravity fires on the audit density threshold and is +20% alloy', () => {
    const quirk = QUIRK_TABLE.find((q) => q.id === 'highGravity')
    expect(quirk).toBeDefined()
    expect(quirk?.multiplier).toBe(1.2)
    const dense = PLANETS.find((p) => {
      const d = densityProxy(p)
      return d !== null && d >= 0.005
    })
    expect(dense).toBeDefined()
    expect(triggeredQuirks(dense as PlanetCatalogueEntry).some((q) => q.id === 'highGravity')).toBe(true)
  })

  it('ColdStar fires for K/M stars, HotStar for O/B/A stars', () => {
    const km = PLANETS.find((p) => /^[KM]/i.test(p.starType ?? ''))
    const hot = PLANETS.find((p) => /^[OBA]/i.test(p.starType ?? ''))
    expect(km).toBeDefined()
    expect(hot).toBeDefined()
    expect(triggeredQuirks(km as PlanetCatalogueEntry).some((q) => q.id === 'coldStar')).toBe(true)
    expect(triggeredQuirks(hot as PlanetCatalogueEntry).some((q) => q.id === 'hotStar')).toBe(true)
    expect(isHotStar(hot?.starType)).toBe(true)
    expect(isHotStar(km?.starType)).toBe(false)
  })

  it('GasGiant fires only on tier 5 + low density', () => {
    const t5 = PLANETS.filter((p) => p.tier === 5)
    const nonT5 = PLANETS.filter((p) => p.tier !== 5)
    for (const entry of nonT5) {
      expect(triggeredQuirks(entry).some((q) => q.id === 'gasGiant')).toBe(false)
    }
    for (const entry of t5) {
      if (triggeredQuirks(entry).some((q) => q.id === 'gasGiant')) {
        const d = densityProxy(entry)
        expect(d).not.toBeNull()
        expect((d as number) < 0.0007).toBe(true)
      }
    }
  })
})

describe('P2-T02-B tier bounds and purity', () => {
  it('generated identities are valid for every tier 1-5', () => {
    for (const tier of [1, 2, 3, 4, 5]) {
      const entries = PLANETS.filter((p) => p.tier === tier)
      expect(entries.length).toBeGreaterThan(0)
      for (const entry of entries.slice(0, 100)) {
        const identity = generatePlanetIdentity(entry)
        expect(identity.visual.surfacePalette.length).toBeGreaterThanOrEqual(3)
        expect(identity.description).toContain(`tier-${tier}`)
      }
    }
  })

  it('generator never mutates the catalogue entry', () => {
    for (const entry of PLANETS.slice(0, 100)) {
      const before = JSON.stringify(entry)
      generatePlanetIdentity(entry)
      expect(JSON.stringify(entry)).toBe(before)
    }
  })
})
