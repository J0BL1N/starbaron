TASK (StarBaron PHASE 7 phase audit round 4 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/combat/capture.ts, tests/capture.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
[capture.ts:379] permits a capture timestamp BEFORE the battle's outcome.resolvedAt — can write a conquest transfer/history event before the battle it derives from, breaking resolve → casualties → capture ordering. Fix: after the outcome/ledger consistency validation, REJECT `capturedAt < outcome.resolvedAt` (RangeError, descriptive); add boundary tests: equality allowed (capturedAt == resolvedAt OK), prior time rejected (capturedAt == resolvedAt − 1 throws).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/capture.test.ts --pool threads` all pass (report counts). Report changed lines + results.
