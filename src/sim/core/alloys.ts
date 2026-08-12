/**
 * Alloy-accounting primitives for the simulation: the canonical resource
 * model for the secondary-economy resource (see DESIGN.md §4a "Alloys/ore —
 * Defend"). Mirrors the credit accounting in ./transactions.ts but with kind
 * 'mine' (production from Ore Mines) instead of 'income'.
 *
 * Dependency contract (same as ./transactions.ts after Codex audit round 1):
 * - Type-only imports from '../player/types' are authorised (WalletState's
 *   type definition lives there; wallet.ts re-exports it).
 * - fnv1a is imported from '../planets/hash' (shared implementation) rather
 *   than reimplemented locally.
 *
 * Note on the input type: the task's inline signature read
 * `Omit<AlloyTransaction, 'id' | 'balanceAfter'>`, but `at` is supplied as a
 * separate argument (the ledger timestamp) exactly as in ./transactions.ts,
 * so `AlloyTransactionInput` omits `at` too. Keeps a single source of truth
 * for the timestamp and mirrors CreditTransactionInput.
 */
import type { WalletState } from '../player/types'
import { fnv1a } from '../planets/hash'
import { walletInvariants } from './ledger'

export { walletInvariants }

export type AlloyKind = 'mine' | 'spend' | 'transfer' | 'adjustment'

export interface AlloyTransaction {
  id: string
  kind: AlloyKind
  amount: number
  balanceAfter: number
  at: number
  reference?: string
}

/**
 * The mutable inputs to applyAlloyTransaction. `at` is supplied as an explicit
 * argument (the ledger timestamp); `id` and `balanceAfter` are derived.
 */
export type AlloyTransactionInput = Omit<
  AlloyTransaction,
  'id' | 'balanceAfter' | 'at'
>

export interface ApplyAlloyTransactionResult {
  wallet: WalletState
  transaction: AlloyTransaction
}

/**
 * Scarcity-curve constants. SCARCITY_HALF_LIFE is the alloy stock at which
 * the scarcity multiplier halves. SCARCITY_FLOOR is the lower clamp.
 *
 * Balance-harness input (flagged for T10): the exact curve formula is a
 * tuning knob; it is implemented here deterministically so the harness can
 * rebalance without changing call sites.
 */
export const SCARCITY_HALF_LIFE = 5_000
export const SCARCITY_FLOOR = 0.05

/**
 * Alloy cost of one point of defense power. Derived from DESIGN.md §4d/§5:
 * the Defense Turret costs 1,000 alloys and provides +500 DP
 * (DP = 500 × turret levels), so 1,000 / 500 = 2 alloys per DP. This is
 * DESIGN's number and deliberately overrides the ×50 draft figure in the
 * task brief; flagged for T10 balance alongside the scarcity curve.
 */
export const DEFENSE_ALLOYS_PER_DP = 2

const ALLOY_KINDS: readonly AlloyKind[] = [
  'mine',
  'spend',
  'transfer',
  'adjustment',
]

function isAlloyKind(value: unknown): value is AlloyKind {
  return (
    typeof value === 'string' && (ALLOY_KINDS as readonly string[]).includes(value)
  )
}

function assertFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a finite number > 0, got ${value}`)
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${field} must be a finite number >= 0, got ${value}`,
    )
  }
}

/**
 * Deterministic id for an alloy transaction. Same scheme as
 * ./transactions.ts#transactionId: `<hex>-<tag>:<nonce>`, where `<hex>` is
 * the FNV-1a hash of `kind|amount|at|<tag>:<nonce>`, `<tag>` is the nonce
 * type (`n` for number, `s` for string) and `<nonce>` is the verbatim nonce.
 * The type-tagged suffix makes the mapping injective on (type, value), so
 * `1` and `'1'` yield distinct ids. The FNV-1a component is at most 8 hex
 * chars (32-bit) and the suffix is at most 42 chars (`s:` + 40), so ids stay
 * within 64 chars. Nonces are validated before an id is produced: number
 * nonces must be finite and must not be -0 (0 and -0 are distinct JS values
 * but both stringify to `n:0`, so -0 is rejected to keep ids injective);
 * string nonces must be non-empty, free of control characters and at most 40
 * chars. Uniqueness across a ledger is the caller's responsibility: they must
 * supply distinct nonces.
 */
function assertValidNonce(nonce: number | string): void {
  if (typeof nonce === 'number') {
    if (!Number.isFinite(nonce)) {
      throw new Error(`nonce must be a finite number, got ${nonce}`)
    }
    if (Object.is(nonce, -0)) {
      throw new Error('nonce must not be -0 (rejected: -0 and 0 share the same id)')
    }
    return
  }
  if (nonce.length === 0) {
    throw new Error('nonce string must not be empty')
  }
  for (let i = 0; i < nonce.length; i++) {
    const code = nonce.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      throw new Error('nonce string must not contain control characters')
    }
  }
  if (nonce.length > 40) {
    throw new Error(
      `nonce string must be at most 40 characters, got ${nonce.length}`,
    )
  }
}

