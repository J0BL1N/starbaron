import { useCallback, useEffect, useRef, useState } from 'react'
import { baselinePassiveIncome } from '../sim/core/economy'
import {
  calculateOfflineEarnings,
  MAX_OFFLINE_BANK_SECONDS,
} from '../sim/core/offline'
import { populationCap, populationGrowthPerSec } from '../sim/core/population'
import {
  createPlayer,
  generatePlayerId,
  ownedPlanetIdentity,
  walletSpend,
} from '../sim/player'
import type { OwnedPlanet, PlayerState } from '../sim/player'
import type { PlanetIdentity } from '../sim/planets/types'
import { STRUCTURES } from '../sim/structures/data'
import { nextBuildCost, structureEffect, defensePower } from '../sim/structures/effects'
import type { StructureId } from '../sim/structures/types'
import {
  loadSave,
  OFFLINE_SUMMARY_THRESHOLD_MS,
  saveGame,
  SAVE_SCHEMA_VERSION,
  TUTORIAL_LAST_STEP,
} from './save'
import type { SaveGameV2, TutorialState } from './save'

export const AUTOSAVE_DEBOUNCE_MS = 5_000

const OFFLINE_CAP_MS = MAX_OFFLINE_BANK_SECONDS * 1_000

export interface GameState {
  tier: number
  credits: number
  alloys: number
  population: number
  garrison: number
  fleet: number
  levels: Record<StructureId, number>
  lastTickAt: number
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
  playerId: string
  homePlanet: OwnedPlanet
  homeIdentity: PlanetIdentity
  buy: (id: StructureId) => void
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

function project(player: PlayerState): GameState {
  return {
    tier: player.homePlanet.tier,
    credits: player.wallet.credits,
    alloys: player.wallet.alloys,
    population: player.wallet.population,
    garrison: player.wallet.garrison,
    fleet: player.wallet.fleet,
    levels: { ...player.structureLevels },
    lastTickAt: player.lastTickAt,
  }
}

function clonePlanet(planet: OwnedPlanet): OwnedPlanet {
  return { ...planet, entry: { ...planet.entry } }
}

function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    homePlanet: clonePlanet(player.homePlanet),
    colonies: player.colonies.map(clonePlanet),
    wallet: { ...player.wallet },
    structureLevels: { ...player.structureLevels },
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

export function computeDerived(
  levels: Record<StructureId, number>,
  tier: number,
  population: number,
): DerivedRates {
  const oreMine = structureEffect('oreMine', levels.oreMine)
  const tradeHub = structureEffect('tradeHub', levels.tradeHub)
  const barracks = structureEffect('barracks', levels.barracks)
  const shipyard = structureEffect('shipyard', levels.shipyard)

  const tradeHubEffect = tradeHub.kind === 'incomeMultiplier' ? tradeHub : null
  const shipyardEffect = shipyard.kind === 'shipyard' ? shipyard : null
  const oreMineEffect = oreMine.kind === 'alloys' ? oreMine : null
  const barracksEffect = barracks.kind === 'barracks' ? barracks : null

  return {
    creditsPerSec:
      baselinePassiveIncome(tier) * (tradeHubEffect?.multiplier ?? 1) +
      (shipyardEffect?.shipbuildingIncomePerSec ?? 0),
    alloysPerSec: oreMineEffect?.alloysPerSec ?? 0,
    populationPerSec: populationGrowthPerSec(levels.housing, levels.hydroponics),
    garrisonPerSec: barracksEffect?.soldierConversionPerSec ?? 0,
    populationCap: populationCap(levels.housing),
    garrisonCap: barracksEffect?.garrisonCap ?? 0,
    fleetCap: shipyardEffect?.fleetCap ?? 0,
    defensePower: defensePower(levels.defenseTurret, population),
  }
}

function accrue(
  player: PlayerState,
  derived: DerivedRates,
  elapsedMs: number,
): PlayerState {
  const dt = elapsedMs / 1_000
  const wholeSeconds = Math.floor(dt)
  const remainder = dt - wholeSeconds

  const wallet = { ...player.wallet }
  let population = wallet.population
  let garrison = wallet.garrison

  for (let i = 0; i < wholeSeconds; i += 1) {
    if (population < derived.populationCap) {
      population = Math.min(
        population + derived.populationPerSec,
        derived.populationCap,
      )
    }
    const converted = Math.min(
      derived.garrisonPerSec,
      Math.max(0, derived.garrisonCap - garrison),
      population,
    )
    population -= converted
    garrison += converted
  }

  if (remainder > 0) {
    if (population < derived.populationCap) {
      population = Math.min(
        population + derived.populationPerSec * remainder,
        derived.populationCap,
      )
    }
    const converted = Math.min(
      derived.garrisonPerSec * remainder,
      Math.max(0, derived.garrisonCap - garrison),
      population,
    )
    population -= converted
    garrison += converted
  }

  wallet.credits += derived.creditsPerSec * dt
  wallet.alloys += derived.alloysPerSec * dt
  wallet.population = population
  wallet.garrison = garrison

  return { ...player, wallet }
}

export function useGameState(options: UseGameStateOptions = {}): UseGameStateReturn {
  const nowFn = options.now ?? Date.now
  const nowRef = useRef(nowFn)
  nowRef.current = nowFn
  const storageRef = useRef<Storage | null>(resolveStorage(options.storage))

  const ref = useRef<PlayerState>(initialPlayer(nowFn()))
  const [snapshot, setSnapshot] = useState<GameState>(project(ref.current))
  const [offlineGain, setOfflineGain] = useState<OfflineGain | null>(null)

  const initialTutorial: TutorialState = { step: 0, done: false, skipped: false }
  const tutorialRef = useRef<TutorialState>(initialTutorial)
  const [tutorial, setTutorialState] = useState<TutorialState>(initialTutorial)
  const offlineSeenRef = useRef(false)
  const [offlineSummarySeen, setOfflineSummarySeen] = useState(false)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

  const saveRef = useRef<SaveGameV2 | null>(null)
  const debounceRef = useRef<number | null>(null)
  const quotaNoticedRef = useRef(false)
  const loadedRef = useRef(false)

  const writeSave = useCallback((payload: SaveGameV2) => {
    const store = storageRef.current
    if (!saveGame(payload, store) && !quotaNoticedRef.current) {
      quotaNoticedRef.current = true
      setSaveNotice("Couldn't save progress this session.")
    }
  }, [])

  const buildPayload = useCallback((): SaveGameV2 => {
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
    setSnapshot(project(ref.current))
    scheduleSave()
  }, [scheduleSave])

  const bankElapsed = useCallback(
    (at = nowRef.current(), durable = false): number => {
      const current = ref.current
      const elapsedMs = at - current.lastTickAt
      if (elapsedMs <= 0) {
        return 0
      }
      const cappedMs = Math.min(elapsedMs, OFFLINE_CAP_MS)
      const next = accrue(
        current,
        computeDerived(
          current.structureLevels,
          current.homePlanet.tier,
          current.wallet.population,
        ),
        cappedMs,
      )
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
      const level = current.structureLevels[id]
      const cost = nextBuildCost(id, level)
      const alloyCost = STRUCTURES[id].alloyCost ?? 0
      if (current.wallet.credits < cost || current.wallet.alloys < alloyCost) {
        return
      }
      ref.current = {
        ...current,
        wallet: walletSpend(current.wallet, cost, alloyCost),
        structureLevels: { ...current.structureLevels, [id]: level + 1 },
      }
      commit()
      flushSave()
    },
    [bankElapsed, commit, flushSave],
  )

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
      tutorialRef.current = { step: 0, done: false, skipped: false }
      setTutorialState(tutorialRef.current)
      commit()
      return
    }

