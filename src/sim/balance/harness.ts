/**
 * P3-T10 — Economy balancing harness.
 *
 * A DETERMINISTIC economy simulation for balance analysis: cost curves, income
 * curves, time-to-upgrade and early/mid/late progression. It is a pure module
 * — no nondeterministic APIs, no module-level mutable state, no wall clock
 * (the sim clock is derived entirely from `tickSeconds`/`horizonSeconds`;
 * queue timestamps are `atSeconds * 1000`). Strictly typed, no `any`.
 *
 * The harness never re-derives a locked formula — it SIMULATES using the
 * locked modules:
 *   - income:      productionSummaryFor(tier, grid, no quirks) per tick
 *   - costs:       framework.buildCost / prerequisitesMet / maxLevelFor
 *   - construction: queues.queueConstruction + completeDueJobs (ms timestamps)
 *   - population:  core/population-model applyGrowth (locked legacy raw-level
 *                  model), rebound to the grid's housing/hydroponics each tick;
 *                  the tier-scaled cap used by harnessInvariants is the locked
 *                  populationCapFor(housing, populationCapMultiplier(tier)).
 *
 * HARNESS-INPUT DECISIONS (documented — deliberately NOT gameplay decisions):
 *   - Greedy policy: each tick enqueues AT MOST ONE build — the structure with
 *     the smallest nextBuildCost that is affordable (credits + alloys) and has
 *     its prerequisites met. Ties break in STRUCTURE_IDS order. A structure
 *     with an in-flight building job is excluded (builds are serial per
 *     structure; parallel builds across DIFFERENT structures are permitted, as
 *     the locked queue module allows). This policy is a balance-harness input
 *     for measuring the economy, not a gameplay decision.
 *   - Income is accrued with the grid as of the START of the tick window
 *     (discrete approximation); a final partial tick accrues for its partial
 *     window.
 *   - Initial population is the harness constant INITIAL_POPULATION (a fresh
 *     planet's population is not an economy input).
 *   - timeToFirstUpgradeSeconds is the exact completion time (seconds) of the
 *     first completed job; if no upgrade completes within the horizon it is
 *     the horizon (documented sentinel keeping summary numbers finite).
 *   - timeToBand[band] is the first observed point time in that band; a band
 *     never reached within the horizon reports its NOMINAL threshold (0 for
 *     early, BAND_EARLY_SECONDS for mid, BAND_MID_SECONDS for late).
 *
 * BANDS: early = [0, BAND_EARLY_SECONDS], mid = (BAND_EARLY_SECONDS,
 * BAND_MID_SECONDS], late = beyond BAND_MID_SECONDS.
 */

import { MAX_TIER, MIN_TIER } from '../core/economy'
import { applyGrowth, populationCapFor } from '../core/population-model'
import type { PopulationState } from '../core/population-model'
import { populationCapMultiplier } from '../planets/levels'
import type { PlanetTier } from '../data/planets'
import { STRUCTURES, STRUCTURE_IDS, isStructureId } from '../structures/data'
import { buildCost, maxLevelFor, prerequisitesMet } from '../structures/framework'
import { productionSummaryFor } from '../structures/production'
import { completeDueJobs, queueConstruction } from '../structures/queues'
import type { ConstructionQueue } from '../structures/queues'
import type { StructureId } from '../structures/types'
import type { WalletState } from '../player/types'

/** End of the early band, in simulated seconds (first 15 minutes). */
export const BAND_EARLY_SECONDS = 900

/** End of the mid band, in simulated seconds (up to 4 hours). */
export const BAND_MID_SECONDS = 14_400

/** Default tick length in simulated seconds. */
export const DEFAULT_TICK_SECONDS = 60

/** Harness convention for a fresh planet's starting population. */
export const INITIAL_POPULATION = 1_000

const PLANET_NAME = 'Home'

const BAND_ORDER = Object.freeze<readonly ProgressionBand[]>(['early', 'mid', 'late'])

export type ProgressionBand = 'early' | 'mid' | 'late'

export interface HarnessPoint {
  atSeconds: number
  credits: number
  alloys: number
  population: number
  structureLevels: Record<StructureId, number>
  income: { creditsPerSec: number; alloysPerSec: number }
  band: ProgressionBand
}

export interface HarnessSummary {
  timeToFirstUpgradeSeconds: number
  timeToBand: Record<ProgressionBand, number>
  finalCredits: number
  totalUpgrades: number
}

