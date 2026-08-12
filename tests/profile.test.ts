import { describe, expect, it } from 'vitest'
import type { BodyId } from '../src/sim/world/identity'
import { bodyId, galaxyId, systemId } from '../src/sim/world/identity'
import {
  createPlayerProfile,
  levelFromXp,
  PROFILE_GENERATION_VERSION,
  validateProfile,
  withHomeWorld,
} from '../src/sim/player/profile'
import type {
  CreatePlayerProfileInput,
  PlayerProfile,
} from '../src/sim/player/profile'

const JOINED_AT = 1_700_000_000_000
const VALID_BODY_ID: BodyId = bodyId(systemId('alpha', '42'), 'planet', 1)

const longString = (n: number): string => 'x'.repeat(n)

function makeProfileWith(
  overrides: Partial<CreatePlayerProfileInput> = {},
): PlayerProfile {
  return createPlayerProfile({
    playerId: 'player-1',
    displayName: 'Jay',
    empireName: 'Starbaron',
    joinedAt: JOINED_AT,
    ...overrides,
  })
}

function makeProfile(): PlayerProfile {
  return makeProfileWith()
}

function tamper(overrides: Partial<PlayerProfile>): PlayerProfile {
  return { ...makeProfile(), ...overrides }
}

describe('createPlayerProfile — defaults and shape', () => {
  it('fills sensible defaults: theme dark, reducedMotion off, notifications on, level 1', () => {
    const profile = makeProfile()
    expect(profile.settings).toStrictEqual({
      theme: 'dark',
      reducedMotion: false,
      notificationsEnabled: true,
    })
    expect(profile.progression).toStrictEqual({
      xp: 0,
      level: 1,
      achievementsUnlocked: [],
    })
    expect(profile.generationVersion).toBe(PROFILE_GENERATION_VERSION)
    expect(PROFILE_GENERATION_VERSION).toBe(1)
    expect(profile.joinedAt).toBe(JOINED_AT)
    expect(profile.homeWorld).toBeUndefined()
  })

  it('respects a theme override', () => {
    expect(makeProfileWith({ theme: 'light' }).settings.theme).toBe('light')
  })

  it('stores a valid homeWorld and rejects an invalid one', () => {
    expect(makeProfileWith({ homeWorld: VALID_BODY_ID }).homeWorld).toBe(
      VALID_BODY_ID,
    )
    expect(() => makeProfileWith({ homeWorld: 'gal:alpha' as BodyId })).toThrow(
      /homeWorld/,
    )
  })

  it('trims playerId, displayName, and empireName', () => {
    const profile = makeProfileWith({
      playerId: '  player-1  ',
      displayName: '  Jay  ',
      empireName: '  Starbaron  ',
    })
    expect(profile.playerId).toBe('player-1')
    expect(profile.displayName).toBe('Jay')
    expect(profile.empireName).toBe('Starbaron')
  })
})

describe('createPlayerProfile — id/name/length/joinedAt validation', () => {
  it('rejects empty, whitespace-only, and over-long playerIds; accepts the 64-char boundary', () => {
    expect(() => makeProfileWith({ playerId: '' })).toThrow(/playerId/)
    expect(() => makeProfileWith({ playerId: '   ' })).toThrow(/playerId/)
    expect(() => makeProfileWith({ playerId: longString(65) })).toThrow(/playerId/)
    expect(() => makeProfileWith({ playerId: longString(64) })).not.toThrow()
  })

  it('rejects empty, over-long, and control-character displayNames; accepts boundaries', () => {
    expect(() => makeProfileWith({ displayName: '' })).toThrow(/displayName/)
    expect(() => makeProfileWith({ displayName: longString(33) })).toThrow(/displayName/)
    expect(() => makeProfileWith({ displayName: 'bad\u0007name' })).toThrow(/control/)
    expect(() => makeProfileWith({ displayName: 'A' })).not.toThrow()
    expect(() => makeProfileWith({ displayName: longString(32) })).not.toThrow()
  })

  it('rejects too-short, over-long, and control-character empireNames; accepts boundaries', () => {
    expect(() => makeProfileWith({ empireName: 'A' })).toThrow(/empireName/)
    expect(() => makeProfileWith({ empireName: longString(33) })).toThrow(/empireName/)
    expect(() => makeProfileWith({ empireName: 'Emp\u0001ire' })).toThrow(/control/)
    expect(() => makeProfileWith({ empireName: 'AB' })).not.toThrow()
    expect(() => makeProfileWith({ empireName: longString(32) })).not.toThrow()
  })

  it('rejects NaN, zero, negative, and infinite joinedAt', () => {
    expect(() => makeProfileWith({ joinedAt: Number.NaN })).toThrow(/joinedAt/)
    expect(() => makeProfileWith({ joinedAt: 0 })).toThrow(/joinedAt/)
    expect(() => makeProfileWith({ joinedAt: -5 })).toThrow(/joinedAt/)
    expect(() => makeProfileWith({ joinedAt: Number.POSITIVE_INFINITY })).toThrow(
      /joinedAt/,
    )
  })
})

