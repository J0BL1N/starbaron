import type { BodyId } from '../world/identity'
import { parseCanonicalId } from '../world/identity'

/**
 * Planet ownership (P2-T04): the pure model of WHO owns a world, HOW they
 * acquired it, and the immutable audit trail of every change of hands.
 *
 * The game is deterministic: every timestamp is a caller-supplied INPUT (a
 * finite epoch-ms number), never the wall clock, so every function here is a
 * pure function of its arguments — no module-level mutable state, no
 * nondeterminism, no I/O.
 *
 * Ownership rules (locked with DESIGN §5/§6 and the P2-T03 protection model,
 * src/sim/player/protection.ts):
 *   - a home world is acquired ONLY by 'home-assignment' (isHome implies
 *     method 'home-assignment') — the home IS the first world;
 *   - the two flags ALWAYS AGREE: ownershipFor enforces isHome ===
 *     unconquerable (exact parity, mirroring the 0016 DB CHECK
 *     is_home = unconquerable). A home is always unconquerable and only a
 *     home is, so a "declassified" isHome=true/unconquerable=false record
 *     cannot be constructed — protection cannot be bypassed at transfer time;
 *   - an unconquerable world can never change hands — transferOwnership
 *     throws, mirroring the 0014 DB guard (now irreversible: 0016 also blocks
 *     is_home/unconquerable flag flips on a protected row) that aborts the
 *     same transfer in SQL. transferOwnership keys ONLY on unconquerable,
 *     exactly like the DB guard and deriveProtection (protected iff isHome
 *     AND unconquerable).
 *
 * The audit event (OwnershipEvent) is the persistence contract for
 * supabase/migrations/0015_ownership_audit.sql: bodyId, from/to owners,
 * epoch-ms timestamp and acquisition method map 1:1 onto an
 * ownership_audit row.
 */
export const ACQUISITION_METHODS = [
  'home-assignment',
  'colonisation',
  'conquest',
  'trade',
] as const

export type AcquisitionMethod = (typeof ACQUISITION_METHODS)[number]

export interface OwnershipRecord {
  bodyId: BodyId
  ownerId: string
  previousOwnerId: string | null
  acquiredAt: number
  acquisitionMethod: AcquisitionMethod
  isHome: boolean
  unconquerable: boolean
}

export interface OwnershipEvent {
  bodyId: BodyId
  fromOwnerId: string | null
  toOwnerId: string
  at: number
  method: AcquisitionMethod
}

function isAcquisitionMethod(value: string): value is AcquisitionMethod {
  return (ACQUISITION_METHODS as readonly string[]).includes(value)
}

