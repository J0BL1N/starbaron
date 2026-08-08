import { useGameState } from './useGameState'
import type { UseGameStateOptions } from './useGameState'
import PlanetDisplay from './components/PlanetDisplay'
import ResourceBar from './components/ResourceBar'
import StructureGrid from './components/StructureGrid'
import BuildMenu from './components/BuildMenu'
import OfflineSummary from './components/OfflineSummary'
import './App.css'

interface PlanetViewProps {
  options?: UseGameStateOptions
}

export default function PlanetView({ options }: PlanetViewProps) {
  const game = useGameState(options)

  return (
    <main className="planet-view">
      <PlanetDisplay tier={game.state.tier} defensePower={game.derived.defensePower} />
      <ResourceBar state={game.state} derived={game.derived} />
      <div className="planet-view-main">
        <StructureGrid levels={game.state.levels} derived={game.derived} />
        <BuildMenu state={game.state} onBuy={game.buy} />
      </div>
      {game.offlineGain ? (
        <OfflineSummary gain={game.offlineGain} onClose={game.dismissOffline} />
      ) : null}
    </main>
  )
}
