import { useCallback, useEffect, useRef, useState } from 'react'
import {
  calculateOfflineEarnings,
  MAX_OFFLINE_BANK_SECONDS,
} from '../sim/core/offline'
import {
  accruePlayer,
  buildStructure,
  coloniseFirstUnclaimed,
  computePlanetDerived,
  empireRates,
  firstUnclaimedByIndex,
  gridForPlanet,
  ownedPlanetByName,
  ownedPlanetIdentity,
  planetTotals,
  walletSpend,
} from '../sim/player'
import {
  createPlayer,
  generatePlayerId,
} from '../sim/player'
import type { OwnedPlanet, PlayerState } from '../sim/player'
import type { PlanetIdentity } from '../sim/planets/types'
import { STRUCTURES } from '../sim/structures/data'
import { nextBuildCost } from '../sim/structures/effects'
import type { StructureId } from '../sim/structures/types'
import {
  loadSave,
  OFFLINE_SUMMARY_THRESHOLD_MS,
  saveGame,
  SAVE_SCHEMA_VERSION,
  TUTORIAL_LAST_STEP,
} from './save'
import type { SaveGameV3, TutorialState } from './save'

export const AUTOSAVE_DEBOUNCE_MS = 5_000

const OFFLINE_CAP_MS = MAX_OFFLINE_BANK_SECONDS * 1_000

export const COLONISE_COST_CREDITS = 1_000

export interface GameState {
  tier: number
  credits: number
  alloys: number
  population: number
  garrison: number
  fleet: number
  levels: Record<StructureId, number>
  lastTickAt: number
  selectedPlanetName: string
}

export interface DerivedRates {
  creditsPerSec: number
  alloysPerSec: number
  populationPerSec: number
  garrisonPerSec: number
  populationCap: number
  garrisonCap: number
  fleetCap: number
  defensePower: number
}

export interface EmpireRates {
  creditsPerSec: number
  alloysPerSec: number
}

export interface OfflineGain {
  elapsedSec: number
  credits: number
  alloys: number
  population: number
  garrison: number
  fleet: number
}

export interface UseGameStateOptions {
  now?: () => number
  storage?: Storage
}

export interface UseGameStateReturn {
  state: GameState
  derived: DerivedRates
  empire: EmpireRates
  playerId: string
  planets: OwnedPlanet[]
  homePlanet: OwnedPlanet
  homeIdentity: PlanetIdentity
  selectedPlanetName: string
  selectedPlanet: OwnedPlanet
  selectedIdentity: PlanetIdentity
  selectPlanet: (name: string) => void
  buy: (id: StructureId) => void
  colonise: () => void
  coloniseBusy: boolean
  coloniseError: string | null
  canColonise: boolean
  bankElapsed: (at?: number, durable?: boolean) => number
  offlineGain: OfflineGain | null
  dismissOffline: () => void
  tutorial: TutorialState
  advanceTutorial: () => void
  skipTutorial: () => void
  offlineSummarySeen: boolean
  saveNotice: string | null
  dismissSaveNotice: () => void
}

function initialPlayer(now: number): PlayerState {
  return createPlayer(generatePlayerId(), now)
}

function project(player: PlayerState, selectedName: string): GameState {
  const selected = ownedPlanetByName(player, selectedName) ?? player.homePlanet
  return {
    tier: selected.tier,
    credits: player.wallet.credits,
    alloys: player.wallet.alloys,
    population: selected.population,
    garrison: selected.garrison,
    fleet: selected.fleet,
    levels: { ...gridForPlanet(player, selected.name) },
    lastTickAt: player.lastTickAt,
    selectedPlanetName: selected.name,
  }
}

function clonePlanet(planet: OwnedPlanet): OwnedPlanet {
  return { ...planet, entry: { ...planet.entry } }
}

function cloneGrids(
  grids: Record<string, Record<StructureId, number>>,
): Record<string, Record<StructureId, number>> {
  const out: Record<string, Record<StructureId, number>> = {}
  for (const key of Object.keys(grids)) {
    out[key] = { ...grids[key] }
  }
  return out
}

function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    homePlanet: clonePlanet(player.homePlanet),
    colonies: player.colonies.map(clonePlanet),
    wallet: { ...player.wallet },
    structureLevels: cloneGrids(player.structureLevels),
  }
}

function resolveStorage(storage?: Storage): Storage | null {
  if (storage != null) {
    return storage
  }
  try {
    return typeof window !== 'undefined' && window.localStorage != null
      ? window.localStorage
      : null
  } catch {
    return null
  }
}

