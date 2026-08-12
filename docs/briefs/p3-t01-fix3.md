TASK (StarBaron P3-T01, Codex FAIL round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/core/transactions.ts, tests/transactions.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic.

CODEX FINDING (fix exactly this):
[src/sim/core/transactions.ts:68] `transactionId` returns only a 32-bit FNV-1a hash — distinct nonce values can collide, so "distinct nonces → distinct ids" is not guaranteed. Fix: include an unambiguous nonce representation in the id alongside the FNV component — e.g. `${fnv1a(`${kind}|${amount}|${at}|${nonce}`).toString(16)}-${String(nonce)}` (hex hash + '-' + verbatim nonce). The nonce part makes the mapping injective on nonce values (number 5 and string '5' intentionally share an id — same value). Update the module JSDoc (id format: hex-nonce) and the tests that assert the hex-only regex — assert `/^[0-9a-f]+-[0-9a-zA-Z.+-]+$/` (or the exact format you choose; document it) + keep length <= 64 (add a test with a long nonce string asserting the bound is respected or documented).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/transactions.test.ts --pool threads` all pass (report counts). Report changed lines + results.
