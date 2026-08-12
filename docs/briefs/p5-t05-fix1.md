TASK (StarBaron P5-T05, Codex FAIL round 1 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/fleet/positioning.ts, tests/positioning.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS.

CODEX FINDINGS (fix exactly these):

1. [positioning.ts:3,31] Comments contain banned tokens (`ANY`, `any`). Reword without the token (e.g. "ALL" / "each supplied").

2. [positioning.ts:162,176,193] `positionAt` returns the caller's TravelLeg BY REFERENCE in the non-null branches, contradicting the documented no-aliasing guarantee (the test at positioning.test.ts:263 even asserts identity). Fix: return a FRESH DEEP COPY of the leg (including its `from` and `to` refs) in every branch; update the test to assert non-identity + deep equality (toEqual) instead of toBe.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/positioning.test.ts --pool threads` all pass (report counts). Report changed lines + results + which test covers which finding.