export interface HarnessRunConfig {
  tier: number
  initialCredits: number
  initialAlloys: number
  horizonSeconds: number
  tickSeconds: number
}

export interface HarnessRun {
  config: HarnessRunConfig
  points: HarnessPoint[]
  summary: HarnessSummary
}

export interface EconomySimulationConfig {
  tier: number
  initialCredits: number
  initialAlloys: number
  horizonSeconds: number
  tickSeconds?: number
}

function bandForSeconds(seconds: number): ProgressionBand {
  if (seconds <= BAND_EARLY_SECONDS) {
    return 'early'
  }
  if (seconds <= BAND_MID_SECONDS) {
    return 'mid'
  }
  return 'late'
}

function isPlanetTier(tier: number): tier is PlanetTier {
  return Number.isInteger(tier) && tier >= MIN_TIER && tier <= MAX_TIER
}

function emptyGrid(): Record<StructureId, number> {
  return {
    oreMine: 0,
    tradeHub: 0,
    housing: 0,
    hydroponics: 0,
    barracks: 0,
    shipyard: 0,
    defenseTurret: 0,
  }
}

function resolveConfig(config: EconomySimulationConfig): HarnessRunConfig {
  if (!Number.isInteger(config.tier) || config.tier < MIN_TIER || config.tier > MAX_TIER) {
    throw new RangeError(
      `tier must be an integer in [${MIN_TIER}, ${MAX_TIER}], got ${config.tier}`,
    )
  }
  if (!Number.isFinite(config.initialCredits) || config.initialCredits < 0) {
    throw new RangeError(
      `initialCredits must be a finite non-negative number, got ${config.initialCredits}`,
    )
  }
  if (!Number.isFinite(config.initialAlloys) || config.initialAlloys < 0) {
    throw new RangeError(
      `initialAlloys must be a finite non-negative number, got ${config.initialAlloys}`,
    )
  }
  if (!Number.isFinite(config.horizonSeconds) || config.horizonSeconds <= 0) {
    throw new RangeError(
      `horizonSeconds must be a finite number greater than 0, got ${config.horizonSeconds}`,
    )
  }
  const tickSeconds = config.tickSeconds ?? DEFAULT_TICK_SECONDS
  if (!Number.isFinite(tickSeconds) || tickSeconds <= 0) {
    throw new RangeError(
      `tickSeconds must be a finite number greater than 0, got ${tickSeconds}`,
    )
  }
  return {
    tier: config.tier,
    initialCredits: config.initialCredits,
    initialAlloys: config.initialAlloys,
    horizonSeconds: config.horizonSeconds,
    tickSeconds,
  }
}

function hasBuildingJob(queue: ConstructionQueue, structure: StructureId): boolean {
  return queue.jobs.some(
    (job) => job.structure === structure && job.status === 'building',
  )
}

interface BuildCandidate {
  structure: StructureId
  cost: { credits: number; alloys: number }
}

/**
 * The harness greedy policy: the structure with the smallest nextBuildCost that
 * is affordable (credits and alloys) and has its prerequisites met, with no
 * in-flight building job. Ties break in STRUCTURE_IDS order. Returns null when
 * nothing qualifies.
 */
function cheapestAffordableBuild(
  grid: Record<StructureId, number>,
  wallet: WalletState,
  queue: ConstructionQueue,
): BuildCandidate | null {
  const candidates: BuildCandidate[] = []
  for (const id of STRUCTURE_IDS) {
    const level = grid[id]
    if (level >= maxLevelFor(id)) {
      continue
    }
    if (hasBuildingJob(queue, id)) {
      continue
    }
    if (!prerequisitesMet(id, grid)) {
      continue
    }
    const cost = {
      credits: buildCost(id, level),
      alloys: STRUCTURES[id].alloyCost ?? 0,
    }
    if (wallet.credits < cost.credits || wallet.alloys < cost.alloys) {
      continue
    }
    candidates.push({ structure: id, cost })
  }
  candidates.sort((a, b) => {
    if (a.cost.credits !== b.cost.credits) {
      return a.cost.credits - b.cost.credits
    }
    return STRUCTURE_IDS.indexOf(a.structure) - STRUCTURE_IDS.indexOf(b.structure)
  })
  return candidates[0] ?? null
}

