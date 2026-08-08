import { formatNumber } from '../../sim/core/format'
import { STRUCTURES, STRUCTURE_IDS } from '../../sim/structures/data'
import { nextBuildCost } from '../../sim/structures/effects'
import type { StructureId } from '../../sim/structures/types'
import type { GameState } from '../useGameState'

interface BuildMenuProps {
  state: GameState
  onBuy: (id: StructureId) => void
}

export default function BuildMenu({ state, onBuy }: BuildMenuProps) {
  return (
    <section className="build-menu" aria-label="Build menu">
      <h2>Build</h2>
      {STRUCTURE_IDS.map((id) => {
        const structure = STRUCTURES[id]
        const level = state.levels[id]
        const cost = nextBuildCost(id, level)
        const alloyCost = structure.alloyCost ?? 0
        const canAfford = state.credits >= cost && state.alloys >= alloyCost
        return (
          <div className="build-row" key={id} data-structure={id}>
            <span className="build-name">
              {structure.name}
              <span className="build-level mono">Lv {level}</span>
            </span>
            <span className="build-cost mono">
              {formatNumber(cost)} cr
              {alloyCost > 0 ? ` + ${formatNumber(alloyCost)} alloys` : ''}
            </span>
            <button
              type="button"
              className="buy-button"
              disabled={!canAfford}
              aria-label={`Build ${structure.name}`}
              onClick={() => onBuy(id)}
            >
              BUILD
            </button>
          </div>
        )
      })}
    </section>
  )
}
