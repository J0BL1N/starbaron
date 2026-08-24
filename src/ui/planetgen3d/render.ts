/**
 * Thin THREE.js scene builder and animation loop for the 3D planet generator.
 */

import * as THREE from 'three'
import type { PlanetVisualProfile } from '../../sim/planets/types'
import type { RadiusBand } from '../../sim/planets/visual'
import {
  buildTerrainTexture,
  buildCloudTexture,
  buildRingTexture,
  buildVenusTexture,
  buildGalaxyDiskTexture,
  buildGalaxyCoreGlowTexture,
  buildGalaxyHaloTexture,
  buildDistantGalaxyTexture,
  type TextureResult,
} from './textures'
import { starModelFromType } from './spectral'
import { keplerPosition } from './orbits'
import { rngFrom } from './random'
import type { HostStar } from './hosts'
import type { SolarSystemData, PlanetData, MoonData } from './system'
import { buildSolarSystem } from './system'
import { DEFAULT_GALAXY_RADIUS } from './galaxy'

// ---------------------------------------------------------------------------
// Texture cache
// ---------------------------------------------------------------------------

const textureCache = new Map<string, TextureResult>()

function cacheKey(name: string, kind: string): string {
  return `${name}|${kind}`
}

function getCached(
  name: string,
  kind: string,
  builder: () => TextureResult,
): TextureResult {
  const key = cacheKey(name, kind)
  let result = textureCache.get(key)
  if (!result) {
    result = builder()
    textureCache.set(key, result)
  }
  return result
}

export function clearTextureCache(): void {
  textureCache.clear()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToColor(hex: string): THREE.Color {
  return new THREE.Color(hex)
}

function makeCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function glowSpriteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d context not available')
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  gr.addColorStop(0, 'rgba(255,232,170,0.5)')
  gr.addColorStop(0.25, 'rgba(255,204,110,0.16)')
  gr.addColorStop(1, 'rgba(255,200,100,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Round radial-gradient sprite used for galaxy host-star dots.
 * PointsMaterial defaults to squares; this texture makes them round disks.
 */
function makeCircleSprite(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d context not available')
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.55, 'rgba(255,255,255,1)')
  gr.addColorStop(0.85, 'rgba(255,255,255,0.35)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function atmosphereMaterial(tint: string, strength = 1.4): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tint: { value: new THREE.Color(tint) },
      strength: { value: strength },
    },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      uniform float strength;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(vN, vV)), 3.0);
        gl_FragColor = vec4(tint, f * strength);
      }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  })
}

function ringMaterial(
  innerRadius: number,
  outerRadius: number,
  texture: THREE.CanvasTexture,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      innerRadius: { value: innerRadius },
      outerRadius: { value: outerRadius },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float innerRadius;
      uniform float outerRadius;
      varying vec2 vUv;
      void main() {
        float r = innerRadius + vUv.x * (outerRadius - innerRadius);
        vec4 tex = texture2D(map, vec2(vUv.x, 0.5));
        gl_FragColor = vec4(tex.rgb, tex.a);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  })
}

// ---------------------------------------------------------------------------
// Scene-graph builders
// ---------------------------------------------------------------------------

interface PlanetMeshes {
  group: THREE.Group
  surface: THREE.Mesh
  clouds?: THREE.Mesh
  atmosphere?: THREE.Mesh
  rings: THREE.Mesh[]
  moons: { mesh: THREE.Mesh; data: MoonData }[]
}

function buildPlanet(
  data: PlanetData,
  scene: THREE.Scene,
): PlanetMeshes {
  const group = new THREE.Group()

  // Surface texture
  const band: RadiusBand = data.band
  const isVenusLike =
    data.profile.atmosphereTint !== null &&
    (band === 'rocky' || band === 'earthlike') &&
    rngFrom(`${data.seed}|kind`)() > 0.7

  const terrainResult = isVenusLike
    ? getCached(data.name, 'venus', () =>
        buildVenusTexture(data.name, data.profile, data.textureSize),
      )
    : getCached(data.name, band, () =>
        buildTerrainTexture(data.name, band, data.profile, data.textureSize),
      )

  const geometry = new THREE.SphereGeometry(data.radius, 48, 48)
  const material = new THREE.MeshStandardMaterial({
    map: makeCanvasTexture(terrainResult.canvas),
    roughness: 0.92,
    metalness: 0,
  })
  const surface = new THREE.Mesh(geometry, material)
  surface.rotation.z = data.elements.tilt
  group.add(surface)

  // Clouds
  let clouds: THREE.Mesh | undefined
  if (data.hasClouds) {
    const cloudResult = getCached(data.name, 'clouds', () =>
      buildCloudTexture(`${data.name}:cl`, 512),
    )
    const cloudMat = new THREE.MeshStandardMaterial({
      map: makeCanvasTexture(cloudResult.canvas),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      roughness: 1,
    })
    clouds = new THREE.Mesh(
      new THREE.SphereGeometry(data.radius * 1.025, 48, 48),
      cloudMat,
    )
    group.add(clouds)
  }

  // Atmosphere fresnel
  let atmosphere: THREE.Mesh | undefined
  if (data.hasAtmosphere && data.profile.atmosphereTint) {
    atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(data.radius * 1.14, 48, 48),
      atmosphereMaterial(data.profile.atmosphereTint),
    )
    group.add(atmosphere)
  }

  // Rings
  const rings: THREE.Mesh[] = []
  if (data.profile.ringed) {
    const ringResult = getCached(data.name, 'rings', () =>
      buildRingTexture(data.name, data.profile, 512),
    )
    const tex = makeCanvasTexture(ringResult.canvas)

    const innerR = data.radius * 1.6
    const outerR = data.radius * 2.5
    const ringGeo = new THREE.RingGeometry(innerR, outerR, 64)
    const ringMat = ringMaterial(innerR, outerR, tex)
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2 + 0.28
    ring.rotation.z = 0.15
    group.add(ring)
    rings.push(ring)

    const innerR2 = data.radius * 2.6
    const outerR2 = data.radius * 2.9
    const ringGeo2 = new THREE.RingGeometry(innerR2, outerR2, 64)
    const ringMat2 = ringMaterial(innerR2, outerR2, tex)
    const ring2 = new THREE.Mesh(ringGeo2, ringMat2)
    ring2.rotation.x = Math.PI / 2 + 0.28
    ring2.rotation.z = 0.15
    group.add(ring2)
    rings.push(ring2)
  }

  // Moons orbit the planet group, but for the solar-system view they need to
  // be added to the scene and follow the planet position. We return metadata
  // and let the animator place them.
  const moons: { mesh: THREE.Mesh; data: MoonData }[] = []
  for (const moon of data.moons) {
    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(data.radius * 0.09, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0x9aa0b0, roughness: 1 }),
    )
    scene.add(moonMesh)
    moons.push({ mesh: moonMesh, data: moon })
  }

  scene.add(group)

  return { group, surface, clouds, atmosphere, rings, moons }
}

