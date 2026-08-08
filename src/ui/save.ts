import { MAX_TIER, MIN_TIER } from '../sim/core/economy'
import type { PlanetCatalogueEntry, PlanetTier } from '../sim/data/planets'
import { fnv1a, makePlanet } from '../sim/planets'
import {
  catalogueEntryByName,
  claimHomePlanet,
  emptyStructureLevels,
} from '../sim/player'
import type {
  OwnedPlanet,
  PlayerState,
  StructureGrid,
  WalletState,
} from '../sim/player'
import { isStructureId } from '../sim/structures/data'
import type { StructureId } from '../sim/structures/types'

export const SAVE_KEY = 'starbaron.save.v1'
export const SAVE_V2_KEY = 'starbaron.save.v2'
export const SAVE_V3_KEY = 'starbaron.save.v3'
export const SAVE_SCHEMA_VERSION = 3
export const OFFLINE_SUMMARY_THRESHOLD_MS = 60 * 1_000
export const TUTORIAL_LAST_STEP = 3

export interface TutorialState {
  step: number
  done: boolean
  skipped: boolean
}

export interface SaveGameV1 {
  schemaVersion: 1
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

export interface SaveGameV2 {
  schemaVersion: 2
  savedAt: number
  player: {
    playerId: string
    homePlanet: OwnedPlanet
    colonies: OwnedPlanet[]
    wallet: WalletState & {
      population: number
      garrison: number
      fleet: number
    }
    structureLevels: Record<StructureId, number>
    lastTickAt: number
  }
  tutorial: TutorialState
  offlineSummarySeen: boolean
}

export interface SaveGameV3 {
  schemaVersion: 3
  savedAt: number
  player: PlayerState
  tutorial: TutorialState
  offlineSummarySeen: boolean
}

export type SaveSchema = SaveGameV3

export type LoadResult =
  | { kind: 'absent' }
  | { kind: 'ok'; save: SaveGameV3 }
  | { kind: 'future'; version: number }
  | { kind: 'corrupt' }

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

function validateWallet(value: unknown): WalletState | null {
  if (!isRecord(value)) {
    return null
  }
  const credits = value.credits
  const alloys = value.alloys
  if (!isFiniteNonNegative(credits) || !isFiniteNonNegative(alloys)) {
    return null
  }
  if ('population' in value || 'garrison' in value || 'fleet' in value) {
    return null
  }
  return { credits, alloys }
}

function validateOwnedPlanet(value: unknown, isHome: boolean): OwnedPlanet | null {
  if (!isRecord(value)) {
    return null
  }
  const name = value.name
  if (typeof name !== 'string' || name.length === 0) {
    return null
  }
  const entry = value.entry
  if (!isRecord(entry) || entry.name !== name) {
    return null
  }
  const catalogueEntry = catalogueEntryByName(name)
  if (catalogueEntry === null) {
    return null
  }
  const tier = value.tier
  if (!isFiniteInteger(tier, MIN_TIER, MAX_TIER)) {
    return null
  }
  if (
    !isFiniteInteger(entry.tier, MIN_TIER, MAX_TIER) ||
    entry.tier !== tier ||
    catalogueEntry.tier !== tier
  ) {
    return null
  }
  if (
    !isFiniteNonNegative(value.baselineIncomePerSec) ||
    !isFiniteNonNegative(value.populationCapMultiplier) ||
    !isFiniteNonNegative(value.claimedAt) ||
    !isFiniteNonNegative(value.population) ||
    !isFiniteNonNegative(value.garrison) ||
    !isFiniteNonNegative(value.fleet)
  ) {
    return null
  }
  const derived = makePlanet(catalogueEntry)
  if (
    value.baselineIncomePerSec !== derived.baselineIncomePerSec ||
    value.populationCapMultiplier !== derived.populationCapMultiplier
  ) {
    return null
  }
  if (typeof value.isHome !== 'boolean' || typeof value.unconquerable !== 'boolean') {
    return null
  }
  if (value.isHome !== isHome || value.unconquerable !== value.isHome) {
    return null
  }
  return {
    name,
    entry: entry as unknown as PlanetCatalogueEntry,
    tier: tier as PlanetTier,
    baselineIncomePerSec: value.baselineIncomePerSec,
    populationCapMultiplier: value.populationCapMultiplier,
    claimedAt: value.claimedAt,
    isHome: value.isHome,
    unconquerable: value.unconquerable,
    population: value.population,
    garrison: value.garrison,
    fleet: value.fleet,
  }
}

function validateStructureGrid(value: unknown): StructureGrid | null {
  if (!isRecord(value)) {
    return null
  }
  const levels = emptyStructureLevels()
  for (const key of Object.keys(value)) {
    if (!isStructureId(key)) {
      return null
    }
    if (!isFiniteNonNegativeInteger(value[key])) {
      return null
    }
    levels[key] = value[key]
  }
  return levels
}

function validateStructureLevels(
  value: unknown,
  ownedNames: ReadonlySet<string>,
): Record<string, StructureGrid> | null {
  if (!isRecord(value)) {
    return null
  }
  const grids: Record<string, StructureGrid> = {}
  const seen = new Set<string>()
  for (const key of Object.keys(value)) {
    if (!ownedNames.has(key)) {
      return null
    }
    const grid = validateStructureGrid(value[key])
    if (grid === null) {
      return null
    }
    grids[key] = grid
    seen.add(key)
  }
  for (const name of ownedNames) {
    if (!seen.has(name)) {
      grids[name] = emptyStructureLevels()
    }
  }
  return grids
}

export function validateSave(value: unknown): SaveGameV3 | null {
  if (!isRecord(value)) {
    return null
  }
  if (value.schemaVersion !== SAVE_SCHEMA_VERSION) {
    return null
  }
  const player = value.player
  if (!isRecord(player)) {
    return null
  }
  const playerId = player.playerId
  if (typeof playerId !== 'string' || playerId.length === 0) {
    return null
  }

  const homePlanet = validateOwnedPlanet(player.homePlanet, true)
  if (homePlanet === null) {
    return null
  }

  if (!Array.isArray(player.colonies)) {
    return null
  }
  const colonies: OwnedPlanet[] = []
  const owned = new Set<string>([homePlanet.name])
  for (const raw of player.colonies) {
    const colony = validateOwnedPlanet(raw, false)
    if (colony === null) {
      return null
    }
    if (owned.has(colony.name)) {
      return null
    }
    owned.add(colony.name)
    colonies.push(colony)
  }

  const wallet = validateWallet(player.wallet)
  if (wallet === null) {
    return null
  }

  const structureLevels = validateStructureLevels(player.structureLevels, owned)
  if (structureLevels === null) {
    return null
  }

  if (typeof player.lastTickAt !== 'number' || !Number.isFinite(player.lastTickAt)) {
    return null
  }

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt:
      typeof value.savedAt === 'number' && Number.isFinite(value.savedAt)
        ? value.savedAt
        : 0,
    player: {
      playerId,
      homePlanet,
      colonies,
      wallet,
      structureLevels,
      lastTickAt: player.lastTickAt,
    },
    tutorial: validateTutorial(value.tutorial),
    offlineSummarySeen:
      typeof value.offlineSummarySeen === 'boolean'
        ? value.offlineSummarySeen
        : false,
  }
}

