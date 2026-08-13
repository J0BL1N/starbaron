TASK (StarBaron PHASE 6 phase audit round 3 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/intel/staleness.ts, tests/staleness.test.ts, tests/store.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
[staleness.ts:94-110] freshnessFor does not validate a non-null TargetIntel.lastUpdatedAt — lastUpdatedAt: 0 is treated as fresh at at:1 (while store.ts/pvp-gate.ts reject it), NaN is silently classified expired; storeApplyDecay can preserve an invalid record through the direct staleness path. Fix: in freshnessFor, after the null branch, call the shared assertPositiveAt(intel.lastUpdatedAt) BEFORE computing age — this automatically protects decayedLevel, needsRescout, applyDecay, and store decay. Add negative tests: staleness paths (freshnessFor/decayedLevel/needsRescout/applyDecay) with lastUpdatedAt 0 / negative / NaN / ±Infinity throw RangeError; storeApplyDecay with such a record also throws (or reports — pick the module's convention; PREFER throw via the staleness path).

VERIFY: `npx tsc -b` exit 0; run tests/staleness.test.ts tests/store.test.ts with --pool threads — all pass (report counts). Report changed lines + results.
