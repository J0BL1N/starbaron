READ-ONLY AUDIT — StarBaron P6-T04 (master roadmap): Scout Missions.

READ LIST:
- src/sim/intel/missions.ts    (NEW — under audit)
- tests/missions.test.ts       (NEW — test suite)
- src/sim/fleet/movement.ts    (P5-T04: arrivalTime, fleetTravelTime — delegated)
- src/sim/intel/scouts.ts      (P6-T03: canScout)
- src/sim/intel/levels.ts      (P6-T02: recordIntel semantics, IntelLevel)
- src/sim/planets/hash.ts      (fnv1a)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT e29b4f9a1a2aac6db520d9744df475fa1b6603f6 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p6-t04-brief.md + master roadmap P6-T04):
1. ScoutMission { id (fnv1a(ownerId|fleetId|launchAt|targetId)), ownerId, fleetId, targetRef, launchAt, arrivalAt (overflow-safe via movement.arrivalTime — DELEGATED), scanCompletesAt (arrival + 30s × 1000), status launched|traveling|scanning|reported|destroyed|failed, recordedLevel }.
2. launchScoutMission: preflight canScout (else Error 'failed'); speed = fleet slowest-ship (movement.fleetTravelTime inverted) or override; status 'launched'.
3. missionStatusAt: half-open windows (at==launchAt→traveling; at==arrivalAt→scanning; at==scanCompletesAt→reported); destroyed/failed short-circuit 'lost'.
4. recordMissionIntel: REPORT step only from scanning/reported; returns promoted mission + TargetIntel delta (caller merges via recordIntel — documented); re-record promotes (never decreases). abortMission: launched/traveling/scanning→failed; terminal throws.
5. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ fleet/movement + fleet/ships + fleet/fleet (PURE — CONTRACT CORRECTION: FleetComposition/Fleet + SHIP_CLASSES are the composition source; type-or-value as needed) + intel/* + planets/hash + ui/validate + stdlib; banned comment tokens absent.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Arrival/scan math (hand-computed); overflow-safe arrival; id determinism.
C. Status windows + boundaries; destroyed/failed short-circuit; preflight rejection.
D. recordMissionIntel state machine + promotion; abort transitions (valid/invalid); TargetIntel delta shape; immutability.
E. Tests ~36 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