const MIGRATION_SALT = 'starbaron-migration-v1'

function resolveMigrationSavedAt(source: Record<string, unknown>): number {
  return typeof source.savedAt === 'number' && Number.isFinite(source.savedAt)
    ? source.savedAt
    : 0
}

function canonicalLevels(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) {
    return null
  }
  const out: Record<string, number> = {}
  for (const key of Object.keys(value).sort()) {
    out[key] = value[key] as number
  }
  return out
}

function migratePlayerIdFromV1(source: Record<string, unknown>): string {
  const game = isRecord(source.game) ? source.game : {}
  const fingerprint = JSON.stringify([
    resolveMigrationSavedAt(source),
    game.tier,
    game.credits,
    game.alloys,
    game.population,
    game.garrison,
    game.fleet,
    game.lastTickAt,
    canonicalLevels(game.levels),
  ])
  const hash = fnv1a(`${MIGRATION_SALT}|${fingerprint}`)
  return `migrated-${hash.toString(36)}`
}

function migrateV1ToV2(raw: unknown): unknown {
  const source = (isRecord(raw) ? raw : {}) as Record<string, unknown>
  const game = isRecord(source.game) ? source.game : {}
  const savedAt = resolveMigrationSavedAt(source)
  const playerId = migratePlayerIdFromV1(source)
  let homePlanet: OwnedPlanet | undefined
  try {
    homePlanet = claimHomePlanet(playerId, savedAt)
  } catch {
    homePlanet = undefined
  }
  return {
    schemaVersion: 2,
    savedAt,
    player: {
      playerId,
      homePlanet,
      colonies: [],
      wallet: {
        credits: game.credits,
        alloys: game.alloys,
        population: game.population,
        garrison: game.garrison,
        fleet: game.fleet,
      },
      structureLevels: game.levels,
      lastTickAt: game.lastTickAt,
    },
    tutorial: source.tutorial,
    offlineSummarySeen: source.offlineSummarySeen,
  }
}

