import { formatNumber } from '../../sim/core/format'
import type { DerivedRates, GameState } from '../useGameState'

interface EmpireRates {
  creditsPerSec: number
  alloysPerSec: number
}

interface ResourceBarProps {
  state: GameState
  derived: DerivedRates
  empire: EmpireRates
}

interface ResourceChipProps {
  label: string
  value: number
  cap?: number
  rate?: number
}

function ResourceChip({ label, value, cap, rate }: ResourceChipProps) {
  const showRate = rate != null && rate > 0
  return (
    <div className="resource-chip" data-testid={`resource-${label.toLowerCase()}`}>
      <span className="resource-label">{label}</span>
      <span className="resource-value mono">
        {formatNumber(value)}
        {cap != null ? <span className="resource-cap"> / {formatNumber(cap)}</span> : null}
      </span>
      {showRate ? (
        <span className="resource-rate mono">+{formatNumber(rate)}/s</span>
      ) : null}
    </div>
  )
}

export default function ResourceBar({ state, derived, empire }: ResourceBarProps) {
  return (
    <section className="resource-bar" aria-label="Resources">
      <ResourceChip label="Credits" value={state.credits} rate={empire.creditsPerSec} />
      <ResourceChip label="Alloys" value={state.alloys} rate={empire.alloysPerSec} />
      <ResourceChip
        label="Population"
        value={state.population}
        cap={derived.populationCap}
        rate={derived.populationPerSec}
      />
      <ResourceChip label="Fleet" value={state.fleet} cap={derived.fleetCap} />
      <ResourceChip label="Garrison" value={state.garrison} cap={derived.garrisonCap} rate={derived.garrisonPerSec} />
    </section>
  )
}
