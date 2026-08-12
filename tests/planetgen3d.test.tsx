/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLANETS } from '../src/sim/data/planets'
import {
  generatePlanetIdentity,
  radiusBandOf,
  resolveRadius,
} from '../src/sim/planets'
import { keplerPosition, seededOrbitalElements } from '../src/ui/planetgen3d/orbits'
import {
  spectralClassOf,
  starModel,
  starModelFromType,
} from '../src/ui/planetgen3d/spectral'
import {
  buildTerrainTexture,
  buildCloudTexture,
  buildGalaxyDiskTexture,
  buildDistantGalaxyTexture,
} from '../src/ui/planetgen3d/textures'
import {
  buildGalaxy,
  buildUniverse,
  clearTextureCache,
} from '../src/ui/planetgen3d/render'
import { buildSolarSystem } from '../src/ui/planetgen3d/system'
import * as THREE from 'three'
import PlanetCanvas3D from '../src/ui/components/PlanetCanvas3D'

import type { PlanetVisualProfile } from '../src/sim/planets/types'
import type { RadiusBand } from '../src/sim/planets/visual'

afterEach(() => {
  cleanup()
  clearTextureCache()
  vi.restoreAllMocks()
})

function identityFor(name: string) {
  const entry = PLANETS.find((p) => p.name === name) ?? PLANETS[0]!
  return generatePlanetIdentity(entry)
}

function bandFor(name: string): RadiusBand {
  const entry = PLANETS.find((p) => p.name === name) ?? PLANETS[0]!
  return radiusBandOf(resolveRadius(entry, () => 0.5))
}

// ---------------------------------------------------------------------------
// Fake canvas helper for deterministic texture tests in jsdom.
// ---------------------------------------------------------------------------

const IMAGE_DATA_KEY = '__fake_image_data__'

function installFakeCanvas() {
  const originalCreateElement = document.createElement
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      const canvas = originalCreateElement.call(document, tag) as HTMLCanvasElement
      const store = { img: null as ImageData | null }
      ;(canvas as unknown as Record<string, unknown>)[IMAGE_DATA_KEY] = store
      return new Proxy(canvas, {
        get(target, prop) {
          if (prop === 'getContext') {
            return (type: string) => {
              if (type === '2d') {
                return {
                  createImageData(w: number, h: number) {
                    const img = {
                      data: new Uint8ClampedArray(w * h * 4),
                      width: w,
                      height: h,
                    } as unknown as ImageData
                    store.img = img
                    return img
                  },
                  putImageData() {
                    // no-op
                  },
                }
              }
              return target.getContext(type)
            }
          }
          if (prop === IMAGE_DATA_KEY) return store
          const value = (target as unknown as Record<string, unknown>)[prop as string]
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }
    return originalCreateElement.call(document, tag)
  })
}

function getFakeImageData(canvas: HTMLCanvasElement): ImageData | null {
  return ((canvas as unknown as Record<string, unknown>)[IMAGE_DATA_KEY] as { img: ImageData | null } | undefined)?.img ?? null
}

function hashPixels(data: Uint8ClampedArray): string {
  let h = 0
  for (let i = 0; i < data.length; i++) {
    h = (h * 31 + data[i]) | 0
  }
  return (h >>> 0).toString(16)
}

// ---------------------------------------------------------------------------
// Orbit math
// ---------------------------------------------------------------------------

