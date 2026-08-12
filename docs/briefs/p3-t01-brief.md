TASK (StarBaron P3-T01, master roadmap): CREDITS — canonical credit transactions with validation (the roadmap's 'transaction validation' + 'storage/balance' subtasks; base income, structure income, spending, formatting already exist).

CONTEXT — existing code you may READ but NOT modify:
- src/sim/core/economy.ts: baselinePassiveIncome(tier), structureCost(baseCost, level), MIN/MAX_TIER.
- src/sim/player/wallet.ts: WalletState { credits, alloys }, walletAdd, walletSpend, startWallet, STARTER_CREDITS.
- src/sim/core/format.ts: formatNumber.
- src/sim/structures/effects.ts: per-structure income effects (read-only reference).

ALLOWED FILES (create ONLY):
- src/sim/core/transactions.ts
- tests/transactions.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `CreditKind = 'income' | 'spend' | 'transfer' | 'adjustment'` (extensible union).
2. `CreditTransaction = { id: string; kind: CreditKind; amount: number; balanceAfter: number; at: number; reference?: string }` — id: deterministic from (reference ?? kind) + amount + at? NO — ids must be unique per transaction even with identical fields: use `fnv1a(`${kind}|${amount}|${at}|${counter}`)` where counter is part of an injected sequence? Keep SIMPLE + deterministic: caller supplies a unique `id` (the pure module validates format: non-empty, <= 64 chars, no control chars); document that id uniqueness is the caller's ledger concern. OR derive: `transactionId(kind, amount, at, nonce)` exported helper using fnv1a of the joined parts — deterministic when the caller passes a stable nonce. PREFER the helper.
3. Pure functions:
   - `transactionId(kind, amount, at, nonce: number | string): string` — fnv1a(`${kind}|${amount}|${at}|${nonce}`) — exported; callers use a per-ledger monotonic nonce for uniqueness.
   - `applyTransaction(wallet: WalletState, tx: Omit<CreditTransaction, 'id' | 'balanceAfter'>, at: number, nonce: number | string): { wallet: WalletState; transaction: CreditTransaction }`
     - VALIDATION (throw descriptive Error): amount finite AND > 0 (zero/negative rejected — income must be positive; spends are positive amounts with kind 'spend'); kind in union; at finite > 0; for kind 'spend': wallet.credits >= amount (insufficient funds throws 'insufficient credits'); for 'transfer': same spend-side check (outgoing); credits balance must remain finite >= 0.
     - returns a NEW wallet ({...wallet, credits: wallet.credits + amount}) for income/adjustment; credits - amount for spend/transfer. alloys untouched. balanceAfter = new balance.
     - immutability: input wallet not mutated.
   - `transactionHistoryAppend(history: CreditTransaction[], tx: CreditTransaction): CreditTransaction[]` — immutable append.
   - `walletInvariants(wallet: WalletState): { ok: boolean; problems: string[] }` — credits finite, >= 0, alloys finite, >= 0.
   - `totalByKind(history: CreditTransaction[], kind: CreditKind): number` — sum of amounts for a kind (income positive, spend positive — sums raw amounts; document).
4. Invariants (test): validation throws (negative/zero amount, NaN, bad kind, bad at, insufficient spend), income/spend/transfer/adjustment math + balanceAfter, immutability, history append immutable, walletInvariants, totalByKind, transactionId determinism + distinct nonces → distinct ids, id format.

TESTS (vitest, tests/transactions.test.ts, ~24-30): all invariants + edge cases (exact-balance spend succeeds; 0.1 float amounts fine; huge amounts finite).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/transactions.test.ts` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
