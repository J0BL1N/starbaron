/**
 * Credit-accounting primitives for the simulation.
 *
 * Dependency contract (documented after Codex audit round 1):
 * - Type-only imports from '../player/types' are authorised (WalletState's
 *   type definition lives there; wallet.ts re-exports it).
 * - fnv1a is imported from '../planets/hash' (shared implementation) rather
 *   than reimplemented locally.
 */
import type { WalletState } from '../player/types'
import { fnv1a } from '../planets/hash'

export type CreditKind = 'income' | 'spend' | 'transfer' | 'adjustment'

export interface CreditTransaction {
  id: string
  kind: CreditKind
  amount: number
  balanceAfter: number
  at: number
  reference?: string
}

/**
 * The mutable inputs to applyTransaction. `at` is supplied as an explicit
 * argument (the ledger timestamp); `id` and `balanceAfter` are derived.
 */
export type CreditTransactionInput = Omit<
  CreditTransaction,
  'id' | 'balanceAfter' | 'at'
>

export interface ApplyTransactionResult {
  wallet: WalletState
  transaction: CreditTransaction
}

const CREDIT_KINDS: readonly CreditKind[] = [
  'income',
  'spend',
  'transfer',
  'adjustment',
]

function isCreditKind(value: unknown): value is CreditKind {
  return (
    typeof value === 'string' && (CREDIT_KINDS as readonly string[]).includes(value)
  )
}

function assertFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a finite number > 0, got ${value}`)
  }
}

/**
 * Deterministic id for a transaction. Unique per (kind, amount, at, nonce);
 * callers pass a per-ledger monotonic nonce so identical fields still yield
 * distinct ids. Uniqueness across a ledger is the caller's responsibility.
 */
export function transactionId(
  kind: CreditKind,
  amount: number,
  at: number,
  nonce: number | string,
): string {
  return fnv1a(`${kind}|${amount}|${at}|${nonce}`).toString(16)
}

/**
 * Applies one validated credit transaction, returning a new wallet and the
 * recorded transaction. The input wallet is never mutated. Income and
 * adjustment add credits; spend and transfer subtract them. Alloy balance is
 * untouched. spend/transfer require sufficient credits (outgoing).
 */
export function applyTransaction(
  wallet: WalletState,
  tx: CreditTransactionInput,
  at: number,
  nonce: number | string,
): ApplyTransactionResult {
  if (!isCreditKind(tx.kind)) {
    throw new RangeError(`unknown credit kind, got ${String(tx.kind)}`)
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
  if (isOutgoing && wallet.credits < tx.amount) {
    throw new RangeError(
      `insufficient credits: need ${tx.amount} cr, have ${wallet.credits} cr`,
    )
  }

  const newBalance = isOutgoing
    ? wallet.credits - tx.amount
    : wallet.credits + tx.amount
  if (!Number.isFinite(newBalance) || newBalance < 0) {
    throw new RangeError(
      `resulting credits balance must be a finite number >= 0, got ${newBalance}`,
    )
  }

  const transaction: CreditTransaction = {
    id: transactionId(tx.kind, tx.amount, at, nonce),
    kind: tx.kind,
    amount: tx.amount,
    balanceAfter: newBalance,
    at,
    ...(tx.reference !== undefined ? { reference: tx.reference } : {}),
  }

  return { wallet: { ...wallet, credits: newBalance }, transaction }
}

export function transactionHistoryAppend(
  history: CreditTransaction[],
  tx: CreditTransaction,
): CreditTransaction[] {
  return [...history, tx]
}

export function walletInvariants(
  wallet: WalletState,
): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (!Number.isFinite(wallet.credits)) {
    problems.push('credits must be finite')
  }
  if (wallet.credits < 0) {
    problems.push('credits must be >= 0')
  }
  if (!Number.isFinite(wallet.alloys)) {
    problems.push('alloys must be finite')
  }
  if (wallet.alloys < 0) {
    problems.push('alloys must be >= 0')
  }
  return { ok: problems.length === 0, problems }
}

/**
 * Sums raw amounts for a kind. Amounts are stored positive for every kind, so
 * spend/transfer totals are the sum of outgoing magnitudes (never negative).
 */
export function totalByKind(history: CreditTransaction[], kind: CreditKind): number {
  let total = 0
  for (const tx of history) {
    if (tx.kind === kind) {
      total += tx.amount
    }
  }
  return total
}
