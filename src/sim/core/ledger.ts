import type { WalletState } from '../player/types'

/**
 * Shared wallet-invariant validation for BOTH ledgers (credits and alloys).
 *
 * This is the single implementation backing `transactions.walletInvariants`
 * (which keeps its own locked copy) and the new `alloys.walletInvariants`
 * export. The ordering and wording match `transactions.walletInvariants`
 * exactly so the two surfaces are interchangeable: every check is
 * credits finite >= 0, then alloys finite >= 0.
 *
 * Pure and deterministic — never mutates the wallet, never touches clocks or
 * locale APIs.
 */
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
