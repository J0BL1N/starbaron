TASK (StarBaron P5-T06, master roadmap): FLEET RENDERING — the render-state CONTRACT: draw data derived from fleet state (composition, position, phase), LOD draw counts, orientation/scale hints, label data. (The pure contract the renderer consumes per frame; the Kimi K3 visual-language pass (ship MESH art) defers to P12 — the roadmap's P5-T06 is the draw-state contract, documented.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/fleet/fleet.ts (P5-T03): Fleet, FleetComposition, fleetCompositionSize.
- src/sim/fleet/positioning.ts (P5-T05): PositionedFleet, FleetPosition.
- src/sim/fleet/ships.ts (P5-T01): SHIP_CLASSES (names).
- src/sim/fleet/movement.ts (P5-T04): TravelLeg.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/fleet/render-state.ts
- tests/render-state.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no Three.js/rendering imports (the renderer consumes this data; the contract never touches the scene).

DESIGN SPEC:
1. `FleetRenderState = { fleetId: string; label: string; position: FleetPosition; draw: { totalShips: number; perClass: { id: ShipClassId; name: string; count: number; drawCount: number }[] }; scaleHint: number; statusHint: string }`.
2. Pure functions:
   - `fleetRenderState(input: { positioned: PositionedFleet; composition: FleetComposition; ownerName?: string; at: number }): FleetRenderState` — label = `${ownerName ? ownerName + ' ' : ''}Fleet ${fleetId.slice(0, 8)}` (deterministic); position passthrough (validated); draw = per-class counts (from composition) with drawCount LOD cap: TOTAL render cap exported const MAX_RENDERED_SHIPS = 60; per-class drawCount = round(count × (total <= cap ? 1 : cap/total)) — deterministic proportional downsampling (document: the visual LOD — full counts stay in the model); ensure at least 1 drawn ship per non-empty class? NO — keep the pure proportional math (document: 0-count classes absent; tiny fleets draw all). scaleHint = 1 + log10(totalShips)/10 (clamped 1.0..2.0 — deterministic size cue; document as a draft hint, P12 art refines).
   - `fleetLabel(fleet: Fleet, ownerName?: string): string` — the deterministic label (exported separately for tests/UI reuse).
3. Invariants (test): label determinism (same inputs → same string; ownerName included/excluded); draw per-class from composition + LOD cap (60: fleet of 120 scouts → drawCount total 60, each class scaled; fleet of 10 → all drawn); proportional math (hand-computed 2-class mix); scaleHint clamp (1 ship → 1.0; 1M ships → 2.0); position passthrough; validation (bad at, bad composition); determinism; no mutation.

TESTS (vitest, tests/render-state.test.ts, ~24-28): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/render-state.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (mesh art deferred to P12/Kimi K3; scaleHint draft).
