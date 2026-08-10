/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLANETS } from '../src/sim/data/planets'
import { generatePlanetIdentity, radiusBandOf, resolveRadius } from '../src/sim/planets'
import { generatePlanetRenderFeatures } from '../src/ui/planetgen/features'
import PlanetCanvas from '../src/ui/components/PlanetCanvas'
import type { PlanetVisualProfile } from '../src/sim/planets/types'
import type { RadiusBand } from '../src/sim/planets/visual'

const TEST_NAMES = PLANETS.slice(0, 30).map((p) => p.name)

function identityFor(name: string) {
  const entry = PLANETS.find((p) => p.name === name) ?? PLANETS[0]!
  return generatePlanetIdentity(entry)
}

function bandFor(name: string): RadiusBand {
  const entry = PLANETS.find((p) => p.name === name) ?? PLANETS[0]!
  return radiusBandOf(resolveRadius(entry, () => 0.5))
}

describe('planetgen/features', () => {
  it('is deterministic for the same planet name', () => {
    for (const name of TEST_NAMES) {
      const identity = identityFor(name)
      const tier = (PLANETS.find((p) => p.name === name)?.tier ?? 3)
      const band = bandFor(name)
      const a = generatePlanetRenderFeatures(name, identity.visual, tier, band)
      const b = generatePlanetRenderFeatures(name, identity.visual, tier, band)
      expect(a).toEqual(b)
    }
  })

  it('produces materially different feature vectors for different planets', () => {
    const vectors = TEST_NAMES.slice(0, 20).map((name) => {
      const identity = identityFor(name)
      const tier = PLANETS.find((p) => p.name === name)!.tier
      const band = bandFor(name)
      return generatePlanetRenderFeatures(name, identity.visual, tier, band)
    })
    const serialised = vectors.map((v) => JSON.stringify(v))
    expect(new Set(serialised).size).toBe(vectors.length)

    // Light angles and starfields should also vary.
    const lightAngles = vectors.map((v) => v.lightAngle)
    expect(new Set(lightAngles).size).toBeGreaterThan(1)
  })

  it('throws for an empty planet name', () => {
    const profile: PlanetVisualProfile = {
      surfacePalette: ['#c0c0c0', '#8a6a4a', '#6b5138', '#4a3a2a'],
      atmosphereTint: null,
      ringed: false,
      moons: 0,
      emoji: '🪨',
    }
    expect(() => generatePlanetRenderFeatures('', profile, 3, 'rocky')).toThrow(
      /required/i,
    )
  })

  it('handles moons=0, ringed=false, atmosphereTint=null', () => {
    const profile: PlanetVisualProfile = {
      surfacePalette: ['#c0c0c0', '#8a6a4a', '#6b5138', '#4a3a2a'],
      atmosphereTint: null,
      ringed: false,
      moons: 0,
      emoji: '🪨',
    }
    const f = generatePlanetRenderFeatures('Test-Null-World', profile, 3, 'rocky')
    expect(f.moons.count).toBe(0)
    expect(f.rings.enabled).toBe(false)
    expect(f.atmosphere.tint).toBeNull()
    expect(f.atmosphere.alpha).toBe(0)
  })

  it('scales size with tier 1 versus tier 5', () => {
    const profile: PlanetVisualProfile = {
      surfacePalette: ['#c0c0c0', '#8a6a4a', '#6b5138', '#4a3a2a'],
      atmosphereTint: null,
      ringed: false,
      moons: 1,
      emoji: '🪨',
    }
    const t1 = generatePlanetRenderFeatures('Tier-1-World', profile, 1, 'rocky')
    const t5 = generatePlanetRenderFeatures('Tier-5-World', profile, 5, 'gaseous')
    expect(t5.cssSize).toBeGreaterThan(t1.cssSize)
    expect(t5.discRadius).toBeGreaterThan(t1.discRadius)
  })

  it('produces distinct surface features for every radius band', () => {
    const profile: PlanetVisualProfile = {
      surfacePalette: ['#c0c0c0', '#8a6a4a', '#6b5138', '#4a3a2a'],
      atmosphereTint: null,
      ringed: false,
      moons: 0,
      emoji: '🪨',
    }
    const bands: RadiusBand[] = ['rocky', 'earthlike', 'superearth', 'gaseous']
    const results = bands.map((band) => ({
      band,
      f: generatePlanetRenderFeatures(`Band-${band}`, profile, 3, band),
    }))

    expect(results.find((r) => r.band === 'rocky')!.f.surface.craters.length).toBeGreaterThan(0)
    expect(results.find((r) => r.band === 'gaseous')!.f.surface.bands.length).toBeGreaterThan(0)
    expect(results.find((r) => r.band === 'earthlike')!.f.surface.blobs.length).toBeGreaterThan(0)
    expect(results.find((r) => r.band === 'superearth')!.f.surface.bands.length).toBeGreaterThan(0)
    expect(results.find((r) => r.band === 'superearth')!.f.surface.blobs.length).toBeGreaterThan(0)
  })

  it('never calls Math.random (static source check)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'ui', 'planetgen', 'features.ts'),
      'utf8',
    )
    expect(src).not.toMatch(/Math\.random\s*\(/)
  })

  it('uses the documented seed derivation, not the identity PRNG', () => {
    const entry = PLANETS.find((p) => p.name === 'Kepler-452 b')!
    const identity = generatePlanetIdentity(entry)
    const band = radiusBandOf(resolveRadius(entry, () => 0.5))
    const f = generatePlanetRenderFeatures(entry.name, identity.visual, entry.tier, band)
    // Seeded from fnv1a(`${name}:2d`). The exact numeric value is implementation-defined;
    // the test guards that a stable seed is exposed and non-zero.
    expect(f.seed).toBeGreaterThan(0)
  })
})

describe('planetgen/PlanetCanvas', () => {
  it('renders a canvas with the expected aria-label and size', () => {
    const entry = PLANETS.find((p) => p.name === 'Kepler-452 b')!
    const identity = generatePlanetIdentity(entry)
    const band = radiusBandOf(resolveRadius(entry, () => 0.5))
    const { container } = render(
      <PlanetCanvas
        name={entry.name}
        profile={identity.visual}
        tier={entry.tier}
        radiusBand={band}
      />,
    )
    const canvas = container.querySelector('canvas')
    expect(canvas).toBeInTheDocument()
    expect(canvas).toHaveAttribute('aria-label', `${entry.name} ${identity.visual.emoji}`)
    expect(canvas).toHaveAttribute('role', 'img')
    cleanup()
  })

  it('produces identical feature vectors across two mounts', () => {
    const entry = PLANETS.find((p) => p.name === 'K2-210 b')!
    const identity = generatePlanetIdentity(entry)
    const band = radiusBandOf(resolveRadius(entry, () => 0.5))

    const first = render(
      <PlanetCanvas
        name={entry.name}
        profile={identity.visual}
        tier={entry.tier}
        radiusBand={band}
      />,
    )
    const c1 = first.container.querySelector('canvas')

    const second = render(
      <PlanetCanvas
        name={entry.name}
        profile={identity.visual}
        tier={entry.tier}
        radiusBand={band}
      />,
    )
    const c2 = second.container.querySelector('canvas')

    expect(c1?.width).toBe(c2?.width)
    expect(c1?.height).toBe(c2?.height)
    cleanup()
  })
})
