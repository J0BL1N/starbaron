TASK (StarBaron P5-T08, master roadmap): FLEET UI — fleet list, fleet detail, orders panel state contracts. (Pure UI-state projections — the React components consume them; matches the P4 ui-contract pattern.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/fleet/fleet.ts (P5-T03): Fleet.
- src/sim/fleet/orders.ts (P5-T07): FleetOrders, FleetOrder.
- src/sim/fleet/positioning.ts (P5-T05): PositionedFleet.
- src/sim/fleet/render-state.ts (P5-T06): FleetRenderState, fleetLabel.
- src/sim/fleet/ships.ts (P5-T01): SHIP_CLASSES names.
- src/sim/core/format.ts: formatNumber.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/ui/fleet-panel.ts
- tests/fleet-panel.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no React wiring.

DESIGN SPEC:
1. `FleetListRow = { fleetId: string; label: string; size: number; status: string; location: string; phase: string }` — location deterministic (the fleet's current body ref or 'en route'; document the string forms).
2. `FleetDetail = { fleetId: string; label: string; size: number; composition: { id: ShipClassId; name: string; count: number }[]; status: string; position: { phase: string; progress: number }; activeOrder: { type: string; target: string; status: string } | null; queuedOrders: number }`.
3. `FleetPanelState = { fleets: FleetListRow[]; selectedFleetId: string | null; selected: FleetDetail | null }`.
4. Pure functions:
   - `fleetListState(input: { fleets: readonly Fleet[]; positioned: ReadonlyMap<string, PositionedFleet>; orders: ReadonlyMap<string, FleetOrders>; at: number }): FleetListRow[]` — one row per fleet, ordered by fleetId ascending; label via fleetLabel (no ownerName — document); size via fleetCompositionSize; status from the fleet; location = the fleet's location ref or the positioned phase ('at-destination' → the leg's to ref — READ PositionedFleet shape and use the leg's refs; document).
   - `fleetDetailState(input: { fleet: Fleet; positioned: PositionedFleet; orders: FleetOrders | null; at: number }): FleetDetail` — composition rows in SHIP_CLASS_IDS order; activeOrder from orders.activeOrderId (target string from the order's target ref); queuedOrders = orders.orders.filter(issued).length.
   - `fleetPanelState(input: { fleets: readonly Fleet[]; positioned: ReadonlyMap<string, PositionedFleet>; orders: ReadonlyMap<string, FleetOrders>; selectedFleetId?: string | null; at: number }): FleetPanelState` — list + selection passthrough (null when the id isn't in the list) + detail.
5. Invariants (test): list rows (label/size/status/location/phase); ordering; detail composition order + active order + queued count; selection (present/absent); at validation; determinism; no mutation.

TESTS (vitest, tests/fleet-panel.test.ts, ~26-30): all invariants + edges (no orders map entry, no positioned entry).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/fleet-panel.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