function buildStar(
  data: SolarSystemData,
  scene: THREE.Scene,
): { mesh: THREE.Mesh; glow: THREE.Sprite; baseSize: number } {
  const model = data.starModel
  const baseSize = 2.6 * model.size

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(baseSize, 32, 32),
    new THREE.MeshBasicMaterial({ color: hexToColor(model.color) }),
  )
  scene.add(core)

  const glowMat = new THREE.SpriteMaterial({
    map: glowSpriteTexture(),
    color: hexToColor(model.glowColor),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  })
  const glow = new THREE.Sprite(glowMat)
  glow.scale.set(baseSize * 5, baseSize * 5, 1)
  scene.add(glow)

  return { mesh: core, glow, baseSize }
}

const ASTEROID_COLORS = [
  0x8a7a6a, 0x9a8a72, 0x6e6658, 0x7a7268, 0xa09078, 0x5e5648,
]

function buildAsteroidBelt(
  belt: SolarSystemData['asteroidBelt'],
  scene: THREE.Scene,
): THREE.InstancedMesh {
  // 10-segment spheres + per-instance colour so the belt reads as rocks,
  // not uniform blocky specks.
  const geometry = new THREE.SphereGeometry(1, 10, 10)
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const mesh = new THREE.InstancedMesh(geometry, material, belt.asteroids.length)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  const color = new THREE.Color()
  for (let i = 0; i < belt.asteroids.length; i++) {
    color.setHex(ASTEROID_COLORS[i % ASTEROID_COLORS.length])
    mesh.setColorAt(i, color)
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  scene.add(mesh)
  return mesh
}

/**
 * Precomputed circular-orbit parameters for one asteroid.
 *
 * Belt rocks are visually indistinguishable at their scale, so the animator
 * uses a cheap circular model (constant angular speed, inclination/node folded
 * into two precomputed basis coefficients) instead of the full Kepler solve
 * the planets use. This removes ~1400 pow()+trig chains PER FRAME — the
 * single biggest CPU hotspot in the old loop.
 */
export interface AsteroidFast {
  a: number
  baseAngle: number
  angularSpeed: number
  cosNode: number
  sinNode: number
  sinInc: number
  cosInc: number
  scale: number
}

export function buildAsteroidFastTable(
  asteroids: SolarSystemData['asteroidBelt']['asteroids'],
): AsteroidFast[] {
  const table: AsteroidFast[] = new Array(asteroids.length)
  for (let i = 0; i < asteroids.length; i++) {
    const el = asteroids[i].elements
    table[i] = {
      a: el.a,
      baseAngle: el.phase + el.argP,
      angularSpeed: (Math.PI * 2) / el.period,
      cosNode: Math.cos(el.node),
      sinNode: Math.sin(el.node),
      sinInc: Math.sin(el.inc),
      cosInc: Math.cos(el.inc),
      scale: 0.025 + ((i * 37) % 9) * 0.008,
    }
  }
  return table
}

export interface GalaxyLocator {
  hostName: string
  position: THREE.Vector3
  tier: number
  claimed: boolean
  home: boolean
  group: THREE.Group
}

export interface GalaxyLayer {
  root: THREE.Group
  backdrop: THREE.Object3D
  field: THREE.Points
  locatorLayer: THREE.Group
  locators: Map<string, GalaxyLocator>
  fleetLayer: THREE.Group
  highlightLayer: THREE.Group
  homeRing?: THREE.Mesh
  hostByName: Map<string, HostStar>
}

const TIER_COLORS = [
  new THREE.Color(0x4a4a52), // T1 dim grey
  new THREE.Color(0x6a6a78),
  new THREE.Color(0x8a8a9a),
  new THREE.Color(0xb8a060),
  new THREE.Color(0xffa040), // T5 bright warm
]

const OWNED_LOCATOR_COLOR = new THREE.Color(0xffe8a0)
const HOME_LOCATOR_COLOR = new THREE.Color(0x60d0ff)

/**
 * Build the star-first galaxy view.
 *
 * Dots are HOST STARS, not individual planets. Each host's colour is the tier
 * colour of its BEST planet, so the existing tier legend stays meaningful while
 * the view collapses multi-planet systems to a single point. Locators are
 * static Groups created once; the pulsing home ring lives in a separate
 * highlightLayer so locator transforms are never mutated at runtime.
 */
export function buildGalaxy(
  data: SolarSystemData['galaxy'],
  scene: THREE.Scene,
  ownedNames: Set<string>,
  highlightName?: string,
): GalaxyLayer {
  const root = new THREE.Group()
  root.name = 'galaxyLayer'

  const hosts = data.hosts
  const hostByName = new Map<string, HostStar>()
  for (const host of hosts) {
    hostByName.set(host.hostname, host)
  }

  // Map planet names to their host for locator assignment.
  const hostByPlanetName = new Map<string, string>()
  for (const host of hosts) {
    for (const entry of host.entries) {
      hostByPlanetName.set(entry.name, host.hostname)
    }
  }

  // -------------------------------------------------------------------------
  // High-detail galaxy backdrop: one disk mesh + core glow + halo.
  // Seeded from data.backdropSeed so the same system always shows the same
  // galaxy. The disk spins in the XZ plane; host stars are rendered as a single
  // Points field on top of it.
  // -------------------------------------------------------------------------
  const R = DEFAULT_GALAXY_RADIUS

  const diskResult = getCached(data.backdropSeed, 'galaxy-disk', () =>
    buildGalaxyDiskTexture(data.backdropSeed, 2048),
  )
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(R, 64),
    new THREE.MeshBasicMaterial({
      map: makeCanvasTexture(diskResult.canvas),
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  disk.name = 'galaxyDisk'
  disk.rotation.x = -Math.PI / 2
  root.add(disk)

  const coreGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeCanvasTexture(buildGalaxyCoreGlowTexture().canvas),
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  )
  coreGlow.name = 'galaxyCoreGlow'
  coreGlow.scale.set(R * 0.18, R * 0.18, 1)
  root.add(coreGlow)

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeCanvasTexture(buildGalaxyHaloTexture().canvas),
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  )
  halo.name = 'galaxyHalo'
  halo.scale.set(R * 2.4, R * 2.4, 1)
  root.add(halo)

  const backdrop: THREE.Object3D = disk

  // -------------------------------------------------------------------------
  // Host star field: one round dot per host star, coloured by best tier.
  // -------------------------------------------------------------------------
  const hostCount = hosts.length
  const fieldColors = new Float32Array(hostCount * 3)
  const fieldSizes = new Float32Array(hostCount)

  for (let i = 0; i < hostCount; i++) {
    const tier = hosts[i].bestTier
    const tierColor = TIER_COLORS[(tier - 1) % TIER_COLORS.length]
    fieldColors[i * 3] = tierColor.r
    fieldColors[i * 3 + 1] = tierColor.g
    fieldColors[i * 3 + 2] = tierColor.b
    fieldSizes[i] = 0.9 + tier * 0.16
  }

  const fieldGeometry = new THREE.BufferGeometry()
  fieldGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(data.hostPositions.slice(), 3),
  )
  fieldGeometry.setAttribute(
    'color',
    new THREE.BufferAttribute(fieldColors, 3),
  )

  const circleSprite = makeCircleSprite()
  const fieldMaterial = new THREE.PointsMaterial({
    size: 2.4,
    vertexColors: true,
    map: circleSprite,
    transparent: true,
    opacity: 0.92,
    sizeAttenuation: true,
    alphaTest: 0.15,
    depthWrite: false,
  })

  const field = new THREE.Points(fieldGeometry, fieldMaterial)
  field.name = 'hostStarField'
  root.add(field)

  // -------------------------------------------------------------------------
  // Locators: one static named Group per HOST. Unowned = subtle tier dot;
  // owned = bright pin; home ring is added to a separate highlight layer.
  // -------------------------------------------------------------------------
  const locatorLayer = new THREE.Group()
  locatorLayer.name = 'locatorLayer'
  const locators = new Map<string, GalaxyLocator>()
  const sharedDotGeometry = new THREE.SphereGeometry(1, 8, 8)

  // Determine which hosts are owned / highlighted.
  const ownedHosts = new Set<string>()
  for (const name of ownedNames) {
    const hostName = hostByPlanetName.get(name)
    if (hostName) ownedHosts.add(hostName)
  }
  const highlightHostName = highlightName
    ? hostByPlanetName.get(highlightName)
    : undefined

  for (let i = 0; i < hostCount; i++) {
    const host = hosts[i]
    const x = data.hostPositions[i * 3]
    const y = data.hostPositions[i * 3 + 1]
    const z = data.hostPositions[i * 3 + 2]
    const position = new THREE.Vector3(x, y, z)
    const claimed = ownedHosts.has(host.hostname)
    const home = highlightHostName === host.hostname

    const group = new THREE.Group()
    group.name = host.hostname
    group.position.copy(position)
    group.userData.hostIndex = i

    // Unowned marker: small tier-colored dot.
    const dot = new THREE.Mesh(
      sharedDotGeometry,
      new THREE.MeshBasicMaterial({
        color: TIER_COLORS[(host.bestTier - 1) % TIER_COLORS.length],
        transparent: true,
        opacity: 0.85,
      }),
    )
    dot.scale.setScalar(0.65 + host.bestTier * 0.14)
    dot.name = 'hostDot'
    group.add(dot)

    if (claimed) {
      const pin = new THREE.Mesh(
        sharedDotGeometry,
        new THREE.MeshBasicMaterial({ color: OWNED_LOCATOR_COLOR }),
      )
      pin.scale.setScalar(1.8)
      pin.name = 'ownedPin'
      group.add(pin)
    }

    locatorLayer.add(group)
    locators.set(host.hostname, {
      hostName: host.hostname,
      position,
      tier: host.bestTier,
      claimed,
      home,
      group,
    })
  }

  root.add(locatorLayer)

  // -------------------------------------------------------------------------
  // Highlight layer: dynamic visuals that pulse/animate without touching the
  // static locator Groups. Currently: home ring around the highlighted host.
  // -------------------------------------------------------------------------
  const highlightLayer = new THREE.Group()
  highlightLayer.name = 'highlightLayer'
  const homeRing: THREE.Mesh | undefined = highlightHostName
    ? (() => {
        const locator = locators.get(highlightHostName)
        if (!locator) return undefined
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(4, 5.2, 32),
          new THREE.MeshBasicMaterial({
            color: HOME_LOCATOR_COLOR,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8,
          }),
        )
        ring.name = 'homeRing'
        ring.position.copy(locator.position)
        ring.lookAt(0, 0, 0)
        highlightLayer.add(ring)
        return ring
      })()
    : undefined

  root.add(highlightLayer)

  // -------------------------------------------------------------------------
  // Fleet layer: empty dynamic layer for future attack/colonisation fleets.
  // Fleets will attach here and animate between static locator positions.
  // -------------------------------------------------------------------------
  const fleetLayer = new THREE.Group()
  fleetLayer.name = 'fleetLayer'
  root.add(fleetLayer)

  scene.add(root)
  return {
    root,
    backdrop,
    field,
    locatorLayer,
    locators,
    fleetLayer,
    highlightLayer,
    homeRing,
    hostByName,
  }
}