describe('planetgen3d/orbits', () => {
  it('returns a circle when eccentricity is zero', () => {
    const a = 10
    const p0 = keplerPosition(a, 0, 0, 0, 0, 100, 0)
    expect(p0.x).toBeCloseTo(a, 6)
    expect(p0.y).toBeCloseTo(0, 6)
    expect(p0.z).toBeCloseTo(0, 6)

    const pQuarter = keplerPosition(a, 0, 0, 0, 0, 100, 25)
    expect(pQuarter.x).toBeCloseTo(0, 6)
    expect(pQuarter.y).toBeCloseTo(0, 6)
    expect(pQuarter.z).toBeCloseTo(a, 6)

    const pHalf = keplerPosition(a, 0, 0, 0, 0, 100, 50)
    expect(pHalf.x).toBeCloseTo(-a, 6)
  })

  it('moves faster near periapsis for high eccentricity', () => {
    const a = 10
    const e = 0.9
    const period = 100
    const p0 = keplerPosition(a, e, 0, 0, 0, period, 0)
    const p1 = keplerPosition(a, e, 0, 0, 0, period, 1)
    const p50 = keplerPosition(a, e, 0, 0, 0, period, 50)
    const p51 = keplerPosition(a, e, 0, 0, 0, period, 51)

    const nearPeriapsis = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z)
    const nearApoapsis = Math.hypot(p51.x - p50.x, p51.y - p50.y, p51.z - p50.z)
    expect(nearPeriapsis).toBeGreaterThan(nearApoapsis)
  })

  it('is deterministic for the same seed', () => {
    const a = 12
    const el1 = seededOrbitalElements('seed-a', a)
    const el2 = seededOrbitalElements('seed-a', a)
    expect(el1).toEqual(el2)
  })

  it('produces different elements for different seeds', () => {
    const a = 12
    const el1 = seededOrbitalElements('seed-a', a)
    const el2 = seededOrbitalElements('seed-b', a)
    expect(el1).not.toEqual(el2)
  })

  it('returns to the same position after one period', () => {
    const a = 10
    const e = 0.3
    const period = 80
    const p0 = keplerPosition(a, e, 0.1, 0.2, 0.3, period, 0)
    const p1 = keplerPosition(a, e, 0.1, 0.2, 0.3, period, period)
    expect(p0.x).toBeCloseTo(p1.x, 4)
    expect(p0.y).toBeCloseTo(p1.y, 4)
    expect(p0.z).toBeCloseTo(p1.z, 4)
  })
})

// ---------------------------------------------------------------------------
// Spectral
// ---------------------------------------------------------------------------

