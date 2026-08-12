import { describe, expect, it } from 'vitest'
import type { WalletState } from '../src/sim/player/types'
import {
  applyTransaction,
  totalByKind,
  transactionHistoryAppend,
  transactionId,
  walletInvariants,
} from '../src/sim/core/transactions'
import type {
  CreditTransaction,
  CreditTransactionInput,
} from '../src/sim/core/transactions'

const AT = 1_700_000_000_000

function baseWallet(): WalletState {
  return { credits: 1_000, alloys: 0 }
}

function tx(kind: CreditTransactionInput['kind'], amount: number): CreditTransactionInput {
  return { kind, amount }
}

function fullTx(
  kind: CreditTransactionInput['kind'],
  amount: number,
): CreditTransaction {
  return { id: 'id', kind, amount, balanceAfter: 0, at: AT }
}

describe('transactionId', () => {
  it('is deterministic for identical inputs', () => {
    const a = transactionId('income', 100, AT, 1)
    const b = transactionId('income', 100, AT, 1)
    expect(a).toBe(b)
  })

  it('produces distinct ids for distinct nonces', () => {
    const ids = new Set([1, 2, 3].map((n) => transactionId('income', 100, AT, n)))
    expect(ids.size).toBe(3)
  })

  it('produces distinct ids when kind/amount/at change', () => {
    const base = transactionId('income', 100, AT, 1)
    expect(transactionId('spend', 100, AT, 1)).not.toBe(base)
    expect(transactionId('income', 200, AT, 1)).not.toBe(base)
    expect(transactionId('income', 100, AT + 1, 1)).not.toBe(base)
  })

  it('emits a valid id format: hex hash + type-tagged nonce, <= 64 chars, no control chars', () => {
    const id = transactionId('transfer', 50, AT, 42)
    expect(id.length).toBeGreaterThan(0)
    expect(id.length).toBeLessThanOrEqual(64)
    expect(/^[0-9a-f]+-[ns]:[0-9a-zA-Z.+-]+$/.test(id)).toBe(true)
    const hasControlChars = [...id].some((c) => {
      const code = c.charCodeAt(0)
      return code <= 0x1f || code === 0x7f
    })
    expect(hasControlChars).toBe(false)
  })

  it('yields distinct ids for distinct string nonces with identical fields', () => {
    const ids = new Set(
      ['alpha', 'bravo', 'charlie'].map((n) => transactionId('income', 100, AT, n)),
    )
    expect(ids.size).toBe(3)
  })

  it('keeps ids within 64 chars for the maximum 40-char nonce', () => {
    const maxNonce = 'a'.repeat(40)
    const id = transactionId('income', 100, AT, maxNonce)
    expect(id.length).toBeLessThanOrEqual(64)
    expect(id.endsWith(`-s:${maxNonce}`)).toBe(true)
  })

  it('rejects an empty string nonce', () => {
    expect(() => transactionId('income', 100, AT, '')).toThrow(/nonce/)
  })

  it('rejects a string nonce containing control characters', () => {
    expect(() => transactionId('income', 100, AT, 'a\nb')).toThrow(/nonce/)
    expect(() => transactionId('income', 100, AT, '\x00')).toThrow(/nonce/)
    expect(() => transactionId('income', 100, AT, '\x7f')).toThrow(/nonce/)
  })

  it('rejects a 41-character string nonce', () => {
    const tooLong = 'a'.repeat(41)
    expect(() => transactionId('income', 100, AT, tooLong)).toThrow(/nonce/)
  })

  it('rejects non-finite number nonces', () => {
    expect(() => transactionId('income', 100, AT, Number.NaN)).toThrow(/nonce/)
    expect(() =>
      transactionId('income', 100, AT, Number.POSITIVE_INFINITY),
    ).toThrow(/nonce/)
  })

  it('yields distinct ids for a number nonce and the string that stringifies the same', () => {
    expect(transactionId('income', 100, AT, '1')).not.toBe(
      transactionId('income', 100, AT, 1),
    )
  })
})

