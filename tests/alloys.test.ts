import { describe, expect, it } from 'vitest'
import type { WalletState } from '../src/sim/player/types'
import {
  DEFENSE_ALLOYS_PER_DP,
  SCARCITY_FLOOR,
  SCARCITY_HALF_LIFE,
  alloyScarcityCurve,
  alloyTransactionId,
  alloyYield,
  applyAlloyTransaction,
  defensiveAlloyDemand,
  walletInvariants,
} from '../src/sim/core/alloys'
import { walletInvariants as creditWalletInvariants } from '../src/sim/core/transactions'
import type { AlloyTransaction, AlloyTransactionInput } from '../src/sim/core/alloys'

const AT = 1_700_000_000_000

function baseWallet(): WalletState {
  return { credits: 1_000, alloys: 0 }
}

function tx(kind: AlloyTransactionInput['kind'], amount: number): AlloyTransactionInput {
  return { kind, amount }
}

function fullTx(
  kind: AlloyTransactionInput['kind'],
  amount: number,
): AlloyTransaction {
  return { id: 'id', kind, amount, balanceAfter: 0, at: AT }
}

describe('alloyTransactionId', () => {
  it('is deterministic for identical inputs', () => {
    const a = alloyTransactionId('mine', 100, AT, 1)
    const b = alloyTransactionId('mine', 100, AT, 1)
    expect(a).toBe(b)
  })

  it('produces distinct ids for distinct nonces and when kind/amount/at change', () => {
    const base = alloyTransactionId('mine', 100, AT, 1)
    expect(alloyTransactionId('spend', 100, AT, 1)).not.toBe(base)
    expect(alloyTransactionId('mine', 200, AT, 1)).not.toBe(base)
    expect(alloyTransactionId('mine', 100, AT + 1, 1)).not.toBe(base)
    const ids = new Set([1, 2, 3].map((n) => alloyTransactionId('mine', 100, AT, n)))
    expect(ids.size).toBe(3)
    const strIds = new Set(
      ['alpha', 'bravo', 'charlie'].map((n) =>
        alloyTransactionId('mine', 100, AT, n),
      ),
    )
    expect(strIds.size).toBe(3)
  })

  it('emits a valid id format, stays within 64 chars and has no control chars', () => {
    const id = alloyTransactionId('transfer', 50, AT, 42)
    expect(id.length).toBeGreaterThan(0)
    expect(id.length).toBeLessThanOrEqual(64)
    expect(/^[0-9a-f]+-[ns]:[0-9a-zA-Z.+-]+$/.test(id)).toBe(true)
    const hasControlChars = [...id].some((c) => {
      const code = c.charCodeAt(0)
      return code <= 0x1f || code === 0x7f
    })
    expect(hasControlChars).toBe(false)
    const maxNonce = 'a'.repeat(40)
    const maxId = alloyTransactionId('mine', 100, AT, maxNonce)
    expect(maxId.length).toBeLessThanOrEqual(64)
    expect(maxId.endsWith(`-s:${maxNonce}`)).toBe(true)
  })

  it('yields distinct ids for a number nonce and the string that stringifies the same', () => {
    expect(alloyTransactionId('mine', 100, AT, '1')).not.toBe(
      alloyTransactionId('mine', 100, AT, 1),
    )
  })

  it('rejects invalid nonces: empty, control chars, >40 chars, non-finite, -0', () => {
    expect(() => alloyTransactionId('mine', 100, AT, '')).toThrow(/nonce/)
    expect(() => alloyTransactionId('mine', 100, AT, 'a\nb')).toThrow(/nonce/)
    expect(() => alloyTransactionId('mine', 100, AT, '\x00')).toThrow(/nonce/)
    expect(() => alloyTransactionId('mine', 100, AT, '\x7f')).toThrow(/nonce/)
    expect(() => alloyTransactionId('mine', 100, AT, 'a'.repeat(41))).toThrow(/nonce/)
    expect(() => alloyTransactionId('mine', 100, AT, Number.NaN)).toThrow(/nonce/)
    expect(() =>
      alloyTransactionId('mine', 100, AT, Number.POSITIVE_INFINITY),
    ).toThrow(/nonce/)
    expect(() => alloyTransactionId('mine', 100, AT, -0)).toThrow(/-0/)
  })
})

