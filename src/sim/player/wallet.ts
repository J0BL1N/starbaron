import type { WalletState } from './types'

export const STARTER_CREDITS = 1_000
export const STARTER_ALLOYS = 0
export const STARTER_POPULATION = 1_000

export function startWallet(): WalletState {
  return {
    credits: STARTER_CREDITS,
    alloys: STARTER_ALLOYS,
    population: STARTER_POPULATION,
    garrison: 0,
    fleet: 0,
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite non-negative number, got ${value}`)
  }
}

export function walletAdd(
  wallet: WalletState,
  delta: Partial<WalletState>,
): WalletState {
  for (const field of ['credits', 'alloys', 'population', 'garrison', 'fleet'] as const) {
    const amount = delta[field] ?? 0
    assertFiniteNonNegative(amount, field)
  }
  return {
    credits: wallet.credits + (delta.credits ?? 0),
    alloys: wallet.alloys + (delta.alloys ?? 0),
    population: wallet.population + (delta.population ?? 0),
    garrison: wallet.garrison + (delta.garrison ?? 0),
    fleet: wallet.fleet + (delta.fleet ?? 0),
  }
}

export function walletSpend(
  wallet: WalletState,
  credits: number,
  alloys: number,
): WalletState {
  assertFiniteNonNegative(credits, 'credits')
  assertFiniteNonNegative(alloys, 'alloys')
  if (wallet.credits < credits || wallet.alloys < alloys) {
    throw new RangeError(
      `insufficient funds: need ${credits} cr and ${alloys} alloys, ` +
        `have ${wallet.credits} cr and ${wallet.alloys} alloys`,
    )
  }
  return {
    ...wallet,
    credits: wallet.credits - credits,
    alloys: wallet.alloys - alloys,
  }
}