function migrateV2ToV3(raw: unknown): unknown {
  const source = (isRecord(raw) ? raw : {}) as Record<string, unknown>
  const player = isRecord(source.player) ? source.player : {}
  const wallet = isRecord(player.wallet) ? player.wallet : {}
  const homePlanet = isRecord(player.homePlanet) ? player.homePlanet : {}
  const colonies = Array.isArray(player.colonies) ? player.colonies : []
  const flatLevels = isRecord(player.structureLevels) ? player.structureLevels : {}

  const homeName = typeof homePlanet.name === 'string' ? homePlanet.name : ''
  const structureLevels: Record<string, StructureGrid> = {
    [homeName]: { ...flatLevels } as StructureGrid,
  }

  const migratedColonies: Record<string, unknown>[] = []
  for (const rawColony of colonies) {
    const colony = isRecord(rawColony) ? rawColony : {}
    const colonyName = typeof colony.name === 'string' ? colony.name : ''
    structureLevels[colonyName] = emptyStructureLevels()
    migratedColonies.push({ ...colony, population: 0, garrison: 0, fleet: 0 })
  }

  return {
    ...source,
    schemaVersion: 3,
    player: {
      ...player,
      homePlanet: {
        ...homePlanet,
        population: wallet.population ?? 0,
        garrison: wallet.garrison ?? 0,
        fleet: wallet.fleet ?? 0,
      },
      colonies: migratedColonies,
      wallet: { credits: wallet.credits, alloys: wallet.alloys },
      structureLevels,
    },
  }
}

export const MIGRATIONS: Record<number, (raw: unknown) => unknown> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
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

const SAVE_KEYS_NEWEST_FIRST = [SAVE_V3_KEY, SAVE_V2_KEY, SAVE_KEY]

function repairHomePlanetClaim(save: SaveGameV3): SaveGameV3 | null {
  let expected: OwnedPlanet
  try {
    expected = claimHomePlanet(save.player.playerId, save.savedAt)
  } catch {
    return null
  }
  if (save.player.homePlanet.name === expected.name) {
    return null
  }
  const colonies = save.player.colonies.filter(
    (colony) => colony.name !== expected.name,
  )
  const owned = new Set<string>([
    expected.name,
    ...colonies.map((colony) => colony.name),
  ])
  const structureLevels: Record<string, StructureGrid> = {}
  for (const name of owned) {
    structureLevels[name] = save.player.structureLevels[name] ?? emptyStructureLevels()
  }
  return {
    ...save,
    player: {
      ...save.player,
      homePlanet: expected,
      colonies,
      structureLevels,
    },
  }
}

export function loadSave(storage: Storage | null): LoadResult {
  if (storage == null) {
    return { kind: 'absent' }
  }
  for (const key of SAVE_KEYS_NEWEST_FIRST) {
    let raw: string | null = null
    try {
      raw = storage.getItem(key)
    } catch {
      continue
    }
    if (raw === null) {
      continue
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
    const repaired = repairHomePlanetClaim(save)
    if (key !== SAVE_V3_KEY || repaired !== null) {
      saveGame(repaired ?? save, storage)
    }
    return { kind: 'ok', save: repaired ?? save }
  }
  return { kind: 'absent' }
}

export function saveGame(save: SaveGameV3, storage: Storage | null): boolean {
  if (storage == null) {
    return false
  }
  try {
    const validated = validateSave(save)
    if (validated === null) {
      return false
    }
    storage.setItem(SAVE_V3_KEY, JSON.stringify(validated))
    storage.removeItem(SAVE_V2_KEY)
    storage.removeItem(SAVE_KEY)
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
    storage.removeItem(SAVE_V3_KEY)
    storage.removeItem(SAVE_V2_KEY)
    storage.removeItem(SAVE_KEY)
  } catch {
    // Degrade silently — same policy as saveGame; the save simply stays.
  }
}