export function useGameState(options: UseGameStateOptions = {}): UseGameStateReturn {
  const nowFn = options.now ?? Date.now
  const nowRef = useRef(nowFn)
  nowRef.current = nowFn
  const storageRef = useRef<Storage | null>(resolveStorage(options.storage))

  const ref = useRef<PlayerState>(initialPlayer(nowFn()))
  const selectedRef = useRef<string>(ref.current.homePlanet.name)
  const [selectedPlanetName, setSelectedPlanetName] = useState<string>(
    selectedRef.current,
  )
  const [snapshot, setSnapshot] = useState<GameState>(() =>
    project(ref.current, selectedRef.current),
  )
  const [offlineGain, setOfflineGain] = useState<OfflineGain | null>(null)

  const initialTutorial: TutorialState = { step: 0, done: false, skipped: false }
  const tutorialRef = useRef<TutorialState>(initialTutorial)
  const [tutorial, setTutorialState] = useState<TutorialState>(initialTutorial)
  const offlineSeenRef = useRef(false)
  const [offlineSummarySeen, setOfflineSummarySeen] = useState(false)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [coloniseBusy, setColoniseBusy] = useState(false)
  const coloniseBusyRef = useRef(false)
  const [coloniseError, setColoniseError] = useState<string | null>(null)

  const saveRef = useRef<SaveGameV3 | null>(null)
  const debounceRef = useRef<number | null>(null)
  const quotaNoticedRef = useRef(false)
  const loadedRef = useRef(false)

  const writeSave = useCallback((payload: SaveGameV3) => {
    const store = storageRef.current
    if (!saveGame(payload, store) && !quotaNoticedRef.current) {
      quotaNoticedRef.current = true
      setSaveNotice("Couldn't save progress this session.")
    }
  }, [])

  const buildPayload = useCallback((): SaveGameV3 => {
    const p = ref.current
    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: nowRef.current(),
      player: clonePlayer(p),
      tutorial: { ...tutorialRef.current },
      offlineSummarySeen: offlineSeenRef.current,
    }
  }, [])

  const scheduleSave = useCallback(() => {
    saveRef.current = buildPayload()
    if (debounceRef.current != null) {
      return
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      const payload = saveRef.current
      if (payload != null) {
        writeSave(payload)
      }
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [buildPayload, writeSave])

  const flushSave = useCallback(() => {
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    saveRef.current = buildPayload()
    writeSave(saveRef.current)
  }, [buildPayload, writeSave])

  const commit = useCallback(() => {
    setSnapshot(project(ref.current, selectedRef.current))
    scheduleSave()
  }, [scheduleSave])

  const selectPlanet = useCallback(
    (name: string) => {
      const owned = ownedPlanetByName(ref.current, name)
      if (owned == null) {
        return
      }
      selectedRef.current = owned.name
      setSelectedPlanetName(owned.name)
      commit()
    },
    [commit],
  )

  const bankElapsed = useCallback(
    (at = nowRef.current(), durable = false): number => {
      const current = ref.current
      const elapsedMs = at - current.lastTickAt
      if (elapsedMs <= 0) {
        return 0
      }
      const cappedMs = Math.min(elapsedMs, OFFLINE_CAP_MS)
      const next = accruePlayer(current, cappedMs)
      next.lastTickAt = at
      ref.current = next
      commit()
      if (durable) {
        flushSave()
      }
      return cappedMs
    },
    [commit, flushSave],
  )

  const advanceTutorial = useCallback(() => {
    const t = tutorialRef.current
    if (t.done || t.skipped) {
      return
    }
    let next: TutorialState
    if (t.step >= TUTORIAL_LAST_STEP) {
      next = { ...t, done: true }
    } else {
      next = { ...t, step: t.step + 1 }
    }
    tutorialRef.current = next
    setTutorialState(next)
    flushSave()
  }, [flushSave])

  const skipTutorial = useCallback(() => {
    const next = { ...tutorialRef.current, skipped: true }
    tutorialRef.current = next
    setTutorialState(next)
    flushSave()
  }, [flushSave])

  const buy = useCallback(
    (id: StructureId): void => {
      bankElapsed()
      const current = ref.current
      const name = selectedRef.current
      const grid = gridForPlanet(current, name)
      const level = grid[id]
      const cost = nextBuildCost(id, level)
      const alloyCost = STRUCTURES[id].alloyCost ?? 0
      if (current.wallet.credits < cost || current.wallet.alloys < alloyCost) {
        return
      }
      ref.current = buildStructure(current, name, id)
      commit()
      flushSave()
    },
    [bankElapsed, commit, flushSave],
  )

  const colonise = useCallback((): void => {
    if (coloniseBusyRef.current) {
      return
    }
    coloniseBusyRef.current = true
    setColoniseBusy(true)
    try {
      bankElapsed()
      const current = ref.current
      if (firstUnclaimedByIndex(current) === null) {
        setColoniseError('No unclaimed planets left to colonise.')
        return
      }
      if (current.wallet.credits < COLONISE_COST_CREDITS) {
        setColoniseError('Insufficient credits to colonise.')
        return
      }
      const { player, colony } = coloniseFirstUnclaimed(current, nowRef.current())
      ref.current = {
        ...player,
        wallet: walletSpend(player.wallet, COLONISE_COST_CREDITS, 0),
      }
      setColoniseError(null)
      selectedRef.current = colony.name
      setSelectedPlanetName(colony.name)
      commit()
      flushSave()
    } catch {
      setColoniseError('Could not colonise a planet.')
    } finally {
      window.setTimeout(() => {
        coloniseBusyRef.current = false
        setColoniseBusy(false)
      }, 0)
    }
  }, [bankElapsed, commit, flushSave])

  useEffect(() => {
    if (tutorial.done || tutorial.skipped) {
      return
    }
    const levels = snapshot.levels
    if (tutorial.step === 1 && levels.housing >= 1) {
      advanceTutorial()
    } else if (tutorial.step === 2 && levels.oreMine >= 1) {
      advanceTutorial()
    }
  }, [tutorial, snapshot, advanceTutorial])

  const dismissOffline = useCallback(() => {
    setOfflineGain(null)
    offlineSeenRef.current = true
    setOfflineSummarySeen(true)
    const t = tutorialRef.current
    if (t.step === TUTORIAL_LAST_STEP && !t.done && !t.skipped) {
      advanceTutorial()
    } else {
      flushSave()
    }
  }, [advanceTutorial, flushSave])

  const dismissSaveNotice = useCallback(() => {
    setSaveNotice(null)
  }, [])

  useEffect(() => {
    if (loadedRef.current) {
      return
    }
    loadedRef.current = true

    const now = nowRef.current()
    const result = loadSave(storageRef.current)

    if (result.kind === 'absent') {
      ref.current = createPlayer(generatePlayerId(), now)
      selectedRef.current = ref.current.homePlanet.name
      setSelectedPlanetName(selectedRef.current)
      tutorialRef.current = { step: 0, done: false, skipped: false }
      setTutorialState(tutorialRef.current)
      commit()
      return
    }

    if (result.kind === 'corrupt' || result.kind === 'future') {
      ref.current = createPlayer(generatePlayerId(), now)
      selectedRef.current = ref.current.homePlanet.name
      setSelectedPlanetName(selectedRef.current)
      tutorialRef.current = { step: 0, done: false, skipped: false }
      setTutorialState(tutorialRef.current)
      commit()
      setSaveNotice("Saved game couldn't be read — starting a new game.")
      return
    }

    const save = result.save
    ref.current = clonePlayer(save.player)
    selectedRef.current = ref.current.homePlanet.name
    setSelectedPlanetName(selectedRef.current)
    tutorialRef.current = { ...save.tutorial }
    setTutorialState(tutorialRef.current)
    offlineSeenRef.current = save.offlineSummarySeen
    setOfflineSummarySeen(save.offlineSummarySeen)

    const before = clonePlayer(ref.current)
    const gapMs = now - before.lastTickAt
    const bankedMs = bankElapsed(now, true)

    if (gapMs > OFFLINE_SUMMARY_THRESHOLD_MS) {
      offlineSeenRef.current = false
      setOfflineSummarySeen(false)
      const elapsedSec = bankedMs / 1_000
      const beforeTotals = planetTotals(before)
      const afterTotals = planetTotals(ref.current)
      const rates = empireRates(before)
      setOfflineGain({
        elapsedSec,
        credits: calculateOfflineEarnings(rates.creditsPerSec, elapsedSec),
        alloys: calculateOfflineEarnings(rates.alloysPerSec, elapsedSec),
        population: afterTotals.population - beforeTotals.population,
        garrison: afterTotals.garrison - beforeTotals.garrison,
        fleet: afterTotals.fleet - beforeTotals.fleet,
      })
    }
    commit()
  }, [bankElapsed, commit, scheduleSave])

  useEffect(() => {
    const id = window.setInterval(() => {
      bankElapsed()
    }, 1_000)
    return () => window.clearInterval(id)
  }, [bankElapsed])

  useEffect(() => {
    const handleHide = () => {
      flushSave()
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushSave()
      }
    }
    window.addEventListener('beforeunload', handleHide)
    window.addEventListener('pagehide', handleHide)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('beforeunload', handleHide)
      window.removeEventListener('pagehide', handleHide)
      document.removeEventListener('visibilitychange', handleVisibility)
      if (debounceRef.current != null) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [flushSave])

  const current = snapshot
  const selectedOwned =
    ownedPlanetByName(ref.current, selectedPlanetName) ?? ref.current.homePlanet
  const selectedGrid = gridForPlanet(ref.current, selectedOwned.name)
  return {
    state: current,
    derived: computePlanetDerived(selectedOwned, selectedGrid),
    empire: empireRates(ref.current),
    playerId: ref.current.playerId,
    planets: [
      clonePlanet(ref.current.homePlanet),
      ...ref.current.colonies.map(clonePlanet),
    ],
    homePlanet: clonePlanet(ref.current.homePlanet),
    homeIdentity: ownedPlanetIdentity(ref.current.homePlanet),
    selectedPlanetName,
    selectedPlanet: clonePlanet(selectedOwned),
    selectedIdentity: ownedPlanetIdentity(selectedOwned),
    selectPlanet,
    buy,
    colonise,
    coloniseBusy,
    coloniseError,
    canColonise: firstUnclaimedByIndex(ref.current) !== null,
    bankElapsed,
    offlineGain,
    dismissOffline,
    tutorial,
    advanceTutorial,
    skipTutorial,
    offlineSummarySeen,
    saveNotice,
    dismissSaveNotice,
  }
}
