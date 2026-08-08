import { useGameState } from './useGameState'
import type { UseGameStateOptions } from './useGameState'
import PlanetDisplay from './components/PlanetDisplay'
import ResourceBar from './components/ResourceBar'
import StructureGrid from './components/StructureGrid'
import BuildMenu from './components/BuildMenu'
import OfflineSummary from './components/OfflineSummary'
import Onboarding from './components/Onboarding'
import SaveNotice from './components/SaveNotice'
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
      {game.saveNotice ? (
        <SaveNotice message={game.saveNotice} onClose={game.dismissSaveNotice} />
      ) : null}
      {!game.tutorial.done && !game.tutorial.skipped ? (
        <Onboarding
          step={game.tutorial.step}
          onAdvance={game.advanceTutorial}
          onSkip={game.skipTutorial}
        />
      ) : null}
      {game.offlineGain ? (
        <OfflineSummary gain={game.offlineGain} onClose={game.dismissOffline} />
      ) : null}
    </main>
  )
}
