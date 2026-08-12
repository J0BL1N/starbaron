TASK (StarBaron P5-T05, master roadmap): TIMESTAMP-BASED POSITIONING — deterministic position at any timestamp, interpolation between legs, arrival/departure events, no per-frame state. (The pure position-model — the renderer calls positionAt(fleet, at) per frame.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/fleet/movement.ts (P5-T04): TravelLeg, planTravel, isArrived.
- src/sim/fleet/fleet.ts (P5-T03): Fleet.
- src/sim/world/body.ts: BodyRecord position (world units).
- src/sim/ui/validate.ts (P4 phase fix): assertPositiveAt (shared validator — USE it).

ALLOWED FILES (create ONLY):
- src/sim/fleet/positioning.ts
- tests/positioning.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no rendering wiring.

DESIGN SPEC:
1. `FleetPosition = { x: number; y: number; z: number; phase: 'at-origin' | 'traveling' | 'at-destination'; progress: number }` — progress = 0 at departure, 1 at arrival (clamped).
2. `PositionedFleet = { fleetId: string; position: FleetPosition; leg: TravelLeg | null }` — leg null when idle at origin (no active leg).
3. Pure functions:
   - `positionAt(input: { fleet: Fleet; origin: Position; destination: Position; leg: TravelLeg | null; at: number }): PositionedFleet` — DETERMINISTIC: leg null → phase 'at-origin', position = origin, progress 0; leg with at < departureAt → 'at-origin' (clamped, progress 0 — the fleet hasn't left); departureAt <= at < arrivalAt → 'traveling' + LINEAR INTERPOLATION between origin/destination (progress = (at - departureAt)/(arrivalAt - departureAt), clamped [0,1]; position = origin + (destination - origin) × progress — deterministic, no easing, the roadmap's 'no per-frame state'); at >= arrivalAt → 'at-destination', position = destination, progress 1. Validation: at finite (assertPositiveAt via the shared validator — import from ../ui/validate).
   - `interpolate(from: Position, to: Position, progress: number): Position` — pure linear interpolation (progress validated 0..1 finite); exported for tests.
   - `legEvents(leg: TravelLeg): { departure: { at: number; position: Position }; arrival: { at: number; position: Position } }` — the arrival/departure EVENT contract (the caller wires notifications via P4-T07).
4. Invariants (test): leg null → origin/at-origin/0; pre-departure clamp; traveling midpoint (progress 0.5 → midpoint coords); post-arrival → destination/1; exact boundaries (at == departureAt → traveling progress 0? — define: at == departureAt → 'traveling' with progress 0 (departed); at == arrivalAt → 'at-destination' progress 1 — document + test); interpolation math (hand-computed); legEvents fields; determinism; validation (bad at).

TESTS (vitest, tests/positioning.test.ts, ~26-30): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/positioning.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
