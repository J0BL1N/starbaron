import { describe, expect, it } from 'vitest'
import type {
  HomeImmunity,
  HomeImmunityInput,
} from '../src/sim/combat/home-immunity'
import {
  assertConquestPermitted,
  CONQUEST_PROTECTED_MESSAGE,
  guardLaunch,
  HOME_IMMUNITY_STATUSES,
  HOME_WORLD_IMMUNITY_REASON,
  homeImmunityFor,
  NOT_HOME_WORLD_REASON,
} from '../src/sim/combat/home-immunity'
import type { OwnedPlanet, PlayerState, WalletState } from '../src/sim/player/types'

const AT = 1_700_000_000_000
const HOME = 'alpha'
const COLONY = 'alpha-colony'
const FOREIGN = 'foreign'

function planet(
  name: string,
  overrides: Partial<OwnedPlanet> = {},
): OwnedPlanet {
  return {
    name,
    entry: { name, hostname: 'host', systemCount: 1, tier: 2 },
    tier: 2,
    baselineIncomePerSec: 20,
    populationCapMultiplier: 1,
    claimedAt: AT,
    isHome: false,
    unconquerable: false,
    population: 100,
    garrison: 0,
    fleet: 0,
    ...overrides,
  }
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  const wallet: WalletState = { credits: 1000, alloys: 0 }
  return {
    playerId: 'player-1',
    homePlanet: planet(HOME, { isHome: true, unconquerable: true }),
    colonies: [planet(COLONY)],
    wallet,
    structureLevels: {},
    lastTickAt: AT,
    ...overrides,
  }
}

function immunityInput(
  overrides: Partial<HomeImmunityInput> = {},
): HomeImmunityInput {
  return {
    targetId: HOME,
    ownerPlayer: player(),
    attemptedAt: AT,
    ...overrides,
  }
}

function immuneVerdict(targetId: string, attemptedAt = AT): HomeImmunity {
  return {
    targetId,
    isHome: true,
    status: 'immune',
    reason: HOME_WORLD_IMMUNITY_REASON,
    attemptedAt,
  }
}

function attackableVerdict(targetId: string, attemptedAt = AT): HomeImmunity {
  return {
    targetId,
    isHome: false,
    status: 'attackable',
    reason: NOT_HOME_WORLD_REASON,
    attemptedAt,
  }
}

describe('homeImmunityFor — the immunity verdict', () => {
  it('returns immune when the target is the owner\'s protected home world', () => {
    expect(homeImmunityFor(immunityInput())).toStrictEqual(immuneVerdict(HOME))
  })

  it('flips with the locked predicate: a hand-built home with isHome + unconquerable is immune, a colony is attackable', () => {
    expect(
      homeImmunityFor(immunityInput({ targetId: COLONY })),
    ).toStrictEqual(attackableVerdict(COLONY))
    expect(
      homeImmunityFor(immunityInput({ targetId: FOREIGN })),
    ).toStrictEqual(attackableVerdict(FOREIGN))
  })

  it('a declassified home (both flags false) is attackable — the locked check decides, not the name', () => {
    const ownerPlayer = player({
      homePlanet: planet(HOME, { isHome: false, unconquerable: false }),
    })
    expect(homeImmunityFor(immunityInput({ ownerPlayer }))).toStrictEqual(
      attackableVerdict(HOME),
    )
  })

  it('propagates the locked parity rejection: an unequal-flag home row throws', () => {
    const ownerPlayer = player({
      homePlanet: planet(HOME, { isHome: true, unconquerable: false }),
    })
    expect(() => homeImmunityFor(immunityInput({ ownerPlayer }))).toThrow(
      /parity/,
    )
  })

  it('treats an unowned target (ownerPlayer null) as attackable', () => {
    expect(
      homeImmunityFor(immunityInput({ ownerPlayer: null })),
    ).toStrictEqual(attackableVerdict(HOME))
  })

  it('treats a colony of the owner as attackable', () => {
    expect(
      homeImmunityFor(immunityInput({ targetId: COLONY })),
    ).toStrictEqual(attackableVerdict(COLONY))
  })

  it('mirrors the protection module wording in the reason constants', () => {
    expect(HOME_WORLD_IMMUNITY_REASON).toBe('home world — protected by law')
    expect(NOT_HOME_WORLD_REASON).toBe('not a home world')
  })

  it('passes attemptedAt through verbatim, preserving fractional milliseconds', () => {
    const attemptedAt = AT + 0.25
    expect(
      homeImmunityFor(immunityInput({ attemptedAt })),
    ).toStrictEqual(immuneVerdict(HOME, attemptedAt))
  })

  it('is deterministic and returns a fresh object per call', () => {
    const a = homeImmunityFor(immunityInput())
    const b = homeImmunityFor(immunityInput())
    expect(a).toStrictEqual(b)
    expect(a).not.toBe(b)
  })

  it('does not mutate the input', () => {
    const ownerPlayer = player()
    const input = immunityInput({ ownerPlayer })
    const beforeOwner = { ...ownerPlayer, homePlanet: { ...ownerPlayer.homePlanet } }
    const beforeInput = { ...input, ownerPlayer: { ...input.ownerPlayer! } }
    homeImmunityFor(input)
    expect(input.ownerPlayer).toStrictEqual(beforeOwner)
    expect(input).toStrictEqual(beforeInput)
  })

  it('rejects an empty or whitespace-only targetId', () => {
    expect(() => homeImmunityFor(immunityInput({ targetId: '' }))).toThrow(
      RangeError,
    )
    expect(() => homeImmunityFor(immunityInput({ targetId: '   ' }))).toThrow(
      RangeError,
    )
  })

  it('trims the targetId before matching, so padded ids still find the home', () => {
    expect(
      homeImmunityFor(immunityInput({ targetId: `  ${HOME}  ` })),
    ).toStrictEqual(immuneVerdict(HOME))
  })

  it('rejects a non-finite, zero, or negative attemptedAt', () => {
    for (const attemptedAt of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
      expect(() =>
        homeImmunityFor(immunityInput({ attemptedAt })),
      ).toThrow(RangeError)
    }
  })

  it('freezes the status lookup table and enumerates the union', () => {
    expect(Object.isFrozen(HOME_IMMUNITY_STATUSES)).toBe(true)
    expect([...HOME_IMMUNITY_STATUSES]).toStrictEqual(['immune', 'attackable'])
    const immune = homeImmunityFor(immunityInput())
    expect(HOME_IMMUNITY_STATUSES).toContain(immune.status)
  })
})

