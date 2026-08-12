import { useEffect, useMemo, useRef } from 'react'
import {
  createSolarSystemRenderer,
  type CreateSolarSystemRendererOptions,
} from '../planetgen3d/render'
import type { RadiusBand } from '../../sim/planets/visual'
import type { PlanetVisualProfile } from '../../sim/planets/types'
import type { HostStar } from '../planetgen3d/hosts'
import type { PlanetData } from '../planetgen3d/system'

interface SolarSystemCanvasProps {
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
  className?: string
}

export default function SolarSystemCanvas({
  seedName,
  homePlanetName,
  profile,
  tier,
  radiusBand,
  starType,
  ownedPlanetNames,
  highlightPlanetName,
  initialZoom,
  onHostSelected,
  onPlanetSelected,
  onZoomChanged,
  className,
}: SolarSystemCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)

  const ownedNames = useMemo(
    () => ownedPlanetNames ?? [],
    [ownedPlanetNames],
  )

  const renderer = useMemo(() => {
    const options: CreateSolarSystemRendererOptions = {
      seedName,
      homePlanetName,
      profile,
      tier,
      radiusBand,
      starType,
      ownedPlanetNames: ownedNames,
      highlightPlanetName,
      initialZoom,
      onHostSelected,
      onPlanetSelected,
      onZoomChanged,
    }
    return createSolarSystemRenderer(options)
  }, [
    seedName,
    homePlanetName,
    profile,
    tier,
    radiusBand,
    starType,
    ownedNames,
    highlightPlanetName,
    initialZoom,
    onHostSelected,
    onPlanetSelected,
    onZoomChanged,
  ])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const canvas = renderer.canvas
    canvas.setAttribute('aria-label', `Solar system view of ${homePlanetName}`)
    canvas.setAttribute('role', 'img')
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    wrapper.appendChild(canvas)
    return () => {
      renderer.dispose()
      if (wrapper.contains(canvas)) {
        wrapper.removeChild(canvas)
      }
    }
  }, [renderer, homePlanetName])

  return (
    <div
      ref={wrapperRef}
      className={className ?? 'solar-system-canvas'}
      style={{ width: '100%', height: '100%', minHeight: 400 }}
    >
      <noscript>{`Solar system view of ${homePlanetName}`}</noscript>
    </div>
  )
}