describe('applyTransaction — validation', () => {
  it('rejects negative and zero amounts', () => {
    expect(() => applyTransaction(baseWallet(), tx('income', -10), AT, 1)).toThrow(
      /amount/,
    )
    expect(() => applyTransaction(baseWallet(), tx('spend', 0), AT, 1)).toThrow(
      /amount/,
    )
  })

  it('rejects NaN and Infinity amounts', () => {
    expect(() =>
      applyTransaction(baseWallet(), tx('income', Number.NaN), AT, 1),
    ).toThrow(/amount/)
    expect(() =>
      applyTransaction(baseWallet(), tx('income', Number.POSITIVE_INFINITY), AT, 1),
    ).toThrow(/amount/)
  })

  it('rejects an unknown credit kind', () => {
    const bad = { kind: 'bonus', amount: 10 } as unknown as CreditTransactionInput
    expect(() => applyTransaction(baseWallet(), bad, AT, 1)).toThrow(
      /unknown credit kind/,
    )
  })

  it('rejects non-positive or non-finite at timestamps', () => {
    expect(() => applyTransaction(baseWallet(), tx('income', 10), 0, 1)).toThrow(/at/)
    expect(() =>
      applyTransaction(baseWallet(), tx('income', 10), -5, 1),
    ).toThrow(/at/)
    expect(() =>
      applyTransaction(baseWallet(), tx('income', 10), Number.NaN, 1),
    ).toThrow(/at/)
  })

  it('throws insufficient credits for spend and transfer on a short wallet', () => {
    const wallet = { credits: 100, alloys: 0 }
    expect(() => applyTransaction(wallet, tx('spend', 101), AT, 1)).toThrow(
      /insufficient credits/,
    )
    expect(() => applyTransaction(wallet, tx('transfer', 101), AT, 1)).toThrow(
      /insufficient credits/,
    )
  })

  it('rejects an income whose resulting balance overflows to Infinity', () => {
    const wallet = { credits: Number.MAX_VALUE, alloys: 0 }
    expect(() =>
      applyTransaction(wallet, tx('income', Number.MAX_VALUE), AT, 1),
    ).toThrow(/balance/)
  })

  it('rejects a broken input wallet even for income', () => {
    const wallet = { credits: -50, alloys: 0 }
    expect(() => applyTransaction(wallet, tx('income', 100), AT, 1)).toThrow(
      /credits/,
    )
  })
})

describe('applyTransaction — math and balanceAfter', () => {
  it('income adds credits and sets balanceAfter; alloys untouched', () => {
    const result = applyTransaction(baseWallet(), tx('income', 100), AT, 1)
    expect(result.wallet.credits).toBe(1_100)
    expect(result.wallet.alloys).toBe(0)
    expect(result.transaction.balanceAfter).toBe(1_100)
  })

  it('spend subtracts credits and sets balanceAfter', () => {
    const result = applyTransaction(baseWallet(), tx('spend', 300), AT, 1)
    expect(result.wallet.credits).toBe(700)
    expect(result.wallet.alloys).toBe(0)
    expect(result.transaction.balanceAfter).toBe(700)
  })

  it('an exact-balance spend succeeds and lands on 0', () => {
    const result = applyTransaction(baseWallet(), tx('spend', 1_000), AT, 1)
    expect(result.wallet.credits).toBe(0)
    expect(result.transaction.balanceAfter).toBe(0)
  })

  it('transfer is outgoing like spend', () => {
    const result = applyTransaction(baseWallet(), tx('transfer', 250), AT, 1)
    expect(result.wallet.credits).toBe(750)
    expect(result.transaction.balanceAfter).toBe(750)
  })

  it('adjustment adds credits like income', () => {
    const result = applyTransaction(baseWallet(), tx('adjustment', 40), AT, 1)
    expect(result.wallet.credits).toBe(1_040)
    expect(result.transaction.balanceAfter).toBe(1_040)
  })

  it('0.1 float amounts are handled exactly enough', () => {
    const afterIncome = applyTransaction(baseWallet(), tx('income', 0.1), AT, 1)
    expect(afterIncome.wallet.credits).toBeCloseTo(1_000.1, 10)
    const afterSpend = applyTransaction(
      afterIncome.wallet,
      tx('spend', 0.1),
      AT,
      2,
    )
    expect(afterSpend.wallet.credits).toBeCloseTo(1_000, 10)
  })

  it('huge finite amounts stay finite', () => {
    const huge = 1e300
    const result = applyTransaction(
      { credits: huge, alloys: 0 },
      tx('spend', huge / 10),
      AT,
      1,
    )
    expect(Number.isFinite(result.wallet.credits)).toBe(true)
    expect(result.wallet.credits).toBeCloseTo(huge - huge / 10, 10)
  })
})

