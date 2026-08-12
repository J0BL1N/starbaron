TASK (StarBaron P3-T01, Codex FAIL round 1 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/core/transactions.ts, tests/transactions.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic, no behavior changes.

CODEX FINDINGS (fix exactly these):

1. [src/sim/core/transactions.ts:1] WalletState is imported from '../player/types' — outside the authorised set. CONTRACT CORRECTION (documented): type-only imports from '../player/types' ARE authorised (the WalletState type lives there; wallet.ts re-exports it). Keep the import but ensure it is TYPE-ONLY (`import type { WalletState } from '../player/types'`) and note the corrected dependency contract in the module JSDoc.

2. [src/sim/core/transactions.ts:41-48] fnv1a is reimplemented locally. Fix: replace the local function with `import { fnv1a } from '../planets/hash'` and delete the local copy.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/transactions.test.ts --pool threads` all pass (report counts). Report changed lines + results.
