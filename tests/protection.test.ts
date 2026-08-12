import { describe, expect, it } from 'vitest'
import type { BodyId } from '../src/sim/world/identity'
import { bodyId, systemId } from '../src/sim/world/identity'
import type {
  AttemptedConquestInput,
  HomeProtection,
} from '../src/sim/player/protection'
import {
  attemptedConquest,
  CONQUERABLE_LABEL,
  conquestAllowed,
  deriveProtection,
  HOME_WORLD_PROTECTED_REASON,
  HOME_WORLD_REASON,
  protectionStateForUi,
  UNCONQUERABLE_HOME_LABEL,
} from '../src/sim/player/protection'

const HOME_BODY: BodyId = bodyId(systemId('alpha', '42'), 'planet', 1)
const OTHER_BODY: BodyId = bodyId(systemId('alpha', '42'), 'planet', 2)
const OWNER = 'player-1'
const ATTACKER = 'player-2'
const PROTECTED_SINCE = 1_700_000_000_000

function protectedHome(overrides: Partial<HomeProtection> = {}): HomeProtection {
  return {
    bodyId: HOME_BODY,
    ownerId: OWNER,
    protected: true,
    reason: HOME_WORLD_REASON,
    protectedSince: PROTECTED_SINCE,
    ...overrides,
  }
}

function unprotectedHome(
  overrides: Partial<HomeProtection> = {},
): HomeProtection {
  return {
    bodyId: HOME_BODY,
    ownerId: OWNER,
    protected: false,
    ...overrides,
  }
}

function conquestInput(
  target: HomeProtection,
  attackerId: string = ATTACKER,
): AttemptedConquestInput {
  return { target, attackerId }
}

describe('deriveProtection — protection combinations', () => {
  it('protects only when isHome AND unconquerable are BOTH true', () => {
    expect(deriveProtection(HOME_BODY, OWNER, true, true).protected).toBe(true)
    expect(deriveProtection(HOME_BODY, OWNER, true, false).protected).toBe(false)
    expect(deriveProtection(HOME_BODY, OWNER, false, true).protected).toBe(false)
    expect(deriveProtection(HOME_BODY, OWNER, false, false).protected).toBe(false)
  })

  it('tags a protected world with reason "home-world" and the caller-supplied protectedSince', () => {
    const p = deriveProtection(HOME_BODY, OWNER, true, true, PROTECTED_SINCE)
    expect(p.reason).toBe(HOME_WORLD_REASON)
    expect(p.protectedSince).toBe(PROTECTED_SINCE)
    expect(p).toStrictEqual(protectedHome())
  })

  it('omits reason and protectedSince when no timestamp is supplied', () => {
    const p = deriveProtection(HOME_BODY, OWNER, true, true)
    expect(p.reason).toBe(HOME_WORLD_REASON)
    expect(p.protectedSince).toBeUndefined()
    expect('protectedSince' in p).toBe(false)
  })

  it('never exposes reason or protectedSince on an unprotected world', () => {
    const p = deriveProtection(HOME_BODY, OWNER, false, true, PROTECTED_SINCE)
    expect(p.protected).toBe(false)
    expect(p.reason).toBeUndefined()
    expect(p.protectedSince).toBeUndefined()
    expect('reason' in p).toBe(false)
    expect('protectedSince' in p).toBe(false)
  })

  it('passes bodyId and ownerId through unchanged', () => {
    expect(deriveProtection(OTHER_BODY, OWNER, true, true)).toMatchObject({
      bodyId: OTHER_BODY,
      ownerId: OWNER,
    })
  })

  it('is deterministic and returns a fresh object per call', () => {
    const a = deriveProtection(HOME_BODY, OWNER, true, true, PROTECTED_SINCE)
    const b = deriveProtection(HOME_BODY, OWNER, true, true, PROTECTED_SINCE)
    expect(a).toStrictEqual(b)
    expect(a).not.toBe(b)
  })
})

describe('attemptedConquest — rejection and allowance', () => {
  it('rejects a protected target for a foreign attacker', () => {
    const result = attemptedConquest(conquestInput(protectedHome(), ATTACKER))
    expect(result.rejected).toBe(true)
    expect(result.reason).toBe(HOME_WORLD_PROTECTED_REASON)
  })

  it('rejects a protected target for ANY attacker, including the owner', () => {
    const result = attemptedConquest(conquestInput(protectedHome(), OWNER))
    expect(result.rejected).toBe(true)
    expect(result.reason).toBe(HOME_WORLD_PROTECTED_REASON)
  })

  it('rejection details identify the body, owner, and attacker', () => {
    const result = attemptedConquest(
      conquestInput(protectedHome(), 'player-99'),
    )
    expect(result.details).toContain(HOME_BODY)
    expect(result.details).toContain(OWNER)
    expect(result.details).toContain('player-99')
    expect(result.details).toContain('unconquerable')
  })

  it('allows an unprotected target with no rejection reason', () => {
    const result = attemptedConquest(conquestInput(unprotectedHome(), ATTACKER))
    expect(result.rejected).toBe(false)
    expect(result.reason).toBeUndefined()
    expect('reason' in result).toBe(false)
  })

  it('allow details describe a conquerable target', () => {
    const result = attemptedConquest(conquestInput(unprotectedHome(), ATTACKER))
    expect(result.details).toContain(HOME_BODY)
    expect(result.details).toContain('not protected')
  })

  it('is deterministic for identical inputs', () => {
    const a = attemptedConquest(conquestInput(protectedHome(), ATTACKER))
    const b = attemptedConquest(conquestInput(protectedHome(), ATTACKER))
    expect(a).toStrictEqual(b)
    expect(a).not.toBe(b)
  })

  it('does not mutate its inputs', () => {
    const target = protectedHome()
    const input = conquestInput(target, ATTACKER)
    const beforeTarget = { ...target }
    const beforeInput = { ...input, target: { ...input.target } }
    attemptedConquest(input)
    expect(input.target).toStrictEqual(beforeTarget)
    expect(input).toStrictEqual(beforeInput)
  })
})

describe('conquestAllowed', () => {
  it('is false for a protected target', () => {
    expect(conquestAllowed(protectedHome())).toBe(false)
  })

  it('is true for an unprotected target', () => {
    expect(conquestAllowed(unprotectedHome())).toBe(true)
  })

  it('does not mutate the target', () => {
    const target = protectedHome()
    const before = { ...target }
    conquestAllowed(target)
    expect(target).toStrictEqual(before)
  })
})

describe('protectionStateForUi', () => {
  it('labels a protected world "Unconquerable home world"', () => {
    expect(protectionStateForUi(protectedHome())).toStrictEqual({
      protected: true,
      label: UNCONQUERABLE_HOME_LABEL,
    })
  })

  it('labels an unprotected world "Conquerable"', () => {
    expect(protectionStateForUi(unprotectedHome())).toStrictEqual({
      protected: false,
      label: CONQUERABLE_LABEL,
    })
  })

  it('label constants match the locked DESIGN strings', () => {
    expect(UNCONQUERABLE_HOME_LABEL).toBe('Unconquerable home world')
    expect(CONQUERABLE_LABEL).toBe('Conquerable')
  })

  it('does not mutate the target', () => {
    const target = protectedHome()
    const before = { ...target }
    protectionStateForUi(target)
    expect(target).toStrictEqual(before)
  })
})
