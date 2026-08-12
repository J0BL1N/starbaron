/**
 * Pure-ish deterministic Canvas 2D texture builders for 3D planets.
 * No THREE dependency. No Math.random — every texture is seeded from the planet name.
 */

import { rngFrom } from './random'
import type { PlanetVisualProfile } from '../../sim/planets/types'
import type { RadiusBand } from '../../sim/planets/visual'

export type TextureBand = RadiusBand | 'venus-like'

class NoiseField {
  private octaves: { n: number; g: Float32Array }[]

  constructor(seed: string, octaves = 5, base = 64) {
    this.octaves = []
    for (let o = 0; o < octaves; o++) {
      const n = Math.max(2, base >> o)
      const r = rngFrom(`${seed}:n${o}`)
      const g = new Float32Array((n + 1) * (n + 1))
      for (let i = 0; i < g.length; i++) {
        g[i] = r()
      }
      this.octaves.push({ n, g })
    }
  }

  sample(x: number, y: number): number {
    let sum = 0
    let amp = 1
    let total = 0
    for (const { n, g } of this.octaves) {
      const X = x * n
      const Y = y * n
      const x0 = Math.floor(X) % n
      const y0 = Math.floor(Y) % n
      const fx = X - Math.floor(X)
      const fy = Y - Math.floor(Y)
      const i = y0 * (n + 1) + x0
      const v00 = g[i]
      const v10 = g[i + 1]
      const v01 = g[i + n + 1]
      const v11 = g[i + n + 2]
      const sx = fx * fx * (3 - 2 * fx)
      const sy = fy * fy * (3 - 2 * fy)
      sum +=
        ((v00 * (1 - sx) + v10 * sx) * (1 - sy) +
          (v01 * (1 - sx) + v11 * sx) * sy) *
        amp
      total += amp
      amp *= 0.5
    }
    return sum / total
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function mixRGB(a: number[], b: number[], t: number): number[] {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ]
}

function ramp(stops: [number, number[]][], t: number): number[] {
  if (t <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [a, c1] = stops[i - 1]
      const [b, c2] = stops[i]
      return mixRGB(c1, c2, (t - a) / (b - a))
    }
  }
  return stops[stops.length - 1][1]
}

function canvasFromRGBA(
  size: number,
  fn: (x: number, y: number) => [number, number, number, number],
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d context not available')
  const img = g.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, gg, b, a] = fn(x / size, y / size)
      const i = (y * size + x) * 4
      img.data[i] = r
      img.data[i + 1] = gg
      img.data[i + 2] = b
      img.data[i + 3] = a
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

function pickPalette(
  profile: PlanetVisualProfile,
): [string, string, string, string] {
  const p = profile.surfacePalette
  return [p[0] ?? '#888888', p[1] ?? '#666666', p[2] ?? '#444444', p[3] ?? '#222222']
}

export interface TextureResult {
  canvas: HTMLCanvasElement
  hasAlpha: boolean
}

function opaque(canvas: HTMLCanvasElement): TextureResult {
  return { canvas, hasAlpha: false }
}

function alpha(canvas: HTMLCanvasElement): TextureResult {
  return { canvas, hasAlpha: true }
}

export function buildEarthlikeTexture(
  name: string,
  profile: PlanetVisualProfile,
  size = 1024,
): TextureResult {
  const nf = new NoiseField(name, 6, 96)
  const [, c1, c2, c3] = pickPalette(profile)

  const deep = hexToRgb('#0a2e5c')
  const mid = hexToRgb('#14508c')
  const shallow = hexToRgb(c1)
  const sand = hexToRgb('#c8b080')
  const grass = hexToRgb(c2)
  const forest = hexToRgb(c3)
  const rock = hexToRgb('#8a7a5a')
  const snow = hexToRgb('#f0f0f8')

  return opaque(
    canvasFromRGBA(size, (x, y) => {
      const lat = Math.abs(y - 0.5) * 2
      let e = nf.sample(x * 1.3, y * 1.3)
      e = (e - 0.5) * 1.7 + 0.5
      e += Math.sin(x * Math.PI * 2) * 0.05 + Math.cos(y * Math.PI * 2) * 0.05
      const polar = Math.max(0, (lat - 0.78) / 0.22)

      let col: number[]
      if (e < 0.46) {
        col = ramp(
          [
            [0, deep],
            [0.35, mid],
            [0.46, shallow],
          ],
          e,
        )
      } else if (e < 0.5) {
        col = ramp([[0.46, shallow], [0.5, sand]], e)
      } else if (e < 0.72) {
        col = ramp(
          [
            [0.5, sand],
            [0.58, grass],
            [0.72, forest],
          ],
          e,
        )
      } else {
        col = ramp(
          [
            [0.72, forest],
            [0.85, rock],
            [1, snow],
          ],
          e,
        )
      }
      col = mixRGB(col, snow, polar)
      return [col[0], col[1], col[2], 255]
    }),
  )
}

