TASK (StarBaron P7-T10, master roadmap): COMBAT SIMULATION HARNESS — scenario generation + deterministic replay: run scripted battle scenarios through the locked combat chain (attack → resolve → casualties → capture) and replay them deterministically. (The combat twin of P3-T10's balance harness.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/combat/resolution.ts (P7-T03): resolveBattle, BattleOutcome.
- src/sim/combat/casualties.ts (P7-T05): applyCasualties, CasualtyLedger.
- src/sim/combat/conquest-cost.ts (P7-T06): conquestCostFor.
- src/sim/combat/capture.ts (P7-T07 — READ IF PRESENT): capturePlanet.
- src/sim/combat/attack-orders.ts (P7-T01): attackLaunchCost, launchAttack.
- src/sim/balance/harness.ts (P3-T10): the balance harness conventions (deterministic simulation, report bands) — MIRROR its structure.
- src/sim/planets/hash.ts: fnv1a.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/combat/sim-harness.ts
- tests/sim-harness.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `BattleScenario = { scenarioId: string; name: string; attacker: { troops: number; shipyardTier: number; fleetSize: number; conquests: number }; defender: { turretLevels: number; population: number; garrison: number; fleetSize: number; tier: number }; distancePc: number; speedPcPerSec: number; at: number }` — the full input envelope.
2. `ScenarioResult = { scenarioId: string; outcome: BattleOutcome; ledger: CasualtyLedger; cost: ConquestCost | null; captured: boolean; travelSeconds: number; launchCost: number; report: string }`.
3. Pure functions:
   - `runScenario(input: BattleScenario): ScenarioResult` — the CHAIN (all DELEGATED to the locked modules, never re-derived): launchCost = attackLaunchCost(fleetSize, distancePc).credits; travelSeconds = distancePc / speedPcPerSec (validated speed > 0; ×1000 for ms? — NO: keep seconds as the unit the movement module uses — READ movement.ts arrivalTime's unit and match it; document); outcome = resolveBattle(...); ledger = applyCasualties(...); cost = outcome.result === 'victory' ? conquestCostFor({ tier, attackerConquests }) : null; captured = outcome.result === 'victory'; report = the deterministic one-liner (reuse the capture/combat-report text style — 'VICTORY · 1,300 cr launch · 12h travel · 1,500 troops lost').
   - `scenarioTable(scenarios: readonly BattleScenario[]): string[]` — deterministic rows (one per scenario, sorted by scenarioId).
   - `replayCheck(recorded: ScenarioResult, rerun: ScenarioResult): { identical: boolean; firstDifference: string | null }` — DETERMINISTIC REPLAY: compare field-by-field (outcome powers/survivors, ledger losses, cost totals, captured, report); firstDifference = the first diverging field path ('outcome.attackPower' style); identical = all equal.
4. Invariants (test): the chain end-to-end (hand-computed: 5,000 troops × tier 2 = 10,000 AP vs 3 turrets/10k pop (1,500+1,500=3,000 DP) → VICTORY; a losing scenario; a stalemate at exact parity); replayCheck identical for the same input (deterministic — run twice, identical true); a tampered rerun (change one field) → identical false + firstDifference names it; scenarioTable sorted + deterministic; travelSeconds math; validation (bad tiers/speed/population/at).

TESTS (vitest, tests/sim-harness.test.ts, ~28-34): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/sim-harness.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (balance tuning of the rates is P10's harness; notifications UI → T11).
