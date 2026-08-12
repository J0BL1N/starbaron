TASK (StarBaron P3-T08, master roadmap): OFFLINE PROGRESSION — resource accrual, population growth, construction completion, capped/unlimited policy, reconnect calculation, anti-duplication.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/core/offline.ts: LOCKED MAX_OFFLINE_BANK_SECONDS = 8h + calculateOfflineEarnings (the cap policy is LOCKED — mirror it).
- src/sim/core/population-model.ts (P3-T03): PopulationState, applyGrowth.
- src/sim/structures/queues.ts (P3-T07): completeDueJobs, ConstructionQueue.
- src/sim/player/accrual.ts: accruePlayer (the live tick path — the offline model must AGREE with it at equal elapsed time).
- src/sim/player/types.ts: PlayerState.
- src/sim/player/wallet.ts: WalletState.

ALLOWED FILES (create ONLY):
- src/sim/core/offline-model.ts
- tests/offline-model.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `OfflineResult = { walletDelta: { credits: number; alloys: number }; populationByPlanet: Record<string, number>; completedJobs: ConstructionJob[]; bankedSeconds: number; elapsedSeconds: number; capped: boolean }`.
2. Pure functions:
   - `offlineProgress(input: { player: PlayerState; queue: ConstructionQueue; at: number }): OfflineResult`
     - elapsedSeconds = (at - player.lastTickAt) / 1000 (at >= lastTickAt validated; throw otherwise).
     - CAP POLICY (LOCKED): bankedSeconds = min(elapsedSeconds, MAX_OFFLINE_BANK_SECONDS); capped = elapsedSeconds > bankedSeconds. Mirror offline.ts EXACTLY (read calculateOfflineEarnings — the credit math there is LOCKED; delegate to it for the credit/alloy delta if its signature fits, else mirror precisely).
     - population: applyGrowth per planet (PlayerState.homePlanet + colonies) from lastTickAt to at — CAPPED the same way (banked window only — mirror how offline.ts treats the excess: excess time accrues NOTHING).
     - completedJobs: completeDueJobs(queue, at).completed.
     - anti-duplication: the result is a DELTA (walletDelta, not absolute balances) — applying it once is the caller's contract; document that re-applying the same delta double-counts (the anti-duplication mechanism is the caller advancing lastTickAt; the model returns the delta for exactly [lastTickAt, at]).
   - `offlineSummary(result: OfflineResult): string` — deterministic one-line summary for the UI modal ('While you were away (4h)… +120,000 cr · +3,200 pop' style) — deterministic formatting (comma grouping, NO locale APIs).
   - `validateOfflineResult(r: OfflineResult): { ok: boolean; problems: string[] }` — deltas non-negative finite; bankedSeconds <= elapsedSeconds; capped flag consistent; population deltas finite.
3. Invariants (test): elapsed/banked/capped math mirrors offline.ts (8h cap: 10h offline → 8h banked, capped true; 2h → uncapped); credit delta EQUALS calculateOfflineEarnings for the same inputs; population growth applies only within the banked window; completedJobs from the queue; anti-duplication contract documented (delta semantics tested: advancing lastTickAt + re-running gives the SECOND window's delta only); summary determinism + no-locale; validateOfflineResult catches each tamper.

TESTS (vitest, tests/offline-model.test.ts, ~26-32): all invariants + edges (at === lastTickAt → zero delta, capped false; huge offline; zero population).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/offline-model.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (which offline.ts pieces delegated vs mirrored).