describe('planetgen3d/spectral', () => {
  it('maps every spectral class to a distinct plausible color', () => {
    const classes = ['O', 'B', 'A', 'F', 'G', 'K', 'M'] as const
    const colors = classes.map((c) => starModel(c).color)
    expect(new Set(colors).size).toBe(classes.length)
    for (const c of colors) {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('orders star color from blue-white (O) to red (M)', () => {
    // Hue is a simple proxy: O/B are blue (high hue in RGB space), M is red.
    const o = starModel('O').color
    const m = starModel('M').color
    const blueScore = (hex: string) =>
      parseInt(hex.slice(5, 7), 16) - parseInt(hex.slice(1, 3), 16)
    expect(blueScore(o)).toBeGreaterThan(blueScore(m))
  })

  it('returns the default model for unknown star types', () => {
    expect(starModelFromType('')).toEqual(starModel('unknown'))
    expect(starModelFromType('Q9 V')).toEqual(starModel('unknown'))
  })

  it('parses spectral classes from real catalogue starType strings', () => {
    expect(spectralClassOf('G2 V')).toBe('G')
    expect(spectralClassOf('K0 III')).toBe('K')
    expect(spectralClassOf('M4.5 V')).toBe('M')
    expect(spectralClassOf('F8')).toBe('F')
  })
})

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

describe('planetgen3d/textures', () => {
  it('produces identical pixel data for the same planet name', () => {
    installFakeCanvas()
    const TEST_NAMES = ['Kepler-452 b', 'K2-210 b', 'HAT-P-64 b']
    for (const name of TEST_NAMES) {
      const identity = identityFor(name)
      const band = bandFor(name)
      const t1 = buildTerrainTexture(name, band, identity.visual, 64)
      const t2 = buildTerrainTexture(name, band, identity.visual, 64)
      const img1 = getFakeImageData(t1.canvas)
      const img2 = getFakeImageData(t2.canvas)
      expect(img1).not.toBeNull()
      expect(img2).not.toBeNull()
      expect(hashPixels(img1!.data)).toBe(hashPixels(img2!.data))
      expect(t1.canvas.width).toBe(t2.canvas.width)
      expect(t1.canvas.height).toBe(t2.canvas.height)
      expect(t1.hasAlpha).toBe(t2.hasAlpha)
    }
  })

  it('produces different textures for different planet names', () => {
    installFakeCanvas()
    const a = buildTerrainTexture('Planet-A', 'rocky', sampleProfile('rocky'), 64)
    const b = buildTerrainTexture('Planet-B', 'rocky', sampleProfile('rocky'), 64)
    const imgA = getFakeImageData(a.canvas)
    const imgB = getFakeImageData(b.canvas)
    expect(imgA).not.toBeNull()
    expect(imgB).not.toBeNull()
    expect(hashPixels(imgA!.data)).not.toBe(hashPixels(imgB!.data))
  })

  it('cloud textures are deterministic', () => {
    installFakeCanvas()
    const a = buildCloudTexture('Cloud-A', 64)
    const b = buildCloudTexture('Cloud-A', 64)
    const c = buildCloudTexture('Cloud-B', 64)
    const imgA = getFakeImageData(a.canvas)
    const imgB = getFakeImageData(b.canvas)
    const imgC = getFakeImageData(c.canvas)
    expect(imgA).not.toBeNull()
    expect(imgB).not.toBeNull()
    expect(imgC).not.toBeNull()
    expect(hashPixels(imgA!.data)).toBe(hashPixels(imgB!.data))
    expect(hashPixels(imgA!.data)).not.toBe(hashPixels(imgC!.data))
  })

  it('never calls Math.random in the pure modules (static source check)', () => {
    const files = [
      'orbits.ts',
      'spectral.ts',
      'textures.ts',
      'random.ts',
      'galaxy.ts',
      'system.ts',
      'hosts.ts',
    ]
    for (const file of files) {
      const src = readFileSync(
        join(process.cwd(), 'src', 'ui', 'planetgen3d', file),
        'utf8',
      )
      expect(src).not.toMatch(/Math\.random\s*\(/)
    }
  })
})

// ---------------------------------------------------------------------------
// Galaxy / universe backdrop textures
// ---------------------------------------------------------------------------

describe('planetgen3d/galaxyTextures', () => {
  it('galaxy disk texture is deterministic for the same seed', () => {
    installFakeCanvas()
    const a = buildGalaxyDiskTexture('seed-a', 128)
    const b = buildGalaxyDiskTexture('seed-a', 128)
    const c = buildGalaxyDiskTexture('seed-b', 128)
    const imgA = getFakeImageData(a.canvas)
    const imgB = getFakeImageData(b.canvas)
    const imgC = getFakeImageData(c.canvas)
    expect(imgA).not.toBeNull()
    expect(imgB).not.toBeNull()
    expect(imgC).not.toBeNull()
    expect(hashPixels(imgA!.data)).toBe(hashPixels(imgB!.data))
    expect(hashPixels(imgA!.data)).not.toBe(hashPixels(imgC!.data))
  })

  it('distant galaxy texture is deterministic for the same seed', () => {
    installFakeCanvas()
    const a = buildDistantGalaxyTexture('seed-a', 128)
    const b = buildDistantGalaxyTexture('seed-a', 128)
    const c = buildDistantGalaxyTexture('seed-b', 128)
    const imgA = getFakeImageData(a.canvas)
    const imgB = getFakeImageData(b.canvas)
    const imgC = getFakeImageData(c.canvas)
    expect(imgA).not.toBeNull()
    expect(imgB).not.toBeNull()
    expect(imgC).not.toBeNull()
    expect(hashPixels(imgA!.data)).toBe(hashPixels(imgB!.data))
    expect(hashPixels(imgA!.data)).not.toBe(hashPixels(imgC!.data))
  })
})

// ---------------------------------------------------------------------------
// Galaxy / universe scene-graph builders
// ---------------------------------------------------------------------------

function buildSampleSystem(seedName: string) {
  return buildSolarSystem(seedName, `${seedName} b`, {
    surfacePalette: ['#2f6fb0', '#3a8a4a', '#c8d8a0', '#2a5c3a'],
    atmosphereTint: '#8ab8ff',
    ringed: false,
    moons: 0,
    emoji: '🌍',
  }, 3, 'earthlike', 'G2 V', seedName)
}

describe('planetgen3d/galaxyBuilder', () => {
  it('buildGalaxy returns a small root group (≤ 8 children) plus locator data', () => {
    const scene = new THREE.Scene()
    const system = buildSampleSystem('Builder-Kepler-452')
    const galaxy = buildGalaxy(system.galaxy, scene, new Set())

    expect(galaxy.root.children.length).toBeLessThanOrEqual(8)
    expect(galaxy.field).toBeInstanceOf(THREE.Points)
    expect(galaxy.locators.size).toBe(system.galaxy.hosts.length)
    expect(galaxy.hostByName.size).toBe(system.galaxy.hosts.length)
  })

  it('buildGalaxy is deterministic for the same seed', () => {
    const scene1 = new THREE.Scene()
    const scene2 = new THREE.Scene()
    const system1 = buildSampleSystem('Deterministic-Galaxy')
    const system2 = buildSampleSystem('Deterministic-Galaxy')

    const a = buildGalaxy(system1.galaxy, scene1, new Set())
    const b = buildGalaxy(system2.galaxy, scene2, new Set())

    expect(a.root.children.length).toBe(b.root.children.length)
    expect(a.root.children.map((c) => c.name).sort()).toEqual(
      b.root.children.map((c) => c.name).sort(),
    )
    expect(a.locators.size).toBe(b.locators.size)
  })

  it('buildGalaxy differs for different seeds', () => {
    const system1 = buildSampleSystem('Galaxy-Seed-A')
    const system2 = buildSampleSystem('Galaxy-Seed-B')

    // The visual seed is derived from the system seed; different system seeds
    // must produce different backdrop seeds (and therefore different textures).
    expect(system1.galaxy.backdropSeed).not.toBe(system2.galaxy.backdropSeed)
  })
})

describe('planetgen3d/universeBuilder', () => {
  it('buildUniverse returns a small group (≤ 45 children) containing galaxy sprites', () => {
    const scene = new THREE.Scene()
    const system = buildSampleSystem('Builder-Kepler-62')
    const universe = buildUniverse(system.universe, scene)

    expect(universe.children.length).toBeLessThanOrEqual(45)
    const sprites = universe.children.find((c) => c.name === 'distantGalaxySprites')
    expect(sprites).toBeDefined()
    expect(sprites!.children.length).toBeGreaterThanOrEqual(20)
    expect(sprites!.children.length).toBeLessThanOrEqual(42)
    expect(sprites!.children[0]).toBeInstanceOf(THREE.Sprite)
  })

  it('buildUniverse is deterministic for the same seed', () => {
    const scene1 = new THREE.Scene()
    const scene2 = new THREE.Scene()
    const system1 = buildSampleSystem('Deterministic-Universe')
    const system2 = buildSampleSystem('Deterministic-Universe')

    const a = buildUniverse(system1.universe, scene1)
    const b = buildUniverse(system2.universe, scene2)

    expect(a.children.length).toBe(b.children.length)
    const spritesA = a.children.find((c) => c.name === 'distantGalaxySprites')!
    const spritesB = b.children.find((c) => c.name === 'distantGalaxySprites')!
    expect(spritesA.children.length).toBe(spritesB.children.length)
  })
})

function sampleProfile(band: RadiusBand): PlanetVisualProfile {
  const palettes: Record<RadiusBand, string[]> = {
    rocky: ['#c0c0c0', '#8a6a4a', '#a89070', '#4a3a2a'],
    earthlike: ['#2f6fb0', '#3a8a4a', '#c8d8a0', '#2a5c3a'],
    superearth: ['#2a8a9e', '#7aa8b8', '#1e6a86', '#8ab8c8'],
    gaseous: ['#c9a86a', '#e0c9a0', '#a9855a', '#8a6a4a'],
  }
  return {
    surfacePalette: palettes[band],
    atmosphereTint: band === 'earthlike' ? '#8ab8ff' : null,
    ringed: false,
    moons: 0,
    emoji: '🪐',
  }
}

// ---------------------------------------------------------------------------
// React component smoke tests
// ---------------------------------------------------------------------------

describe('planetgen3d/PlanetCanvas3D', () => {
  it('renders a canvas with the expected aria-label for Kepler-452 b', () => {
    const entry = PLANETS.find((p) => p.name === 'Kepler-452 b')!
    const identity = generatePlanetIdentity(entry)
    const band = radiusBandOf(resolveRadius(entry, () => 0.5))
    const { container } = render(
      <PlanetCanvas3D
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

  it('builds without throwing for edge cases (moons=0, ringed=false, no atmosphere, tier 1 and 5)', () => {
    const edgeProfile: PlanetVisualProfile = {
      surfacePalette: ['#c0c0c0', '#8a6a4a', '#6b5138', '#4a3a2a'],
      atmosphereTint: null,
      ringed: false,
      moons: 0,
      emoji: '🪨',
    }

    expect(() =>
      render(
        <PlanetCanvas3D
          name="Edge-Tier-1"
          profile={edgeProfile}
          tier={1}
          radiusBand="rocky"
        />,
      ),
    ).not.toThrow()

    cleanup()

    expect(() =>
      render(
        <PlanetCanvas3D
          name="Edge-Tier-5"
          profile={edgeProfile}
          tier={5}
          radiusBand="gaseous"
        />,
      ),
    ).not.toThrow()

    cleanup()
  })
})
