TASK (StarBaron PHASE 5 phase audit round 5 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/fleet/shipyard.ts, src/sim/fleet/fleet.ts, tests/shipyard.test.ts, tests/fleet.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens (list: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random).

CODEX FINDINGS (fix exactly these):

1. [shipyard.ts:132] shipyardStateFor re-derives a flat SHIPYARD_INCOME_PER_MIN/60 and omits effective-level scaling; locked structureEffect('shipyard', level) already supplies shipbuildingIncomePerSec (READ effects.ts to confirm the field name). Fix: `incomePerSec: effect.shipbuildingIncomePerSec` (delegate to the locked per-level value); update the shipyard tests that pinned the flat base rate to assert the locked level-scaled value (hand-compute level 2 vs level 1 from effects.ts).

2. [fleet.ts:242-293 vs persistence.ts:821-845] fleetInvariants + createFleet never validate fleet.name as a non-empty string (persistence requires it) — a snapshot with name '' serializes but cannot deserialize, breaking the round-trip claim. Fix: validate name as a non-empty string (trimmed non-empty; descriptive RangeError/Error consistent with the module's style) in createFleet AND fleetInvariants (new problem entry 'fleet name must be a non-empty string'); add regression tests (createFleet with '' throws; fleetInvariants flags ''; the persistence round-trip tests still pass).

VERIFY: `npx tsc -b` exit 0; run the 2 test files with --pool threads — all pass (report per-file counts). DO NOT run the full suite.

REPORT: per-finding changed lines + which test covers which finding.
