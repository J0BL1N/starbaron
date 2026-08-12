READ-ONLY AUDIT — StarBaron P5-T08 (master roadmap): Fleet UI state contracts.

READ LIST:
- src/sim/ui/fleet-panel.ts    (NEW — under audit)
- tests/fleet-panel.test.ts    (NEW — test suite)
- src/sim/fleet/fleet.ts       (P5-T03)
- src/sim/fleet/orders.ts      (P5-T07)
- src/sim/fleet/positioning.ts (P5-T05)
- src/sim/fleet/render-state.ts (P5-T06: fleetLabel)
- src/sim/fleet/ships.ts       (P5-T01: SHIP_CLASS_IDS)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 5779a75255947022ab61a83ecd7fd118428c8b04 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p5-t08-brief.md + master roadmap P5-T08):
1. FleetListRow { fleetId, label (fleetLabel, no owner), size (fleetCompositionSize), status, location ('kind:bodyId' | 'en route' — leg to-ref when at-destination), phase }; ordered by fleetId asc.
2. FleetDetail { fleetId, label, size, composition (full roster in SHIP_CLASS_IDS order, zero counts included), status, position {phase, progress}, activeOrder|null (target 'kind:id' or 'origin' for return), queuedOrders (issued count) }.
3. fleetPanelState: list + selection passthrough (null when not in list) + detail (only when positioned).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ fleet/* + ui/validate + core/format + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. List rows + ordering; location/phase strings; missing positioned/orders map entries handled.
C. Detail composition order; active order target forms; queuedOrders semantics.
D. Selection passthrough; at validated; determinism; no mutation.
E. Tests ~29 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
