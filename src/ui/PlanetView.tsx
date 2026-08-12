import { useCallback, useEffect, useMemo, useState } from 'react'
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
import WarWearinessPanel from './components/WarWearinessPanel'
import SolarSystemCanvas from './components/SolarSystemCanvas'
import { generatePlanetIdentity, radiusBandOf, resolveRadius } from '../sim/planets'
import type { HostStar } from './planetgen3d/hosts'
import type { PlanetData } from './planetgen3d/system'
import type { PlanetTier } from '../sim/data/planets'

interface PlanetViewProps {
  options?: UseGameStateOptions
}

type ViewMode = 'planet' | 'system' | 'galaxy'

function planetProfile(entry: { name: string; tier: number; starType?: string }) {
  return generatePlanetIdentity({
    name: entry.name,
    hostname: entry.name.split(' ')[0] ?? entry.name,
    systemCount: 1,
    tier: entry.tier as 1 | 2 | 3 | 4 | 5,
    starType: entry.starType,
  }).visual
}

export default function PlanetView({ options }: PlanetViewProps) {
  const game = useGameState(options)

  // -------------------------------------------------------------------------
  // Star-first zoom journey state
  // -------------------------------------------------------------------------
  const [viewMode, setViewMode] = useState<ViewMode>('planet')

  const selectedEntry = game.selectedPlanet.entry
  const selectedBand = radiusBandOf(resolveRadius(selectedEntry, () => 0.5))

  const initialJourney = useMemo(
    () => ({
      seedName: selectedEntry.hostname,
      homePlanetName: game.selectedPlanet.name,
      profile: game.selectedIdentity.visual,
      tier: game.selectedPlanet.tier,
      radiusBand: selectedBand,
      starType: selectedEntry.starType,
    }),
    [
      selectedEntry.hostname,
      selectedEntry.starType,
      game.selectedPlanet.name,
      game.selectedPlanet.tier,
      game.selectedIdentity.visual,
      selectedBand,
    ],
  )

  const [journey, setJourney] = useState(initialJourney)

  // Keep the journey in sync when the user picks a different owned planet.
  useEffect(() => {
    setJourney(initialJourney)
  }, [initialJourney])

  const setView = useCallback((mode: ViewMode) => {
    setViewMode(mode)
  }, [])

  const handleHostSelected = useCallback((host: HostStar) => {
    const ownedHome = host.entries.find((entry) =>
      game.ownedPlanetNames.includes(entry.name),
    )
    const homeEntry = ownedHome ?? host.entries[0]
    if (!homeEntry) return
    const band = radiusBandOf(resolveRadius(homeEntry, () => 0.5))
    setJourney({
      seedName: host.hostname,
      homePlanetName: homeEntry.name,
      profile: ownedHome
        ? game.homeIdentity.visual
        : planetProfile(homeEntry),
      tier: homeEntry.tier,
      radiusBand: band,
      starType: host.starType,
    })
    setViewMode('system')
  }, [game.ownedPlanetNames, game.homeIdentity.visual])

  const handlePlanetSelected = useCallback((planet: PlanetData) => {
    setJourney((prev) => ({
      ...prev,
      homePlanetName: planet.name,
      profile: planet.profile,
      tier: planet.tier as PlanetTier,
      radiusBand: planet.band,
    }))
    setViewMode('planet')
  }, [])

  const initialZoom = viewMode === 'galaxy' ? 2 : viewMode === 'system' ? 1 : 0

  const canvasKey = `${journey.seedName}|${journey.homePlanetName}|${viewMode}`

  const showSpaceMap = viewMode === 'system' || viewMode === 'galaxy'

  return (
    <main className="planet-view">
      <PlanetSelector
        planets={game.planets}
        selectedName={game.selectedPlanetName}
        onSelect={game.selectPlanet}
      />

      <div className="view-mode-bar">
        <button
          type="button"
          className={viewMode === 'planet' ? 'active' : ''}
          onClick={() => setView('planet')}
        >
          Planet
        </button>
        <button
          type="button"
          className={viewMode === 'system' ? 'active' : ''}
          onClick={() => setView('system')}
        >
          System
        </button>
        <button
          type="button"
          className={viewMode === 'galaxy' ? 'active' : ''}
          onClick={() => setView('galaxy')}
        >
          Galaxy
        </button>
      </div>

      {showSpaceMap ? (
        <div
          className="space-map"
          style={{ height: 520, borderRadius: 12, overflow: 'hidden' }}
        >
          <SolarSystemCanvas
            key={canvasKey}
            seedName={journey.seedName}
            homePlanetName={journey.homePlanetName}
            profile={journey.profile}
            tier={journey.tier}
            radiusBand={journey.radiusBand}
            starType={journey.starType}
            ownedPlanetNames={game.ownedPlanetNames}
            highlightPlanetName={game.highlightPlanetName}
            initialZoom={initialZoom}
            onHostSelected={handleHostSelected}
            onPlanetSelected={handlePlanetSelected}
          />
        </div>
      ) : (
        <PlanetDisplay
          planet={game.selectedPlanet}
          identity={game.selectedIdentity}
          defensePower={game.derived.defensePower}
        />
      )}

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
      <WarWearinessPanel />
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