describe('applyTransaction — record and immutability', () => {
  it('returns the recorded transaction with id, at, balanceAfter, kind, amount', () => {
    const { wallet, transaction } = applyTransaction(
      baseWallet(),
      tx('income', 250),
      AT,
      7,
    )
    expect(transaction).toEqual({
      id: transactionId('income', 250, AT, 7),
      kind: 'income',
      amount: 250,
      balanceAfter: 1_250,
      at: AT,
    })
    expect(transaction.id).toBe(transactionId('income', 250, AT, 7))
    expect(wallet.credits).toBe(1_250)
  })

  it('captures the reference when provided', () => {
    const { transaction } = applyTransaction(
      baseWallet(),
      { kind: 'income', amount: 50, reference: 'oreMine-level2' },
      AT,
      1,
    )
    expect(transaction.reference).toBe('oreMine-level2')
  })

  it('omits the reference field when absent', () => {
    const { transaction } = applyTransaction(baseWallet(), tx('spend', 10), AT, 1)
    expect('reference' in transaction).toBe(false)
  })

  it('never mutates the input wallet and returns a fresh wallet object', () => {
    const wallet = baseWallet()
    const before = { ...wallet }
    const income = applyTransaction(wallet, tx('income', 500), AT, 1)
    expect(wallet).toEqual(before)
    expect(income.wallet).not.toBe(wallet)
    const spent = applyTransaction(wallet, tx('spend', 200), AT, 2)
    expect(wallet).toEqual(before)
    expect(spent.wallet).not.toBe(wallet)
    expect(() => applyTransaction(wallet, tx('spend', 9_999), AT, 3)).toThrow(
      /insufficient credits/,
    )
    expect(wallet).toEqual(before)
  })
})

describe('transactionHistoryAppend', () => {
  it('appends immutably and leaves the input history untouched', () => {
    const history = [fullTx('income', 100)]
    const next = transactionHistoryAppend(history, fullTx('spend', 30))
    expect(next).toHaveLength(2)
    expect(next[1].kind).toBe('spend')
    expect(history).toHaveLength(1)
    expect(history[0].kind).toBe('income')
  })

  it('accumulates across repeated appends without mutating prior arrays', () => {
    let history: CreditTransaction[] = []
    const first = transactionHistoryAppend(history, fullTx('income', 10))
    const second = transactionHistoryAppend(first, fullTx('income', 20))
    const third = transactionHistoryAppend(second, fullTx('spend', 5))
    expect(history).toHaveLength(0)
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(2)
    expect(third).toHaveLength(3)
    expect(third.map((t) => t.kind)).toEqual(['income', 'income', 'spend'])
  })
})

describe('walletInvariants', () => {
  it('reports ok for a valid wallet', () => {
    const result = walletInvariants(baseWallet())
    expect(result.ok).toBe(true)
    expect(result.problems).toHaveLength(0)
  })

  it('reports ok for zero balances', () => {
    const result = walletInvariants({ credits: 0, alloys: 0 })
    expect(result.ok).toBe(true)
  })

  it('flags negative credits, NaN alloys and Infinity credits', () => {
    expect(walletInvariants({ credits: -1, alloys: 0 }).ok).toBe(false)
    expect(walletInvariants({ credits: 0, alloys: Number.NaN }).ok).toBe(false)
    expect(
      walletInvariants({ credits: Number.POSITIVE_INFINITY, alloys: 0 }).ok,
    ).toBe(false)
    const negative = walletInvariants({ credits: -1, alloys: 0 })
    expect(negative.problems.some((p) => p.includes('credits'))).toBe(true)
    const nan = walletInvariants({ credits: 0, alloys: Number.NaN })
    expect(nan.problems.some((p) => p.includes('alloys'))).toBe(true)
  })
})

describe('totalByKind', () => {
  it('sums raw amounts for a kind across a mixed history', () => {
    const history = [
      fullTx('income', 100),
      fullTx('spend', 30),
      fullTx('income', 50),
      fullTx('transfer', 20),
    ]
    expect(totalByKind(history, 'income')).toBe(150)
    expect(totalByKind(history, 'spend')).toBe(30)
    expect(totalByKind(history, 'transfer')).toBe(20)
  })

  it('returns 0 for a kind with no entries', () => {
    expect(totalByKind([fullTx('income', 100)], 'adjustment')).toBe(0)
    expect(totalByKind([], 'spend')).toBe(0)
  })
})
