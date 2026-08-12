import { STRUCTURES, isStructureId } from './data'
import { buildCost, canBuild } from './framework'
import { fnv1a } from '../planets/hash'
import type { StructureId } from './types'
import type { WalletState } from '../player/types'

/**
 * Construction queues (P3-T07) — pure reservation model for building and
 * upgrading structures.
 *
 * DESIGN decisions (all documented; DESIGN.md has no construction section):
 * - **Duration:** DESIGN §4d lists a single build time per structure ("build
 *   time shown for level 1") and locks no level scaling, so duration is the
 *   flat `buildTimeSec` (seconds); `finishesAt = startedAt + buildTimeSec * 1000`
 *   (timestamps are milliseconds, matching transactions.ts).
 * - **Refund:** DESIGN is silent on a refund policy, so cancellation returns a
 *   FULL refund of the reserved cost (credits + alloys).
 * - **Concurrency:** DESIGN locks no parallel-construction rule (structure
 *   slots are unlimited, §4d), so PARALLEL building jobs on the same structure
 *   are permitted. `queueInvariants` therefore does NOT enforce a
 *   single-building-job-per-structure rule.
 * - **Reservation:** the wallet is NOT debited here. The returned `cost` is
 *   the reservation; the caller debits via transactions.ts after a successful
 *   `queueConstruction`. Validation (canBuild + grid/fromLevel consistency)
 *   guarantees the reservation never exceeds the wallet.
 *
 * LEVEL RULE (centralised, DESIGN-locked): structure levels are UNLIMITED —
 * finite non-negative integers with NO hard cap. queueConstruction validates
 * every level as a non-negative integer (see assertNonNegativeInteger) and
 * the single-level step toLevel === fromLevel + 1; queueInvariants re-asserts
 * both on every job. There is no maxLevelFor check anywhere (the framework
 * removed that cap in the same audit).
 *
 * Pure module — deterministic, no wall clock (all timestamps are inputs), no
 * module-level mutable state, strictly typed.
 */

export type ConstructionJobStatus = 'building' | 'complete' | 'cancelled'

export interface ConstructionJob {
  id: string
  structure: StructureId
  fromLevel: number
  toLevel: number
  startedAt: number
  finishesAt: number
  cost: { credits: number; alloys: number }
  status: ConstructionJobStatus
}

export interface ConstructionQueue {
  planet: string
  jobs: ConstructionJob[]
}

export interface QueueConstructionInput {
  planet: string
  structure: StructureId
  fromLevel: number
  toLevel: number
  startedAt: number
  wallet: WalletState
  existingJobs: readonly ConstructionJob[]
  grid: Record<StructureId, number>
}

export interface QueueConstructionResult {
  queue: ConstructionQueue
  job: ConstructionJob
  cost: { credits: number; alloys: number }
}

export interface CompleteDueJobsResult {
  queue: ConstructionQueue
  completed: ConstructionJob[]
}

export interface CancelJobResult {
  queue: ConstructionQueue
  refund: { credits: number; alloys: number }
}

const JOB_STATUSES: readonly ConstructionJobStatus[] = [
  'building',
  'complete',
  'cancelled',
]

function assertFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a finite number > 0, got ${value}`)
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite non-negative number, got ${value}`)
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a finite non-negative integer, got ${value}`)
  }
}

/**
 * Reserves a construction job. Validates the level step (single-level, finite
 * non-negative integers — see the module-level LEVEL RULE), the canBuild
 * ladder (funds, via framework.canBuild) and timestamp sanity, then
 * appends the new job to a copy of the queue. The wallet is never debited.
 *
 * The job id is the FNV-1a hash (hex) of
 * `planet|structure|toLevel|startedAt|index`, where `index` is the new job's
 * 0-based position in the resulting queue (i.e. `existingJobs.length`).
 */
export function queueConstruction(
  input: QueueConstructionInput,
): QueueConstructionResult {
  const { planet, structure, fromLevel, toLevel, startedAt, wallet, existingJobs, grid } =
    input
  if (!isStructureId(structure)) {
    throw new RangeError(`unknown structure id, got ${String(structure)}`)
  }
  if (toLevel !== fromLevel + 1) {
    throw new Error(
      `single-level builds only: toLevel (${toLevel}) must be fromLevel (${fromLevel}) + 1`,
    )
  }
  assertNonNegativeInteger(fromLevel, 'fromLevel')
  assertNonNegativeInteger(toLevel, 'toLevel')
  assertFinitePositive(startedAt, 'startedAt')
  assertFiniteNonNegative(wallet.credits, 'wallet.credits')
  assertFiniteNonNegative(wallet.alloys, 'wallet.alloys')

  const currentLevel = grid[structure] ?? 0
  assertNonNegativeInteger(currentLevel, `grid.${structure}`)
  if (currentLevel !== fromLevel) {
    throw new Error(
      `grid level for ${structure} is ${currentLevel}, expected ${fromLevel} ` +
        `(the reserved cost must match what canBuild validated)`,
    )
  }

  const cost = {
    credits: buildCost(structure, fromLevel),
    alloys: STRUCTURES[structure].alloyCost ?? 0,
  }

  const decision = canBuild(structure, grid, wallet)
  if (!decision.ok) {
    switch (decision.reason) {
      case 'insufficient-credits':
        throw new Error(
          `cannot build ${structure}: need ${cost.credits} cr, have ${wallet.credits} cr`,
        )
      case 'insufficient-alloys':
        throw new Error(
          `cannot build ${structure}: need ${cost.alloys} alloys, have ${wallet.alloys} alloys`,
        )
      case 'unknown-structure':
        throw new RangeError(`unknown structure id, got ${String(structure)}`)
    }
  }

  const durationSec = STRUCTURES[structure].buildTimeSec
  const durationMs = durationSec * 1000
  const finishesAt = startedAt + durationMs
  if (!Number.isFinite(finishesAt) || finishesAt <= startedAt) {
    throw new RangeError(
      `finishesAt (${finishesAt}) must be finite and strictly after startedAt (${startedAt}) ` +
        `for ${structure} with duration ${durationMs}ms`,
    )
  }
  const index = existingJobs.length
  const id = fnv1a(`${planet}|${structure}|${toLevel}|${startedAt}|${index}`).toString(16)

  const job: ConstructionJob = {
    id,
    structure,
    fromLevel,
    toLevel,
    startedAt,
    finishesAt,
    cost: { ...cost },
    status: 'building',
  }

  return {
    queue: { planet, jobs: [...existingJobs, job] },
    job,
    cost: { ...cost },
  }
}

function compareStartedAtThenId(a: ConstructionJob, b: ConstructionJob): number {
  if (a.startedAt !== b.startedAt) {
    return a.startedAt - b.startedAt
  }
  if (a.id < b.id) {
    return -1
  }
  if (a.id > b.id) {
    return 1
  }
  return 0
}

/**
 * Every building job (due — finishesAt <= at — and still-building alike),
 * ordered deterministically by startedAt then id. Complete and cancelled jobs
 * are excluded. `at` classifies due vs still-building (both are returned) and
 * never mutates the queue.
 */
export function jobsAt(queue: ConstructionQueue, _at: number): ConstructionJob[] {
  return queue.jobs
    .filter((job) => job.status === 'building')
    .sort(compareStartedAtThenId)
}

/**
 * Advances the queue to `at`: every building job whose `finishesAt <= at`
 * transitions to 'complete' exactly once. Idempotent — a job already
 * 'complete' (or 'cancelled') is never touched, and `completed` contains only
 * newly-completed jobs. Returns a new queue; the input is never mutated.
 */
export function completeDueJobs(
  queue: ConstructionQueue,
  at: number,
): CompleteDueJobsResult {
  const completed: ConstructionJob[] = []
  const jobs = queue.jobs.map((job) => {
    if (job.status === 'building' && job.finishesAt <= at) {
      const done: ConstructionJob = { ...job, status: 'complete' }
      completed.push(done)
      return done
    }
    return job
  })
  return { queue: { ...queue, jobs }, completed }
}

/**
 * Cancels a building job, refunding the FULL reserved cost (DESIGN is silent
 * on a refund policy — full refund is the default). A complete or already
 * cancelled job cannot be cancelled (throws); an unknown job id throws.
 * Returns a new queue; the input is never mutated.
 */
export function cancelJob(
  queue: ConstructionQueue,
  jobId: string,
  at: number,
): CancelJobResult {
  assertFinitePositive(at, 'at')
  const job = queue.jobs.find((candidate) => candidate.id === jobId)
  if (job === undefined) {
    throw new Error(`unknown job id: ${jobId}`)
  }
  if (job.status === 'complete') {
    throw new Error(`cannot cancel completed job ${jobId}`)
  }
  if (job.status === 'cancelled') {
    throw new Error(`job ${jobId} is already cancelled`)
  }
  const cancelled: ConstructionJob = { ...job, status: 'cancelled' }
  const jobs = queue.jobs.map((candidate) =>
    candidate.id === jobId ? cancelled : candidate,
  )
  return {
    queue: { ...queue, jobs },
    refund: { credits: job.cost.credits, alloys: job.cost.alloys },
  }
}

/**
 * Structural invariants of a construction queue. Deliberately does NOT enforce
 * a single-building-job-per-structure rule — DESIGN locks no such rule
 * (parallel construction is permitted; see module docstring).
 */
export function queueInvariants(queue: ConstructionQueue): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const job of queue.jobs) {
    if (typeof job.id !== 'string' || job.id.length === 0) {
      problems.push(`job id must be a non-empty string, got ${String(job.id)}`)
    } else if (seen.has(job.id)) {
      problems.push(`duplicate job id: ${job.id}`)
    } else {
      seen.add(job.id)
    }
    if (!isStructureId(job.structure)) {
      problems.push(`unknown structure id in job ${job.id}: ${String(job.structure)}`)
    }
    if (!Number.isInteger(job.fromLevel) || job.fromLevel < 0) {
      problems.push(`invalid fromLevel for job ${job.id}: ${job.fromLevel}`)
    }
    if (!Number.isInteger(job.toLevel) || job.toLevel < 0) {
      problems.push(`invalid toLevel for job ${job.id}: ${job.toLevel}`)
    } else if (job.toLevel !== job.fromLevel + 1) {
      problems.push(
        `job ${job.id} must be single-level: toLevel ${job.toLevel} !== fromLevel ${job.fromLevel} + 1`,
      )
    }
    if (!Number.isFinite(job.startedAt) || job.startedAt <= 0) {
      problems.push(`invalid startedAt for job ${job.id}: ${job.startedAt}`)
    }
    if (!Number.isFinite(job.finishesAt) || job.finishesAt <= job.startedAt) {
      problems.push(
        `invalid finishesAt for job ${job.id}: ${job.finishesAt} ` +
          `(must be > startedAt ${job.startedAt})`,
      )
    }
    if (!JOB_STATUSES.includes(job.status)) {
      problems.push(`invalid status for job ${job.id}: ${String(job.status)}`)
    }
    if (!Number.isFinite(job.cost.credits) || job.cost.credits < 0) {
      problems.push(`invalid cost.credits for job ${job.id}: ${job.cost.credits}`)
    }
    if (!Number.isFinite(job.cost.alloys) || job.cost.alloys < 0) {
      problems.push(`invalid cost.alloys for job ${job.id}: ${job.cost.alloys}`)
    }
  }
  return { ok: problems.length === 0, problems }
}