function makePoint(
  atSeconds: number,
  grid: Record<StructureId, number>,
  wallet: WalletState,
  population: number,
  income: { creditsPerSec: number; alloysPerSec: number },
): HarnessPoint {
  return {
    atSeconds,
    credits: wallet.credits,
    alloys: wallet.alloys,
    population,
    structureLevels: { ...grid },
    income: { ...income },
    band: bandForSeconds(atSeconds),
  }
}

function firstBandPointTimes(
  points: readonly HarnessPoint[],
): Record<ProgressionBand, number | null> {
  const firstSeen: Record<ProgressionBand, number | null> = {
    early: null,
    mid: null,
    late: null,
  }
  for (const point of points) {
    if (firstSeen[point.band] === null) {
      firstSeen[point.band] = point.atSeconds
    }
  }
  return firstSeen
}

function computeTimeToBand(
  points: readonly HarnessPoint[],
): Record<ProgressionBand, number> {
  const firstSeen = firstBandPointTimes(points)
  return {
    early: firstSeen.early ?? 0,
    mid: firstSeen.mid ?? BAND_EARLY_SECONDS,
    late: firstSeen.late ?? BAND_MID_SECONDS,
  }
}

/**
 * DETERMINISTIC economy simulation: fresh home planet (tier from config), empty
 * grid, empty queue, wallet from config. Each tick (default 60s): accrue income
 * (productionSummaryFor x elapsed), complete due queue jobs, then enqueue the
 * cheapest affordable next build (see module docstring). Identical config
 * yields deep-equal runs.
 */
export function runEconomySimulation(config: EconomySimulationConfig): HarnessRun {
  const resolved = resolveConfig(config)
  const tier = resolved.tier
  const horizonSeconds = resolved.horizonSeconds
  const tickSeconds = resolved.tickSeconds

  let grid = emptyGrid()
  let wallet: WalletState = {
    credits: resolved.initialCredits,
    alloys: resolved.initialAlloys,
  }
  let queue: ConstructionQueue = { planet: PLANET_NAME, jobs: [] }
  let population: PopulationState = {
    population: INITIAL_POPULATION,
    housingLevels: 0,
    hydroponicsLevels: 0,
    lastTickAt: 0,
  }

  const points: HarnessPoint[] = []
  let totalUpgrades = 0
  let timeToFirstUpgradeSeconds: number | null = null

  const initialIncome = productionSummaryFor({ name: PLANET_NAME, tier, grid }).total
  points.push(makePoint(0, grid, wallet, population.population, initialIncome))

  let atSeconds = 0
  while (atSeconds < horizonSeconds) {
    const stepSeconds = Math.min(tickSeconds, horizonSeconds - atSeconds)
    const nextSeconds = atSeconds + stepSeconds

    const windowRates = productionSummaryFor({ name: PLANET_NAME, tier, grid }).total
    wallet.credits += windowRates.creditsPerSec * stepSeconds
    wallet.alloys += windowRates.alloysPerSec * stepSeconds

    const due = completeDueJobs(queue, nextSeconds * 1000)
    queue = due.queue
    for (const job of due.completed) {
      grid[job.structure] = job.toLevel
      totalUpgrades += 1
      if (timeToFirstUpgradeSeconds === null) {
        timeToFirstUpgradeSeconds = job.finishesAt / 1000
      }
    }

    const candidate = cheapestAffordableBuild(grid, wallet, queue)
    if (candidate !== null) {
      const built = queueConstruction({
        planet: PLANET_NAME,
        structure: candidate.structure,
        fromLevel: grid[candidate.structure],
        toLevel: grid[candidate.structure] + 1,
        startedAt: nextSeconds * 1000,
        wallet,
        existingJobs: queue.jobs,
        grid,
      })
      queue = built.queue
      wallet.credits -= built.cost.credits
      wallet.alloys -= built.cost.alloys
    }

    population = applyGrowth(population, nextSeconds)
    population = {
      ...population,
      housingLevels: grid.housing,
      hydroponicsLevels: grid.hydroponics,
    }

    const pointRates = productionSummaryFor({ name: PLANET_NAME, tier, grid }).total
    points.push(makePoint(nextSeconds, grid, wallet, population.population, pointRates))
    atSeconds = nextSeconds
  }

  return {
    config: resolved,
    points,
    summary: {
      timeToFirstUpgradeSeconds: timeToFirstUpgradeSeconds ?? horizonSeconds,
      timeToBand: computeTimeToBand(points),
      finalCredits: points[points.length - 1].credits,
      totalUpgrades,
    },
  }
}

