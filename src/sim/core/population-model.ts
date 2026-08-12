import { populationCap, populationGrowthPerSec } from './population'

export interface PopulationState {
  population: number
  housingLevels: number
  hydroponicsLevels: number
  lastTickAt: number
}

export interface PopulationSnapshot {
  population: number
  cap: number
  growthPerSec: number
  at: number
}

function clampPopulation(value: number, cap: number): number {
  return Math.min(Math.max(value, 0), cap)
}

export function populationCapFor(housingLevels: number, planetMultiplier: number): number {
  if (!Number.isFinite(planetMultiplier) || planetMultiplier <= 0) {
    throw new RangeError(
      `planetMultiplier must be a finite number greater than 0, got ${planetMultiplier}`,
    )
  }
  return populationCap(housingLevels) * planetMultiplier
}

export function growthRateFor(housingLevels: number, hydroponicsLevels = 0): number {
  return populationGrowthPerSec(housingLevels, hydroponicsLevels)
}

export function snapshotAt(state: PopulationState, at: number): PopulationSnapshot {
  if (!Number.isFinite(at)) {
    throw new RangeError(`at must be a finite number, got ${at}`)
  }
  if (at < state.lastTickAt) {
    throw new RangeError(
      `at (${at}) must not be earlier than lastTickAt (${state.lastTickAt})`,
    )
  }
  const growthPerSec = growthRateFor(state.housingLevels, state.hydroponicsLevels)
  const cap = populationCap(state.housingLevels)
  const elapsed = at - state.lastTickAt
  const population = clampPopulation(state.population + growthPerSec * elapsed, cap)
  return { population, cap, growthPerSec, at }
}

export function applyGrowth(state: PopulationState, at: number): PopulationState {
  const snapshot = snapshotAt(state, at)
  return { ...state, population: snapshot.population, lastTickAt: at }
}

export function applyWarLoss(state: PopulationState, fraction: number, at: number): PopulationState {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new RangeError(`fraction must be a finite number in [0, 1], got ${fraction}`)
  }
  if (!Number.isFinite(at)) {
    throw new RangeError(`at must be a finite number, got ${at}`)
  }
  if (at < state.lastTickAt) {
    throw new RangeError(
      `at (${at}) must not be earlier than lastTickAt (${state.lastTickAt})`,
    )
  }
  const population = Math.max(0, state.population * (1 - fraction))
  return { ...state, population, lastTickAt: at }
}

export function populationInvariants(state: PopulationState): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []

  if (!Number.isFinite(state.population)) {
    problems.push('population must be finite')
  } else if (state.population < 0) {
    problems.push('population must be non-negative')
  }

  if (!Number.isInteger(state.housingLevels) || state.housingLevels < 0) {
    problems.push('housingLevels must be a non-negative integer')
  }
  if (!Number.isInteger(state.hydroponicsLevels) || state.hydroponicsLevels < 0) {
    problems.push('hydroponicsLevels must be a non-negative integer')
  }
  if (!Number.isFinite(state.lastTickAt) || state.lastTickAt <= 0) {
    problems.push('lastTickAt must be a finite number greater than 0')
  }

  const levelsValid =
    Number.isFinite(state.population) &&
    state.population >= 0 &&
    Number.isInteger(state.housingLevels) &&
    state.housingLevels >= 0
  if (levelsValid && state.population > populationCap(state.housingLevels)) {
    problems.push('population exceeds cap')
  }

  return { ok: problems.length === 0, problems }
}