function assertPositiveTime(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${field} must be a finite number greater than 0, got: ${String(value)}`,
    )
  }
  return value
}

function assertOwnerId(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new RangeError(`${field} must be a non-empty string, got: ${String(value)}`)
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new RangeError(`${field} must be a non-empty string`)
  }
  return trimmed
}

function assertBodyId(value: unknown, field: string): BodyId {
  if (typeof value !== 'string') {
    throw new RangeError(`${field} must be a valid body id, got: ${String(value)}`)
  }
  const parsed = parseCanonicalId(value)
  if (!parsed.ok || parsed.kind !== 'body') {
    throw new RangeError(`${field} must be a valid body id, got: ${String(value)}`)
  }
  return parsed.id
}

/**
 * Build an ownership record at acquisition time. Validates every input before
 * producing a fresh record: acquiredAt must be a finite number > 0; ownerId
 * must be non-empty; previousOwnerId, when present, must differ from ownerId;
 * method must be in the AcquisitionMethod union; isHome REQUIRES the method
 * 'home-assignment'; unconquerable REQUIRES isHome; and isHome REQUIRES
 * unconquerable — exact parity (isHome === unconquerable, mirroring the 0016
 * DB CHECK is_home = unconquerable), so a home can never be declassified.
 */
export function ownershipFor(
  bodyId: BodyId,
  ownerId: string,
  previousOwnerId: string | null,
  acquiredAt: number,
  method: AcquisitionMethod,
  isHome: boolean,
  unconquerable: boolean,
): OwnershipRecord {
  const validBody = assertBodyId(bodyId, 'bodyId')
  const validOwner = assertOwnerId(ownerId, 'ownerId')
  const validPrevious =
    previousOwnerId === null ? null : assertOwnerId(previousOwnerId, 'previousOwnerId')
  const validAt = assertPositiveTime(acquiredAt, 'acquiredAt')
  if (!isAcquisitionMethod(method)) {
    throw new RangeError(
      `method must be one of: ${ACQUISITION_METHODS.join(', ')}, got: ${String(method)}`,
    )
  }
  if (validPrevious === validOwner) {
    throw new RangeError('previousOwnerId must differ from ownerId')
  }
  if (isHome && method !== 'home-assignment') {
    throw new RangeError(
      `isHome requires acquisitionMethod 'home-assignment', got: ${method}`,
    )
  }
  if (unconquerable && !isHome) {
    throw new RangeError('unconquerable requires isHome')
  }
  if (isHome && !unconquerable) {
    throw new RangeError('isHome requires unconquerable: a home is always protected')
  }
  return {
    bodyId: validBody,
    ownerId: validOwner,
    previousOwnerId: validPrevious,
    acquiredAt: validAt,
    acquisitionMethod: method,
    isHome,
    unconquerable,
  }
}

/**
 * Transfer a world to a new owner. Immutable: the input record is untouched and
 * a fresh record is returned (previousOwnerId = record.ownerId, acquiredAt =
 * at, acquisitionMethod = method; bodyId/isHome/unconquerable carry through).
 * The matching audit event is returned alongside. Throws when the record is
 * unconquerable (P2-T03 integration — a protected home can never change
 * hands), when the recipient equals the current owner (a transfer must change
 * hands), or when the transfer inputs are invalid.
 */
export function transferOwnership(
  record: OwnershipRecord,
  toOwnerId: string,
  at: number,
  method: AcquisitionMethod,
): { updated: OwnershipRecord; event: OwnershipEvent } {
  if (record.unconquerable) {
    throw new RangeError(
      `cannot transfer ${record.bodyId}: unconquerable (protected)`,
    )
  }
  if (!isAcquisitionMethod(method)) {
    throw new RangeError(
      `method must be one of: ${ACQUISITION_METHODS.join(', ')}, got: ${String(method)}`,
    )
  }
  const validTo = assertOwnerId(toOwnerId, 'toOwnerId')
  const validAt = assertPositiveTime(at, 'at')
  if (validTo === record.ownerId) {
    throw new RangeError('toOwnerId must differ from the current owner')
  }
  const updated: OwnershipRecord = {
    ...record,
    ownerId: validTo,
    previousOwnerId: record.ownerId,
    acquiredAt: validAt,
    acquisitionMethod: method,
  }
  const event: OwnershipEvent = {
    bodyId: record.bodyId,
    fromOwnerId: record.ownerId,
    toOwnerId: validTo,
    at: validAt,
    method,
  }
  return { updated, event }
}

/**
 * Immutable append: returns a new array with event as the last element. The
 * input array and the event object are never mutated.
 */
export function historyAppend(
  history: readonly OwnershipEvent[],
  event: OwnershipEvent,
): OwnershipEvent[] {
  return [...history, event]
}

/**
 * The audit trail for one body, oldest-first: filtered to the body, ordered by
 * `at` ascending, ties broken by input order (explicit index sort — fully
 * deterministic regardless of the engine's sort stability).
 */
export function ownershipHistory(
  history: readonly OwnershipEvent[],
  bodyId: BodyId,
): OwnershipEvent[] {
  return history
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.bodyId === bodyId)
    .sort((a, b) => a.event.at - b.event.at || a.index - b.index)
    .map(({ event }) => event)
}

/**
 * The current owner of a body: the most recent event's toOwnerId for that
 * body (the last entry of ownershipHistory), or null when it has no events.
 */
export function currentOwner(
  history: readonly OwnershipEvent[],
  bodyId: BodyId,
): string | null {
  const events = ownershipHistory(history, bodyId)
  const last = events[events.length - 1]
  return last === undefined ? null : last.toOwnerId
}
