/**
 * Shipyard model (P5-T02) — ship construction over the LOCKED structure
 * pieces: build requirements (credits/alloys), cost, build time, fleet-cap
 * integration and queue-friendly completions.
 *
 * DESIGN decisions (all delegated to locked modules — nothing re-derived):
 * - **fleetCap** comes from the LOCKED `structureEffect('shipyard', level)`
 *   (1000 × effective level) — never re-implemented here.
 * - **incomePerSec** is the LOCKED flat base rate `SHIPYARD_INCOME_PER_MIN / 60`
 *   (per-level shipbuilding income scaling is owned by the locked accrual.ts,
 *   which multiplies this base by the effective level).
 * - **nextBuildCost** delegates to the LOCKED `framework.buildCost` (the
 *   canonical `structureCost` formula, baseCost × 1.15^level).
 * - **buildTimeSec** is the LOCKED data.ts shipyard build time (300s).
 * - **completions** are timestamps: `completesAt = at + class.buildTimeSec × 1000`,
 *   validated overflow-safe exactly like queues.ts (finite and strictly after
 *   `at`). `at` is an input — no time-source reads.
 * - **Check order** in canBuildShips (reason ladder): no-shipyard →
 *   invalid-count → fleet-cap → not-enough-credits → not-enough-alloys → ok.
 *   Validation errors (non-non-negative-integer level, non-finite fleet or
 *   wallet, non-positive `at`, overflowing completesAt) throw RangeError;
 *   only the six ladder reasons are returned as outcomes.
 * - **Construction queue (whole-phase finding 7 — the roadmap's 'queue
 *   integration'):** `ShipyardQueue` carries the shipyard level and an
 *   immutable FIFO job list. The shipyard has ONE build slot — a job starts
 *   only after the previous job completes, so `startedAt = max(request.at,
 *   previous.completesAt)` and jobs complete strictly in enqueue (FIFO)
 *   order. `enqueueShipBuild` validates the canBuildShips ladder subset its
 *   signature covers (no-shipyard → invalid-count → fleet-cap) and checks the
 *   fleet cap against CURRENT ships + ALL in-flight ('building') job counts;
 *   the credit/alloy ladder steps stay with canBuildShips, which remains the
 *   FULL eligibility gate the caller runs first (enqueueShipBuild takes no
 *   wallet). `shipJobsAt` returns the due jobs (inclusive boundary) and
 *   `completeShipJobs` advances them to 'done' — both mirror queues.ts
 *   semantics (idempotent).
 *
 * Pure module — deterministic, no time-source reads (timestamps are inputs),
 * no nondeterministic APIs, no module-level mutable state, strictly typed.
 */

import { SHIP_CLASSES } from './ships'
import type { ShipClass, ShipClassId } from './ships'
import { STRUCTURES } from '../structures/data'
import { SHIPYARD_INCOME_PER_MIN, structureEffect } from '../structures/effects'
import { buildCost } from '../structures/framework'
import type { WalletState } from '../player/types'
import { assertPositiveAt } from '../ui/validate'
import { fnv1a } from '../planets/hash'

export interface ShipyardState {
  level: number
  fleetCap: number
  incomePerSec: number
  nextBuildCost: number
  buildTimeSec: number
}

export interface ShipBuildRequest {
  shipClass: ShipClassId
  count: number
  at: number
}

export type ShipBuildReason =
  | 'ok'
  | 'not-enough-credits'
  | 'not-enough-alloys'
  | 'fleet-cap'
  | 'no-shipyard'
  | 'invalid-count'

export interface ShipBuildOutcome {
  ok: boolean
  reason: ShipBuildReason
  fleetAfter: number
  cost: { credits: number; alloys: number }
  completesAt: number
}

export interface CanBuildShipsInput {
  shipyardLevel: number
  fleet: number
  wallet: WalletState
  request: ShipBuildRequest
  classStats?: ShipClass
}

function assertValidLevel(level: number): void {
  if (!Number.isInteger(level) || level < 0) {
    throw new RangeError(`level must be a non-negative integer, got ${level}`)
  }
}

