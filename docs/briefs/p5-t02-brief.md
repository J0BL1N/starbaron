TASK (StarBaron P5-T02, master roadmap): SHIPYARD — ship construction: build requirements, cost, time, queue integration, fleet cap. (Formal shipyard model over the LOCKED structure pieces.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/structures/effects.ts: LOCKED SHIPYARD_FLEET_CAP_PER_LEVEL=1000, SHIPYARD_INCOME_PER_MIN=50, structureEffect('shipyard', level) → fleetCap = 1000 × effLevel.
- src/sim/structures/data.ts: shipyard buildTimeSec=300, name, description.
- src/sim/structures/framework.ts (P3-T04): buildCost, canBuild (no prereqs after the P3 phase fix).
- src/sim/structures/queues.ts (P3-T07): queueConstruction, ConstructionQueue (the build pipeline).
- src/sim/fleet/ships.ts (P5-T01): SHIP_CLASSES (class build times).
- src/sim/player/accrual.ts: fleetCap clamp (locked).
- src/sim/player/wallet.ts: WalletState.

ALLOWED FILES (create ONLY):
- src/sim/fleet/shipyard.ts
- tests/shipyard.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring. Everything delegates to the locked modules.

DESIGN SPEC:
1. `ShipyardState = { level: number; fleetCap: number; incomePerSec: number; nextBuildCost: number; buildTimeSec: number }`.
2. `ShipBuildRequest = { shipClass: ShipClassId; count: number; at: number }`.
3. `ShipBuildOutcome = { ok: boolean; reason: 'ok' | 'not-enough-credits' | 'not-enough-alloys' | 'fleet-cap' | 'no-shipyard' | 'invalid-count'; fleetAfter: number; cost: { credits: number; alloys: number }; completesAt: number }`.
4. Pure functions:
   - `shipyardStateFor(level: number): ShipyardState` — fleetCap via LOCKED structureEffect('shipyard', level).fleetCap (validate level non-negative integer); incomePerSec = SHIPYARD_INCOME_PER_MIN / 60 (locked const); nextBuildCost via framework.buildCost('shipyard', level); buildTimeSec from data.ts.
   - `canBuildShips(input: { shipyardLevel: number; fleet: number; wallet: WalletState; request: ShipBuildRequest; classStats?: ShipClass }): ShipBuildOutcome` — checks in order: no-shipyard (level 0), invalid-count (count <= 0 or non-integer), fleet-cap (fleet + count > fleetCap), credits, alloys (classStats = SHIP_CLASSES[shipClass] when not supplied — optional param for testability); cost = class cost × count; completesAt = at + class.buildTimeSec × 1000 (validated finite > at — overflow-safe like queues); ok path.
   - `shipBuildCost(request, classStats?): { credits: number; alloys: number }` — class cost × count (validated count positive integer).
5. Invariants (test): shipyardStateFor (fleetCap = 1000 × level — locked; income 50/60; nextBuildCost via framework — hand-compute level 1/3); canBuildShips order (each reason fires on the right state); fleet-cap math (fleet + count vs cap); cost math × count; completesAt overflow-safe; determinism; validation (level negative, count 0/-1/1.5, bad at).

TESTS (vitest, tests/shipyard.test.ts, ~26-30): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/shipyard.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
