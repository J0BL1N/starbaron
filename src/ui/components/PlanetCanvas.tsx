import { useEffect, useMemo, useRef } from 'react'
import { generatePlanetRenderFeatures, renderPlanet } from '../planetgen'
import type { PlanetRenderFeatures } from '../planetgen'
import type { RadiusBand } from '../../sim/planets/visual'
import type { PlanetVisualProfile } from '../../sim/planets/types'

interface PlanetCanvasProps {
  name: string
  profile: PlanetVisualProfile
  tier: number
  radiusBand: RadiusBand
  className?: string
}

export default function PlanetCanvas({
  name,
  profile,
  tier,
  radiusBand,
  className,
}: PlanetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const features: PlanetRenderFeatures = useMemo(
    () => generatePlanetRenderFeatures(name, profile, tier, radiusBand),
    [name, profile, tier, radiusBand],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cssSize = features.cssSize
    const logicalScale = features.supersample
    const dpr = window.devicePixelRatio || 1
    const logicalWidth = cssSize * logicalScale
    const logicalHeight = cssSize * logicalScale

    canvas.width = Math.round(logicalWidth * dpr)
    canvas.height = Math.round(logicalHeight * dpr)
    canvas.style.width = `${cssSize}px`
    canvas.style.height = `${cssSize}px`

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    renderPlanet(ctx, logicalWidth, logicalHeight, features)
  }, [features])

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'planet-canvas'}
      aria-label={`${name} ${profile.emoji}`}
      role="img"
    />
  )
}
