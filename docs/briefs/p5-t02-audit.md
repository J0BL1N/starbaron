READ-ONLY AUDIT — StarBaron P5-T02 (master roadmap): Shipyard.

READ LIST:
- src/sim/fleet/shipyard.ts     (NEW — under audit)
- tests/shipyard.test.ts        (NEW — test suite)
- src/sim/structures/effects.ts (SHIPYARD_FLEET_CAP_PER_LEVEL, structureEffect — locked)
- src/sim/structures/framework.ts (buildCost)
- src/sim/structures/data.ts    (shipyard buildTimeSec)
- src/sim/fleet/ships.ts        (P5-T01: SHIP_CLASSES)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 1f62244032ade27117a10e9c6bf71febe2151cd5 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p5-t02-brief.md + master roadmap P5-T02):
1. ShipyardState { level, fleetCap (LOCKED 1000×level via structureEffect), incomePerSec (SHIPYARD_INCOME_PER_MIN/60), nextBuildCost (framework), buildTimeSec (data) }.
2. ShipBuildRequest { shipClass, count, at }; ShipBuildOutcome { ok, reason ladder: no-shipyard → invalid-count → fleet-cap → not-enough-credits → not-enough-alloys → ok, fleetAfter, cost (class × count), completesAt (overflow-safe, > at) }.
3. shipBuildCost (class cost × count, validated).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ the listed modules + stdlib; no re-derived formulas.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. fleetCap = 1000 × level (locked path, hand-compute level 1/3); income 50/60; nextBuildCost via framework.
C. Reason ladder order (each fires on the right state); fleet-cap math; cost × count; completesAt overflow-safe (reject finite-but-not-greater).
D. Validation (negative level, count 0/-1/1.5, bad at); determinism; no mutation.
E. Tests ~30 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
