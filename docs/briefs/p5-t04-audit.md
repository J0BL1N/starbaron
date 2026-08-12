READ-ONLY AUDIT — StarBaron P5-T04 (master roadmap): Fleet Movement.

READ LIST:
- src/sim/fleet/movement.ts    (NEW — under audit)
- tests/movement.test.ts       (NEW — test suite)
- src/sim/fleet/ships.ts       (P5-T01: SHIP_CLASSES speeds)
- src/sim/fleet/fleet.ts       (P5-T03: FleetComposition, fleetCompositionSize)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 511456ba8b7f54e1c54605170d182d00e1564711 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p5-t04-brief.md + master roadmap P5-T04):
1. TravelLeg { fleetId, from/to {kind, bodyId}, distancePc, speedPcPerSec, departureAt, arrivalAt, status }; Position {x,y,z}.
2. distanceBetween (Euclidean); travelDuration (distancePc/speed, distance >= 0, speed > 0, 0 distance → 0s); arrivalTime (ms, overflow-safe: finite AND > departureAt; zero-distance legs REJECTED — documented deviation: arrival would equal departure).
3. planTravel (status 'traveling'); fleetTravelTime (SLOWEST class with count > 0; empty → 0s); isArrived (at >= arrivalAt inclusive).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ the listed modules + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Distance math (hand-computed); duration math (0, 10pc@1.0 → 10s); arrival ms math + overflow-safe.
C. planTravel fields; fleetTravelTime slowest-ship semantics (mixed/single/empty); isArrived inclusive boundary.
D. Validation (bad speed/distance/at, zero-distance leg); determinism; no mutation.
E. Tests ~30 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
