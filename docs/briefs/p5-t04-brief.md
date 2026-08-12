TASK (StarBaron P5-T04, master roadmap): FLEET MOVEMENT — travel mechanics: origin, destination, speed, arrival time, departure, travel-time calculation. (The movement model over the world graph positions — the position querying belongs to the caller; this module computes travel math from POSITIONS as inputs.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/fleet/ships.ts (P5-T01): SHIP_CLASSES speedPcPerSec (draft).
- src/sim/fleet/fleet.ts (P5-T03): Fleet, FleetComposition, fleetCompositionSize.
- src/sim/world/api.ts: queryBody (position lookup — the CALLER passes positions; this module does NOT query).
- src/sim/world/body.ts: BodyRecord (position field — READ the exact position shape).
- DESIGN.md §5: travel time = real distance (read the travel section ~line 157-186).

ALLOWED FILES (create ONLY):
- src/sim/fleet/movement.ts
- tests/movement.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `TravelLeg = { fleetId: string; from: { kind: 'planet' | 'system'; bodyId: string }; to: { kind: 'planet' | 'system'; bodyId: string }; distancePc: number; speedPcPerSec: number; departureAt: number; arrivalAt: number; status: 'traveling' | 'arrived' }`.
2. `Position = { x: number; y: number; z: number }`.
3. Pure functions:
   - `distanceBetween(a: Position, b: Position): number` — Euclidean distance (deterministic, documented: parsecs are world units in this model).
   - `travelDuration(distancePc: number, speedPcPerSec: number): number` — SECONDS = distancePc / speedPcPerSec (validate distance >= 0, speed > 0 finite; distance 0 → 0s).
   - `arrivalTime(departureAt: number, distancePc: number, speedPcPerSec: number): number` — departureAt + duration × 1000 (ms); overflow-safe (reject unless finite AND > departureAt — mirror queues.ts).
   - `planTravel(input: { fleetId: string; from: Position; fromRef: { kind: 'planet' | 'system'; bodyId: string }; to: Position; toRef: { kind: 'planet' | 'system'; bodyId: string }; speedPcPerSec: number; departureAt: number }): TravelLeg` — distance from positions; arrival = arrivalTime; status 'traveling'.
   - `fleetTravelTime(composition: FleetComposition, distancePc: number): number` — the fleet's travel time = distance / SLOWEST class speed in the composition (the fleet moves at its slowest ship — document); composition with zero ships → 0? NO — zero ships = empty fleet → 0s (documented; validation still on composition shape); if composition has ships, slowest = min speedPcPerSec over classes with count > 0.
   - `isArrived(leg: TravelLeg, at: number): boolean` — at >= arrivalAt (validated finite).
4. Invariants (test): distance math (hand-computed simple coords); travelDuration (0 distance, 10pc @ 1.0 → 10s); arrivalTime ms math + overflow-safe; planTravel fields; fleetTravelTime (mixed fleet uses slowest; single class; empty → 0); isArrived boundary (exactly arrivalAt → true); determinism; validation (bad speeds/distance/at).

TESTS (vitest, tests/movement.test.ts, ~26-30): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/movement.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
