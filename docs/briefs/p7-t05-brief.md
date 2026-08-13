TASK (StarBaron P7-T05, master roadmap): POPULATION CASUALTIES — committed attackers lost appropriately (the invasion force is spent whether win or lose — DESIGN), defender losses per the battle outcome (P7-T03's defenderCasualties), the casualty ledger on BOTH sides + the attacker population impact (recruitment drew from population; committed troops are lost; surviving troops return). (Pure model — the casualty application over T02/T03 outputs.)

CONTEXT — existing code you may READ but NOT modify:
- DESIGN.md §5 (lines ~120-186): "launch invasion of 5,000 troops — those 5,000 are gone whether you win or lose"; committed troops lost appropriately.
- src/sim/combat/resolution.ts (P7-T03): BattleOutcome (survivingTroops, defenderCasualties, result) — the battle result source.
- src/sim/combat/invasion.ts (P7-T02): InvasionForce (recruitedFrom ledger).
- src/sim/combat/attack-orders.ts (P7-T01): AttackOrder (troopsCommitted).
- src/sim/player/types.ts: OwnedPlanet (population).
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/combat/casualties.ts
- tests/casualties.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `CasualtyLedger = { attackerId: string; targetId: string; battleId: string; resolvedAt: number; attacker: { troopsCommitted: number; survivors: number; populationLoss: number; fleetLost: boolean }; defender: { populationLoss: number; garrisonLoss: number }; result: 'victory' | 'defeat' | 'stalemate' }`.
2. Pure functions:
   - `applyCasualties(input: { outcome: BattleOutcome; committedTroops: number; defenderPopulationBefore: number; defenderGarrisonBefore: number }): CasualtyLedger` — attacker: survivors = outcome.survivingTroops (from T03 — DELEGATE, never recompute); populationLoss = committedTroops − survivors (the committed troops are GONE whether win or lose — DESIGN: the recruited population is lost; survivors RETURN but were not the committed loss... CAREFUL: DESIGN says the 5,000 committed are gone whether win or lose — so survivors are ALSO lost? No: DESIGN's meaning = the troops you send are spent (you don't get them back as a refund — they're casualties or occupied); the draft resolution gives survivingTroops = floor(troops×0.7) on victory — those SURVIVORS return to the population (they're not dead). populationLoss = committedTroops − survivors (only the dead are population loss); survivors return → attacker population recovers them (document); fleetLost = defeat (the fleet escorting is destroyed — DESIGN: "or lose the fleet too"; stalemate → fleet retreats intact — fleetLost false; victory → false — document the choice).
   - defender: populationLoss = outcome.defenderCasualties (DELEGATE from T03); garrisonLoss = stalemate ? 0 : defeat ? floor(defenderGarrisonBefore × GARRISON_LOSS_RATE_DEFEAT = 0.5) : floor(defenderGarrisonBefore × GARRISON_LOSS_RATE_VICTORY = 0.3) (draft exported rates — document; the garrison is wiped when the planet falls — DESIGN: garrison destroyed on conquest → on defeat garrisonLoss = garrisonBefore? — NO: the resolution's result 'defeat' means the ATTACKER lost; the DEFENDER held → garrison survives mostly. On VICTORY (attacker won, planet taken) the garrison is destroyed: garrisonLoss = garrisonBefore (all). FIX THE MAPPING: result 'victory' (attacker wins) → defender garrison destroyed (garrisonLoss = garrisonBefore) + defender population casualties from outcome.defenderCasualties; result 'defeat' (attacker loses, defender holds) → garrisonLoss = floor(garrisonBefore × 0.2) (defense losses, draft DEFENDER_GARRISON_LOSS_RATE = 0.2); stalemate → 0. PIN these semantics; document).
   - `attackerPopulationImpact(ledger: CasualtyLedger): { totalPopulationLost: number; survivorsReturned: number }` — totalPopulationLost = populationLoss (the dead); survivorsReturned = survivors (they go home — document).
   - `casualtyReport(ledger: CasualtyLedger): string` — deterministic ('2,000 troops lost · 3,000 returned home · defenders lost 850').
3. Invariants (test): applyCasualties delegation (survivors/defenderCasualties EXACTLY from a constructed BattleOutcome — no recompute); populationLoss = committed − survivors (victory: 5,000 committed, 3,500 survivors → 1,500 lost); fleetLost semantics; garrisonLoss per result (victory → full garrison destroyed; defeat → 20%; stalemate → 0); ledger invariants (defender population never negative: defenderCasualties ≤ populationBefore — clamp? NO: validate — throw if defenderCasualties > populationBefore); determinism; validation.

TESTS (vitest, tests/casualties.test.ts, ~26-32): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/casualties.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (planet handover → T07; garrison rebuild → accrual/queues).