describe('guardLaunch — the launch-layer guard', () => {
  it('allows an attackable target (colony) and reports the verdict', () => {
    const result = guardLaunch(immunityInput({ targetId: COLONY }))
    expect(result.allowed).toBe(true)
    expect(result.immunity).toStrictEqual(attackableVerdict(COLONY))
  })

  it('refuses a home world without throwing — the caller decides', () => {
    const result = guardLaunch(immunityInput())
    expect(result.allowed).toBe(false)
    expect(result.immunity).toStrictEqual(immuneVerdict(HOME))
  })

  it('allows an unowned target', () => {
    const result = guardLaunch(immunityInput({ ownerPlayer: null }))
    expect(result.allowed).toBe(true)
    expect(result.immunity).toStrictEqual(attackableVerdict(HOME))
  })

  it('keeps allowed === !immunity.isHome across home, colony, and unowned', () => {
    const cases: HomeImmunityInput[] = [
      immunityInput(),
      immunityInput({ targetId: COLONY }),
      immunityInput({ ownerPlayer: null }),
    ]
    for (const input of cases) {
      const result = guardLaunch(input)
      expect(result.allowed).toBe(!result.immunity.isHome)
    }
  })

  it('returns the same verdict as homeImmunityFor', () => {
    const input = immunityInput({ targetId: COLONY })
    expect(guardLaunch(input).immunity).toStrictEqual(homeImmunityFor(input))
  })

  it('is deterministic and propagates input validation', () => {
    const a = guardLaunch(immunityInput())
    const b = guardLaunch(immunityInput())
    expect(a).toStrictEqual(b)
    expect(() => guardLaunch(immunityInput({ targetId: '' }))).toThrow(
      RangeError,
    )
  })
})

describe('assertConquestPermitted — the resolution-layer guard', () => {
  it('throws the locked message when a resolution touches the owner\'s home world', () => {
    expect(() => assertConquestPermitted(immunityInput())).toThrow(
      CONQUEST_PROTECTED_MESSAGE,
    )
  })

  it('throws a plain Error with message "home world — protected"', () => {
    try {
      assertConquestPermitted(immunityInput())
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('home world — protected')
    }
  })

  it('is a no-op for a colony target', () => {
    expect(() =>
      assertConquestPermitted(immunityInput({ targetId: COLONY })),
    ).not.toThrow()
  })

  it('is a no-op for an unowned target', () => {
    expect(() =>
      assertConquestPermitted(immunityInput({ ownerPlayer: null })),
    ).not.toThrow()
  })

  it('is a no-op for a declassified home', () => {
    const ownerPlayer = player({
      homePlanet: planet(HOME, { isHome: false, unconquerable: false }),
    })
    expect(() =>
      assertConquestPermitted(immunityInput({ ownerPlayer })),
    ).not.toThrow()
  })

  it('propagates input validation and never mutates the input', () => {
    const ownerPlayer = player()
    const input = immunityInput({ ownerPlayer, targetId: COLONY })
    const beforeOwner = { ...ownerPlayer, homePlanet: { ...ownerPlayer.homePlanet } }
    expect(() =>
      assertConquestPermitted(immunityInput({ attemptedAt: 0 })),
    ).toThrow(RangeError)
    assertConquestPermitted(input)
    expect(input.ownerPlayer).toStrictEqual(beforeOwner)
  })
})
