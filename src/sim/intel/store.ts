/**
 * Intel STORE (P6-T08) — the per-owner intel store: record, decay, query,
 * re-scout projection and structural invariants. This is the pure data
 * layer behind the intel-safe backend: each player owns a store keyed by
 * target id, and every operation below derives only from its arguments.
 *
 * THE STORE: IntelStore = { ownerId, records } where records maps a targetId
 * to the stored TargetIntel (P6-T02). A TargetIntel carries NO owner — the
 * store is per-owner BY CONSTRUCTION: the caller builds one store per
 * recording player, and storeRecord never reads or writes an owner field on
 * the record. The recording player owns their intel store; the SQL mirror
 * (supabase/migrations/0018_intel.sql) enforces the same ownership at the
 * row level with RLS policies gated on auth.uid() = owner_id.
 *
 * THE RECORD (storeRecord): an immutable UPSERT with recordIntel semantics
 * (P6-T02) lifted to the store level. A target absent from the store is
 * inserted (its sources are deduplicated). A target already present is
 * merged:
 *   * level         = promoteIntel(existing, gained)   — the promotion rule,
 *                       so intel never decreases through a store write;
 *   * lastUpdatedAt = the freshest of the two timestamps — a newer report
 *                       advances the recorded time, an older report never
 *                       regresses it (the store keeps the freshest observed
 *                       moment; a null "never updated" side is ignored);
 *   * sources       = the deduplicated union, existing sources first, then
 *                       the new sources in record order.
 *
 * THE DECAY PASS (storeApplyDecay): applies staleness.applyDecay (P6-T06) to
 * every record at `at`; an expired record (or a never-updated one) returns
 * null and is DROPPED from the new store. Non-expired records keep the same
 * lastUpdatedAt (decay never resets a timestamp — only a fresh record does).
 *
 * THE READ (storeQuery): the store read — the record for a targetId, or null
 * when absent.
 *
 * THE RE-SCOUT PROJECTION (storeRescoutNeeded): the targetIds whose records
 * need a fresh scout at `at` (staleness.needsRescout — stale or expired, a
 * never-updated record included), in deterministic ascending targetId order
 * (code-unit comparison — no environment-dependent string comparison).
 *
 * THE INVARIANTS (storeInvariants): a never-throwing structural report —
 * ownerId non-empty; each map key is a non-empty string EQUAL to the record's
 * targetId (the map key is the uniqueness anchor — the records' targetIds are
 * unique exactly because each key is the record's own id and a JS Map admits
 * no duplicate keys); every record has a valid intel level, a lastUpdatedAt
 * that is null or a positive finite number, and sources that are deduplicated
 * non-empty strings.
 *
 * THE NO-LEAK RULE: the gate projection (pvpGatedView, P6-T07) runs at a
 * server-side RPC boundary and filters through the VIEWER'S OWN store — this
 * module is the per-owner data that the gate reads; the RLS mirror keeps a
 * player's store readable only by that player. The pure decision is in
 * pvp-gate.ts; this module never reveals another owner's records.
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no time-source reads
 * (every timestamp is an INPUT), no I/O. Identical inputs always produce
 * identical (deep-equal) output, and caller-provided objects are never
 * mutated — every store result is a fresh { ownerId, records } pair with a
 * fresh Map and fresh record objects.
 */

import { INTEL_LEVELS, isIntelLevel, promoteIntel } from './levels'
import type { TargetIntel } from './levels'
import { applyDecay, needsRescout } from './staleness'
import { assertNonEmptyString, assertPositiveAt } from '../ui/validate'

/** The per-owner intel store: the recording player's targetId → TargetIntel
 * map. See the module docstring. */
export interface IntelStore {
  ownerId: string
  records: ReadonlyMap<string, TargetIntel>
}

function assertStore(store: IntelStore): void {
  assertNonEmptyString(store.ownerId, 'ownerId')
}

/** Local record validation mirroring pvp-gate's assertIntelRecord, plus the
 * sources rule: every source must be a non-empty string. Returns the trimmed
 * targetId. Violations throw a RangeError. */
