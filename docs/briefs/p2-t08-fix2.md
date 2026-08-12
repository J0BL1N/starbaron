TASK (StarBaron P2-T08, Codex FAIL round 2 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/player/onboarding.ts, tests/onboarding.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic.

CODEX FINDINGS (fix exactly these):

1. [src/sim/player/onboarding.ts:32,143] Comments contain the banned token `any`. Reword: "each parseable home body" (line ~32) and "level 1 or higher" (line ~143) — no behavior change.

2. [src/sim/player/onboarding.ts:102-110,245-248] The entryFlow eligibility contract is ambiguous: the injected `eligible` defaults to [] so a caller using the original input shape silently gets invalid-eligible-set instead of a valid assignment. Fix the CONTRACT (documented revision): make `eligible: readonly BodyId[]` a REQUIRED field of the entryFlow input (no default). The caller always supplies the candidate home set (tests pass eligibleHomeBodies(PLANETS) or a fixture). 'invalid-eligible-set' then occurs ONLY when the caller passes an empty array. Update the module JSDoc to state the caller-supplied eligibility contract, and update all entryFlow call sites in the tests to pass eligible explicitly.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/onboarding.test.ts` all pass (report counts). Report changed lines + results + which test covers which finding.
