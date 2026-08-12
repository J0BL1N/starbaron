TASK (StarBaron P3-T01, Codex FAIL round 3 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/core/transactions.ts, tests/transactions.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic.

CODEX FINDINGS (fix exactly these):

1. [src/sim/core/transactions.ts:75-76] Distinct valid nonce VALUES can produce the same id: `1` and `'1'` both stringify to `1`. Fix: TYPE-TAG the nonce serialization — numbers serialize as `n:<value>`, strings as `s:<value>` — in BOTH the fnv1a hash input AND the emitted id suffix (e.g. `${fnv1a(`${kind}|${amount}|${at}|${typeof nonce}:${nonce}`).toString(16)}-${typeof nonce === 'number' ? 'n' : 's'}:${nonce}`). Update the test that asserted `1` and `'1'` share an id — they must now be DISTINCT ids.

2. [src/sim/core/transactions.ts:76] Verbatim string nonces permit control characters and unbounded id length. Fix: VALIDATE the nonce before producing the id — number nonces must be finite; string nonces must be non-empty, contain no control characters, and be at most 40 chars (so the id stays within 64 chars); throw descriptive Error otherwise. Add rejection tests: empty string nonce throws, control-char nonce throws, 41-char nonce throws; a 40-char nonce still works and the id is <= 64 chars; remove the "long nonce extends past 64 chars" test (that behavior no longer exists).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/transactions.test.ts --pool threads` all pass (report counts). Report changed lines + results + which test covers which finding.