export function buildSuperEarthTexture(
  name: string,
  profile: PlanetVisualProfile,
  size = 1024,
): TextureResult {
  const nf = new NoiseField(name, 6, 96)
  const [primary, c1, c2] = pickPalette(profile)

  const deep = hexToRgb('#062a4a')
  const mid = hexToRgb(c1)
  const shallow = hexToRgb(c2)
  const land = hexToRgb(primary)
  const cloud = hexToRgb('#e8f0f8')

  return opaque(
    canvasFromRGBA(size, (x, y) => {
      const lat = Math.abs(y - 0.5) * 2
      let e = nf.sample(x * 1.3, y * 1.3)
      e = (e - 0.5) * 1.5 + 0.45
      e += Math.sin(x * Math.PI * 2) * 0.04
      const polar = Math.max(0, (lat - 0.72) / 0.28)

      let col: number[]
      if (e < 0.55) {
        col = ramp(
          [
            [0, deep],
            [0.4, mid],
            [0.55, shallow],
          ],
          e,
        )
      } else {
        col = ramp(
          [
            [0.55, shallow],
            [0.7, land],
            [1, cloud],
          ],
          e,
        )
      }
      col = mixRGB(col, cloud, polar * 0.7)
      return [col[0], col[1], col[2], 255]
    }),
  )
}

export function buildGasTexture(
  name: string,
  profile: PlanetVisualProfile,
  size = 1024,
): TextureResult {
  const nf = new NoiseField(name, 5, 64)
  const [primary, c1, c2, c3] = pickPalette(profile)

  const bandA = hexToRgb(c1)
  const bandB = hexToRgb(c2)
  const bandC = hexToRgb(c3)
  const bandD = hexToRgb(primary)

  return opaque(
    canvasFromRGBA(size, (x, y) => {
      const turb = nf.sample(x * 3, y * 6) * 1.6 + nf.sample(x * 9, y * 14) * 0.5
      const band = Math.sin(y * Math.PI * 14 + turb * 2.2) * 0.5 + 0.5
      let col = ramp(
        [
          [0, bandC],
          [0.35, bandA],
          [0.55, bandB],
          [0.75, bandC],
          [1, bandD],
        ],
        band,
      )
      const swirl = nf.sample(x * 5, y * 3)
      col = mixRGB(col, bandB, swirl * 0.18)
      return [col[0], col[1], col[2], 255]
    }),
  )
}

export function buildRockyTexture(
  name: string,
  profile: PlanetVisualProfile,
  size = 1024,
): TextureResult {
  const nf = new NoiseField(name, 6, 80)
  const [, c1, c2, c3] = pickPalette(profile)

  const base = hexToRgb(c1)
  const dark = hexToRgb(c3)
  const light = hexToRgb(c2)

  const r = rngFrom(`${name}:cr`)
  const craters: { x: number; y: number; rad: number; deep: number }[] = []
  for (let i = 0; i < 26; i++) {
    craters.push({ x: r(), y: r(), rad: 0.02 + r() * 0.07, deep: r() })
  }

  return opaque(
    canvasFromRGBA(size, (x, y) => {
      let e = nf.sample(x * 2, y * 2) * 0.6 + nf.sample(x * 6, y * 6) * 0.4
      let col = ramp(
        [
          [0, dark],
          [0.5, base],
          [1, light],
        ],
        e,
      )
      for (const cr of craters) {
        const dx = x - cr.x
        const dy = y - cr.y
        const d = Math.sqrt(dx * dx + dy * dy) / cr.rad
        if (d < 1) {
          const rim = 1 - Math.abs(d - 0.78) / 0.22
          col = mixRGB(col, light, Math.max(0, rim) * 0.7 * cr.deep)
          col = mixRGB(col, dark, Math.max(0, 1 - d) * 0.6)
        }
      }
      return [col[0], col[1], col[2], 255]
    }),
  )
}

