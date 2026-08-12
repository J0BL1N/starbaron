READ-ONLY AUDIT — StarBaron P5-T09 (master roadmap): Travel Routes.

READ LIST:
- src/sim/fleet/routes.ts     (NEW — under audit)
- tests/routes.test.ts        (NEW — test suite)
- src/sim/fleet/movement.ts   (P5-T04: distanceBetween, travelDuration, planTravel, arrivalTime)
- src/sim/ui/validate.ts      (assertPositiveAt)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 289489a9663bd13f0ae06d1dab0bd4bc5654e1ae (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p5-t09-brief.md + master roadmap P5-T09):
1. TravelRoute { fleetId, waypoints, legs (count = waypoints − 1, chained: leg i+1 departs at leg i's arrival), totalDistancePc (Σ), totalDurationSec (Σ), departureAt, arrivalAt (final leg, overflow-safe) }.
2. planRoute: rejects <2 waypoints; zero-distance/duplicate consecutive pairs (identical ref OR position); non-finite positions; non-positive speed/departureAt; non-consecutive revisits allowed (documented).
3. routeEta { remainingMs (clamped 0), remainingPc (proportional clamped), done (at >= arrival) }; routeLegIndex (half-open [departure, arrival); pre-departure → 0; boundary → next; post-arrival → legs.length sentinel).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ fleet/movement + ui/validate + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Leg chaining (departure continuity); totals (Σ distance, Σ duration — hand-compute a 3-waypoint route); arrivalAt overflow-safe.
C. Rejections (1 waypoint, duplicate consecutive, bad speed/at); arrivalAt > departureAt.
D. routeEta math (before/during/after, clamped, proportional hand-computed); routeLegIndex windows + boundaries + sentinel.
E. Tests ~39 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
