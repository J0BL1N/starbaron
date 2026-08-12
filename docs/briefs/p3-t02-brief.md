TASK (StarBaron P3-T02, master roadmap): ALLOYS / ORE — canonical resource model for the secondary economy resource.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/core/transactions.ts (P3-T01, just committed): CreditTransaction machinery (kinds income/spend/transfer/adjustment — CREDITS-only; alloys NOT covered there).
- src/sim/player/wallet.ts: WalletState { credits, alloys }, walletAdd, walletSpend.
- src/sim/core/economy.ts: tier constants, baselinePassiveIncome, structureCost.
- src/sim/structures/data.ts + effects.ts: Ore Mine (alloy production), Defense Turret (alloy cost) — read-only reference for scarcity/demand.
- src/sim/structures/types.ts: StructureId.
- DESIGN.md: alloy/ore economy section (scarcity curve, defensive uses) — READ the relevant section.

ALLOWED FILES (create ONLY):
- src/sim/core/alloys.ts
- tests/alloys.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `AlloyTransaction = { id: string; kind: 'mine' | 'spend' | 'transfer' | 'adjustment'; amount: number; balanceAfter: number; at: number; reference?: string }` — mirror CreditTransaction but kind 'mine' (production) instead of 'income'.
2. Pure functions:
   - `alloyTransactionId(kind, amount, at, nonce): string` — fnv1a-based, same pattern as transactions.ts.
   - `applyAlloyTransaction(wallet: WalletState, tx: Omit<AlloyTransaction, 'id' | 'balanceAfter'>, at: number, nonce: number | string): { wallet: WalletState; transaction: AlloyTransaction }` — SAME validation rules as credits (amount finite > 0; kind union; at finite > 0; spend/transfer insufficient alloys throws 'insufficient alloys'); credits untouched; immutability.
   - `alloyScarcityCurve(ownedAlloys: number): number` — the scarcity multiplier on future alloy income: a pure deterministic curve — e.g. diminishing returns: multiplier = 1 / (1 + ownedAlloys / SCARCITY_HALF_LIFE) with SCARCITY_HALF_LIFE = 5_000 exported const; clamps to [0.05, 1]; monotonic decreasing. (This is the roadmap's 'scarcity curve' — implement it deterministically; the exact formula is a balance-harness input (T10), document that.)
   - `alloyYield(baseRate: number, ownedAlloys: number): number` — baseRate × alloyScarcityCurve(ownedAlloys), rounded to 1 decimal (0.1 precision — document).
   - `defensiveAlloyDemand(defensePower: number): number` — deterministic alloy cost of defense power: defensePower × 50 (read DESIGN.md defensive-uses section; if DESIGN specifies a different number, use DESIGN's — READ IT FIRST).
3. Invariants (test): transaction validation mirrors credits (all throw paths); credits untouched by alloy ops; immutability; scarcity curve monotonic + bounds [0.05, 1] + determinism; alloyYield math; defensive demand; determinism everywhere.

TESTS (vitest, tests/alloys.test.ts, ~24-30): all invariants + edge cases (0 alloys, huge alloys → curve floor, exact-balance spend).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/alloys.test.ts --pool threads` all pass (counts) — use the threads pool (fork pool is unreliable under load); DO NOT run the full suite. Report changed files, commands + results, limitations (formula choices flagged for T10 balancing).
