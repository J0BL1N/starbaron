import { formatNumber } from '../../sim/core/format'
import type { OwnedPlanet } from '../../sim/player'
import type { PlanetIdentity } from '../../sim/planets/types'
import { radiusBandOf, resolveRadius } from '../../sim/planets'
import PlanetCanvas3D from './PlanetCanvas3D'

interface PlanetDisplayProps {
  planet: OwnedPlanet
  identity: PlanetIdentity
  defensePower: number
}

export default function PlanetDisplay({
  planet,
  identity,
  defensePower,
}: PlanetDisplayProps) {
  const radius = resolveRadius(planet.entry, () => 0.5)
  const radiusBand = radiusBandOf(radius)

  return (
    <header className="planet-display">
      <PlanetCanvas3D
        name={planet.name}
        profile={identity.visual}
        tier={planet.tier}
        radiusBand={radiusBand}
      />
      <div>
        <h1>{planet.name}</h1>
        <p className="planet-subtitle mono">
          Tier {planet.tier} · {formatNumber(defensePower)} DP
        </p>
        <p className="planet-desc">{identity.description}</p>
      </div>
    </header>
  )
}
