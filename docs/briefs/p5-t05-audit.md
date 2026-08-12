READ-ONLY AUDIT — StarBaron P5-T05 (master roadmap): Timestamp-Based Positioning.

READ LIST:
- src/sim/fleet/positioning.ts   (NEW — under audit)
- tests/positioning.test.ts      (NEW — test suite)
- src/sim/fleet/movement.ts      (P5-T04: TravelLeg)
- src/sim/fleet/fleet.ts         (P5-T03: Fleet)
- src/sim/ui/validate.ts         (assertPositiveAt — shared)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 20dd6f744bb7be9911d69a330774d867f60c6ff1 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p5-t05-brief.md + master roadmap P5-T05):
1. FleetPosition { x,y,z, phase at-origin|traveling|at-destination, progress clamped 0..1 }; PositionedFleet { fleetId, position, leg|null }.
2. positionAt: leg null → at-origin/origin/0; pre-departure clamp; traveling = LINEAR interpolation (progress = (at-departure)/(arrival-departure) clamped); post-arrival → destination/1; boundary: at==departureAt → traveling/0, at==arrivalAt → at-destination/1 (documented + tested).
3. interpolate (pure linear, progress validated); legEvents { departure, arrival } (takes resolved positions — leg carries refs only; documented).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ fleet/* + ui/validate + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Interpolation math (hand-computed midpoint); phase/progress at every window incl. exact boundaries.
C. leg null path; at validation via the shared assertPositiveAt; leg timestamp validation.
D. legEvents fields; determinism; no mutation/aliasing of inputs.
E. Tests ~30 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