describe('applyAlloyTransaction — validation', () => {
  it('rejects non-positive and non-finite amounts', () => {
    expect(() => applyAlloyTransaction(baseWallet(), tx('mine', -10), AT, 1)).toThrow(
      /amount/,
    )
    expect(() => applyAlloyTransaction(baseWallet(), tx('spend', 0), AT, 1)).toThrow(
      /amount/,
    )
    expect(() =>
      applyAlloyTransaction(baseWallet(), tx('mine', Number.NaN), AT, 1),
    ).toThrow(/amount/)
    expect(() =>
      applyAlloyTransaction(baseWallet(), tx('mine', Number.POSITIVE_INFINITY), AT, 1),
    ).toThrow(/amount/)
  })

  it('rejects an unknown alloy kind', () => {
    const bad = { kind: 'refund', amount: 10 } as unknown as AlloyTransactionInput
    expect(() => applyAlloyTransaction(baseWallet(), bad, AT, 1)).toThrow(
      /unknown alloy kind/,
    )
  })

  it('rejects non-positive or non-finite at timestamps', () => {
    expect(() => applyAlloyTransaction(baseWallet(), tx('mine', 10), 0, 1)).toThrow(
      /at/,
    )
    expect(() => applyAlloyTransaction(baseWallet(), tx('mine', 10), -5, 1)).toThrow(
      /at/,
    )
    expect(() =>
      applyAlloyTransaction(baseWallet(), tx('mine', 10), Number.NaN, 1),
    ).toThrow(/at/)
  })

  it('throws insufficient alloys for spend and transfer on a short wallet', () => {
    const wallet = { credits: 100, alloys: 100 }
    expect(() => applyAlloyTransaction(wallet, tx('spend', 101), AT, 1)).toThrow(
      /insufficient alloys/,
    )
    expect(() => applyAlloyTransaction(wallet, tx('transfer', 101), AT, 1)).toThrow(
      /insufficient alloys/,
    )
  })

  it('rejects a mine whose resulting balance overflows to Infinity', () => {
    const wallet = { credits: 0, alloys: Number.MAX_VALUE }
    expect(() =>
      applyAlloyTransaction(wallet, tx('mine', Number.MAX_VALUE), AT, 1),
    ).toThrow(/balance/)
  })

  it('rejects a broken input wallet even for mine', () => {
    const badCredits = { credits: -50, alloys: 0 }
    const badAlloys = { credits: 0, alloys: -1 }
    expect(() =>
      applyAlloyTransaction(badCredits, tx('mine', 100), AT, 1),
    ).toThrow(/credits/)
    expect(() =>
      applyAlloyTransaction(badAlloys, tx('mine', 100), AT, 1),
    ).toThrow(/alloys/)
  })
})

describe('applyAlloyTransaction — math and balanceAfter', () => {
  it('mine adds alloys and sets balanceAfter; credits untouched', () => {
    const result = applyAlloyTransaction(baseWallet(), tx('mine', 100), AT, 1)
    expect(result.wallet.alloys).toBe(100)
    expect(result.wallet.credits).toBe(1_000)
    expect(result.transaction.balanceAfter).toBe(100)
  })

  it('spend subtracts alloys and sets balanceAfter', () => {
    const result = applyAlloyTransaction(
      { credits: 0, alloys: 500 },
      tx('spend', 300),
      AT,
      1,
    )
    expect(result.wallet.alloys).toBe(200)
    expect(result.transaction.balanceAfter).toBe(200)
  })

  it('an exact-balance spend succeeds and lands on 0', () => {
    const result = applyAlloyTransaction(
      { credits: 0, alloys: 1_000 },
      tx('spend', 1_000),
      AT,
      1,
    )
    expect(result.wallet.alloys).toBe(0)
    expect(result.transaction.balanceAfter).toBe(0)
  })

  it('transfer is outgoing like spend', () => {
    const result = applyAlloyTransaction(
      { credits: 0, alloys: 250 },
      tx('transfer', 250),
      AT,
      1,
    )
    expect(result.wallet.alloys).toBe(0)
    expect(result.transaction.balanceAfter).toBe(0)
  })

  it('adjustment adds alloys like mine', () => {
    const result = applyAlloyTransaction(
      { credits: 0, alloys: 40 },
      tx('adjustment', 40),
      AT,
      1,
    )
    expect(result.wallet.alloys).toBe(80)
    expect(result.transaction.balanceAfter).toBe(80)
  })

  it('0.1 float amounts are handled exactly enough', () => {
    const afterMine = applyAlloyTransaction(
      { credits: 0, alloys: 0 },
      tx('mine', 0.1),
      AT,
      1,
    )
    expect(afterMine.wallet.alloys).toBeCloseTo(0.1, 10)
    const afterSpend = applyAlloyTransaction(
      afterMine.wallet,
      tx('spend', 0.1),
      AT,
      2,
    )
    expect(afterSpend.wallet.alloys).toBeCloseTo(0, 10)
  })

  it('huge finite amounts stay finite', () => {
    const huge = 1e300
    const result = applyAlloyTransaction(
      { credits: 0, alloys: huge },
      tx('spend', huge / 10),
      AT,
      1,
    )
    expect(Number.isFinite(result.wallet.alloys)).toBe(true)
    expect(result.wallet.alloys).toBeCloseTo(huge - huge / 10, 10)
  })
})

