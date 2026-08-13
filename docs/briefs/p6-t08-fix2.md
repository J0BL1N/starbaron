TASK (StarBaron P6-T08, Codex FAIL round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/intel/store.ts, tests/store.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
[store.ts:248-253] storeInvariants accepts ANY iterable as a records map — a tampered `records: new Set([42])` passes the iterability check then THROWS during `[key, intel]` destructuring; an empty Set/array also wrongly returns ok:true. Fix: require the records value to be a real `Map` (e.g. `records instanceof Map` — report 'records must be a Map' as a problem when not); after the Map check, guard each entry is a 2-tuple with a string key and an object record (report malformed entries as problems — never throw). Add tamper tests: records as Set([42]) → ok false with the Map problem (no throw); records as [] → ok false; records as a Map with a non-string key → problem.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/store.test.ts --pool threads` all pass (report counts). Report changed lines + results.
