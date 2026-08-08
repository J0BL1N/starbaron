import { MAX_TIER, MIN_TIER } from '../sim/core/economy'
import { STRUCTURE_IDS, isStructureId } from '../sim/structures/data'
import type { StructureId } from '../sim/structures/types'

export const SAVE_KEY = 'starbaron.save.v1'
export const SAVE_SCHEMA_VERSION = 1
export const OFFLINE_SUMMARY_THRESHOLD_MS = 60 * 1_000
export const TUTORIAL_LAST_STEP = 3

export interface TutorialState {
  step: number
  done: boolean
  skipped: boolean
}

export interface SaveGameV1 {
  schemaVersion: number
  savedAt: number
  game: {
    tier: number
    credits: number
    alloys: number
    population: number
    garrison: number
    fleet: number
    levels: Record<StructureId, number>
    lastTickAt: number
  }
  tutorial: TutorialState
  offlineSummarySeen: boolean
}

export type SaveSchema = SaveGameV1

export type LoadResult =
  | { kind: 'absent' }
  | { kind: 'ok'; save: SaveGameV1 }
  | { kind: 'future'; version: number }
  | { kind: 'corrupt' }

export const MIGRATIONS: Record<number, (raw: unknown) => unknown> = {}

export function emptyStructureLevels(): Record<StructureId, number> {
  const levels = {} as Record<StructureId, number>
  for (const id of STRUCTURE_IDS) {
    levels[id] = 0
  }
  return levels
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteInteger(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  )
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function validateTutorial(value: unknown): TutorialState {
  const base: TutorialState = { step: 0, done: false, skipped: false }
  if (!isRecord(value)) {
    return base
  }
  return {
    step: isFiniteInteger(value.step, 0, TUTORIAL_LAST_STEP)
      ? value.step
      : base.step,
    done: typeof value.done === 'boolean' ? value.done : base.done,
    skipped: typeof value.skipped === 'boolean' ? value.skipped : base.skipped,
  }
}

export function validateSave(value: unknown): SaveGameV1 | null {
  if (!isRecord(value)) {
    return null
  }
  if (value.schemaVersion !== SAVE_SCHEMA_VERSION) {
    return null
  }
  const game = value.game
  if (!isRecord(game)) {
    return null
  }
  if (!isFiniteInteger(game.tier, MIN_TIER, MAX_TIER)) {
    return null
  }
  const tier = game.tier
  const credits = game.credits
  const alloys = game.alloys
  const population = game.population
  const garrison = game.garrison
  const fleet = game.fleet
  if (
    !isFiniteNonNegative(credits) ||
    !isFiniteNonNegative(alloys) ||
    !isFiniteNonNegative(population) ||
    !isFiniteNonNegative(garrison) ||
    !isFiniteNonNegative(fleet)
  ) {
    return null
  }
  if (!isRecord(game.levels)) {
    return null
  }
  const levels = emptyStructureLevels()
  for (const key of Object.keys(game.levels)) {
    if (!isStructureId(key)) {
      return null
    }
    if (!isFiniteNonNegativeInteger(game.levels[key])) {
      return null
    }
    levels[key] = game.levels[key]
  }
  if (
    typeof game.lastTickAt !== 'number' ||
    !Number.isFinite(game.lastTickAt)
  ) {
    return null
  }
  const lastTickAt = game.lastTickAt
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt:
      typeof value.savedAt === 'number' && Number.isFinite(value.savedAt)
        ? value.savedAt
        : 0,
    game: {
      tier,
      credits,
      alloys,
      population,
      garrison,
      fleet,
      levels,
      lastTickAt,
    },
    tutorial: validateTutorial(value.tutorial),
    offlineSummarySeen:
      typeof value.offlineSummarySeen === 'boolean'
        ? value.offlineSummarySeen
        : false,
  }
}

export function migrateSave(value: unknown): unknown {
  let current = value
  while (
    isRecord(current) &&
    typeof current.schemaVersion === 'number'
  ) {
    const version = current.schemaVersion
    if (version >= SAVE_SCHEMA_VERSION) {
      break
    }
    const migrate = MIGRATIONS[version]
    if (migrate == null) {
      break
    }
    current = migrate(current)
  }
  return current
}

export function loadSave(storage: Storage | null): LoadResult {
  if (storage == null) {
    return { kind: 'absent' }
  }
  let raw: string | null = null
  try {
    raw = storage.getItem(SAVE_KEY)
  } catch {
    return { kind: 'absent' }
  }
  if (raw === null) {
    return { kind: 'absent' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'corrupt' }
  }
  if (!isRecord(parsed) || typeof parsed.schemaVersion !== 'number') {
    return { kind: 'corrupt' }
  }
  if (parsed.schemaVersion > SAVE_SCHEMA_VERSION) {
    return { kind: 'future', version: parsed.schemaVersion }
  }
  const save = validateSave(migrateSave(parsed))
  if (save === null) {
    return { kind: 'corrupt' }
  }
  return { kind: 'ok', save }
}

export function saveGame(save: SaveGameV1, storage: Storage | null): boolean {
  if (storage == null) {
    return false
  }
  try {
    const validated = validateSave(save)
    if (validated === null) {
      return false
    }
    storage.setItem(SAVE_KEY, JSON.stringify(validated))
    return true
  } catch {
    return false
  }
}

export function clearSave(storage: Storage | null): void {
  if (storage == null) {
    return
  }
  try {
    storage.removeItem(SAVE_KEY)
  } catch {
    // Degrade silently — same policy as saveGame; the save simply stays.
  }
}
