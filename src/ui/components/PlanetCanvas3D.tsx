import { useEffect, useMemo, useRef } from 'react'
import { createPlanetRenderer } from '../planetgen3d/render'
import type { RadiusBand } from '../../sim/planets/visual'
import type { PlanetVisualProfile } from '../../sim/planets/types'

interface PlanetCanvas3DProps {
  name: string
  profile: PlanetVisualProfile
  tier: number
  radiusBand: RadiusBand
  className?: string
}

export default function PlanetCanvas3D({
  name,
  profile,
  tier,
  radiusBand,
  className,
}: PlanetCanvas3DProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)

  const renderer = useMemo(
    () => createPlanetRenderer(name, profile, tier, radiusBand),
    [name, profile, tier, radiusBand],
  )

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const canvas = renderer.canvas
    canvas.setAttribute('aria-label', `${name} ${profile.emoji}`)
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
  }, [renderer, name, profile.emoji])

  return (
    <div
      ref={wrapperRef}
      className={className ?? 'planet-canvas-3d'}
      style={{ width: 96, height: 96, flexShrink: 0 }}
    >
      <noscript>{`${name} ${profile.emoji}`}</noscript>
    </div>
  )
}
