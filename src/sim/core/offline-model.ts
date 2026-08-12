import { MAX_OFFLINE_BANK_SECONDS, calculateOfflineEarnings } from './offline'
import { applyGrowth } from './population-model'
import type { PopulationState } from './population-model'
import { empireRates } from '../player/accrual'
import type { PlayerState } from '../player/types'
import { completeDueJobs } from '../structures/queues'
import type { ConstructionJob, ConstructionQueue } from '../structures/queues'

/**
 * Offline progression (P3-T08) — the pure projection of what a player accrues
 * while away, as a DELTA for exactly the window `[player.lastTickAt, at]`.
 *
 * ANTI-DUPLICATION CONTRACT: the result is a delta, NOT absolute balances
 * (`walletDelta` — the caller adds it to the live wallet exactly once, then
 * advances `player.lastTickAt` to `at`). Re-applying the same delta, or
 * re-running from an un-advanced `lastTickAt`, double-counts: the model always
 * reports the delta for `[lastTickAt, at]`, and the caller's advancing of
 * `lastTickAt` is the anti-duplication mechanism.
 *
 * CAP POLICY (LOCKED): mirrors `src/sim/core/offline.ts` EXACTLY —
 * `bankedSeconds = min(elapsedSeconds, MAX_OFFLINE_BANK_SECONDS)`. Credit and
 * alloy deltas DELEGATE to the locked `calculateOfflineEarnings` (same
 * signature: rate-per-second × elapsedSeconds, capped internally). Population
 * growth is fed ONLY the banked window — excess time accrues nothing.
 *
 * DELEGATION / AGREEMENT:
 * - wallet deltas: `empireRates(player)` (the live accrual path, P3) for the
 *   per-second rates, then `calculateOfflineEarnings` for the capped amount.
 *   For elapsed <= the 8h bank this equals `accruePlayer(player, elapsedMs)`
 *   wallet deltas at equal elapsed time.
 * - population: `applyGrowth` per owned planet (population-model, P3-T03),
 *   clamped at the population cap. NOTE the population-model unit quirk: its
 *   `applyGrowth` treats the timestamp delta as seconds, so the banked window
 *   is fed as `lastTickAt + bankedSeconds` (seconds, matching the model's
 *   contract). With the locked caps (~5-6k pop reached in well under an hour)
 *   the banked window is indistinguishable from the full window for
 *   population, but the excess is structurally never fed to growth.
 * - completedJobs: `completeDueJobs(queue, at)` at the FULL `at` (construction
 *   completes on real elapsed time; the 8h bank applies to accrual only).
 *
 * ZERO-ELAPSED BOUNDARY: when `elapsedSeconds === 0` (`at === lastTickAt`)
 * the result reports NO completed jobs — zero time yields zero progress of
 * every kind. `completeDueJobs` is inclusive (`finishesAt <= at`), so its
 * boundary result is suppressed here; a job whose `finishesAt === lastTickAt`
 * completes only in a NON-zero window (the supplied `at` > `lastTickAt`). This
 * keeps the
 * anti-duplication delta contract exact: applying the zero delta advances
 * `lastTickAt` to `at` (a no-op), and the job is still due in the next real
 * window.
 *
 * Pure module — deterministic, no wall clock (`lastTickAt`/`at` are inputs),
 * no module-level mutable state, strictly typed, deterministic number
 * formatting only.
 */

export interface OfflineResult {
  walletDelta: { credits: number; alloys: number }
  populationByPlanet: Record<string, number>
  completedJobs: ConstructionJob[]
  bankedSeconds: number
  elapsedSeconds: number
  capped: boolean
}

export interface OfflineProgressInput {
  player: PlayerState
  queue: ConstructionQueue
  at: number
}

