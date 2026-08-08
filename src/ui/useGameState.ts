import { useCallback, useEffect, useRef, useState } from 'react'
import { baselinePassiveIncome } from '../sim/core/economy'
import {
  calculateOfflineEarnings,
  MAX_OFFLINE_BANK_SECONDS,
} from '../sim/core/offline'
import { populationCap, populationGrowthPerSec } from '../sim/core/population'
import { STRUCTURES } from '../sim/structures/data'
import { nextBuildCost, structureEffect } from '../sim/structures/effects'
import type { StructureId } from '../sim/structures/types'

export const STARTING_TIER = 1
export const STARTER_CREDITS = 1_000
export const STARTER_ALLOYS = 0
export const STARTER_POPULATION = 1_000
export const DEFAULT_SIMULATED_GAP_MS = 12 * 60 * 60 * 1_000

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
  simulatedGapMs?: number
  now?: () => number
}

export interface UseGameStateReturn {
  state: GameState
  derived: DerivedRates
  buy: (id: StructureId) => void
  bankElapsed: (at?: number) => number
  offlineGain: OfflineGain | null
  dismissOffline: () => void
}

function emptyLevels(): Record<StructureId, number> {
  return {
    oreMine: 0,
    tradeHub: 0,
    housing: 0,
    hydroponics: 0,
    barracks: 0,
    shipyard: 0,
    defenseTurret: 0,
  }
}

function initialState(now: number): GameState {
  return {
    tier: STARTING_TIER,
    credits: STARTER_CREDITS,
    alloys: STARTER_ALLOYS,
    population: STARTER_POPULATION,
    garrison: 0,
    fleet: 0,
    levels: emptyLevels(),
    lastTickAt: now,
  }
}

export function computeDerived(
  levels: Record<StructureId, number>,
  tier: number,
): DerivedRates {
  const oreMine = structureEffect('oreMine', levels.oreMine)
  const tradeHub = structureEffect('tradeHub', levels.tradeHub)
  const barracks = structureEffect('barracks', levels.barracks)
  const shipyard = structureEffect('shipyard', levels.shipyard)
  const defenseTurret = structureEffect('defenseTurret', levels.defenseTurret)

  const tradeHubEffect = tradeHub.kind === 'incomeMultiplier' ? tradeHub : null
  const shipyardEffect = shipyard.kind === 'shipyard' ? shipyard : null
  const oreMineEffect = oreMine.kind === 'alloys' ? oreMine : null
  const barracksEffect = barracks.kind === 'barracks' ? barracks : null
  const defenseEffect = defenseTurret.kind === 'defense' ? defenseTurret : null

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
    defensePower: defenseEffect?.defensePower ?? 0,
  }
}

function accrue(
  state: GameState,
  derived: DerivedRates,
  elapsedMs: number,
): GameState {
  const dt = elapsedMs / 1_000
  return {
    ...state,
    credits: state.credits + derived.creditsPerSec * dt,
    alloys: state.alloys + derived.alloysPerSec * dt,
    population: Math.min(
      state.population + derived.populationPerSec * dt,
      derived.populationCap,
    ),
    garrison: Math.min(
      state.garrison + derived.garrisonPerSec * dt,
      derived.garrisonCap,
    ),
  }
}

export function useGameState(options: UseGameStateOptions = {}): UseGameStateReturn {
  const nowFn = options.now ?? Date.now
  const simulatedGapMs = options.simulatedGapMs ?? DEFAULT_SIMULATED_GAP_MS

  const ref = useRef<GameState>(initialState(nowFn()))
  const [snapshot, setSnapshot] = useState<GameState>(ref.current)
  const [offlineGain, setOfflineGain] = useState<OfflineGain | null>(null)

  const commit = useCallback(() => {
    setSnapshot({ ...ref.current })
  }, [])

  const bankElapsed = useCallback(
    (at = nowFn()): number => {
      const current = ref.current
      const elapsedMs = at - current.lastTickAt
      if (elapsedMs <= 0) {
        return 0
      }
      const cappedMs = Math.min(elapsedMs, OFFLINE_CAP_MS)
      const next = accrue(current, computeDerived(current.levels, current.tier), cappedMs)
      next.lastTickAt = at
      ref.current = next
      commit()
      return cappedMs
    },
    [commit, nowFn],
  )

  const buy = useCallback(
    (id: StructureId): void => {
      bankElapsed()
      const current = ref.current
      const level = current.levels[id]
      const cost = nextBuildCost(id, level)
      const alloyCost = STRUCTURES[id].alloyCost ?? 0
      if (current.credits < cost || current.alloys < alloyCost) {
        return
      }
      ref.current = {
        ...current,
        credits: current.credits - cost,
        alloys: current.alloys - alloyCost,
        levels: { ...current.levels, [id]: level + 1 },
      }
      commit()
    },
    [bankElapsed, commit],
  )

  const dismissOffline = useCallback(() => {
    setOfflineGain(null)
  }, [])

  const simulatedRef = useRef(false)
  useEffect(() => {
    if (simulatedRef.current) {
      return
    }
    simulatedRef.current = true
    if (simulatedGapMs <= 0) {
      return
    }
    const before = ref.current
    ref.current = { ...before, lastTickAt: nowFn() - simulatedGapMs }
    const cappedMs = bankElapsed()
    const derived = computeDerived(ref.current.levels, ref.current.tier)
    const elapsedSec = cappedMs / 1_000
    setOfflineGain({
      elapsedSec,
      credits: calculateOfflineEarnings(derived.creditsPerSec, elapsedSec),
      alloys: calculateOfflineEarnings(derived.alloysPerSec, elapsedSec),
      population: calculateOfflineEarnings(derived.populationPerSec, elapsedSec),
      garrison: calculateOfflineEarnings(derived.garrisonPerSec, elapsedSec),
      fleet: calculateOfflineEarnings(0, elapsedSec),
    })
  }, [bankElapsed, nowFn, simulatedGapMs])

  useEffect(() => {
    const id = window.setInterval(() => {
      bankElapsed()
    }, 1_000)
    return () => window.clearInterval(id)
  }, [bankElapsed])

  return {
    state: snapshot,
    derived: computeDerived(snapshot.levels, snapshot.tier),
    buy,
    bankElapsed,
    offlineGain,
    dismissOffline,
  }
}
