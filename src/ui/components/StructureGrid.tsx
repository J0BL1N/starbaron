import { formatNumber } from '../../sim/core/format'
import { STRUCTURES, STRUCTURE_IDS } from '../../sim/structures/data'
import { nextBuildCost, structureEffect } from '../../sim/structures/effects'
import type { StructureEffect, StructureId } from '../../sim/structures/types'
import type { DerivedRates } from '../useGameState'

interface StructureGridProps {
  levels: Record<StructureId, number>
  derived: DerivedRates
}

function effectSummary(effect: StructureEffect): string {
  switch (effect.kind) {
    case 'alloys':
      return `+${formatNumber(effect.alloysPerSec * 60)} alloys/min`
    case 'incomeMultiplier':
      return `+${Math.round((effect.multiplier - 1) * 100)}% passive income`
    case 'population':
      return `+${formatNumber(effect.popCapBonus)} pop cap · +${formatNumber(effect.popGrowthBonusPerSec)}/s pop`
    case 'growthMultiplier':
      return `+${Math.round((effect.multiplier - 1) * 100)}% pop growth`
    case 'barracks':
      return `${formatNumber(effect.soldierConversionPerSec)}/s → garrison · cap ${formatNumber(effect.garrisonCap)}`
    case 'shipyard':
      return `+${formatNumber(effect.fleetCap)} fleet cap · +${formatNumber(effect.shipbuildingIncomePerSec * 60)} cr/min`
    case 'defense':
      return `+${formatNumber(effect.defensePower)} defense power`
  }
}

function costText(id: (typeof STRUCTURE_IDS)[number], level: number): string {
  const cost = nextBuildCost(id, level)
  const alloyCost = STRUCTURES[id].alloyCost ?? 0
  if (alloyCost > 0) {
    return `Next: ${formatNumber(cost)} cr + ${formatNumber(alloyCost)} alloys`
  }
  return `Next: ${formatNumber(cost)} cr`
}

export default function StructureGrid({ levels, derived }: StructureGridProps) {
  return (
    <section className="structure-grid" aria-label="Structures">
      <h2>Structures</h2>
      {STRUCTURE_IDS.map((id) => {
        const structure = STRUCTURES[id]
        const level = levels[id]
        const effect = structureEffect(id, level)
        return (
          <article className="structure-card" key={id} data-structure={id}>
            <header>
              <h3>{structure.name}</h3>
              <span className="level mono">Lv {level}</span>
            </header>
            <p className="structure-effect">{effectSummary(effect)}</p>
            <p className="structure-cost mono">{costText(id, level)}</p>
          </article>
        )
      })}
      <p className="structure-grid-note mono" data-testid="planet-dp">
        Defense power: {formatNumber(derived.defensePower)} DP
      </p>
    </section>
  )
}
