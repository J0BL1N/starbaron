READ-ONLY WHOLE-PHASE AUDIT — StarBaron PHASE 5 (Fleets & Space Travel), cross-task coherence.

READ LIST (all Phase 5 deliverables):
- src/sim/fleet/ships.ts + tests/ships.test.ts            (T01 ship definitions)
- src/sim/fleet/shipyard.ts + tests/shipyard.test.ts      (T02 shipyard)
- src/sim/fleet/fleet.ts + tests/fleet.test.ts            (T03 fleet creation)
- src/sim/fleet/movement.ts + tests/movement.test.ts      (T04 movement)
- src/sim/fleet/positioning.ts + tests/positioning.test.ts (T05 timestamp positioning)
- src/sim/fleet/render-state.ts + tests/render-state.test.ts (T06 render state)
- src/sim/fleet/orders.ts + tests/orders.test.ts          (T07 fleet orders)
- src/sim/ui/fleet-panel.ts + tests/fleet-panel.test.ts   (T08 fleet UI)
- src/sim/fleet/routes.ts + tests/routes.test.ts          (T09 travel routes)
- src/sim/fleet/persistence.ts + tests/persistence.test.ts (T10 persistence)
- supabase/migrations/0017_fleets.sql + supabase/tests/11_fleets.sql (write-only)
- Locked sources: structures/effects.ts (SHIPYARD_*), structures/framework.ts, player/accrual.ts, world/api.ts, core/format.ts, planets/hash.ts, ui/validate.ts

AUDIT TARGET: the whole Phase 5 feature set on staging (through the P5-T10 PASS state). Docs commits OUT OF SCOPE.

BANNED COMMENT TOKENS (scan comments too): any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

CHECK — CROSS-TASK COHERENCE:
A. LOCKED-FORMULA DISCIPLINE: fleet modules delegate to the locked sources (SHIPYARD_* fleetCap/income, framework costs, accrual) — no re-derived economy formulas in src/sim/fleet/.
B. ID/DETERMINISM: fnv1a is the ONLY hash; ids deterministic (fleet id, order id); no nondeterministic APIs; no module-level MUTABLE state (deep-frozen tables — ships.ts roster, render-state tables).
C. SHARED CONVENTIONS: the ui/validate assertPositiveAt is used everywhere (no local copies); sort conventions consistent (at desc, id tie-break where sorting by time); unknown-id operations throw RangeError with one message style; no duplicated logic (compare movement/routes math; orders/hud alert sorting).
D. TIMELINE CONSISTENCY: movement arrival (overflow-safe) ↔ positioning boundary contract (at==arrivalAt → at-destination) ↔ routes chaining (leg i+1 departs at leg i arrival) ↔ orders lifecycle — verify the SAME timestamp semantics across movement/positioning/routes/orders/persistence (no ms/s drift; the ×1000 convention uniform).
E. FLEET MODEL CONSISTENCY: FleetComposition shape used identically across fleet.ts (size/cost), shipyard (cap check), render-state (LOD), fleet-panel (list/detail), persistence (snapshot) — one composition source; status unions consistent (fleet.status vs order status vs leg status never conflated).
F. PERSISTENCE ROUND-TRIP: serialize/deserialize covers the FULL fleet state graph (fleet + orders + routes incl. leg fleetId cross-checks); the write-only SQL schema mirrors the TS shapes (composition jsonb, location jsonb, target jsonb, waypoints jsonb; CHECK constraints; RLS owner-gate).
G. GAP SCAN vs the roadmap's P5 subtask list (classes/costs/speed/cargo/combat/scouting/tech modifiers; construction/requirements/cost/time/queue/cap; composition/object model/cost/timing/validation; origin/destination/speed/arrival/departure; deterministic position/interpolation/events/no per-frame state; draw data/LOD/orientation/labels; order types/queue/validation/lifecycle; list/detail/orders panel; multi-leg routes/waypoints/distance/ETA; serialization/round-trip) — flag any subtask with NO implementation surface.
H. No duplicated logic across the 10 modules.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix, implicated task). PASS → phase-level invariants verified. Keep under ~1300 words.
