export const MAX_OFFLINE_BANK_SECONDS = 8 * 60 * 60

export function calculateOfflineEarnings(
  ratePerSec: number,
  elapsedSeconds: number,
): number {
  if (!Number.isFinite(ratePerSec) || ratePerSec < 0) {
    throw new RangeError(
      `ratePerSec must be a non-negative finite number, got ${ratePerSec}`,
    )
  }
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError(
      `elapsedSeconds must be a non-negative finite number, got ${elapsedSeconds}`,
    )
  }
  const bankedSeconds = Math.min(elapsedSeconds, MAX_OFFLINE_BANK_SECONDS)
  return ratePerSec * bankedSeconds
}
