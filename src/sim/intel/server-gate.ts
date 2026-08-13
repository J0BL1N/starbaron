/**
 * Server-side intel gate boundary (P6-T08) — the EXACT function the Supabase
 * RPC wraps. The RPC reads auth.uid() → the viewer's OWN intel rows (RLS
 * owner-scoped, 0018_intel.sql) → reconstructs the viewer's IntelStore →
 * calls serverViewFor. This module is the pure decision surface that RPC
 * delegates to; the RPC plumbing itself is backend wiring and lives outside
 * the sim.
 *
 * THE BOUNDARY CONTRACT: serverViewFor reads ONLY the caller-supplied store
 * (the viewer's own — storeQuery over the store keyed by the viewer id), so
 * a projection can never reach a record the viewer does not own. The store
 * must BE the viewer's: a store whose ownerId does not match viewer.viewerId
 * is a caller bug and throws a RangeError (the per-owner store is enforced
 * here, mirroring the RLS owner gate at the row level).
 *
 * THE PIPELINE: serverViewFor looks up the target's record (storeQuery →
 * null when absent), then delegates the viewer × target decision to
 * pvpGatedView (P6-T07) — the combined gate that resolves owner / alliance /
 * stranger / unowned tiers and the intel-store reveal. A stranger with no
 * record for the target resolves to the strict 'no-intel' block; a stranger
 * with an expired record to 'expired-intel'; the reveal NEVER emits an
 * alliance-tier or owner-tier field (the stranger window is the public +
 * intel field sets only). Every timestamp is an INPUT — this module never
 * consults a time source.
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no time-source
 * reads, no I/O. Identical inputs always produce identical (deep-equal)
 * output, and caller-provided objects are never mutated.
 */

import { pvpGatedView } from './pvp-gate'
import type { GatedView } from './pvp-gate'
import type { TargetContext, ViewerContext } from './permissions'
import { storeQuery } from './store'
import type { IntelStore } from './store'
import type { InfoField } from '../ui/info'
import { assertNonEmptyString } from '../ui/validate'

export interface ServerViewInput {
  viewer: ViewerContext
  target: TargetContext
  store: IntelStore
  contractFields: readonly InfoField[]
  values: ReadonlyMap<string, string | number | null>
  at: number
}

/**
 * The server-side viewer × target projection (see the module docstring). The
 * store must belong to the viewer (store.ownerId === viewer.viewerId, else a
 * RangeError) and the target record is read ONLY from that store; the gated
 * view is delegated to pvpGatedView. `at` is validated by the gate
 * (assertPositiveAt) and a non-empty targetId by storeQuery — a violation on
 * either throws a RangeError. The inputs are never mutated.
 */
export function serverViewFor(input: ServerViewInput): GatedView {
  const { viewer, target, store, contractFields, values, at } = input
  const viewerId = assertNonEmptyString(viewer.viewerId, 'viewerId')
  const ownerId = assertNonEmptyString(store.ownerId, 'store.ownerId')
  if (ownerId !== viewerId) {
    throw new RangeError(
      `store.ownerId ${JSON.stringify(ownerId)} does not match ` +
        `viewer.viewerId ${JSON.stringify(viewerId)} — the server gate ` +
        `projects only the viewer's own store`,
    )
  }
  const intel = storeQuery(store, target.targetId)
  return pvpGatedView({
    viewer,
    target,
    intel,
    contractFields: [...contractFields],
    values,
    at,
  })
}
