TASK (StarBaron P7-T02, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/combat/invasion.ts, tests/invasion.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
[invasion.ts:125-169] Duplicate planet names corrupt the force: pools are summed separately but drawLedger is a Map keyed by name — two "Alpha" planets with pools 3,000 each and desired 5,000 return troops 5,000 with ledger {'Alpha' => 2000}, violating "recruitedFrom sums to troops". Fix: REJECT duplicate planet names during recruitment validation (RangeError, descriptive message); add a regression test (two same-named planets → throws; recruitedFrom always sums to troops).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/invasion.test.ts --pool threads` all pass (report counts). Report changed lines + results.
