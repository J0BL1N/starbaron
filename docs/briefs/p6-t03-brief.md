TASK (StarBaron P6-T03, master roadmap): SCOUT SHIPS — the scout-capable ship model: scouting power, sensor range, scout speed, detection profile, which classes can scout. (Wraps the P5-T01 scout class; the mission mechanics are T04.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/fleet/ships.ts (P5-T01): SHIP_CLASSES (scout: scoutingPower 100, speed 1.5, combat 10).
- src/sim/fleet/fleet.ts (P5-T03): FleetComposition.
- src/sim/intel/levels.ts (P6-T02): IntelLevel, coverageFor.
- src/sim/planets/hash.ts: fnv1a.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/intel/scouts.ts
- tests/scouts.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock; no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `ScoutProfile = { scoutCount: number; scoutingPower: number; sensorRangePc: number; scoutSpeedPcPerSec: number; detectionChance: number; maxIntelLevel: IntelLevel }` — the fleet's scouting capability from its composition.
2. Pure functions:
   - `scoutProfileFor(composition: FleetComposition): ScoutProfile` — scoutCount = composition.scout; scoutingPower = scoutCount × LOCKED SHIP_CLASSES.scout.scoutingPower (100 — DELEGATE, never re-derive the constant); sensorRangePc = the locked draft: scout sensor range = scoutingPower / 100 (1 pc per scout... NO — define: sensorRangePc = 5 + log10(1 + scoutingPower) (draft formula, exported const SENSOR_RANGE_BASE_PC=5 — documented as balance-harness input; deterministic); scoutSpeed = SHIP_CLASSES.scout.speedPcPerSec (LOCKED 1.5); detectionChance = clamp(0.05 + scoutingPower/10000, 0.05, 0.95) (draft, documented); maxIntelLevel: scoutCount 0 → 'none'; 1-2 → 'scanned'; 3-9 → 'scouted'; 10+ → 'deep recon' (documented thresholds exported consts; 'full intelligence' is NOT reachable by scouts alone — requires a probe/attack (P7) — documented).
   - `canScout(composition: FleetComposition): boolean` — scoutCount > 0.
   - `scoutSummary(profile: ScoutProfile): string` — deterministic one-line ('3 scouts · power 300 · range 7.5 pc · detects 8% · scouted intel').
3. Invariants (test): profile math (hand-computed: 3 scouts → power 300, range 5+log10(301)≈7.48, speed 1.5, detection 0.05+300/10000=0.08, maxIntel 'scouted'); maxIntelLevel thresholds (0/1/2/3/9/10 scouts); canScout; delegation to LOCKED SHIP_CLASSES values (no hard-coded 100/1.5 — assert via the roster); determinism; validation (bad composition counts).

TESTS (vitest, tests/scouts.test.ts, ~24-30): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/scouts.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (draft formulas are balance-harness input; detection resolution is T04/T07's concern).
