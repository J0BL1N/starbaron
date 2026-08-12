import { parseCanonicalId } from '../world/identity'
import type { BodyId } from '../world/identity'

export const PROFILE_GENERATION_VERSION = 1

export type ProfileTheme = 'dark' | 'light'

const PLAYER_ID_MAX = 64
const DISPLAY_NAME_MIN = 1
const DISPLAY_NAME_MAX = 32
const EMPIRE_NAME_MIN = 2
const EMPIRE_NAME_MAX = 32
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/

export interface ProfileSettings {
  theme: ProfileTheme
  reducedMotion: boolean
  notificationsEnabled: boolean
}

export interface ProfileProgression {
  xp: number
  level: number
  achievementsUnlocked: string[]
  prestige?: number
}

export interface PlayerProfile {
  playerId: string
  displayName: string
  empireName: string
  joinedAt: number
  settings: ProfileSettings
  progression: ProfileProgression
  homeWorld?: BodyId
  generationVersion: number
}

export interface CreatePlayerProfileInput {
  playerId: string
  displayName: string
  empireName: string
  joinedAt: number
  theme?: ProfileTheme
  homeWorld?: BodyId
}

export interface ProfileValidationResult {
  ok: boolean
  problems: string[]
}

/**
 * Pure level formula: every 100 xp gains one level, starting at level 1.
 * Level is always derived from xp, never stored independently.
 */
export function levelFromXp(xp: number): number {
  return Math.floor(xp / 100) + 1
}

function assertPlayerId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`playerId must be a string, got: ${value}`)
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new Error('playerId must not be empty')
  }
  if (trimmed.length > PLAYER_ID_MAX) {
    throw new Error(
      `playerId must be at most ${PLAYER_ID_MAX} characters, got ${trimmed.length}`,
    )
  }
  return trimmed
}

