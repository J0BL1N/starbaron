TASK (StarBaron P5-T07, master roadmap): FLEET ORDERS — order types (move/attack/defend/return), order queue, validation, lifecycle (issued → active → done/cancelled), one-active-order semantics.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/fleet/fleet.ts (P5-T03): Fleet status union.
- src/sim/fleet/movement.ts (P5-T04): TravelLeg, planTravel.
- src/sim/planets/hash.ts: fnv1a.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/fleet/orders.ts
- tests/orders.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `FleetOrderType = 'move' | 'attack' | 'defend' | 'return'` (the roadmap's order set; 'attack' lifecycle resolves in P7 combat — this module defines the ORDER model; resolution is the caller's contract).
2. `FleetOrder = { id: string; fleetId: string; type: FleetOrderType; target: { kind: 'planet' | 'system' | 'body'; id: string } | null; issuedAt: number; status: 'issued' | 'active' | 'done' | 'cancelled'; expiresAt: number | null }` — id = fnv1a(`${fleetId}|${type}|${issuedAt}|${index}`) deterministic; target null ONLY for 'return' (return to origin — documented); expiresAt null unless a duration limit is set (return orders may have none — document).
3. `FleetOrders = { fleetId: string; orders: FleetOrder[]; activeOrderId: string | null }` — ONE-ACTIVE-ORDER semantics: at most one 'active' order at a time (the queue).
4. Pure functions:
   - `issueOrder(state: FleetOrders, input: { type: FleetOrderType; target?: { kind; id } | null; issuedAt: number; index?: number; expiresAt?: number | null }): FleetOrders` — immutable; validates: issuedAt positive finite; type/target pairing (move/attack/defend REQUIRE a target — target missing throws; return REQUIRES target null — a non-null target throws); an already-active order for the fleet THROWS (one-active semantics); the NEW order appended with status 'issued'... OR immediately 'active' if no active order exists? DESIGN DECISION: new orders enqueue as 'issued' and are activated by `activateNext` (explicit lifecycle — the caller activates) — document the choice. Index defaults to orders.length (deterministic position).
   - `activateNext(state: FleetOrders, at: number): FleetOrders` — if an active order exists, NO-OP (immutable return); else the first 'issued' order (queue order) becomes 'active' (validated at positive finite).
   - `completeOrder(state: FleetOrders, orderId: string, at: number): FleetOrders` — 'active' → 'done' (only active orders can complete; 'issued'/'done'/'cancelled' throw); at positive finite.
   - `cancelOrder(state: FleetOrders, orderId: string, at: number): FleetOrders` — 'issued' or 'active' → 'cancelled' (done orders cannot be cancelled — throw).
   - `ordersInvariants(state: FleetOrders): { ok: boolean; problems: string[] }` — activeOrderId matches exactly one active order; order ids unique; statuses valid; target pairing valid; expiresAt > issuedAt when present.
5. Invariants (test): type/target pairing (each type); one-active enforcement (second issue while active throws); queue activation order (FIFO); complete/cancel lifecycle (only valid transitions; done cannot cancel); expiresAt validation; id determinism; invariants tamper classes; immutability.

TESTS (vitest, tests/orders.test.ts, ~30-36): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/orders.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (attack resolution deferred to P7).
