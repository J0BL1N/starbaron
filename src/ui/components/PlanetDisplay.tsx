import { formatNumber } from '../../sim/core/format'
import type { OwnedPlanet } from '../../sim/player'
import type { PlanetIdentity } from '../../sim/planets/types'

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
  return (
    <header className="planet-display">
      <span className="planet-emoji" role="img" aria-label={planet.name}>
        {identity.visual.emoji}
      </span>
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