export function buildUniverse(
  data: SolarSystemData['universe'],
  scene: THREE.Scene,
): THREE.Group {
  const root = new THREE.Group()
  root.name = 'universeLayer'

  const r = rngFrom(data.seed)

  // Subtle deep-space starfield: one Points object.
  const starCount = 600
  const starPositions = new Float32Array(starCount * 3)
  const starColors = new Float32Array(starCount * 3)
  const color = new THREE.Color()
  for (let i = 0; i < starCount; i++) {
    const shell = 2500 + r() * 3500
    const theta = r() * Math.PI * 2
    const phi = Math.acos(2 * r() - 1)
    starPositions[i * 3] = shell * Math.sin(phi) * Math.cos(theta)
    starPositions[i * 3 + 1] = shell * Math.sin(phi) * Math.sin(theta)
    starPositions[i * 3 + 2] = shell * Math.cos(phi)
    color.setHSL(0.55 + r() * 0.12, 0.25 + r() * 0.25, 0.65 + r() * 0.25)
    starColors[i * 3] = color.r
    starColors[i * 3 + 1] = color.g
    starColors[i * 3 + 2] = color.b
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3))
  const starField = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({
      size: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      sizeAttenuation: true,
      map: makeCircleSprite(),
      alphaTest: 0.1,
      depthWrite: false,
    }),
  )
  starField.name = 'universeStarfield'
  root.add(starField)

  // Distant galaxy sprites: 20–40 seeded billboards in one group.
  const galaxyCount = 24 + Math.floor(r() * 18)
  const galaxySprites = new THREE.Group()
  galaxySprites.name = 'distantGalaxySprites'
  for (let i = 0; i < galaxyCount; i++) {
    const spriteSeed = `${data.seed}|sprite|${i}`
    const texResult = getCached(spriteSeed, 'distant-galaxy', () =>
      buildDistantGalaxyTexture(spriteSeed, 256),
    )
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeCanvasTexture(texResult.canvas),
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    )
    sprite.name = `distantGalaxy|${i}`

    const shell = 3200 + r() * 2800
    const theta = r() * Math.PI * 2
    const phi = Math.acos(2 * r() - 1)
    sprite.position.set(
      shell * Math.sin(phi) * Math.cos(theta),
      shell * Math.sin(phi) * Math.sin(theta),
      shell * Math.cos(phi),
    )

    const scale = 120 + r() * 240
    sprite.scale.set(scale, scale * (0.5 + r() * 0.8), 1)
    sprite.material.rotation = r() * Math.PI * 2
    galaxySprites.add(sprite)
  }
  root.add(galaxySprites)

  scene.add(root)
  return root
}