describe('applyAlloyTransaction — record and immutability', () => {
  it('returns the recorded transaction with id, at, balanceAfter, kind, amount', () => {
    const { wallet, transaction } = applyAlloyTransaction(
      baseWallet(),
      { kind: 'mine', amount: 250, reference: 'oreMine-level2' },
      AT,
      7,
    )
    expect(transaction).toEqual({
      id: alloyTransactionId('mine', 250, AT, 7),
      kind: 'mine',
      amount: 250,
      balanceAfter: 250,
      at: AT,
      reference: 'oreMine-level2',
    })
    expect(transaction.id).toBe(alloyTransactionId('mine', 250, AT, 7))
    expect(wallet.alloys).toBe(250)
    const noRef = applyAlloyTransaction(baseWallet(), tx('mine', 10), AT, 1)
    expect('reference' in noRef.transaction).toBe(false)
    expect(noRef.wallet.alloys).toBe(10)
  })

  it('never mutates the input wallet and returns a fresh wallet object', () => {
    const wallet = { credits: 1_000, alloys: 500 }
    const before = { ...wallet }
    const mined = applyAlloyTransaction(wallet, tx('mine', 500), AT, 1)
    expect(wallet).toEqual(before)
    expect(mined.wallet).not.toBe(wallet)
    expect(mined.wallet.alloys).toBe(1_000)
    const spent = applyAlloyTransaction(wallet, tx('spend', 200), AT, 2)
    expect(wallet).toEqual(before)
    expect(spent.wallet).not.toBe(wallet)
    expect(spent.wallet.alloys).toBe(300)
    expect(() => applyAlloyTransaction(wallet, tx('spend', 9_999), AT, 3)).toThrow(
      /insufficient alloys/,
    )
    expect(wallet).toEqual(before)
  })
})