export function buildIceTexture(
  name: string,
  profile: PlanetVisualProfile,
  size = 1024,
): TextureResult {
  const nf = new NoiseField(name, 4, 48)
  const [primary, c1, c2] = pickPalette(profile)

  const a = hexToRgb(c1)
  const b = hexToRgb(c2)
  const c = hexToRgb(primary)

  return opaque(
    canvasFromRGBA(size, (x, y) => {
      const band =
        Math.sin(y * Math.PI * 6 + nf.sample(x * 4, y * 4) * 3) * 0.5 + 0.5
      const col = ramp(
        [
          [0, c],
          [0.5, a],
          [1, b],
        ],
        band,
      )
      return [col[0], col[1], col[2], 255]
    }),
  )
}

export function buildVenusTexture(
  name: string,
  profile: PlanetVisualProfile,
  size = 1024,
): TextureResult {
  const nf = new NoiseField(name, 4, 48)
  const [primary] = pickPalette(profile)
  const base = hexToRgb(primary)

  return opaque(
    canvasFromRGBA(size, (x, y) => {
      const v = nf.sample(x * 4, y * 4)
      return [
        Math.min(255, base[0] + 40 * v),
        Math.min(255, base[1] + 30 * v),
        Math.min(255, base[2] + 20 * v),
        255,
      ]
    }),
  )
}

export function buildCloudTexture(
  name: string,
  size = 512,
): TextureResult {
  const nf = new NoiseField(name, 5, 64)
  return alpha(
    canvasFromRGBA(size, (x, y) => {
      const v =
        nf.sample(x * 2, y * 2) * 0.7 + nf.sample(x * 8, y * 8) * 0.3
      const a = Math.max(0, Math.min(1, (v - 0.55) * 3))
      return [255, 255, 255, a * 255]
    }),
  )
}

export function buildRingTexture(
  name: string,
  profile: PlanetVisualProfile,
  size = 512,
): TextureResult {
  const nf = new NoiseField(name, 4, 48)
  const [primary, c1, c2] = pickPalette(profile)
  const inner = hexToRgb(c1)
  const outer = hexToRgb(c2)
  const accent = hexToRgb(primary)

  return alpha(
    canvasFromRGBA(size, (x, y) => {
      const r = Math.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2) * 2
      if (r < 0.55 || r > 1) return [0, 0, 0, 0]
      const band = nf.sample(x * 8, y * 8)
      let col = mixRGB(inner, outer, r - 0.55)
      col = mixRGB(col, accent, band * 0.25)
      const a = 0.55 + band * 0.25
      // Fade edges
      const edge = Math.min(1, (r - 0.55) / 0.1, (1 - r) / 0.1)
      return [col[0], col[1], col[2], a * edge * 255]
    }),
  )
}

export function buildTerrainTexture(
  name: string,
  band: RadiusBand,
  profile: PlanetVisualProfile,
  size = 1024,
): TextureResult {
  switch (band) {
    case 'rocky':
      return buildRockyTexture(name, profile, size)
    case 'earthlike':
      return buildEarthlikeTexture(name, profile, size)
    case 'superearth':
      return buildSuperEarthTexture(name, profile, size)
    case 'gaseous':
      return buildGasTexture(name, profile, size)
    default:
      return buildEarthlikeTexture(name, profile, size)
  }
}

// ---------------------------------------------------------------------------
// Galaxy and universe backdrop textures
// ---------------------------------------------------------------------------

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function rgb(r: number, g: number, b: number): number[] {
  return [r, g, b]
}

/**
 * Seeded high-detail spiral-galaxy disk texture.
 *
 * Uses 3 logarithmic spiral arms, a warm core bulge, dark dust lanes between
 * arms, blue-white young-star clusters, and a soft rim alpha fade. Every choice
 * is driven by `rngFrom(seed)` — no Math.random.
 */
