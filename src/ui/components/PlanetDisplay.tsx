import { formatNumber } from '../../sim/core/format'

interface PlanetDisplayProps {
  tier: number
  defensePower: number
}

export default function PlanetDisplay({ tier, defensePower }: PlanetDisplayProps) {
  return (
    <header className="planet-display">
      <span className="planet-emoji" role="img" aria-label="Home planet">
        🪐
      </span>
      <div>
        <h1>Home Planet</h1>
        <p className="planet-subtitle mono">
          Tier {tier} · {formatNumber(defensePower)} DP
        </p>
      </div>
    </header>
  )
}
