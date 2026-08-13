TASK (StarBaron P7-T07, Codex FAIL round 1 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/combat/capture.ts, tests/capture.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDINGS (fix exactly these):

1. [capture.ts:118] CaptureResult.transfer is typed `TransferOutcome | null` but the locked task shape requires `TransferEvent | null` — the implementation returns the whole transfer envelope instead of its event. Fix: expose `transfer.event` as the result's transfer field (type `TransferEvent | null`); keep any needed internal transfer data separate from the result contract. READ transfer.ts's types first (what does conquestTransfer return — TransferOutcome with an event field? extract `.event`).

2. [capture.ts:306-314] The module FABRICATES an ownership record with isHome=false / unconquerable=false — a protected/home target can therefore NEVER reach conquestTransfer's protected refusal path; the T08 guard is bypassed by construction. Fix: RECEIVE the actual target ownership record/state as capture input (add a field like `targetOwnership: HomeProtection` — READ protection.ts's HomeProtection shape and transfer.ts's conquestTransfer input to match exactly) and delegate that record UNCHANGED to conquestTransfer. Update the tests: a protected-home target → conquestTransfer throws (or the capture returns repelled/refused per the transfer contract — MATCH the locked behavior; add the regression).

VERIFY: `npx tsc -b` exit 0; run tests/capture.test.ts with --pool threads — all pass (report counts). Report changed lines + which test covers which finding.