// ---------------------------------------------------------------------------
// Orbit tracks
// ---------------------------------------------------------------------------

function buildOrbitTrack(data: PlanetData): THREE.Line {
  const pts: THREE.Vector3[] = []
  for (let k = 0; k <= 160; k++) {
    const el = data.elements
    const p = keplerPosition(el.a, el.e, el.inc, el.node, el.argP, el.period, (k / 160) * el.period)
    pts.push(new THREE.Vector3(p.x, p.y, p.z))
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({
      color: 0x5a6ca0,
      transparent: true,
      opacity: data.band === 'gaseous' ? 0.4 : 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
}


// ---------------------------------------------------------------------------
// WebGL availability
// ---------------------------------------------------------------------------

function isWebGLAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl') || c.getContext('experimental-webgl'))
  } catch {
    return false
  }
}

function fallbackPlanetCanvas(
  name: string,
  profile: PlanetVisualProfile,
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')
  if (!g) return c
  const palette = profile.surfacePalette
  g.fillStyle = palette[1] ?? '#444'
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = palette[0] ?? '#888'
  g.beginPath()
  g.arc(128, 128, 96, 0, Math.PI * 2)
  g.fill()
  if (profile.atmosphereTint) {
    g.fillStyle = profile.atmosphereTint
    g.globalAlpha = 0.25
    g.beginPath()
    g.arc(128, 128, 110, 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 1
  }
  g.fillStyle = '#ffffff'
  g.font = '12px sans-serif'
  g.textAlign = 'center'
  g.fillText(name, 128, 236)
  return c
}

// ---------------------------------------------------------------------------
// Planet renderer (close-up spinning planet)
// ---------------------------------------------------------------------------

export interface PlanetRenderer {
  canvas: HTMLCanvasElement
  dispose: () => void
}

export function createPlanetRenderer(
  name: string,
  profile: PlanetVisualProfile,
  tier: number,
  radiusBand: RadiusBand,
  starType?: string,
): PlanetRenderer {
  if (!isWebGLAvailable()) {
    return {
      canvas: fallbackPlanetCanvas(name, profile),
      dispose: () => {},
    }
  }

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1000)
  camera.position.set(0, 0, 3.4)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(dpr)
  renderer.setSize(512, 512)

  // Lighting
  scene.add(new THREE.AmbientLight(0x223344, 0.4))
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.4)
  sun.position.set(5, 3, 4)
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0x4466aa, 0.35)
  fill.position.set(-4, -2, -3)
  scene.add(fill)

  // Star (sun)
  const model = starModelFromType(starType)
  const baseSize = 2.6 * model.size
  const starMesh = new THREE.Mesh(
    new THREE.SphereGeometry(baseSize, 32, 32),
    new THREE.MeshBasicMaterial({ color: hexToColor(model.color) }),
  )
  starMesh.position.set(8, 4, 6)
  scene.add(starMesh)

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowSpriteTexture(),
      color: hexToColor(model.glowColor),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  )
  glow.scale.set(baseSize * 5.5, baseSize * 5.5, 1)
  glow.position.copy(starMesh.position)
  scene.add(glow)

  // Planet
  const data = buildSolarSystem(
    name,
    name,
    profile,
    tier,
    radiusBand,
    starType,
  ).planets.find((p) => p.name === name)!

  const planet = buildPlanet(data, scene)

  let disposed = false
  let raf = 0
  const clock = new THREE.Clock()

  function animate() {
    if (disposed) return
    raf = requestAnimationFrame(animate)
    const dt = Math.min(clock.getDelta(), 0.05)

    planet.surface.rotation.y += dt * data.elements.spin
    if (planet.clouds) {
      planet.clouds.rotation.y += dt * data.elements.spin * 0.6
    }

    // Slowly pulse the star glow.
    const pulse = 1 + Math.sin(clock.elapsedTime * 1.5) * 0.03
    glow.scale.set(
      baseSize * 5.5 * pulse,
      baseSize * 5.5 * pulse,
      1,
    )

    // Animate moons around the planet.
    const simTime = clock.elapsedTime * 2
    for (const moon of planet.moons) {
      const el = moon.data.elements
      const pos = keplerPosition(el.a, el.e, el.inc, el.node, el.argP, el.period, simTime)
      moon.mesh.position.set(pos.x, pos.y, pos.z)
    }

    renderer.render(scene, camera)
  }

  animate()

  return {
    canvas: renderer.domElement,
    dispose: () => {
      disposed = true
      cancelAnimationFrame(raf)
      renderer.dispose()
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose())
          } else {
            obj.material.dispose()
          }
        }
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Solar system renderer (star-first 3-level zoom journey)
// ---------------------------------------------------------------------------