/**
 * Structural invariants of a harness run: points sorted by time, non-negative
 * credits/alloys/population, population within the tier-scaled cap, valid
 * levels, bands consistent with the time thresholds and in order, income
 * reconciled against the locked productionSummaryFor, and finite summary
 * numbers consistent with the run.
 */
export function harnessInvariants(run: HarnessRun): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []
  const { config, points, summary } = run

  if (points.length === 0) {
    problems.push('run must contain at least one point')
  }

  if (!Number.isInteger(config.tier) || config.tier < MIN_TIER || config.tier > MAX_TIER) {
    problems.push(
      `config.tier must be an integer in [${MIN_TIER}, ${MAX_TIER}], got ${config.tier}`,
    )
  }
  if (!Number.isFinite(config.initialCredits) || config.initialCredits < 0) {
    problems.push('config.initialCredits must be a finite non-negative number')
  }
  if (!Number.isFinite(config.initialAlloys) || config.initialAlloys < 0) {
    problems.push('config.initialAlloys must be a finite non-negative number')
  }
  if (!Number.isFinite(config.horizonSeconds) || config.horizonSeconds <= 0) {
    problems.push('config.horizonSeconds must be a finite number greater than 0')
  }
  if (!Number.isFinite(config.tickSeconds) || config.tickSeconds <= 0) {
    problems.push('config.tickSeconds must be a finite number greater than 0')
  }
  const bandOrder: Record<ProgressionBand, number> = { early: 0, mid: 1, late: 2 }

  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    if (!Number.isFinite(point.atSeconds) || point.atSeconds < 0) {
      problems.push(`atSeconds must be a finite non-negative number (point ${i})`)
    }
    if (i > 0 && point.atSeconds <= points[i - 1].atSeconds) {
      problems.push(
        `points must be strictly increasing in time (point ${i} at ${point.atSeconds})`,
      )
    }
    if (!Number.isFinite(point.credits) || point.credits < 0) {
      problems.push(`credits must be finite and non-negative (point ${i})`)
    }
    if (!Number.isFinite(point.alloys) || point.alloys < 0) {
      problems.push(`alloys must be finite and non-negative (point ${i})`)
    }
    if (!Number.isFinite(point.population) || point.population < 0) {
      problems.push(`population must be finite and non-negative (point ${i})`)
    }
    if (
      isPlanetTier(config.tier) &&
      Number.isInteger(point.structureLevels.housing) &&
      point.structureLevels.housing >= 0
    ) {
      const cap = populationCapFor(
        point.structureLevels.housing,
        populationCapMultiplier(config.tier),
      )
      if (point.population > cap) {
        problems.push(`population exceeds the tier-scaled cap (point ${i})`)
      }
    }
    if (!BAND_ORDER.includes(point.band)) {
      problems.push(`unknown band at point ${i}: ${String(point.band)}`)
    } else if (point.band !== bandForSeconds(point.atSeconds)) {
      problems.push(
        `band ${point.band} is inconsistent with atSeconds ${point.atSeconds} (point ${i})`,
      )
    }
    if (i > 0 && bandOrder[points[i].band] < bandOrder[points[i - 1].band]) {
      problems.push('bands must appear in order (early -> mid -> late)')
    }

    for (const id of STRUCTURE_IDS) {
      const level = point.structureLevels[id]
      if (!Number.isInteger(level) || level < 0) {
        problems.push(`structureLevels.${id} must be a non-negative integer (point ${i})`)
      } else if (level > maxLevelFor(id)) {
        problems.push(`structureLevels.${id} exceeds max level (point ${i})`)
      }
    }
    for (const key of Object.keys(point.structureLevels)) {
      if (!isStructureId(key)) {
        problems.push(`unknown structure key in structureLevels (point ${i}): ${key}`)
      }
    }

    if (isPlanetTier(config.tier)) {
      try {
        const locked = productionSummaryFor({
          name: PLANET_NAME,
          tier: config.tier,
          grid: point.structureLevels,
        }).total
        if (
          locked.creditsPerSec !== point.income.creditsPerSec ||
          locked.alloysPerSec !== point.income.alloysPerSec
        ) {
          problems.push(
            `income must equal productionSummaryFor for the point grid (point ${i})`,
          )
        }
      } catch {
        problems.push(`structureLevels unreadable by productionSummaryFor (point ${i})`)
      }
    }
  }

  if (
    !Number.isFinite(summary.timeToFirstUpgradeSeconds) ||
    summary.timeToFirstUpgradeSeconds <= 0
  ) {
    problems.push('timeToFirstUpgradeSeconds must be a finite number greater than 0')
  } else if (summary.timeToFirstUpgradeSeconds > config.horizonSeconds) {
    problems.push('timeToFirstUpgradeSeconds must not exceed horizonSeconds')
  }
  if (summary.totalUpgrades === 0) {
    if (summary.timeToFirstUpgradeSeconds !== config.horizonSeconds) {
      problems.push(
        'with zero upgrades, timeToFirstUpgradeSeconds must equal horizonSeconds',
      )
    }
  }

  if (!Number.isFinite(summary.finalCredits) || summary.finalCredits < 0) {
    problems.push('finalCredits must be a finite non-negative number')
  } else if (
    points.length > 0 &&
    summary.finalCredits !== points[points.length - 1].credits
  ) {
    problems.push('finalCredits must equal the last point credits')
  }

  if (!Number.isInteger(summary.totalUpgrades) || summary.totalUpgrades < 0) {
    problems.push('totalUpgrades must be a non-negative integer')
  }
  if (points.length > 0) {
    const last = points[points.length - 1]
    const levelSum = STRUCTURE_IDS.reduce(
      (sum, id) => sum + last.structureLevels[id],
      0,
    )
    if (summary.totalUpgrades !== levelSum) {
      problems.push('totalUpgrades must equal the last point total structure levels')
    }
  }

  if (summary.timeToBand.early !== 0) {
    problems.push('timeToBand.early must be 0')
  }
  if (
    !Number.isFinite(summary.timeToBand.mid) ||
    summary.timeToBand.mid < BAND_EARLY_SECONDS ||
    summary.timeToBand.mid > BAND_MID_SECONDS
  ) {
    problems.push('timeToBand.mid must be finite within the mid band window')
  }
  if (!Number.isFinite(summary.timeToBand.late) || summary.timeToBand.late < BAND_MID_SECONDS) {
    problems.push('timeToBand.late must be finite and at or beyond the mid threshold')
  }

  const firstSeen = firstBandPointTimes(points)
  if (firstSeen.mid !== null) {
    if (summary.timeToBand.mid !== firstSeen.mid) {
      problems.push('timeToBand.mid must equal the first observed mid point time')
    }
  } else if (summary.timeToBand.mid !== BAND_EARLY_SECONDS) {
    problems.push('timeToBand.mid must be the nominal BAND_EARLY_SECONDS when mid is never reached')
  }
  if (firstSeen.late !== null) {
    if (summary.timeToBand.late !== firstSeen.late) {
      problems.push('timeToBand.late must equal the first observed late point time')
    }
  } else if (summary.timeToBand.late !== BAND_MID_SECONDS) {
    problems.push('timeToBand.late must be the nominal BAND_MID_SECONDS when late is never reached')
  }

  return { ok: problems.length === 0, problems }
}