    if (result.kind === 'corrupt' || result.kind === 'future') {
      ref.current = createPlayer(generatePlayerId(), now)
      tutorialRef.current = { step: 0, done: false, skipped: false }
      setTutorialState(tutorialRef.current)
      commit()
      setSaveNotice("Saved game couldn't be read — starting a new game.")
      return
    }

    const save = result.save
    ref.current = clonePlayer(save.player)
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
      const derived = computeDerived(
        ref.current.structureLevels,
        ref.current.homePlanet.tier,
        ref.current.wallet.population,
      )
      const elapsedSec = bankedMs / 1_000
      setOfflineGain({
        elapsedSec,
        credits: calculateOfflineEarnings(derived.creditsPerSec, elapsedSec),
        alloys: calculateOfflineEarnings(derived.alloysPerSec, elapsedSec),
        population: ref.current.wallet.population - before.wallet.population,
        garrison: ref.current.wallet.garrison - before.wallet.garrison,
        fleet: calculateOfflineEarnings(0, elapsedSec),
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
  return {
    state: current,
    derived: computeDerived(current.levels, current.tier, current.population),
    playerId: ref.current.playerId,
    homePlanet: clonePlanet(ref.current.homePlanet),
    homeIdentity: ownedPlanetIdentity(ref.current.homePlanet),
    buy,
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
