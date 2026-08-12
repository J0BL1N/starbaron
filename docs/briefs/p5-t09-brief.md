TASK (StarBaron P5-T09, master roadmap): TRAVEL ROUTES — route planning between systems, multi-leg routes, waypoints, distance accumulation, ETA.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/fleet/movement.ts (P5-T04): distanceBetween, travelDuration, planTravel, TravelLeg, Position.
- src/sim/fleet/fleet.ts (P5-T03): fleetTravelTime — wait, fleetTravelTime is in movement.ts (P5-T04). READ the exact exports.
- src/sim/world/api.ts: querySystem positions (the CALLER supplies positions; this module is position-pure).
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/fleet/routes.ts
- tests/routes.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `Waypoint = { ref: { kind: 'planet' | 'system'; bodyId: string }; position: Position }`.
2. `TravelRoute = { fleetId: string; waypoints: Waypoint[]; legs: TravelLeg[]; totalDistancePc: number; totalDurationSec: number; departureAt: number; arrivalAt: number }` — legs computed sequentially: leg i from waypoint i to i+1 (duration via travelDuration at the fleet's speed); totalDistance = sum; arrivalAt = departure + total × 1000 (overflow-safe: finite AND > departureAt — reject zero-total routes? A route with 1 waypoint (no movement) → totalDistance 0 — REJECT with descriptive Error (documented: a route needs at least 2 waypoints).
3. Pure functions:
   - `planRoute(input: { fleetId: string; waypoints: readonly Waypoint[]; speedPcPerSec: number; departureAt: number }): TravelRoute` — validate: >= 2 waypoints; consecutive waypoints with IDENTICAL refs/positions → throw (zero-distance leg — matches movement.ts's zero-distance rejection); each position finite; speed > 0; departureAt positive finite; legs = per-segment planTravel-equivalent (reuse movement.planTravel per segment — READ its signature; if it needs from/to refs + positions, pass them); totalDistance = Σ distanceBetween; totalDuration = Σ travelDuration; arrivalAt overflow-safe.
   - `routeEta(route: TravelRoute, at: number): { remainingMs: number; remainingPc: number; done: boolean }` — remaining = arrivalAt − at (clamped 0); done = at >= arrivalAt; remainingPc = totalDistance × (remainingMs / (arrivalAt − departureAt)) — proportional (clamped 0..total); validated at positive finite.
   - `routeLegIndex(route: TravelRoute, at: number): number` — which leg the fleet is on at `at` (0-based; before departure → 0; at/after arrival → legs.length − 1... or −1 sentinel? DESIGN DECISION: before departure → 0 (first leg), after arrival → legs.length (one past — documented 'route complete' sentinel); within → the leg whose [departureAt, arrivalAt) window contains at; leg boundaries: at == leg.arrivalAt → NEXT leg (documented).
4. Invariants (test): planRoute (2+ waypoints; leg count = waypoints − 1; distances sum; duration sum; arrivalAt math + overflow; zero-distance/duplicate-waypoint rejection; <2 waypoints rejection); routeEta (before/during/after; clamped; proportional math hand-computed); routeLegIndex (all windows + boundaries); determinism; validation.

TESTS (vitest, tests/routes.test.ts, ~30-36): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/routes.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
