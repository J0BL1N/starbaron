import type { OwnedPlanet } from '../../sim/player'

interface PlanetSelectorProps {
  planets: OwnedPlanet[]
  selectedName: string
  onSelect: (name: string) => void
}

export default function PlanetSelector({
  planets,
  selectedName,
  onSelect,
}: PlanetSelectorProps) {
  return (
    <div className="planet-selector" data-testid="planet-selector">
      <label htmlFor="planet-select">Planet</label>
      <select
        id="planet-select"
        value={selectedName}
        onChange={(event) => onSelect(event.target.value)}
      >
        {planets.map((planet) => (
          <option key={planet.name} value={planet.name}>
            {planet.name} (Tier {planet.tier})
          </option>
        ))}
      </select>
    </div>
  )
}
