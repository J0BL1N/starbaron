import { formatNumber } from '../../sim/core/format'
import type { OwnedPlanet } from '../../sim/player'
import type { PlanetIdentity } from '../../sim/planets/types'

interface PlanetDisplayProps {
  homePlanet: OwnedPlanet
  identity: PlanetIdentity
  defensePower: number
}

export default function PlanetDisplay({
  homePlanet,
  identity,
  defensePower,
}: PlanetDisplayProps) {
  return (
    <header className="planet-display">
      <span className="planet-emoji" role="img" aria-label={homePlanet.name}>
        {identity.visual.emoji}
      </span>
      <div>
        <h1>{homePlanet.name}</h1>
        <p className="planet-subtitle mono">
          Tier {homePlanet.tier} · {formatNumber(defensePower)} DP
        </p>
        <p className="planet-desc">{identity.description}</p>
      </div>
    </header>
  )
}