function assertIntelRecord(intel: TargetIntel): string {
  const targetId = assertNonEmptyString(intel.targetId, 'intel.targetId')
  if (!isIntelLevel(intel.level)) {
    throw new RangeError(
      `intel.level must be one of ${INTEL_LEVELS.join(', ')}, got ${JSON.stringify(intel.level)}`,
    )
  }
  if (
    intel.lastUpdatedAt !== null &&
    (!Number.isFinite(intel.lastUpdatedAt) || intel.lastUpdatedAt <= 0)
  ) {
    throw new RangeError(
      `intel.lastUpdatedAt must be null or a positive finite number (milliseconds), got ${intel.lastUpdatedAt}`,
    )
  }
  for (const source of intel.sources) {
    assertNonEmptyString(source, 'source')
  }
  return targetId
}

/** The union of two source lists, deduplicated and order-preserving: first
 * occurrences win, so existing sources keep their order and new sources
 * append in record order. */
function dedupeSources(sources: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const source of sources) {
    if (!seen.has(source)) {
      seen.add(source)
      out.push(source)
    }
  }
  return out
}

/** The freshest of two timestamps: null sides are ignored (a never-updated
 * record never regresses a recorded time); when both are set the greater one
 * wins. */
function freshestAt(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return a > b ? a : b
}

/**
 * The immutable upsert. Validation (each throws a RangeError): the store's
 * ownerId and the record's targetId non-empty, the record's level a known
 * intel level, its lastUpdatedAt null or a positive finite number, and every
 * source a non-empty string. The record carries NO owner — the store is
 * per-owner by construction (module docstring), so no owner match is
 * validated here. A target absent from the store is inserted with
 * deduplicated sources; a present target is merged with recordIntel semantics
 * (promote; freshest timestamp; deduplicated source union). The input store
 * and record are never mutated; the result is a fresh store.
 */
export function storeRecord(store: IntelStore, intel: TargetIntel): IntelStore {
  assertStore(store)
  const targetId = assertIntelRecord(intel)
  const existing = store.records.get(targetId)
  const records = new Map(store.records)
  if (existing === undefined) {
    records.set(targetId, {
      targetId,
      level: intel.level,
      lastUpdatedAt: intel.lastUpdatedAt,
      sources: dedupeSources(intel.sources),
    })
    return { ownerId: store.ownerId, records }
  }
  records.set(targetId, {
    targetId,
    level: promoteIntel(existing.level, intel.level),
    lastUpdatedAt: freshestAt(existing.lastUpdatedAt, intel.lastUpdatedAt),
    sources: dedupeSources([...existing.sources, ...intel.sources]),
  })
  return { ownerId: store.ownerId, records }
}

/**
 * The immutable decay pass over the whole store at `at` (`at` validated
 * positive finite by assertPositiveAt; the store's ownerId non-empty).
 * staleness.applyDecay runs per record — an expired record (or a never
 * updated one) returns null and is DROPPED; every other record is re-stored
 * with its decayed level and its SAME lastUpdatedAt (decay never resets a
 * timestamp; only a fresh report does). A malformed stored record raises the
 * RangeError applyDecay throws. Returns a fresh store; the input is never
 * mutated.
 */
export function storeApplyDecay(store: IntelStore, at: number): IntelStore {
  assertStore(store)
  assertPositiveAt(at)
  const records = new Map<string, TargetIntel>()
  for (const [targetId, intel] of store.records) {
    const decayed = applyDecay(intel, at)
    if (decayed !== null) {
      records.set(targetId, decayed)
    }
  }
  return { ownerId: store.ownerId, records }
}

/**
 * The store read: the TargetIntel for a targetId, or null when absent.
 * Validation (RangeError): the store's ownerId non-empty and the targetId
 * non-empty. The input store is never mutated.
 */
export function storeQuery(store: IntelStore, targetId: string): TargetIntel | null {
  assertStore(store)
  const id = assertNonEmptyString(targetId, 'targetId')
  return store.records.get(id) ?? null
}

