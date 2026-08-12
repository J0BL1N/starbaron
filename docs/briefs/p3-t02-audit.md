READ-ONLY AUDIT — StarBaron P3-T02 (master roadmap): Alloys / Ore.

READ LIST:
- src/sim/core/alloys.ts      (NEW — under audit)
- tests/alloys.test.ts        (NEW — test suite)
- src/sim/core/transactions.ts (P3-T01 — pattern reference: alloyTransactionId/applyAlloyTransaction mirror it)
- src/sim/player/wallet.ts    (WalletState)
- src/sim/planets/hash.ts     (fnv1a)
- DESIGN.md (defensive alloy cost — the implementer cites DEFENSE_ALLOYS_PER_DP = 2; VERIFY against DESIGN)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 1ee0141611a63ba1b3e235f9f01965e5e89b5147 (`git show --stat` adds exactly src/sim/core/alloys.ts + tests/alloys.test.ts). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p3-t02-brief.md + master roadmap P3-T02):
1. AlloyTransaction { id, kind 'mine'|'spend'|'transfer'|'adjustment', amount, balanceAfter, at, reference? }; alloyTransactionId mirrors transactions.ts (type-tagged nonce, injective).
2. applyAlloyTransaction: same validation as credits (amount finite > 0; kind union; at finite > 0; spend/transfer 'insufficient alloys' throws; exact-balance spend ok); credits untouched; immutability.
3. alloyScarcityCurve(ownedAlloys): 1/(1+owned/5000) clamped [0.05, 1], monotonic decreasing, deterministic, validates input; alloyYield(baseRate, owned) = baseRate × curve rounded to 0.1; defensiveAlloyDemand(defensePower) per DESIGN's number (VERIFY the DESIGN value matches the implementation).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ ../player/wallet (types), ../planets/hash, stdlib (+ type-only ../player/types OK per the documented P3-T01 contract).

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Validation completeness (all throw paths incl. -0/non-finite nonce, negative ownedAlloys).
C. Math: mine adds, spend/transfer subtract with insufficiency check, exact-balance ok, overflow guard; credits untouched; immutability.
D. Scarcity curve: formula, clamp bounds [0.05,1], monotonic, floor at huge holdings, determinism; yield rounding; defensive demand matches DESIGN.
E. Id injectivity (type-tagged nonce, -0 rejected).
F. Tests ~29 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
