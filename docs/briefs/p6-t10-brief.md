TASK (StarBaron P6-T10, master roadmap): FUTURE SENSOR HOOKS — sensor range, stealth, counter-intelligence: the forward-looking contract module. (Draft stat model + deterministic hook points; full mechanics land in P7/P9+ — the roadmap's subtasks: sensor range, stealth, counter-intelligence.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/intel/scouts.ts (P6-T03): ScoutProfile (sensorRangePc, detectionChance).
- src/sim/intel/permissions.ts (P6-T01): permissionFor.
- src/sim/fleet/ships.ts (P5-T01): SHIP_CLASSES (draft stats).
- src/sim/planets/hash.ts: fnv1a.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/intel/sensors.ts
- tests/sensors.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `SensorState = { emitter: { fleetId: string; signature: number }; sensors: { fleetId: string; rangePc: number } }` — the detection pairing: the emitter's SIGNATURE (stealth inverse) vs the sensor's RANGE.
2. `DetectionOutcome = { detected: boolean; rangePc: number; signature: number; marginPc: number; reason: 'in-range' | 'out-of-range' | 'cloaked' }`.
3. Pure functions:
   - `sensorRange(composition: FleetComposition): number` — the sensor range of a fleet: MAX sensor range among its ship classes (LOCKED delegation: scout = scoutProfileFor range? NO — a fleet's sensors come from its ships' sensor capability — draft: base 3 pc + (scoutingPower/100) × 0.5 — DOCUMENT as draft balance-harness input; P10 balances; deterministic; delegate to scouts.scoutProfileFor when scoutCount > 0 else a draft base).
   - `signatureOf(composition: FleetComposition): number` — the fleet's EMISSION signature: draft = 1 + totalShips × 0.1 − (stealth factor when the composition has... no stealth classes exist — draft: 1 + fleetCompositionSize × 0.1; document: stealth modifiers (future) multiply this down).
   - `stealthFactor(composition: FleetComposition): number` — the STEALTH HOOK: 1.0 by default (no stealth classes in the P5 roster — documented as the extension point P7/P9 fill); deterministic.
   - `detectionOutcome(input: { sensorRangePc: number; signature: number; distancePc: number; cloaked?: boolean }): DetectionOutcome` — detected = !cloaked && distancePc <= sensorRangePc (marginPc = sensorRangePc − distancePc; reason 'in-range'/'out-of-range'; cloaked → detected false + reason 'cloaked' regardless of range — the counter-intel hook); validated (range/signature > 0, distance >= 0).
   - `counterIntel(profile: ScoutProfile, detected: boolean): { effectiveRangePc: number; effectiveDetection: number }` — the COUNTER-INTELLIGENCE hook: effectiveDetection = detected ? profile.detectionChance : 0 (a detected scout gets NO additional detection roll — it's already spotted; undetected → 0.05 × profile.detectionChance — draft; document); effectiveRangePc = profile.sensorRangePc (unchanged — placeholder).
4. Invariants (test): sensorRange delegation + draft math; signatureOf math; stealthFactor default 1.0 (and its hook documented); detectionOutcome all reasons + boundaries (exactly at range → detected; cloaked overrides); counterIntel math; determinism; validation.

TESTS (vitest, tests/sensors.test.ts, ~24-30): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/sensors.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (draft mechanics; P7/P9 fill the real stealth/counter-intel systems).