/**
 * The re-scout projection: the targetIds whose records need a fresh scout at
 * `at` (staleness.needsRescout — stale or expired, a never-updated record
 * included). The order is DETERMINISTIC: targetId ascending by code-unit
 * comparison (never an environment-dependent string comparison). `at`
 * validated positive finite; the store's ownerId non-empty. Returns a fresh
 * array; the input store is never mutated.
 */
export function storeRescoutNeeded(store: IntelStore, at: number): string[] {
  assertStore(store)
  assertPositiveAt(at)
  const result: string[] = []
  for (const [targetId, intel] of store.records) {
    if (needsRescout(intel, at)) {
      result.push(targetId)
    }
  }
  result.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return result
}

/** True when value is iterable (a Map, an array, a Set — the tampered-store
 * guard). Lets storeInvariants enumerate keys and sources without throwing. */
function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function'
  )
}

/**
 * The structural invariant report (never throws): ownerId non-empty; each map
 * key is a non-empty string EQUAL to its record's targetId (the map key is
 * the uniqueness anchor — the records' targetIds are unique exactly because
 * each key is the record's own id and a JS Map admits no duplicate keys);
 * each record's level is a known intel level, its lastUpdatedAt is null or a
 * positive finite number, and its sources are deduplicated non-empty strings.
 * Every field is runtime-guarded — a tampered value (null ownerId, a
 * non-string key, undefined sources, a null level) is reported as a problem,
 * never thrown. Returns { ok, problems } with one human-readable string per
 * violation.
 */
export function storeInvariants(store: IntelStore): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []
  const ownerId = store.ownerId
  if (typeof ownerId !== 'string' || ownerId.trim() === '') {
    problems.push('ownerId must be a non-empty string')
  }
  const records = store.records
  if (!isIterable(records)) {
    problems.push('records must be an iterable map of target records')
    return { ok: false, problems }
  }
  const seen = new Set<string>()
  for (const [key, intel] of records as Iterable<[unknown, unknown]>) {
    if (typeof key !== 'string' || key.trim() === '') {
      problems.push(`record key ${JSON.stringify(key)} must be a non-empty string`)
    }
    if (typeof key === 'string') {
      if (seen.has(key)) {
        problems.push(`duplicate record key ${JSON.stringify(key)}`)
      }
      seen.add(key)
    }
    if (intel === null || typeof intel !== 'object' || Array.isArray(intel)) {
      problems.push(`record ${JSON.stringify(key)} must be a target record object`)
      continue
    }
    const record = intel as {
      targetId?: unknown
      level?: unknown
      lastUpdatedAt?: unknown
      sources?: unknown
    }
    const targetId = record.targetId
    if (typeof targetId !== 'string' || targetId.trim() === '') {
      problems.push('record targetId must be a non-empty string')
    }
    if (targetId !== key) {
      problems.push(
        `record targetId ${JSON.stringify(targetId)} does not match map key ${JSON.stringify(key)}`,
      )
    }
    if (!isIntelLevel(record.level)) {
      problems.push(
        `record level must be one of ${INTEL_LEVELS.join(', ')}, got ${JSON.stringify(record.level)}`,
      )
    }
    const lastUpdatedAt = record.lastUpdatedAt
    if (
      lastUpdatedAt !== null &&
      (typeof lastUpdatedAt !== 'number' ||
        !Number.isFinite(lastUpdatedAt) ||
        lastUpdatedAt <= 0)
    ) {
      problems.push('record lastUpdatedAt must be null or a positive finite number')
    }
    const sources = record.sources
    if (!Array.isArray(sources)) {
      problems.push('record sources must be an array of non-empty strings')
      continue
    }
    const sourceSeen = new Set<string>()
    for (const source of sources) {
      if (typeof source !== 'string' || source.trim() === '') {
        problems.push(
          `record source ${JSON.stringify(source)} must be a non-empty string`,
        )
      }
      if (typeof source === 'string') {
        if (sourceSeen.has(source)) {
          problems.push(
            `record sources must be deduplicated, duplicate ${JSON.stringify(source)}`,
          )
        }
        sourceSeen.add(source)
      }
    }
  }
  return { ok: problems.length === 0, problems }
}