function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} must be a finite number, got ${value}`)
  }
}

function populationDeltaFor(
  planet: PlayerState['homePlanet'],
  grid: Record<string, number>,
  lastTickAt: number,
  bankedAt: number,
): number {
  const base: PopulationState = {
    population: planet.population,
    housingLevels: grid.housing ?? 0,
    hydroponicsLevels: grid.hydroponics ?? 0,
    lastTickAt,
  }
  const grown = applyGrowth(base, bankedAt)
  return grown.population - planet.population
}

export function offlineProgress(input: OfflineProgressInput): OfflineResult {
  const { player, queue, at } = input
  assertFinite(player.lastTickAt, 'player.lastTickAt')
  assertFinite(at, 'at')
  if (at < player.lastTickAt) {
    throw new RangeError(
      `at (${at}) must not be earlier than lastTickAt (${player.lastTickAt})`,
    )
  }

  const elapsedSeconds = (at - player.lastTickAt) / 1000
  const bankedSeconds = Math.min(elapsedSeconds, MAX_OFFLINE_BANK_SECONDS)
  const capped = elapsedSeconds > bankedSeconds

  const rates = empireRates(player)
  const walletDelta = {
    credits: calculateOfflineEarnings(rates.creditsPerSec, elapsedSeconds),
    alloys: calculateOfflineEarnings(rates.alloysPerSec, elapsedSeconds),
  }

  const bankedAt = player.lastTickAt + bankedSeconds
  const populationByPlanet: Record<string, number> = {}
  for (const planet of [player.homePlanet, ...player.colonies]) {
    const grid =
      player.structureLevels[planet.name] ?? { housing: 0, hydroponics: 0 }
    populationByPlanet[planet.name] = populationDeltaFor(
      planet,
      grid,
      player.lastTickAt,
      bankedAt,
    )
  }

  const completedJobs =
    elapsedSeconds === 0 ? [] : completeDueJobs(queue, at).completed

  return {
    walletDelta,
    populationByPlanet,
    completedJobs,
    bankedSeconds,
    elapsedSeconds,
    capped,
  }
}

function groupThousands(value: number): string {
  const rounded = Math.round(value)
  const sign = rounded < 0 ? '-' : ''
  const digits = String(Math.abs(rounded))
  const parts: string[] = []
  for (let i = digits.length; i > 0; i -= 3) {
    parts.unshift(digits.slice(Math.max(0, i - 3), i))
  }
  return `${sign}${parts.join(',')}`
}

function formatBankedDuration(bankedSeconds: number): string {
  if (bankedSeconds >= 3600) {
    return `${Math.floor(bankedSeconds / 3600)}h`
  }
  if (bankedSeconds >= 60) {
    return `${Math.floor(bankedSeconds / 60)}m`
  }
  return `${Math.round(bankedSeconds)}s`
}

/**
 * Deterministic one-line summary for the UI modal. Comma grouping is
 * implemented locally (manual comma grouping — deterministic number
 * formatting), and every value is rounded to a whole number so identical
 * results always render identically.
 */
export function offlineSummary(result: OfflineResult): string {
  const segments: string[] = []
  const credits = Math.round(result.walletDelta.credits)
  if (credits > 0) {
    segments.push(`+${groupThousands(credits)} cr`)
  }
  const alloys = Math.round(result.walletDelta.alloys)
  if (alloys > 0) {
    segments.push(`+${groupThousands(alloys)} alloys`)
  }
  const population = Math.round(
    Object.values(result.populationByPlanet).reduce(
      (sum: number, delta: number) => sum + delta,
      0,
    ),
  )
  if (population > 0) {
    segments.push(`+${groupThousands(population)} pop`)
  }
  const body = segments.length === 0 ? '+0 cr' : segments.join(' · ')
  return `While you were away (${formatBankedDuration(result.bankedSeconds)})… ${body}`
}

export function validateOfflineResult(r: OfflineResult): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []

  if (!Number.isFinite(r.walletDelta.credits) || r.walletDelta.credits < 0) {
    problems.push('walletDelta.credits must be a finite non-negative number')
  }
  if (!Number.isFinite(r.walletDelta.alloys) || r.walletDelta.alloys < 0) {
    problems.push('walletDelta.alloys must be a finite non-negative number')
  }
  if (!Number.isFinite(r.bankedSeconds) || r.bankedSeconds < 0) {
    problems.push('bankedSeconds must be a finite non-negative number')
  }
  if (!Number.isFinite(r.elapsedSeconds) || r.elapsedSeconds < 0) {
    problems.push('elapsedSeconds must be a finite non-negative number')
  }
  if (r.bankedSeconds > r.elapsedSeconds) {
    problems.push('bankedSeconds must not exceed elapsedSeconds')
  }
  if (r.bankedSeconds > MAX_OFFLINE_BANK_SECONDS) {
    problems.push('bankedSeconds must not exceed MAX_OFFLINE_BANK_SECONDS')
  }
  if (r.bankedSeconds !== Math.min(r.elapsedSeconds, MAX_OFFLINE_BANK_SECONDS)) {
    problems.push(
      'bankedSeconds must equal min(elapsedSeconds, MAX_OFFLINE_BANK_SECONDS)',
    )
  }
  if (r.capped !== (r.elapsedSeconds > r.bankedSeconds)) {
    problems.push('capped flag inconsistent with elapsed/banked seconds')
  }
  for (const [name, delta] of Object.entries(r.populationByPlanet)) {
    if (!Number.isFinite(delta)) {
      problems.push(`population delta for ${name} must be finite`)
    } else if (delta < 0) {
      problems.push(`population delta for ${name} must be non-negative`)
    }
  }

  return { ok: problems.length === 0, problems }
}
