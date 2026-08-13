TASK (StarBaron PHASE 6 phase audit round 5 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/intel/scouts.ts, src/sim/intel/sensors.ts, tests/scouts.test.ts, tests/sensors.test.ts, src/sim/fleet/fleet.ts (ONLY if it needs a canonical validator EXPORT — prefer reusing an existing export; do not change fleet behavior). Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
scouts.ts:68-80 + sensors.ts:95-104 independently implement the same SHIP_CLASS_IDS non-negative-integer composition validation. Fix: centralize on the existing fleet validation surface — READ fleet.ts's exports (fleetCompositionSize validates counts? verify — if fleetCompositionSize throws on negative/fractional counts, DELEGATE to it; if it doesn't validate, export ONE canonical `assertValidComposition(composition: FleetComposition): void` from fleet.ts (documented, RangeError, the same message style) and import it in scouts.ts + sensors.ts; DELETE both local copies). Behavior and error messages stay pinned by existing tests.

VERIFY: `npx tsc -b` exit 0; run tests/scouts.test.ts tests/sensors.test.ts tests/fleet.test.ts with --pool threads — all pass (report counts). DO NOT run the full suite.

REPORT: changed lines + which test covers the canonical validator.
