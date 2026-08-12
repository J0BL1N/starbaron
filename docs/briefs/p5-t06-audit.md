READ-ONLY AUDIT — StarBaron P5-T06 (master roadmap): Fleet Rendering state contract.

READ LIST:
- src/sim/fleet/render-state.ts   (NEW — under audit)
- tests/render-state.test.ts      (NEW — test suite)
- src/sim/fleet/fleet.ts          (P5-T03: FleetComposition, fleetCompositionSize)
- src/sim/fleet/positioning.ts    (P5-T05: PositionedFleet)
- src/sim/fleet/ships.ts          (P5-T01: SHIP_CLASSES names)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT fe920895ce7d185aa2de8bbad3b2ede20405fef8 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p5-t06-brief.md + master roadmap P5-T06):
1. FleetRenderState { fleetId, label (ownerName-prefixed deterministic), position (fresh copy, validated), draw { totalShips, perClass [{id, name, count, drawCount}] }, scaleHint (1 + log10(total)/10 clamped [1,2]; NOTE: 1M ships → 1.6, 2.0 at 10^10 — the FORMULA is authoritative, the brief's 1M→2.0 example was an error), statusHint }.
2. LOD drawCount: proportional downsampling with MAX_RENDERED_SHIPS=60 (ratio 1 when total <= 60; tiny classes can round to 0 — documented); sum of drawCounts <= cap.
3. fleetLabel shared helper (render state agrees).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ fleet/* + ui/validate + stdlib; NO Three.js/scene imports.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Label determinism + ownerName handling; position fresh copy (no aliasing).
C. LOD math: cap at 60 (hand-computed 120 scouts → 60; 10 ships → all); proportional per-class; sum <= cap.
D. scaleHint formula + clamp (1.0 at 0-1 ships, 1.6 at 1M, 2.0 at 10^10, clamp beyond); statusHint.
E. at validated but provably output-neutral; tests ~33 covering; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
