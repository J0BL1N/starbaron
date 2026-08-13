TASK (StarBaron P7-T07, Codex FAIL round 3 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/combat/capture.ts, tests/capture.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
[capture.ts:317] delegates targetOwnership without verifying it belongs to targetId or that its owner is defenderId — a mismatched record can produce a captured result whose transfer event targets another body or names a different previous owner. Fix: BEFORE calling conquestTransfer, reject `targetOwnership.bodyId !== targetId` and `targetOwnership.ownerId !== defenderId` with RangeError (descriptive messages); add BOTH negative-path tests in tests/capture.test.ts (mismatched bodyId throws; mismatched ownerId throws).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/capture.test.ts --pool threads` all pass (report counts). Report changed lines + results.