export interface SolarSystemRenderer {
  canvas: HTMLCanvasElement
  dispose: () => void
}

/** One projected planet-telemetry sample delivered to the React HUD layer.
 *
 * Deliberately NDC-space: the renderer owns the camera, the HUD layer owns
 * the pixels. This removes the renderer's dependence on canvas client size
 * (which read as 1×1 inside the render loop in some environments) and lets
 * the layer convert with its own reliably-measured container rect.
 */
export interface PlanetTelemetrySample {
  name: string
  /** Normalised device coords of the planet centre (-1..1). */
  ndcX: number
  ndcY: number
  /** True when the planet is behind the camera. */
  behind: boolean
  /** World-space distance from the camera (for apparent-size math). */
  dist: number
  /** World-space planet radius. */
  worldRadius: number
  /** Camera zoom level (0 = close planet, 1 = system, 2 = galaxy). */
  level: number
  /** Radius band — drives the classification shown on the label. */
  band: RadiusBand | 'system'
  /** Catalogue tier 1–5. */
  tier: number
  /** 'planet' (system view) or 'system' (galaxy-view host callout). */
  kind: 'planet' | 'system'
  /** Ownership truth straight from the renderer's own options/state. */
  owned: boolean
  home: boolean
}

export interface CreateSolarSystemRendererOptions {
  seedName: string
  homePlanetName: string
  profile: PlanetVisualProfile
  tier: number
  radiusBand: RadiusBand
  starType?: string
  ownedPlanetNames?: readonly string[]
  highlightPlanetName?: string
  initialZoom?: number
  onHostSelected?: (host: HostStar) => void
  onPlanetSelected?: (planet: PlanetData) => void
  onZoomChanged?: (level: string) => void
  /**
   * Single-click selection at system zoom. Fires with the clicked planet, or
   * `null` when empty space was clicked (deselect). Never fires while the
   * camera is dragging.
   */
  onSelectPlanet?: (planet: PlanetData | null) => void
  /**
   * Hover callback — fires only when the hovered planet CHANGES (never per
   * mousemove). `null` = pointer left all planets.
   */
  onPlanetHovered?: (planet: PlanetData | null) => void
  /**
   * Throttled (~12 Hz) world→screen telemetry samples for every planet,
   * delivered AFTER each render so positions match the presented frame.
   */
  onTelemetry?: (samples: PlanetTelemetrySample[]) => void
}

