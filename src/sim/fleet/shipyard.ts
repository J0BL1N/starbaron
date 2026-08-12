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
 *   `at`). `at` is an input — no wall clock.
 * - **Check order** in canBuildShips (reason ladder): no-shipyard →
 *   invalid-count → fleet-cap → not-enough-credits → not-enough-alloys → ok.
 *   Validation errors (non-non-negative-integer level, non-finite fleet or
 *   wallet, non-positive `at`, overflowing completesAt) throw RangeError;
 *   only the six ladder reasons are returned as outcomes.
 *
 * Pure module — deterministic, no wall clock (timestamps are inputs), no
 * nondeterministic APIs, no module-level mutable state, strictly typed.
 */

import { SHIP_CLASSES } from './ships'
import type { ShipClass, ShipClassId } from './ships'
import { STRUCTURES } from '../structures/data'
import { SHIPYARD_INCOME_PER_MIN, structureEffect } from '../structures/effects'
import { buildCost } from '../structures/framework'
import type { WalletState } from '../player/types'

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

function assertFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a finite number > 0, got ${value}`)
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${field} must be a finite non-negative number, got ${value}`,
    )
  }
}

function assertValidCount(count: number): void {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`count must be a positive integer, got ${count}`)
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
  assertFinitePositive(request.at, 'at')

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