export function buildGalaxyDiskTexture(seed: string, size = 2048): TextureResult {
  const r = rngFrom(seed)
  const armCount = 3
  const armOffset = (Math.PI * 2) / armCount
  const winding = 4.0 + r() * 2.5
  const armWidth = 0.32 + r() * 0.14
  const coreRadius = 0.10 + r() * 0.06
  const dustStrength = 0.25 + r() * 0.25

  const clusters: {
    angle: number
    radius: number
    size: number
    strength: number
  }[] = []
  const clusterCount = 20 + Math.floor(r() * 16)
  for (let i = 0; i < clusterCount; i++) {
    const armIndex = Math.floor(r() * armCount)
    const radius = 0.14 + r() * 0.78
    const angle =
      armIndex * armOffset +
      winding * Math.log(radius + 0.04) +
      (r() - 0.5) * armWidth * 0.8
    clusters.push({
      angle,
      radius,
      size: 0.015 + r() * 0.035,
      strength: 0.25 + r() * 0.55,
    })
  }

  return alpha(
    canvasFromRGBA(size, (x, y) => {
      const dx = x - 0.5
      const dy = y - 0.5
      const dist = Math.sqrt(dx * dx + dy * dy) * 2
      if (dist > 1) return [0, 0, 0, 0]

      let angle = Math.atan2(dy, dx)
      if (angle < 0) angle += Math.PI * 2

      const core = Math.exp(-dist / coreRadius)

      let armDensity = 0
      let dustDensity = 0
      for (let a = 0; a < armCount; a++) {
        const armBase = a * armOffset
        const spiralAngle = armBase + winding * Math.log(dist + 0.04)
        let dAngle = Math.abs(angle - spiralAngle)
        dAngle = Math.min(dAngle, Math.PI * 2 - dAngle)

        const arm = Math.exp(
          -(dAngle * dAngle) / (armWidth * armWidth * 0.45),
        )
        armDensity = Math.max(armDensity, arm)

        const dustOffset = armWidth * 0.75
        const d1 = Math.abs(angle - (spiralAngle + dustOffset))
        const d2 = Math.abs(angle - (spiralAngle - dustOffset))
        const dustD = Math.min(
          Math.min(d1, Math.PI * 2 - d1),
          Math.min(d2, Math.PI * 2 - d2),
        )
        const dust = Math.exp(
          -(dustD * dustD) / (armWidth * armWidth * 0.22),
        )
        dustDensity = Math.max(dustDensity, dust)
      }

      const radialFalloff = Math.pow(1 - dist, 0.55)
      let density = core * 0.55 + armDensity * radialFalloff * (1 - core * 0.35)

      let clusterTint = 0
      for (const cl of clusters) {
        const dr = dist - cl.radius
        let da = Math.abs(angle - cl.angle)
        da = Math.min(da, Math.PI * 2 - da)
        const d = Math.sqrt(dr * dr + da * da * 0.04)
        if (d < cl.size * 1.6) {
          const falloff = 1 - d / (cl.size * 1.6)
          density += falloff * cl.strength
          clusterTint += falloff * cl.strength
        }
      }

      density *= 1 - dustDensity * dustStrength

      const coreColor = rgb(255, 214, 160)
      const armColor = rgb(225, 235, 255)
      const clusterColor = rgb(170, 205, 255)

      let col = mixRGB(coreColor, armColor, Math.min(1, dist / (coreRadius * 3.5)))
      col = mixRGB(col, clusterColor, Math.min(1, clusterTint))

      // Micro speckle using a cheap deterministic hash so the arms read as stars.
      const hx = Math.sin(x * 43758.5453 + y * 23421.675) * 43758.5453
      const speckle = (hx - Math.floor(hx)) * 0.12 - 0.06
      density += speckle
      density = Math.max(0, Math.min(1, density))

      const a = density * smoothstep(1.0, 0.82, dist)
      return [col[0], col[1], col[2], a * 255]
    }),
  )
}

/** Small warm additive glow placed at the galaxy centre. */
export function buildGalaxyCoreGlowTexture(size = 256): TextureResult {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d context not available')
  const gr = g.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  )
  gr.addColorStop(0, 'rgba(255, 230, 190, 0.95)')
  gr.addColorStop(0.22, 'rgba(255, 210, 150, 0.42)')
  gr.addColorStop(0.55, 'rgba(255, 190, 120, 0.12)')
  gr.addColorStop(1, 'rgba(255, 180, 100, 0)')
  g.fillStyle = gr
  g.fillRect(0, 0, size, size)
  return alpha(c)
}