describe('alloyScarcityCurve', () => {
  it('returns 1 at zero owned alloys', () => {
    expect(alloyScarcityCurve(0)).toBe(1)
  })

  it('is monotonic decreasing and matches 1 / (1 + owned / half-life)', () => {
    const samples = [0, 1, 100, SCARCITY_HALF_LIFE / 2, SCARCITY_HALF_LIFE, 2 * SCARCITY_HALF_LIFE, 10 * SCARCITY_HALF_LIFE]
    for (let i = 1; i < samples.length; i++) {
      expect(alloyScarcityCurve(samples[i])).toBeLessThanOrEqual(
        alloyScarcityCurve(samples[i - 1]),
      )
    }
    expect(alloyScarcityCurve(SCARCITY_HALF_LIFE)).toBeCloseTo(0.5, 10)
    expect(alloyScarcityCurve(SCARCITY_HALF_LIFE / 3)).toBeCloseTo(0.75, 10)
  })

  it('clamps to [SCARCITY_FLOOR, 1] and hits the floor for huge holdings', () => {
    for (const owned of [0, 1, 10, 100, 5_000, 50_000, 1e9, 1e15]) {
      const v = alloyScarcityCurve(owned)
      expect(v).toBeGreaterThanOrEqual(SCARCITY_FLOOR)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(alloyScarcityCurve(1e15)).toBe(SCARCITY_FLOOR)
    expect(alloyScarcityCurve(Number.MAX_VALUE)).toBe(SCARCITY_FLOOR)
  })

  it('is deterministic and rejects negative or non-finite holdings', () => {
    expect(alloyScarcityCurve(1_337)).toBe(alloyScarcityCurve(1_337))
    expect(() => alloyScarcityCurve(-1)).toThrow(/ownedAlloys/)
    expect(() => alloyScarcityCurve(Number.NaN)).toThrow(/ownedAlloys/)
    expect(() => alloyScarcityCurve(Number.POSITIVE_INFINITY)).toThrow(
      /ownedAlloys/,
    )
  })
})

describe('alloyYield', () => {
  it('multiplies baseRate by the curve and rounds to 1 decimal', () => {
    expect(alloyYield(5, 0)).toBe(5)
    expect(alloyYield(5, SCARCITY_HALF_LIFE)).toBeCloseTo(2.5, 10)
    const curveAtHalf = alloyScarcityCurve(SCARCITY_HALF_LIFE / 2)
    expect(alloyYield(5, SCARCITY_HALF_LIFE / 2)).toBeCloseTo(
      Math.round(5 * curveAtHalf * 10) / 10,
      10,
    )
    expect(alloyYield(5, SCARCITY_HALF_LIFE / 2)).toBe(3.3)
  })

  it('is deterministic, floors at huge holdings and rejects invalid baseRate', () => {
    expect(alloyYield(7.5, 2_222)).toBe(alloyYield(7.5, 2_222))
    expect(alloyYield(100, 1e15)).toBeCloseTo(100 * SCARCITY_FLOOR, 10)
    expect(() => alloyYield(-1, 0)).toThrow(/baseRate/)
    expect(() => alloyYield(Number.NaN, 0)).toThrow(/baseRate/)
    expect(() => alloyYield(5, -1)).toThrow(/ownedAlloys/)
  })
})

describe('defensiveAlloyDemand', () => {
  it('uses DESIGN-derived cost of 2 alloys per DP (turret: 1,000 alloys → 500 DP)', () => {
    expect(DEFENSE_ALLOYS_PER_DP).toBe(2)
    expect(defensiveAlloyDemand(0)).toBe(0)
    expect(defensiveAlloyDemand(500)).toBe(1_000)
    expect(defensiveAlloyDemand(10_000)).toBe(20_000)
  })

  it('is deterministic and linear, and rejects invalid defensePower', () => {
    expect(defensiveAlloyDemand(123)).toBe(defensiveAlloyDemand(123))
    expect(defensiveAlloyDemand(123.5)).toBe(247)
    expect(() => defensiveAlloyDemand(-1)).toThrow(/defensePower/)
    expect(() => defensiveAlloyDemand(Number.POSITIVE_INFINITY)).toThrow(
      /defensePower/,
    )
  })
})

describe('miscellaneous invariants', () => {
  it('uses a well-formed full transaction helper shape', () => {
    const t = fullTx('mine', 100)
    expect(t.id).toBe('id')
    expect(t.balanceAfter).toBe(0)
    expect(t.at).toBe(AT)
  })
})

describe('walletInvariants — parity with the credit ledger (transactions.ts)', () => {
  it('reports ok for a valid wallet', () => {
    expect(walletInvariants(baseWallet())).toEqual({ ok: true, problems: [] })
    expect(walletInvariants({ credits: 0, alloys: 0 })).toEqual({
      ok: true,
      problems: [],
    })
  })

  it('flags negative credits, NaN alloys and Infinity credits', () => {
    expect(walletInvariants({ credits: -1, alloys: 0 }).ok).toBe(false)
    expect(walletInvariants({ credits: 0, alloys: Number.NaN }).ok).toBe(false)
    expect(
      walletInvariants({ credits: Number.POSITIVE_INFINITY, alloys: 0 }).ok,
    ).toBe(false)
    expect(walletInvariants({ credits: 0, alloys: Number.NEGATIVE_INFINITY }).ok).toBe(
      false,
    )
    const negative = walletInvariants({ credits: -1, alloys: 0 })
    expect(negative.problems.some((p) => p.includes('credits'))).toBe(true)
    const nan = walletInvariants({ credits: 0, alloys: Number.NaN })
    expect(nan.problems.some((p) => p.includes('alloys'))).toBe(true)
  })

  it('flags each tamper class on its own and leaves a valid wallet untouched', () => {
    const tampered: Array<{ name: string; wallet: WalletState }> = [
      { name: 'negative credits', wallet: { credits: -5, alloys: 10 } },
      { name: 'negative alloys', wallet: { credits: 5, alloys: -1 } },
      { name: 'NaN credits', wallet: { credits: Number.NaN, alloys: 10 } },
      { name: 'NaN alloys', wallet: { credits: 5, alloys: Number.NaN } },
      { name: 'Infinity credits', wallet: { credits: Number.POSITIVE_INFINITY, alloys: 0 } },
      { name: 'Infinity alloys', wallet: { credits: 0, alloys: Number.POSITIVE_INFINITY } },
    ]
    for (const t of tampered) {
      const result = walletInvariants(t.wallet)
      expect(result.ok, t.name).toBe(false)
      expect(result.problems.length, t.name).toBeGreaterThan(0)
    }
    const valid = walletInvariants({ credits: 10, alloys: 5 })
    expect(valid.ok).toBe(true)
    expect(valid.problems).toEqual([])
  })

  it('is byte-for-byte identical to the credit ledger walletInvariants for every tamper class', () => {
    const samples: WalletState[] = [
      { credits: 0, alloys: 0 },
      { credits: 1_000, alloys: 500 },
      { credits: -1, alloys: 0 },
      { credits: 0, alloys: -1 },
      { credits: -1, alloys: -1 },
      { credits: Number.NaN, alloys: 500 },
      { credits: 1_000, alloys: Number.NaN },
      { credits: Number.POSITIVE_INFINITY, alloys: 500 },
      { credits: 1_000, alloys: Number.NEGATIVE_INFINITY },
      { credits: Number.MAX_VALUE, alloys: Number.MAX_VALUE },
    ]
    for (const sample of samples) {
      expect(walletInvariants(sample)).toEqual(creditWalletInvariants(sample))
    }
  })

  it('reports the offending field name for each tamper class', () => {
    expect(walletInvariants({ credits: -1, alloys: 0 }).problems.join(' | ')).toContain(
      'credits',
    )
    expect(walletInvariants({ credits: 0, alloys: -1 }).problems.join(' | ')).toContain(
      'alloys',
    )
    expect(walletInvariants({ credits: Number.NaN, alloys: 0 }).problems.join(' | ')).toContain(
      'credits must be finite',
    )
    expect(walletInvariants({ credits: 0, alloys: Number.NaN }).problems.join(' | ')).toContain(
      'alloys must be finite',
    )
  })

  it('is deterministic and never mutates the input wallet', () => {
    const wallet = { credits: 1_234, alloys: 567 }
    const before = { ...wallet }
    const a = walletInvariants(wallet)
    const b = walletInvariants(wallet)
    expect(a).toEqual(b)
    expect(a.problems).toEqual(b.problems)
    expect(wallet).toEqual(before)
  })

  it('reports every violated check when both balances are broken', () => {
    const result = walletInvariants({ credits: -1, alloys: Number.NaN })
    expect(result.ok).toBe(false)
    expect(result.problems.length).toBe(2)
    expect(result.problems.join(' | ')).toContain('credits must be >= 0')
    expect(result.problems.join(' | ')).toContain('alloys must be finite')
  })

  it('holds on every wallet produced by applyAlloyTransaction', () => {
    let wallet: WalletState = { credits: 1_000, alloys: 0 }
    wallet = applyAlloyTransaction(wallet, tx('mine', 250), AT, 1).wallet
    expect(walletInvariants(wallet).ok).toBe(true)
    wallet = applyAlloyTransaction(wallet, tx('spend', 100), AT, 2).wallet
    expect(walletInvariants(wallet).ok).toBe(true)
    wallet = applyAlloyTransaction(wallet, tx('adjustment', 5.5), AT, 3).wallet
    expect(walletInvariants(wallet).ok).toBe(true)
    expect(wallet.alloys).toBeCloseTo(155.5, 10)
  })

  it('accepts fractional and zero balances', () => {
    expect(walletInvariants({ credits: 0.1, alloys: 0.01 }).ok).toBe(true)
    expect(walletInvariants({ credits: 0, alloys: 0 }).ok).toBe(true)
    expect(walletInvariants({ credits: 0, alloys: Number.MAX_VALUE }).ok).toBe(true)
  })

  it('rejects only non-finite or negative balances across a wide sample', () => {
    const samples = [-1000, -1, -0.5, 0, 0.5, 1, 1000, 1e300]
    for (const credits of samples) {
      for (const alloys of samples) {
        const expectedOk =
          credits >= 0 && Number.isFinite(credits) && alloys >= 0 && Number.isFinite(alloys)
        expect(
          walletInvariants({ credits, alloys }).ok,
          `credits=${credits} alloys=${alloys}`,
        ).toBe(expectedOk)
      }
    }
  })
})
