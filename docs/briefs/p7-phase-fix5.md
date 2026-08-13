TASK (StarBaron PHASE 7 phase audit round 5 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/combat/capture.ts, tests/capture.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
[capture.ts:395,430,250] capturePlanet validates outcome↔ledger only, then uses INDEPENDENTLY supplied attackerId/targetId for the transfer; assertCost validates shape but not cost.targetId === targetId — a valid victory/ledger for battle A can authorize transfer of target B to attacker C. Fix: BEFORE the non-victory branch, reject unless `outcome.attackerId === attackerId`, `outcome.targetId === targetId`, and `cost.targetId === targetId` (RangeError, descriptive messages); add negative tests for EACH mismatch (outcome.attackerId mismatch; outcome.targetId mismatch; cost.targetId mismatch).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/capture.test.ts --pool threads` all pass (report counts). Report changed lines + results.