describe('levelFromXp — pure level derivation', () => {
  it.each([
    [0, 1],
    [99, 1],
    [100, 2],
    [1000, 11],
    [250, 3],
  ])('levelFromXp(%i) === %i', (xp, level) => {
    expect(levelFromXp(xp)).toBe(level)
  })
})

describe('validateProfile — every field rule', () => {
  it('reports ok for a valid profile', () => {
    const result = validateProfile(makeProfile())
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('flags an xp/level inconsistency', () => {
    const result = validateProfile(
      tamper({ progression: { ...makeProfile().progression, level: 5 } }),
    )
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('levelFromXp')
  })

  it('flags duplicate achievements', () => {
    const result = validateProfile(
      tamper({
        progression: {
          ...makeProfile().progression,
          achievementsUnlocked: ['first', 'first'],
        },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('duplicate')
  })

  it('flags over-long, untrimmed, and control-character names', () => {
    expect(validateProfile(tamper({ displayName: longString(40) })).ok).toBe(false)
    expect(validateProfile(tamper({ displayName: '  Jay  ' })).ok).toBe(false)
    expect(validateProfile(tamper({ empireName: 'Emp\u0001ire' })).ok).toBe(false)
  })

  it('flags empty and over-long playerIds', () => {
    expect(validateProfile(tamper({ playerId: '' })).ok).toBe(false)
    expect(validateProfile(tamper({ playerId: longString(65) })).ok).toBe(false)
  })

  it('flags negative and fractional xp', () => {
    expect(validateProfile(tamper({ progression: { ...makeProfile().progression, xp: -5 } })).ok).toBe(false)
    expect(validateProfile(tamper({ progression: { ...makeProfile().progression, xp: 10.5 } })).ok).toBe(false)
  })

  it('flags an invalid theme and a non-positive joinedAt', () => {
    const badSettings = { ...makeProfile().settings, theme: 'sepia' } as unknown as PlayerProfile['settings']
    expect(validateProfile(tamper({ settings: badSettings })).ok).toBe(false)
    expect(validateProfile(tamper({ joinedAt: 0 })).ok).toBe(false)
  })

  it('flags a non-body homeWorld, wrong generationVersion, and negative prestige', () => {
    expect(validateProfile(tamper({ homeWorld: 'gal:alpha' as BodyId })).ok).toBe(
      false,
    )
    expect(validateProfile(tamper({ generationVersion: 2 })).ok).toBe(false)
    expect(
      validateProfile(
        tamper({ progression: { ...makeProfile().progression, prestige: -1 } }),
      ).ok,
    ).toBe(false)
  })
})

describe('withHomeWorld — immutable update', () => {
  it('sets the homeWorld and preserves every other field', () => {
    const profile = makeProfile()
    const updated = withHomeWorld(profile, VALID_BODY_ID)
    expect(updated.homeWorld).toBe(VALID_BODY_ID)
    expect(updated).toStrictEqual({ ...profile, homeWorld: VALID_BODY_ID })
  })

  it('does not mutate the original profile', () => {
    const profile = makeProfile()
    const updated = withHomeWorld(profile, VALID_BODY_ID)
    expect(updated).not.toBe(profile)
    expect(profile.homeWorld).toBeUndefined()
    expect(updated.playerId).toBe(profile.playerId)
  })

  it('throws for a malformed body id', () => {
    const profile = makeProfile()
    expect(() =>
      withHomeWorld(profile, 'body:alpha|42|planet' as BodyId),
    ).toThrow(/homeWorld/)
  })

  it('throws for a valid non-body canonical id', () => {
    const profile = makeProfile()
    expect(() =>
      withHomeWorld(profile, galaxyId('alpha') as unknown as BodyId),
    ).toThrow(/homeWorld/)
  })
})

describe('determinism', () => {
  it('produces deep-equal profiles for identical input', () => {
    const input: CreatePlayerProfileInput = {
      playerId: 'p-1',
      displayName: 'Jay',
      empireName: 'Empire',
      joinedAt: JOINED_AT,
    }
    expect(createPlayerProfile(input)).toStrictEqual(createPlayerProfile(input))
  })

  it('returns independent nested objects per creation', () => {
    const a = makeProfile()
    const b = makeProfile()
    a.progression.achievementsUnlocked.push('first')
    expect(b.progression.achievementsUnlocked).toEqual([])
  })
})
