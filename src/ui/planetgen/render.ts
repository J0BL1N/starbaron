import type { PlanetRenderFeatures } from './features'

export type { PlanetRenderFeatures } from './features'

/**
 * Append an alpha channel to a 6-digit hex colour.
 * Used by the pure canvas painter; no randomness.
 */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return `rgba(192,192,192,${alpha})`
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function withDiscClip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  draw: () => void,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  draw()
  ctx.restore()
}

function drawStarfield(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  features: PlanetRenderFeatures,
): void {
  for (const star of features.starfield) {
    const x = star.x * width
    const y = star.y * height
    ctx.fillStyle = `rgba(245,240,224,${star.alpha})`
    ctx.beginPath()
    ctx.arc(x, y, star.size, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawRingHalf(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  tilt: number,
  color: string,
  alpha: number,
  width: number,
  height: number,
  back: boolean,
): void {
  ctx.save()
  ctx.beginPath()
  if (back) {
    ctx.rect(0, 0, width, cy)
  } else {
    ctx.rect(0, cy, width, height - cy)
  }
  ctx.clip()

  const ryOuter = outerRadius * Math.sin(tilt)
  const ryInner = innerRadius * Math.sin(tilt)

  ctx.beginPath()
  ctx.ellipse(cx, cy, outerRadius, ryOuter, 0, 0, Math.PI * 2)
  ctx.ellipse(cx, cy, innerRadius, ryInner, 0, 0, Math.PI * 2, true)
  ctx.fillStyle = hexToRgba(color, alpha)
  ctx.fill('evenodd')
  ctx.restore()
}

function drawPlanetDisc(
  ctx: CanvasRenderingContext2D,
  features: PlanetRenderFeatures,
): void {
  const { cx, cy, discRadius, baseColor, radiusBand, surface } = features

  // Base fill.
  ctx.beginPath()
  ctx.arc(cx, cy, discRadius, 0, Math.PI * 2)
  ctx.fillStyle = baseColor
  ctx.fill()

  // Surface texture, clipped to the disc.
  withDiscClip(ctx, cx, cy, discRadius, () => {
    if (radiusBand === 'rocky') {
      for (const crater of surface.craters) {
        const px = cx + crater.x * discRadius
        const py = cy + crater.y * discRadius
        const pr = crater.r * discRadius
        // shadow floor
        ctx.fillStyle = `rgba(0,0,0,${0.25 + crater.depth * 0.35})`
        ctx.beginPath()
        ctx.arc(px, py, pr, 0, Math.PI * 2)
        ctx.fill()
        // lit rim
        ctx.fillStyle = `rgba(255,255,255,${0.08 + crater.depth * 0.12})`
        ctx.beginPath()
        ctx.arc(px - pr * 0.25, py - pr * 0.25, pr * 0.85, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (radiusBand === 'gaseous') {
      for (const band of surface.bands) {
        const by = cy + band.y * discRadius
        const bh = band.height * discRadius
        const grad = ctx.createLinearGradient(0, by - bh, 0, by + bh)
        grad.addColorStop(0, hexToRgba(band.color, 0))
        grad.addColorStop(0.5, hexToRgba(band.color, band.alpha))
        grad.addColorStop(1, hexToRgba(band.color, 0))
        ctx.fillStyle = grad
        ctx.fillRect(0, by - bh, ctx.canvas.width, bh * 2)
      }
    } else if (radiusBand === 'earthlike' || radiusBand === 'superearth') {
      // Ocean/base is already the disc colour; overlay land/ice blobs.
      for (const blob of surface.blobs) {
        const px = cx + blob.x * discRadius
        const py = cy + blob.y * discRadius
        const pr = blob.r * discRadius
        ctx.fillStyle = hexToRgba(blob.color, 0.78)
        ctx.beginPath()
        ctx.arc(px, py, pr, 0, Math.PI * 2)
        ctx.fill()
      }
      for (const band of surface.bands) {
        const by = cy + band.y * discRadius
        const bh = band.height * discRadius
        const grad = ctx.createLinearGradient(0, by - bh, 0, by + bh)
        grad.addColorStop(0, hexToRgba(band.color, 0))
        grad.addColorStop(0.5, hexToRgba(band.color, band.alpha))
        grad.addColorStop(1, hexToRgba(band.color, 0))
        ctx.fillStyle = grad
        ctx.fillRect(0, by - bh, ctx.canvas.width, bh * 2)
      }
    }
  })
}

function drawAtmosphere(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  features: PlanetRenderFeatures,
): void {
  const { cx, cy, discRadius, atmosphere } = features
  if (!atmosphere.tint || atmosphere.alpha <= 0) return

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const grad = ctx.createRadialGradient(
    cx,
    cy,
    discRadius * 0.82,
    cx,
    cy,
    atmosphere.glowRadius,
  )
  grad.addColorStop(0, hexToRgba(atmosphere.tint, 0))
  grad.addColorStop(0.6, hexToRgba(atmosphere.tint, atmosphere.alpha * 0.5))
  grad.addColorStop(1, hexToRgba(atmosphere.tint, 0))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
}

function drawSphereShading(
  ctx: CanvasRenderingContext2D,
  features: PlanetRenderFeatures,
): void {
  const { cx, cy, discRadius, lightAngle } = features

  const lightDx = Math.cos(lightAngle) * discRadius * 0.55
  const lightDy = Math.sin(lightAngle) * discRadius * 0.55
  const lx = cx + lightDx
  const ly = cy + lightDy
  const ox = cx - lightDx * 0.9
  const oy = cy - lightDy * 0.9

  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'

  // Day/night terminator gradient.
  const shade = ctx.createRadialGradient(lx, ly, 0, ox, oy, discRadius * 1.9)
  shade.addColorStop(0, 'rgba(255,255,255,0.32)')
  shade.addColorStop(0.45, 'rgba(255,255,255,0.06)')
  shade.addColorStop(0.55, 'rgba(0,0,0,0.12)')
  shade.addColorStop(1, 'rgba(0,0,0,0.58)')
  ctx.fillStyle = shade
  ctx.beginPath()
  ctx.arc(cx, cy, discRadius, 0, Math.PI * 2)
  ctx.fill()

  // Specular highlight.
  const hiX = cx + Math.cos(lightAngle) * discRadius * 0.42
  const hiY = cy + Math.sin(lightAngle) * discRadius * 0.42
  const hiGrad = ctx.createRadialGradient(
    hiX,
    hiY,
    0,
    hiX,
    hiY,
    discRadius * 0.28,
  )
  hiGrad.addColorStop(0, 'rgba(255,255,255,0.35)')
  hiGrad.addColorStop(0.3, 'rgba(255,255,255,0.12)')
  hiGrad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hiGrad
  ctx.beginPath()
  ctx.arc(cx, cy, discRadius, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

function drawMoon(
  ctx: CanvasRenderingContext2D,
  features: PlanetRenderFeatures,
  moon: PlanetRenderFeatures['moons']['items'][number],
): void {
  const { cx, cy, lightAngle } = features
  const mx = cx + Math.cos(moon.angle) * moon.distance
  const my = cy + Math.sin(moon.angle) * moon.distance * 0.6
  const r = moon.radius

  ctx.save()
  ctx.fillStyle = moon.color
  ctx.beginPath()
  ctx.arc(mx, my, r, 0, Math.PI * 2)
  ctx.fill()

  ctx.globalCompositeOperation = 'source-atop'
  const shade = ctx.createRadialGradient(
    mx + Math.cos(lightAngle) * r * 0.4,
    my + Math.sin(lightAngle) * r * 0.4,
    0,
    mx,
    my,
    r * 1.6,
  )
  shade.addColorStop(0, 'rgba(255,255,255,0.35)')
  shade.addColorStop(0.5, 'rgba(0,0,0,0.1)')
  shade.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = shade
  ctx.beginPath()
  ctx.arc(mx, my, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * Pure canvas painter: given a 2D context and a deterministic feature vector,
 * render a 2.5D planet. No randomness is used here.
 */
export function renderPlanet(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  features: PlanetRenderFeatures,
): void {
  const { cx, cy, rings, moons } = features

  ctx.clearRect(0, 0, width, height)

  drawStarfield(ctx, width, height, features)

  if (rings.enabled) {
    drawRingHalf(
      ctx,
      cx,
      cy,
      rings.innerRadius,
      rings.outerRadius,
      rings.tilt,
      rings.color,
      rings.alpha,
      width,
      height,
      true,
    )
  }

  drawPlanetDisc(ctx, features)
  drawAtmosphere(ctx, width, height, features)
  drawSphereShading(ctx, features)

  if (rings.enabled) {
    drawRingHalf(
      ctx,
      cx,
      cy,
      rings.innerRadius,
      rings.outerRadius,
      rings.tilt,
      rings.color,
      rings.alpha,
      width,
      height,
      false,
    )
  }

  for (const moon of moons.items) {
    drawMoon(ctx, features, moon)
  }
}
