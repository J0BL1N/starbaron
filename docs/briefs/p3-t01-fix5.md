TASK (StarBaron P3-T01, Codex FAIL round 4 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/core/transactions.ts, tests/transactions.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic.

CODEX FINDING (fix exactly this):
[src/sim/core/transactions.ts:82] `transactionId` does not guarantee distinct ids for distinct numeric nonces: `0` and `-0` are distinct JS values (Object.is(0, -0) === false) but both serialize as `n:0`. Fix: reject `-0` in assertValidNonce (e.g. `if (typeof nonce === 'number' && Object.is(nonce, -0)) throw descriptive Error`) — or encode -0 distinctly; pick REJECT and document. Add a test: `transactionId(..., -0)` throws.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/transactions.test.ts --pool threads` all pass (report counts). Report changed lines + results.
