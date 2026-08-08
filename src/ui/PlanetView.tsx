import { useGameState } from './useGameState'
import { COLONISE_COST_CREDITS } from './useGameState'
import type { UseGameStateOptions } from './useGameState'
import PlanetSelector from './components/PlanetSelector'
import PlanetDisplay from './components/PlanetDisplay'
import ResourceBar from './components/ResourceBar'
import StructureGrid from './components/StructureGrid'
import BuildMenu from './components/BuildMenu'
import ColonisePanel from './components/ColonisePanel'
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
      <PlanetSelector
        planets={game.planets}
        selectedName={game.selectedPlanetName}
        onSelect={game.selectPlanet}
      />
      <PlanetDisplay
        planet={game.selectedPlanet}
        identity={game.selectedIdentity}
        defensePower={game.derived.defensePower}
      />
      <ResourceBar
        state={game.state}
        derived={game.derived}
        empire={game.empire}
      />
      <ColonisePanel
        canColonise={game.canColonise}
        busy={game.coloniseBusy}
        error={game.coloniseError}
        cost={COLONISE_COST_CREDITS}
        onColonise={game.colonise}
      />
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
          planetName={game.homePlanet.name}
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