/** Large soft blue-white halo surrounding the whole disk. */
export function buildGalaxyHaloTexture(size = 512): TextureResult {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d context not available')
  const gr = g.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  )
  gr.addColorStop(0, 'rgba(200, 220, 255, 0.14)')
  gr.addColorStop(0.35, 'rgba(180, 205, 255, 0.07)')
  gr.addColorStop(0.75, 'rgba(160, 190, 255, 0.02)')
  gr.addColorStop(1, 'rgba(140, 180, 255, 0)')
  g.fillStyle = gr
  g.fillRect(0, 0, size, size)
  return alpha(c)
}

/**
 * Seeded distant-galaxy billboard texture.
 *
 * Produces a mix of face-on blue spirals, edge-on orange slivers with a dark
 * dust lane, and soft elliptical blobs.
 */
export function buildDistantGalaxyTexture(
  seed: string,
  size = 512,
): TextureResult {
  const r = rngFrom(seed)
  const morph = r()

  if (morph < 0.55) {
    // Face-on blue-white spiral.
    const armCount = 2 + Math.floor(r() * 3)
    const armOffset = (Math.PI * 2) / armCount
    const winding = 3.0 + r() * 2.5
    const armWidth = 0.28 + r() * 0.18
    const coreRadius = 0.08 + r() * 0.06
    const tint = r() < 0.5 ? rgb(200, 220, 255) : rgb(255, 235, 220)

    return alpha(
      canvasFromRGBA(size, (x, y) => {
        const dx = x - 0.5
        const dy = y - 0.5
        const dist = Math.sqrt(dx * dx + dy * dy) * 2
        if (dist > 1) return [0, 0, 0, 0]
        let angle = Math.atan2(dy, dx)
        if (angle < 0) angle += Math.PI * 2

        let density = Math.exp(-dist / coreRadius) * 0.6
        for (let a = 0; a < armCount; a++) {
          const spiralAngle =
            a * armOffset + winding * Math.log(dist + 0.04)
          let dAngle = Math.abs(angle - spiralAngle)
          dAngle = Math.min(dAngle, Math.PI * 2 - dAngle)
          const arm = Math.exp(
            -(dAngle * dAngle) / (armWidth * armWidth * 0.45),
          )
          density = Math.max(
            density,
            arm * Math.pow(1 - dist, 0.4) * 0.75,
          )
        }

        const armColor = mixRGB(tint, rgb(255, 250, 240), 0.4)
        const col = mixRGB(rgb(255, 250, 240), armColor, Math.min(1, dist / 0.35))
        const a = density * smoothstep(1.0, 0.78, dist)
        return [col[0], col[1], col[2], a * 255]
      }),
    )
  }

  if (morph < 0.85) {
    // Edge-on orange sliver with a dark central dust lane.
    const tilt = (r() - 0.5) * 0.5
    const cos = Math.cos(tilt)
    const sin = Math.sin(tilt)

    return alpha(
      canvasFromRGBA(size, (x, y) => {
        const dx = x - 0.5
        const dy = y - 0.5
        const u = dx * cos - dy * sin
        const v = dx * sin + dy * cos
        const dist = Math.sqrt(u * u * 0.12 + v * v * 4.5)
        if (dist > 1) return [0, 0, 0, 0]

        const bulge = Math.exp(-dist * dist * 2.5)
        const lane = Math.exp(-v * v * 90) * (1 - dist * 0.6)
        let density = bulge * (1 - lane * 0.55)
        density = Math.max(0, density)

        const col = mixRGB(rgb(255, 225, 185), rgb(255, 175, 115), dist)
        const a = density * smoothstep(1.0, 0.72, dist)
        return [col[0], col[1], col[2], a * 255]
      }),
    )
  }

  // Faint elliptical blob.
  const hueShift = r()
  const colBase =
    hueShift < 0.33
      ? rgb(255, 240, 220)
      : hueShift < 0.66
        ? rgb(220, 235, 255)
        : rgb(255, 230, 235)

  return alpha(
    canvasFromRGBA(size, (x, y) => {
      const dx = x - 0.5
      const dy = y - 0.5
      const dist = Math.sqrt(dx * dx + dy * dy) * 2
      if (dist > 1) return [0, 0, 0, 0]
      const density = Math.exp(-dist * dist * 2.8)
      const col = mixRGB(colBase, rgb(255, 250, 240), dist)
      const a = density * smoothstep(1.0, 0.75, dist)
      return [col[0], col[1], col[2], a * 255]
    }),
  )
}
