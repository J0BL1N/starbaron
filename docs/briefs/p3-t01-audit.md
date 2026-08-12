READ-ONLY AUDIT — StarBaron P3-T01 (master roadmap): Credit Transactions.

READ LIST:
- src/sim/core/transactions.ts   (NEW — under audit)
- tests/transactions.test.ts     (NEW — test suite)
- src/sim/player/wallet.ts       (WalletState — dependency)
- src/sim/planets/hash.ts        (fnv1a — transactionId dependency)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = the CURRENT state of src/sim/core/transactions.ts + tests/transactions.test.ts on staging (HEAD). The task commits (feat 33831ef + fix commits) modify ONLY these two files. Docs commits OUT OF SCOPE.. Docs/working tree OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p3-t01-brief.md + master roadmap P3-T01):
1. CreditKind union; CreditTransaction { id, kind, amount, balanceAfter, at, reference? }; transactionId(kind, amount, at, nonce) = fnv1a-based, deterministic.
2. applyTransaction: validation throws (amount finite > 0; kind in union; at finite > 0; spend/transfer insufficient credits throws); income/adjustment add, spend/transfer subtract; balanceAfter = new balance; returns NEW wallet (input untouched); alloys untouched.
3. transactionHistoryAppend immutable; walletInvariants { credits >= 0 finite, alloys >= 0 finite }; totalByKind sums.
4. Purity: no nondeterministic APIs/module-level mutable state/wall-clock; no `any`; imports ⊆ ../player/wallet + ../planets/hash + stdlib; TYPE-ONLY imports from ../player/types are AUTHORISED (documented contract correction — WalletState lives in types.ts).

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Validation completeness (each throw path); amount > 0 enforced for ALL kinds (incl. adjustment).
C. Math: income/adjustment add, spend/transfer subtract; balanceAfter correct; exact-balance spend succeeds; immutability.
D. transactionId determinism + distinct nonces → distinct ids; id format sane.
E. walletInvariants + totalByKind correctness.
F. Tests ~30 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