function assertName(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string, got: ${value}`)
  }
  const trimmed = value.trim()
  if (trimmed.length < min || trimmed.length > max) {
    throw new Error(`${field} must be ${min}-${max} characters, got ${trimmed.length}`)
  }
  if (CONTROL_CHAR_PATTERN.test(value)) {
    throw new Error(`${field} must not contain control characters`)
  }
  return trimmed
}

function assertJoinedAt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`joinedAt must be a finite number greater than 0, got: ${value}`)
  }
  return value
}

function assertBodyId(value: unknown): BodyId {
  if (typeof value !== 'string') {
    throw new Error(`homeWorld must be a valid body id, got: ${value}`)
  }
  const parsed = parseCanonicalId(value)
  if (!parsed.ok || parsed.kind !== 'body') {
    throw new Error(`homeWorld must be a valid body id, got: ${value}`)
  }
  return parsed.id
}

export function createPlayerProfile(input: CreatePlayerProfileInput): PlayerProfile {
  const theme = input.theme ?? 'dark'
  if (theme !== 'dark' && theme !== 'light') {
    throw new Error(`theme must be 'dark' or 'light', got: ${theme}`)
  }
  const profile: PlayerProfile = {
    playerId: assertPlayerId(input.playerId),
    displayName: assertName(
      input.displayName,
      'displayName',
      DISPLAY_NAME_MIN,
      DISPLAY_NAME_MAX,
    ),
    empireName: assertName(
      input.empireName,
      'empireName',
      EMPIRE_NAME_MIN,
      EMPIRE_NAME_MAX,
    ),
    joinedAt: assertJoinedAt(input.joinedAt),
    settings: {
      theme,
      reducedMotion: false,
      notificationsEnabled: true,
    },
    progression: {
      xp: 0,
      level: 1,
      achievementsUnlocked: [],
    },
    generationVersion: PROFILE_GENERATION_VERSION,
  }
  if (input.homeWorld !== undefined) {
    profile.homeWorld = assertBodyId(input.homeWorld)
  }
  return profile
}

function playerIdProblems(value: unknown): string[] {
  const problems: string[] = []
  if (typeof value !== 'string') {
    problems.push('playerId must be a string')
    return problems
  }
  const trimmed = value.trim()
  if (trimmed !== value) {
    problems.push('playerId must be trimmed')
  }
  if (trimmed === '') {
    problems.push('playerId must not be empty')
  }
  if (trimmed.length > PLAYER_ID_MAX) {
    problems.push(
      `playerId must be at most ${PLAYER_ID_MAX} characters, got ${trimmed.length}`,
    )
  }
  return problems
}

function nameProblems(value: unknown, field: string, min: number, max: number): string[] {
  const problems: string[] = []
  if (typeof value !== 'string') {
    problems.push(`${field} must be a string`)
    return problems
  }
  const trimmed = value.trim()
  if (trimmed !== value) {
    problems.push(`${field} must be trimmed`)
  }
  if (trimmed.length < min || trimmed.length > max) {
    problems.push(`${field} must be ${min}-${max} characters, got ${trimmed.length}`)
  }
  if (CONTROL_CHAR_PATTERN.test(value)) {
    problems.push(`${field} must not contain control characters`)
  }
  return problems
}

export function validateProfile(profile: PlayerProfile): ProfileValidationResult {
  const problems: string[] = []

  problems.push(...playerIdProblems(profile.playerId))
  problems.push(
    ...nameProblems(
      profile.displayName,
      'displayName',
      DISPLAY_NAME_MIN,
      DISPLAY_NAME_MAX,
    ),
  )
  problems.push(
    ...nameProblems(profile.empireName, 'empireName', EMPIRE_NAME_MIN, EMPIRE_NAME_MAX),
  )

  if (
    typeof profile.joinedAt !== 'number' ||
    !Number.isFinite(profile.joinedAt) ||
    profile.joinedAt <= 0
  ) {
    problems.push(`joinedAt must be a finite number greater than 0, got: ${profile.joinedAt}`)
  }

  const theme = profile.settings?.theme
  if (theme !== 'dark' && theme !== 'light') {
    problems.push(`settings.theme must be 'dark' or 'light', got: ${theme}`)
  }
  if (typeof profile.settings?.reducedMotion !== 'boolean') {
    problems.push('settings.reducedMotion must be a boolean')
  }
  if (typeof profile.settings?.notificationsEnabled !== 'boolean') {
    problems.push('settings.notificationsEnabled must be a boolean')
  }

  const xp = profile.progression?.xp
  if (typeof xp !== 'number' || !Number.isInteger(xp) || xp < 0) {
    problems.push(`progression.xp must be a non-negative integer, got: ${xp}`)
  }
  const level = profile.progression?.level
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1) {
    problems.push(`progression.level must be a positive integer, got: ${level}`)
  } else if (
    typeof xp === 'number' &&
    Number.isInteger(xp) &&
    xp >= 0 &&
    level !== levelFromXp(xp)
  ) {
    problems.push(
      `progression.level ${level} must equal levelFromXp(xp) (${levelFromXp(xp)})`,
    )
  }

  const achievements = profile.progression?.achievementsUnlocked
  if (!Array.isArray(achievements)) {
    problems.push('progression.achievementsUnlocked must be an array of strings')
  } else if (achievements.some((achievement) => typeof achievement !== 'string')) {
    problems.push('progression.achievementsUnlocked must contain only strings')
  } else {
    const seen = new Set<string>()
    for (const achievement of achievements) {
      if (seen.has(achievement)) {
        problems.push(
          `progression.achievementsUnlocked contains a duplicate: ${achievement}`,
        )
        break
      }
      seen.add(achievement)
    }
  }

  const prestige = profile.progression?.prestige
  if (
    prestige !== undefined &&
    (typeof prestige !== 'number' || !Number.isInteger(prestige) || prestige < 0)
  ) {
    problems.push(
      `progression.prestige must be a non-negative integer when present, got: ${prestige}`,
    )
  }

  if (profile.homeWorld !== undefined) {
    const parsed = parseCanonicalId(profile.homeWorld)
    if (!parsed.ok || parsed.kind !== 'body') {
      problems.push(`homeWorld must be a valid body id, got: ${profile.homeWorld}`)
    }
  }

  if (profile.generationVersion !== PROFILE_GENERATION_VERSION) {
    problems.push(
      `generationVersion must be ${PROFILE_GENERATION_VERSION}, got: ${profile.generationVersion}`,
    )
  }

  return { ok: problems.length === 0, problems }
}

export function withHomeWorld(profile: PlayerProfile, homeWorld: BodyId): PlayerProfile {
  return { ...profile, homeWorld: assertBodyId(homeWorld) }
}