function lastPointInBand(
  points: readonly HarnessPoint[],
  band: ProgressionBand,
): HarnessPoint | undefined {
  let found: HarnessPoint | undefined
  for (const point of points) {
    if (point.band === band) {
      found = point
    }
  }
  return found
}

/**
 * Telemetry-ready, DETERMINISTIC summary: one CSV-style line per band present
 * in the run (early, then mid, then late), each taken from the LAST point of
 * that band:
 *   band,creditsPerSec,alloysPerSec,population,structureLevelsSummary,upgrades
 * Plain String() rendering — no locale formatting, for later telemetry
 * ingestion. structureLevelsSummary is STRUCTURE_IDS-order `id=level` pairs
 * joined by ';'; upgrades is the cumulative level total at that point (every
 * harness upgrade adds exactly one level, nothing is demolished).
 */
export function harnessTelemetry(run: HarnessRun): string {
  const lines: string[] = []
  for (const band of BAND_ORDER) {
    const point = lastPointInBand(run.points, band)
    if (point === undefined) {
      continue
    }
    const levels = STRUCTURE_IDS.map((id) => `${id}=${point.structureLevels[id]}`).join(
      ';',
    )
    const upgrades = STRUCTURE_IDS.reduce(
      (sum, id) => sum + point.structureLevels[id],
      0,
    )
    lines.push(
      [
        band,
        point.income.creditsPerSec,
        point.income.alloysPerSec,
        point.population,
        levels,
        upgrades,
      ].join(','),
    )
  }
  return lines.join('\n')
}
