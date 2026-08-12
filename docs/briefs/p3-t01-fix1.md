TASK (StarBaron P3-T01, tsc fix — ONE finding, no broadening):

ALLOWED FILES: tests/transactions.test.ts ONLY.

FINDING: [tests/transactions.test.ts:3] `startWallet` is imported but never used — `npx tsc -b` fails with TS6133. Remove the unused import (keep the other imports).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/transactions.test.ts` all pass (report counts). Report the changed line + results.