function assertValidCount(count: number): void {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`count must be a positive integer, got ${count}`)
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${field} must be a finite non-negative number, got ${value}`,
    )
  }
}

function resolveClass(request: ShipBuildRequest, classStats?: ShipClass): ShipClass {
  if (classStats !== undefined) {
    return classStats
  }
  const stats = SHIP_CLASSES[request.shipClass]
  if (stats === undefined) {
    throw new RangeError(`unknown ship class id, got ${String(request.shipClass)}`)
  }
  return stats
}

/**
 * The derived shipyard state for a structure level. Validates the level as a
 * non-negative integer, then pulls every number from the LOCKED modules.
 */
export function shipyardStateFor(level: number): ShipyardState {
  assertValidLevel(level)
  const effect = structureEffect('shipyard', level)
  if (effect.kind !== 'shipyard') {
    throw new Error(`unexpected shipyard effect kind: ${effect.kind}`)
  }
  return {
    level,
    fleetCap: effect.fleetCap,
    incomePerSec: SHIPYARD_INCOME_PER_MIN / 60,
    nextBuildCost: buildCost('shipyard', level),
    buildTimeSec: STRUCTURES.shipyard.buildTimeSec,
  }
}

/**
 * The credit/alloy cost of a ship build: class cost × count. The count must
 * be a positive integer (RangeError otherwise). `classStats` is an injection
 * point for testability; when omitted it resolves to the locked roster class.
 */
export function shipBuildCost(
  request: ShipBuildRequest,
  classStats?: ShipClass,
): { credits: number; alloys: number } {
  assertValidCount(request.count)
  const stats = resolveClass(request, classStats)
  return {
    credits: stats.cost.credits * request.count,
    alloys: stats.cost.alloys * request.count,
  }
}

/**
 * Build-eligibility ladder (in order): no-shipyard → invalid-count →
 * fleet-cap → not-enough-credits → not-enough-alloys → ok. Failed builds
 * leave the fleet unchanged and report the would-be cost with no completion
 * scheduled (completesAt = request.at). Validation failures throw RangeError:
 * non-negative-integer shipyardLevel, finite non-negative fleet/wallet,
 * finite positive `at`, and an overflow-safe completesAt (strictly > `at`).
 */
export function canBuildShips(input: CanBuildShipsInput): ShipBuildOutcome {
  const { shipyardLevel, fleet, wallet, request, classStats } = input
  assertValidLevel(shipyardLevel)
  assertFiniteNonNegative(fleet, 'fleet')
  assertFiniteNonNegative(wallet.credits, 'wallet.credits')
  assertFiniteNonNegative(wallet.alloys, 'wallet.alloys')
  assertPositiveAt(request.at)

  if (shipyardLevel === 0) {
    return {
      ok: false,
      reason: 'no-shipyard',
      fleetAfter: fleet,
      cost: { credits: 0, alloys: 0 },
      completesAt: request.at,
    }
  }

  if (!Number.isInteger(request.count) || request.count <= 0) {
    return {
      ok: false,
      reason: 'invalid-count',
      fleetAfter: fleet,
      cost: { credits: 0, alloys: 0 },
      completesAt: request.at,
    }
  }

  const stats = resolveClass(request, classStats)
  const cost = shipBuildCost(request, stats)
  const fleetCap = shipyardStateFor(shipyardLevel).fleetCap

  if (fleet + request.count > fleetCap) {
    return {
      ok: false,
      reason: 'fleet-cap',
      fleetAfter: fleet,
      cost,
      completesAt: request.at,
    }
  }

  if (wallet.credits < cost.credits) {
    return {
      ok: false,
      reason: 'not-enough-credits',
      fleetAfter: fleet,
      cost,
      completesAt: request.at,
    }
  }

  if (wallet.alloys < cost.alloys) {
    return {
      ok: false,
      reason: 'not-enough-alloys',
      fleetAfter: fleet,
      cost,
      completesAt: request.at,
    }
  }

  const completesAt = request.at + stats.buildTimeSec * 1000
  if (!Number.isFinite(completesAt) || completesAt <= request.at) {
    throw new RangeError(
      `completesAt (${completesAt}) must be finite and strictly after at ` +
        `(${request.at}) for ${stats.id} with duration ${stats.buildTimeSec * 1000}ms`,
    )
  }

  return {
    ok: true,
    reason: 'ok',
    fleetAfter: fleet + request.count,
    cost,
    completesAt,
  }
}

// -------------------------------------------------------------------------
// Shipyard construction queue (P5 whole-phase finding 7).
// -------------------------------------------------------------------------

export type ShipBuildJobStatus = 'building' | 'done'

/** One immutable ship build job in a ShipyardQueue. */
export interface ShipBuildJob {
  id: string
  shipClass: ShipClassId
  count: number
  startedAt: number
  completesAt: number
  status: ShipBuildJobStatus
}

/**
 * An immutable shipyard construction queue. The shipyard has a single build
 * slot: each job starts when the previous job completes (FIFO), and jobs
 * complete in strict enqueue order. All jobs are append-only; advancing
 * happens through `completeShipJobs` (never in place).
 */
export interface ShipyardQueue {
  shipyardLevel: number
  jobs: ShipBuildJob[]
}

export interface CompleteShipJobsResult {
  queue: ShipyardQueue
  completed: ShipBuildJob[]
}

function assertValidQueue(queue: ShipyardQueue): void {
  assertValidLevel(queue.shipyardLevel)
  if (!Array.isArray(queue.jobs)) {
    throw new RangeError('queue.jobs must be an array')
  }
}

/**
 * Enqueues a ship build on the shipyard queue. Validates the canBuildShips
 * ladder subset this signature covers, in order: no-shipyard (level 0) →
 * invalid-count → fleet-cap, where the cap is checked against CURRENT ships +
 * ALL in-flight ('building') job counts + the new count. The credit/alloy
 * ladder steps are canBuildShips' contract (the caller runs canBuildShips —
 * the full eligibility gate including funds — before enqueueing; this
 * function takes no wallet). Ladder rejections throw Error with the reason
 * embedded (mirroring createFleet); malformed values (level, jobs, fleet,
 * `at`, unknown class, overflowing completesAt) throw RangeError.
 *
 * Sequential FIFO timing: the shipyard has ONE build slot, so the new job
 * starts at `startedAt = max(request.at, previous job completesAt)` and its
 * completesAt is `startedAt + class.buildTimeSec × 1000` (overflow-safe,
 * strictly after startedAt). The job id is
 * `fnv1a(`${shipClass}|${count}|${at}|${index}`).toString(16)` where `index`
 * is the new job's queue position (`queue.jobs.length`). Returns a fresh
 * queue; the input queue is never mutated.
 */
export function enqueueShipBuild(
  queue: ShipyardQueue,
  request: ShipBuildRequest,
  fleet: number,
): ShipyardQueue {
  assertValidQueue(queue)
  assertFiniteNonNegative(fleet, 'fleet')
  assertPositiveAt(request.at)

  if (queue.shipyardLevel === 0) {
    throw new Error(
      `cannot enqueue ship build: no-shipyard (shipyard level ${queue.shipyardLevel})`,
    )
  }
  if (!Number.isInteger(request.count) || request.count <= 0) {
    throw new Error(
      `cannot enqueue ship build: invalid-count (count ${request.count} must be a positive integer)`,
    )
  }

  const stats = resolveClass(request)
  const fleetCap = shipyardStateFor(queue.shipyardLevel).fleetCap
  let inFlightCount = 0
  for (const job of queue.jobs) {
    if (job.status === 'building') {
      inFlightCount += job.count
    }
  }
  if (fleet + inFlightCount + request.count > fleetCap) {
    throw new Error(
      `cannot enqueue ship build: fleet-cap (fleet ${fleet} + in-flight ` +
        `${inFlightCount} + new ${request.count} > cap ${fleetCap})`,
    )
  }

  const previous = queue.jobs[queue.jobs.length - 1]
  const startedAt =
    previous === undefined ? request.at : Math.max(request.at, previous.completesAt)
  const durationMs = stats.buildTimeSec * 1000
  const completesAt = startedAt + durationMs
  if (!Number.isFinite(completesAt) || completesAt <= startedAt) {
    throw new RangeError(
      `completesAt (${completesAt}) must be finite and strictly after startedAt ` +
        `(${startedAt}) for ${stats.id} with duration ${durationMs}ms`,
    )
  }

  const index = queue.jobs.length
  const id = fnv1a(
    `${request.shipClass}|${request.count}|${request.at}|${index}`,
  ).toString(16)
  const job: ShipBuildJob = {
    id,
    shipClass: request.shipClass,
    count: request.count,
    startedAt,
    completesAt,
    status: 'building',
  }
  return { shipyardLevel: queue.shipyardLevel, jobs: [...queue.jobs, job] }
}

function compareStartedAtThenId(a: ShipBuildJob, b: ShipBuildJob): number {
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
 * Every building job that is DUE at `at` (inclusive boundary: `completesAt <=
 * at`), ordered deterministically by startedAt then id (FIFO). `at` must be a
 * positive finite number (assertPositiveAt). Returns a fresh array; the queue
 * is never mutated.
 */
export function shipJobsAt(queue: ShipyardQueue, at: number): ShipBuildJob[] {
  assertValidQueue(queue)
  assertPositiveAt(at)
  return queue.jobs
    .filter((job) => job.status === 'building' && job.completesAt <= at)
    .sort(compareStartedAtThenId)
}

/**
 * Advances the queue to `at`: every building job whose `completesAt <= at`
 * transitions to 'done' exactly once. Idempotent — a job already 'done' is
 * never touched, and `completed` contains only the newly-completed jobs.
 * `at` must be a positive finite number (assertPositiveAt). Returns a new
 * queue; the input is never mutated (mirrors queues.ts completeDueJobs).
 */
export function completeShipJobs(
  queue: ShipyardQueue,
  at: number,
): CompleteShipJobsResult {
  assertValidQueue(queue)
  assertPositiveAt(at)
  const completed: ShipBuildJob[] = []
  const jobs = queue.jobs.map((job) => {
    if (job.status === 'building' && job.completesAt <= at) {
      const done: ShipBuildJob = { ...job, status: 'done' }
      completed.push(done)
      return done
    }
    return job
  })
  return {
    queue: { shipyardLevel: queue.shipyardLevel, jobs },
    completed,
  }
}