export function alloyTransactionId(
  kind: AlloyKind,
  amount: number,
  at: number,
  nonce: number | string,
): string {
  assertValidNonce(nonce)
  const tag = typeof nonce === 'number' ? 'n' : 's'
  const hex = fnv1a(`${kind}|${amount}|${at}|${tag}:${nonce}`).toString(16)
  return `${hex}-${tag}:${nonce}`
}

/**
 * Applies one validated alloy transaction, returning a new wallet and the
 * recorded transaction. The input wallet is never mutated. Mine and
 * adjustment add alloys; spend and transfer subtract them. Credits balance is
 * untouched (but is still validated as a wallet invariant). spend/transfer
 * require sufficient alloys (outgoing). Validation mirrors
 * ./transactions.ts#applyTransaction exactly, with 'mine' in place of
 * 'income'.
 */
export function applyAlloyTransaction(
  wallet: WalletState,
  tx: AlloyTransactionInput,
  at: number,
  nonce: number | string,
): ApplyAlloyTransactionResult {
  if (!isAlloyKind(tx.kind)) {
    throw new RangeError(`unknown alloy kind, got ${String(tx.kind)}`)
  }
  if (!Number.isFinite(tx.amount) || tx.amount <= 0) {
    throw new RangeError(`amount must be a finite number > 0, got ${tx.amount}`)
  }
  assertFinitePositive(at, 'at')
  if (!Number.isFinite(wallet.credits) || wallet.credits < 0) {
    throw new RangeError(
      `wallet credits must be a finite number >= 0, got ${wallet.credits}`,
    )
  }
  if (!Number.isFinite(wallet.alloys) || wallet.alloys < 0) {
    throw new RangeError(
      `wallet alloys must be a finite number >= 0, got ${wallet.alloys}`,
    )
  }

  const isOutgoing = tx.kind === 'spend' || tx.kind === 'transfer'
  if (isOutgoing && wallet.alloys < tx.amount) {
    throw new RangeError(
      `insufficient alloys: need ${tx.amount} alloys, have ${wallet.alloys} alloys`,
    )
  }

  const newBalance = isOutgoing
    ? wallet.alloys - tx.amount
    : wallet.alloys + tx.amount
  if (!Number.isFinite(newBalance) || newBalance < 0) {
    throw new RangeError(
      `resulting alloys balance must be a finite number >= 0, got ${newBalance}`,
    )
  }

  const transaction: AlloyTransaction = {
    id: alloyTransactionId(tx.kind, tx.amount, at, nonce),
    kind: tx.kind,
    amount: tx.amount,
    balanceAfter: newBalance,
    at,
    ...(tx.reference !== undefined ? { reference: tx.reference } : {}),
  }

  return { wallet: { ...wallet, alloys: newBalance }, transaction }
}

/**
 * The scarcity multiplier on future alloy income: `1 / (1 + ownedAlloys /
 * SCARCITY_HALF_LIFE)`, clamped to [SCARCITY_FLOOR, 1]. Monotonic decreasing
 * in ownedAlloys: 1 at zero stock, approaching 0.05 as stock grows past the
 * half-life. Pure and deterministic — the exact formula is a balance-harness
 * input (T10), not a design lock.
 */
export function alloyScarcityCurve(ownedAlloys: number): number {
  assertFiniteNonNegative(ownedAlloys, 'ownedAlloys')
  const multiplier = 1 / (1 + ownedAlloys / SCARCITY_HALF_LIFE)
  return Math.min(1, Math.max(SCARCITY_FLOOR, multiplier))
}

/**
 * Alloy income after the scarcity curve applies: `baseRate ×
 * alloyScarcityCurve(ownedAlloys)`, rounded to 0.1 (one decimal). The 0.1
 * precision is deliberate (matches the sim's decimal income display) and is a
 * balance-harness input (T10).
 */
export function alloyYield(baseRate: number, ownedAlloys: number): number {
  assertFiniteNonNegative(baseRate, 'baseRate')
  const raw = baseRate * alloyScarcityCurve(ownedAlloys)
  return Math.round(raw * 10) / 10
}

/**
 * Deterministic alloy cost of defense power: `defensePower ×
 * DEFENSE_ALLOYS_PER_DP` (2 alloys per DP from DESIGN.md's turret). Callers
 * pass any DP figure (turrets + militia); this returns the alloy equivalent.
 */
export function defensiveAlloyDemand(defensePower: number): number {
  assertFiniteNonNegative(defensePower, 'defensePower')
  return defensePower * DEFENSE_ALLOYS_PER_DP
}
