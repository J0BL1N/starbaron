TASK (StarBaron P6-T10, master roadmap): FUTURE SENSOR HOOKS — sensor range, stealth, counter-intelligence, detection chance, alliance sharing, misinformation hooks.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/intel/scouts.ts (P6-T03): ScoutProfile — scouting power/range/detection/intel ceiling.
- src/sim/intel/levels.ts (P6-T02): IntelLevel ladder, coverageFor.
- src/sim/intel/permissions.ts (P6-T01): viewer relationship tiers.
- src/sim/intel/reports.ts (P6-T05): reveal matrix.
- src/sim/intel/pvp-gate.ts (P6-T07): pvpGatedView.
- src/sim/intel/staleness.ts (P6-T06): Freshness ladder.
- src/sim/fleet/ships.ts (P5-T01): ship class roster (scout stats).
- DESIGN.md §scouting/intel — the sensor/stealth concepts are RESERVED for later; T10 wires the HOOKS (extension points + default behaviour), NOT the full mechanics.

OBJECTIVE: create the sensor-hook layer — deterministic pure module(s) defining the sensor model's extension surface with conservative defaults (v1: hooks exist, default behaviour = current behaviour; the elaborate mechanics (stealth jitter, misinformation) are P9/P10+).

CREATE (ONLY these files):
1. src/sim/intel/sensors.ts — SensorHooks model:
   - interface SensorConfig { sensorRangePc: number; detectionChance: number; stealthModifier: number; counterIntel: number; allianceShareEnabled: boolean; } — per-scout-source defaults from the locked roster (scout = baseline).
   - SensorEvalResult { detected: boolean; effectiveRangePc: number; sourceLabel: string; } 
   - evaluateDetection(config, distancePc, rngDraw: number): SensorEvalResult — DETERMINISTIC: detected = distancePc <= effectiveRangePc && rngDraw < detectionChance; rngDraw is an INPUT (0..1) — the module never draws randomness itself (purity rule); stealthModifier reduces detectionChance (multiplicative, clamped 0..1); counterIntel reduces the source's detectionChance further (multiplicative).
   - hooks as EXTENSION POINTS: type SensorHook = (ctx: SensorEvalContext) => SensorEvalResult — a registry of named hooks (alliance sharing, misinformation) that LATER phases populate; T10 ships the registry + default passthrough hooks (identity behaviour). Document that stealth jitter / misinformation content are future mechanics.
2. src/sim/intel/counter-intel.ts — CounterIntelModel (minimal): counterIntelLevel (0..5), detectionPenalty(level) — deterministic ladder; applyCounterIntel(chance, level).
3. tests/sensors.test.ts + tests/counter-intel.test.ts — focused vitest, ~28-36 tests total: evaluateDetection deterministic (same inputs same result), range check, rngDraw threshold, stealth/counter modifiers clamp, hook registry default passthrough, counter-intel ladder + penalty monotonic, no random calls inside module (grep test for Math.random absence).

RESTRICTIONS: pure modules — no nondeterministic APIs (rngDraw is an input), no module-level mutable state, no wall-clock, no `any`, strict TS; imports ⊆ ../world/* (type-only), ./levels, ./permissions, ../fleet/ships, stdlib; NO modification of existing files; no UI/DB/rendering wiring. Extension hooks must be documented as FUTURE mechanics (stealth/misinformation are P9/P10+ per DESIGN reserved list) — do NOT implement full stealth/misinformation now.

VERIFY: npx vitest run tests/sensors.test.ts tests/counter-intel.test.ts (focused only — NEVER the full suite) — all pass; npx tsc -b exit 0. Report files + design decisions + real test output. Do NOT commit.