export function createSolarSystemRenderer(
  options: CreateSolarSystemRendererOptions,
): SolarSystemRenderer {
  const {
    seedName,
    homePlanetName,
    profile,
    tier,
    radiusBand,
    starType,
    ownedPlanetNames,
    highlightPlanetName,
    initialZoom = 0,
    onHostSelected,
    onPlanetSelected,
    onZoomChanged,
    onSelectPlanet,
    onPlanetHovered,
    onTelemetry,
  } = options

  if (!isWebGLAvailable()) {
    return {
      canvas: fallbackPlanetCanvas(homePlanetName, profile),
      dispose: () => {},
    }
  }

  const scene = new THREE.Scene()
  const aspect = window.innerWidth / Math.max(1, window.innerHeight)
  const camera = new THREE.PerspectiveCamera(55, aspect, 0.01, 30000)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(dpr)
  renderer.setSize(window.innerWidth, window.innerHeight)

  // Lighting
  scene.add(new THREE.AmbientLight(0x223344, 0.4))
  const sunLight = new THREE.DirectionalLight(0xfff2d8, 2.4)
  sunLight.position.set(5, 3, 4)
  scene.add(sunLight)
  const fill = new THREE.DirectionalLight(0x4466aa, 0.35)
  fill.position.set(-4, -2, -3)
  scene.add(fill)

  // System data
  const system = buildSolarSystem(seedName, homePlanetName, profile, tier, radiusBand, starType)
  const homePlanet = system.planets.find((p) => p.name === homePlanetName)

  // Lazy solar-system mesh lifecycle: these meshes are heavy, so build them
  // only while the camera is near the system and dispose them at galaxy/universe
  // zoom. The plain `system` data is retained and rebuilding is cheap.
  let star: { mesh: THREE.Mesh; glow: THREE.Sprite; baseSize: number } | undefined
  let planetMeshes: PlanetMeshes[] = []
  let asteroidMesh: THREE.InstancedMesh | undefined
  let systemMeshesBuilt = false
  let asteroidFastTable: AsteroidFast[] = []

  const SYSTEM_MESH_DISPOSE_ZOOM = 1.8
  const SYSTEM_MESH_REBUILD_ZOOM = 1.5

  function buildSystemMeshes() {
    if (systemMeshesBuilt) return
    star = buildStar(system, scene)

    for (const planetData of system.planets) {
      const meshes = buildPlanet(planetData, scene)
      planetMeshes.push(meshes)

      const track = buildOrbitTrack(planetData)
      track.visible = false
      scene.add(track)
      meshes.group.userData.track = track
      meshes.group.userData.planet = planetData
    }

    asteroidMesh = buildAsteroidBelt(system.asteroidBelt, scene)
    asteroidFastTable = buildAsteroidFastTable(system.asteroidBelt.asteroids)
    systemMeshesBuilt = true
  }

  function disposeSystemMeshes() {
    if (!systemMeshesBuilt) return

    function disposeMaterial(m: THREE.Material | THREE.Material[]): void {
      const materials = Array.isArray(m) ? m : [m]
      for (const raw of materials) {
        const mat = raw as THREE.Material & { map?: THREE.Texture }
        if (mat.map) mat.map.dispose()
        mat.dispose()
      }
    }

    if (star) {
      scene.remove(star.mesh)
      scene.remove(star.glow)
      star.mesh.geometry.dispose()
      disposeMaterial(star.mesh.material)
      star.glow.material.map?.dispose()
      star.glow.material.dispose()
      star = undefined
    }

    for (const meshes of planetMeshes) {
      scene.remove(meshes.group)
      for (const moon of meshes.moons) {
        scene.remove(moon.mesh)
        moon.mesh.geometry.dispose()
        disposeMaterial(moon.mesh.material)
      }
      const track = meshes.group.userData.track as THREE.Line | undefined
      if (track) {
        scene.remove(track)
        track.geometry.dispose()
        disposeMaterial(track.material)
      }
      meshes.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          disposeMaterial(obj.material)
        }
      })
    }
    planetMeshes = []

    if (asteroidMesh) {
      scene.remove(asteroidMesh)
      asteroidMesh.geometry.dispose()
      disposeMaterial(asteroidMesh.material)
      asteroidMesh = undefined
    }
    asteroidFastTable = []

    systemMeshesBuilt = false
  }

  // Build initially if we start in system/planet view; otherwise stay empty.
  if (initialZoom < SYSTEM_MESH_DISPOSE_ZOOM) {
    buildSystemMeshes()
  }

  // Galaxy
  const ownedNames = new Set<string>(ownedPlanetNames ?? [])
  const galaxy = buildGalaxy(system.galaxy, scene, ownedNames, highlightPlanetName)
  galaxy.root.visible = initialZoom >= 1.5

  // Universe
  const universe = buildUniverse(system.universe, scene)
  universe.visible = initialZoom >= 2.5

  // Camera / zoom state
  const DISTANCES = [3.4, 62, 420, 4200]
  const LEVELS = ['Planet View', 'Solar System', 'Galaxy', 'Universe']
  let targetZoom = Math.max(0, Math.min(3, initialZoom))
  let currentZoom = targetZoom
  let yaw = 0.5
  let pitch = 0.45
  let dragging = false
  let lastX = 0
  let lastY = 0

  const canvas = renderer.domElement

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    targetZoom = Math.max(0, Math.min(3, targetZoom + (e.deltaY > 0 ? 0.22 : -0.22)))
  }

  function onMouseDown(e: MouseEvent) {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
  }

  function onMouseUp() {
    dragging = false
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragging) return
    yaw += (e.clientX - lastX) * 0.005
    pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - lastY) * 0.005))
    lastX = e.clientX
    lastY = e.clientY
  }

  function onHoverMove(e: MouseEvent) {
    if (dragging || currentZoom >= 1.5 || !systemMeshesBuilt) {
      setHovered(-1)
      return
    }
    const now = performance.now()
    if (now - hoverThrottleAt < 33) return // ~30 Hz max
    hoverThrottleAt = now

    const rect = canvas.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    if (pointer.x < -1.05 || pointer.x > 1.05 || pointer.y < -1.05 || pointer.y > 1.05) {
      setHovered(-1)
      return
    }
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(
      planetMeshes.map((m) => m.group),
      false,
    )
    if (hits.length === 0) {
      setHovered(-1)
      return
    }
    const group = hits[0].object as THREE.Object3D & { userData: { planetIndex?: number } }
    setHovered(group.userData.planetIndex ?? -1)
  }

  /** Reports hover changes only — never fires per mousemove. */
  function setHovered(index: number) {
    if (index === hoveredIndex) return
    hoveredIndex = index
    if (onPlanetHovered) {
      onPlanetHovered(index >= 0 ? system.planets[index] ?? null : null)
    }
  }

  function onResize() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    camera.aspect = w / Math.max(1, h)
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }

  // -------------------------------------------------------------------------
  // Click / ESC navigation
  // -------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  function zoomOutOneLevel() {
    if (targetZoom >= 2.0) targetZoom = 1.5
    else if (targetZoom >= 1.0) targetZoom = 0
    else targetZoom = 0
  }

  function pickHostAt(clientX: number, clientY: number): HostStar | undefined {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1

    raycaster.setFromCamera(pointer, camera)
    raycaster.params.Points.threshold = 8
    const hits = raycaster.intersectObject(galaxy.field, false)
    if (hits.length === 0) return undefined

    const index = hits[0].index
    if (index === undefined) return undefined
    return system.galaxy.hosts[index]
  }

  function pickPlanetAt(clientX: number, clientY: number): PlanetData | undefined {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1

    raycaster.setFromCamera(pointer, camera)
    const planetGroups = planetMeshes.map((m) => m.group)
    const hits = raycaster.intersectObjects(planetGroups, true)
    if (hits.length === 0) return undefined

    // Walk up from the hit mesh to its owning planet group.
    let obj: THREE.Object3D | null = hits[0].object
    while (obj !== null) {
      const data = (obj as THREE.Object3D).userData?.planet as PlanetData | undefined
      if (data !== undefined) return data
      obj = obj.parent
    }
    return undefined
  }

  function onPointerClick(e: MouseEvent) {
    if (dragging) return
    if (e.button !== 0) return

    if (currentZoom >= 1.5) {
      const host = pickHostAt(e.clientX, e.clientY)
      if (host && onHostSelected) {
        onHostSelected(host)
      }
      return
    }

    if (currentZoom >= 0.6) {
      // System zoom: single click selects (or deselects on empty space).
      const planet = pickPlanetAt(e.clientX, e.clientY)
      if (onSelectPlanet) {
        onSelectPlanet(planet ?? null)
      }
      return
    }
  }

  function onDoubleClick(e: MouseEvent) {
    if (e.button !== 0) return
    if (currentZoom >= 0.6 && currentZoom < 1.5) {
      // Preserve the existing close-up focus journey on double-click.
      const planet = pickPlanetAt(e.clientX, e.clientY)
      if (planet && onPlanetSelected) {
        onPlanetSelected(planet)
      }
    }
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault()
    zoomOutOneLevel()
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      zoomOutOneLevel()
    }
  }

  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('click', onPointerClick)
  canvas.addEventListener('dblclick', onDoubleClick)
  canvas.addEventListener('mousemove', onHoverMove)
  canvas.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKeyDown)

  let disposed = false
  let raf = 0
  const clock = new THREE.Clock()
  let simTime = 0
  // Scratch object reused for asteroid instance matrices (zero allocations/frame).
  const scratchObj = new THREE.Object3D()

  // Hover picking state — raycast on pointermove is throttled to ~30 Hz and
  // only reports CHANGES, so hovering stays cheap even while dragging.
  let hoverThrottleAt = 0
  let hoveredIndex = -1

  // Pre-frame camera target: home planet if present, otherwise origin.
  const targetObj = new THREE.Vector3(0, 0, 0)
  // Telemetry scratch state (no per-frame allocations).
  const TELEMETRY_INTERVAL_MS = 83 // ≈12 Hz
  let lastTelemetryAt = -1000
  const telemetryScratch: PlanetTelemetrySample[] = []
  const worldPos = new THREE.Vector3()
  // Manual frame clock — clock.elapsedTime is NOT advanced by getDelta() in
  // three.js, so all pulse/telemetry timers must use this accumulator.
  let animTime = 0

  function animate() {
    if (disposed) return
    raf = requestAnimationFrame(animate)
    const dt = Math.min(clock.getDelta(), 0.05)

    currentZoom += (targetZoom - currentZoom) * Math.min(1, dt * 2.2)
    simTime += dt * 2
    animTime += dt

    // Lazy build / dispose solar-system meshes as the camera moves between the
    // system view and the galaxy/universe view.
    if (systemMeshesBuilt && currentZoom >= SYSTEM_MESH_DISPOSE_ZOOM) {
      disposeSystemMeshes()
    } else if (!systemMeshesBuilt && currentZoom < SYSTEM_MESH_REBUILD_ZOOM) {
      buildSystemMeshes()
    }

    // Update planet positions and spins (only when meshes exist).
    if (systemMeshesBuilt) {
      for (let i = 0; i < system.planets.length; i++) {
        const data = system.planets[i]
        const meshes = planetMeshes[i]
        if (!meshes) continue
        const pos = keplerPosition(
          data.elements.a,
          data.elements.e,
          data.elements.inc,
          data.elements.node,
          data.elements.argP,
          data.elements.period,
          simTime + data.elements.phase,
        )
        meshes.group.position.set(pos.x, pos.y, pos.z)
        meshes.surface.rotation.y += dt * data.elements.spin
        if (meshes.clouds) {
          meshes.clouds.rotation.y += dt * data.elements.spin * 0.6
        }

        for (const moon of meshes.moons) {
          const el = moon.data.elements
          const mpos = keplerPosition(el.a, el.e, el.inc, el.node, el.argP, el.period, simTime + el.phase)
          moon.mesh.position.set(pos.x + mpos.x, pos.y + mpos.y, pos.z + mpos.z)
        }

        // Show orbit tracks at system zoom.
        const track: THREE.Line | undefined = meshes.group.userData.track
        if (track) {
          track.visible = currentZoom >= 0.8 && currentZoom < 2.5
        }

        // Zoom-scaled planets: real scale at close zoom, enlarged at system
        // zoom so texture, atmosphere and rings actually read on screen
        // (showcase look). Scales smoothly between 0.6 and 1.2 zoom.
        const planetScale =
          currentZoom <= 0.6
            ? 1
            : currentZoom >= 1.2
              ? 4.5
              : 1 + ((currentZoom - 0.6) / 0.6) * 3.5
        meshes.group.scale.setScalar(planetScale)
      }

      // Update asteroids via the precomputed circular-orbit table — no per-
      // frame Kepler solves. Positions are written straight into the
      // instance matrix with a reused scratch object.
      if (asteroidMesh) {
        for (let i = 0; i < asteroidFastTable.length; i++) {
          const fast = asteroidFastTable[i]
          const angle = fast.baseAngle + simTime * fast.angularSpeed
          const cosA = Math.cos(angle)
          const sinA = Math.sin(angle)
          // Inclined circular orbit folded into two basis vectors.
          const ox = fast.a * cosA
          const oz = fast.a * sinA
          const oy = fast.sinInc * (fast.a * 0.5) * sinA * fast.cosNode +
            fast.cosInc * (fast.a * 0.5) * cosA * fast.sinNode
          scratchObj.position.set(
            ox * fast.cosNode - oz * fast.sinNode,
            oy,
            ox * fast.sinNode + oz * fast.cosNode,
          )
          const s = fast.scale
          scratchObj.scale.set(s, s, s)
          scratchObj.rotation.set(0, angle, 0)
          scratchObj.updateMatrix()
          asteroidMesh.setMatrixAt(i, scratchObj.matrix)
        }
        asteroidMesh.instanceMatrix.needsUpdate = true
        asteroidMesh.visible = currentZoom >= 0.6 && currentZoom < 2.5
      }

      // Subtle star glow pulse + zoom-scaled presence. The raw star is
      // real-scale (tiny vs orbital distances), so at system zoom the core
      // and glow scale up to read like the showcase's bright star — without
      // swallowing the inner orbits.
      if (star) {
        const pulse = 1 + Math.sin(animTime * 1.2) * 0.03
        const zt = Math.min(1.5, Math.max(0.6, currentZoom))
        const coreScale = 1 + (zt - 0.6) * 0.9
        const glowScale = star.baseSize * 5 * pulse * (1 + (zt - 0.6) * 1.2)
        star.glow.scale.set(glowScale, glowScale, 1)
        star.mesh.scale.setScalar(coreScale)
      }
    }

    // Galaxy + universe visibility.
    galaxy.root.visible = currentZoom >= 1.5
    universe.visible = currentZoom >= 2.5
    galaxy.backdrop.rotation.y += dt * 0.008

    // Pulse the home ring in the dedicated highlight layer — locators stay static.
    if (galaxy.homeRing) {
      const homePulse = 1 + Math.sin(animTime * 2.5) * 0.18
      galaxy.homeRing.scale.setScalar(homePulse)
      galaxy.homeRing.lookAt(0, 0, 0)
    }

    // Camera positioning.
    const lvl = Math.min(3, Math.floor(currentZoom + 0.5))
    const d0 = DISTANCES[lvl]
    const d1 = DISTANCES[Math.min(3, lvl + 1)]
    const f = Math.min(1, Math.max(0, (currentZoom - lvl) * 2))
    const dist = d0 + (d1 - d0) * Math.min(1, f * 1.2)

    if (homePlanet && currentZoom < 1.0) {
      const pos = keplerPosition(
        homePlanet.elements.a,
        homePlanet.elements.e,
        homePlanet.elements.inc,
        homePlanet.elements.node,
        homePlanet.elements.argP,
        homePlanet.elements.period,
        simTime + homePlanet.elements.phase,
      )
      targetObj.set(pos.x, pos.y, pos.z)
    } else {
      targetObj.set(0, 0, 0)
    }

    camera.position.set(
      targetObj.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      targetObj.y + Math.sin(pitch) * dist * 0.6,
      targetObj.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    )
    camera.lookAt(targetObj)

    renderer.render(scene, camera)

    // Expose current level for optional HUD.
    const levelName = LEVELS[lvl]
    if (canvas.dataset.level !== levelName) {
      canvas.dataset.level = levelName
      onZoomChanged?.(levelName)
    }

    // Telemetry: world→screen projection for every planet, throttled to
    // ~12 Hz. Runs only at system zoom (meshes exist) and never allocates.
    if (onTelemetry && systemMeshesBuilt && currentZoom >= 0.6 && currentZoom < 1.5) {
      const now = animTime * 1000
      if (now - lastTelemetryAt > TELEMETRY_INTERVAL_MS) {
        lastTelemetryAt = now
        telemetryScratch.length = 0
        for (let i = 0; i < planetMeshes.length; i++) {
          const meshes = planetMeshes[i]
          const data = system.planets[i]
          if (!meshes || !data) continue
          worldPos.copy(meshes.group.position)
          worldPos.project(camera)
          telemetryScratch.push({
            name: data.name,
            ndcX: worldPos.x,
            ndcY: worldPos.y,
            behind: worldPos.z > 1,
            dist: meshes.group.position.distanceTo(camera.position),
            worldRadius: data.radius,
            level: currentZoom,
            band: data.band,
            tier: data.tier,
            kind: 'planet',
            owned: ownedNames.has(data.name),
            home: data.name === homePlanetName,
          })
        }
        onTelemetry(telemetryScratch)
      }
    }

    // Galaxy telemetry: callouts for OWNED/home host stars while at galaxy
    // zoom. Same NDC pipeline, ~12 Hz, zero allocation.
    if (onTelemetry && currentZoom >= 1.5 && currentZoom < 2.5) {
      const now = animTime * 1000
      if (now - lastTelemetryAt > TELEMETRY_INTERVAL_MS) {
        lastTelemetryAt = now
        telemetryScratch.length = 0
        for (const locator of galaxy.locators.values()) {
          if (!locator.claimed && !locator.home) continue
          worldPos.copy(locator.position)
          worldPos.project(camera)
          telemetryScratch.push({
            name: locator.hostName,
            ndcX: worldPos.x,
            ndcY: worldPos.y,
            behind: worldPos.z > 1,
            dist: locator.position.distanceTo(camera.position),
            worldRadius: 0,
            level: currentZoom,
            band: 'system',
            tier: locator.tier,
            kind: 'system',
            owned: true,
            home: locator.home,
          })
        }
        onTelemetry(telemetryScratch)
      }
    }
  }

  animate()

  return {
    canvas: renderer.domElement,
    dispose: () => {
      disposed = true
      cancelAnimationFrame(raf)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('click', onPointerClick)
      canvas.removeEventListener('dblclick', onDoubleClick)
      canvas.removeEventListener('mousemove', onHoverMove)
      canvas.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKeyDown)
      renderer.dispose()
      disposeSystemMeshes()
      scene.traverse((obj) => {
        const o = obj as {
          geometry?: { dispose: () => void }
          material?: THREE.Material | THREE.Material[]
        }
        if (
          obj instanceof THREE.Mesh ||
          obj instanceof THREE.Line ||
          obj instanceof THREE.Points ||
          obj instanceof THREE.Sprite
        ) {
          o.geometry?.dispose()
          const materials = Array.isArray(o.material) ? o.material : [o.material]
          for (const m of materials) {
            if (!m) continue
            const mat = m as THREE.Material & { map?: { dispose: () => void } }
            if (mat.map) mat.map.dispose()
            mat.dispose()
          }
        }
      })
    },
  }
}
