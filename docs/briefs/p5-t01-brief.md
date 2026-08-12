TASK (StarBaron P5-T01, master roadmap): SHIP DEFINITIONS — ship classes, costs, speed, cargo, combat stats, scouting stats, future tech modifiers. (The class ROSTER module; P7 wires the locked combat model — DESIGN's soldier-fleet AP model stays the combat basis.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/structures/effects.ts: LOCKED SHIPYARD_FLEET_CAP_PER_LEVEL, SHIPYARD_INCOME_PER_MIN (fleet cap = 1,000 × shipyard levels).
- src/sim/player/accrual.ts: fleet cap clamp, fleet counts.
- src/sim/core/transactions.ts (P3-T01): cost validation patterns (amount finite > 0).
- DESIGN.md: the fleet model (deployed soldiers, AP = fleet × shipyard tier, launch costs) — READ lines ~108-160; the ship CLASS roster is the roadmap's addition ON TOP of that model (classes = how fleets are composed in P5-T03; combat resolution stays the locked AP model in P7).
- src/sim/structures/framework.ts (P3-T04): buildCost patterns.

ALLOWED FILES (create ONLY):
- src/sim/fleet/ships.ts   (new folder src/sim/fleet/)
- tests/ships.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock; no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `ShipClassId = 'scout' | 'corvette' | 'frigate' | 'cruiser' | 'battleship'` (the P5 roster — document: DESIGN's soldier-fleet model remains the locked combat basis; these classes are the composition units T03 builds fleets from).
2. `ShipClass = { id: ShipClassId; name: string; cost: { credits: number; alloys: number }; speedPcPerSec: number; cargoCapacity: number; combatPower: number; scoutingPower: number; buildTimeSec: number; tier: 1 | 2 | 3 | 4 | 5; futureTechModifierIds: readonly string[] }` — futureTechModifierIds = the extension POINTS (empty arrays now; P11 techs may modify — documented).
3. `SHIP_CLASSES: Readonly<Record<ShipClassId, ShipClass>>` — deep-frozen (Object.freeze on the record AND each class object); draft stat block (documented as balance-harness input, P10 balances):
   - scout: 500cr/0alloy, speed 1.5, cargo 0, combat 10, scouting 100, build 15s, tier 1.
   - corvette: 2,000cr/50alloy, speed 1.2, cargo 20, combat 60, scouting 40, build 30s, tier 2.
   - frigate: 8,000cr/200alloy, speed 1.0, cargo 60, combat 180, scouting 20, build 60s, tier 3.
   - cruiser: 30,000cr/800alloy, speed 0.8, cargo 200, combat 600, scouting 10, build 120s, tier 4.
   - battleship: 100,000cr/3,000alloy, speed 0.6, cargo 500, combat 2,000, scouting 5, build 300s, tier 5.
4. Pure functions:
   - `shipClass(id: ShipClassId): ShipClass` — returns the class (or a frozen COPY? — return the frozen object itself, documented read-only).
   - `isShipClassId(v: unknown): v is ShipClassId` — guard.
   - `SHIP_CLASS_IDS: readonly ShipClassId[]` — roster order (deep-frozen array).
   - `validateShipClass(c: ShipClass): { ok: boolean; problems: string[] }` — id in roster; costs finite > 0 (alloys >= 0); speed > 0; cargo >= 0; combat > 0; scouting >= 0; buildTime > 0; tier 1..5; futureTechModifierIds non-empty strings unique.
5. Invariants (test): roster completeness (5 classes, ids match); deep-frozen (Object.isFrozen on record + each class + arrays); stat blocks match the draft numbers EXACTLY; validateShipClass ok on all 5 + tamper classes (negative cost, zero speed, bad tier, dup tech ids); isShipClassId guard; determinism.

TESTS (vitest, tests/ships.test.ts, ~22-28): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/ships.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (draft stats are balance-harness input; combat resolution locked to DESIGN's AP model in P7).
