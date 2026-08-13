TASK (StarBaron P7-T07, master roadmap): PLANET CAPTURE — the conquest handover: ownership transfer to the attacker + structure consequences (turrets destroyed — DESIGN §5; other structures survive by the survival fraction — the P2-T07 transfer machinery). (This is the APPLICATION of T03/T05/T06 onto ownership — DELEGATE to the P2 locked transfer.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/player/transfer.ts (P2-T07): conquestTransfer — THE locked handover (turrets ALWAYS destroyed, structureSurvival fraction; ownership + audit event). DELEGATE — never re-implement.
- src/sim/player/ownership.ts (P2-T04): ownershipFor, currentOwner.
- src/sim/combat/resolution.ts (P7-T03): BattleOutcome (victory flag, result).
- src/sim/combat/casualties.ts (P7-T05): CasualtyLedger (defender losses).
- src/sim/combat/conquest-cost.ts (P7-T06): ConquestCost (the price paid).
- src/sim/player/types.ts: OwnedPlanet.
- src/sim/planets/hash.ts: fnv1a.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/combat/capture.ts
- tests/capture.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `CaptureResult = { captureId: string; attackerId: string; defenderId: string; targetId: string; capturedAt: number; outcome: 'captured' | 'repelled'; transfer: TransferEvent | null; cost: ConquestCost | null; casualties: CasualtyLedger | null }` — captureId = fnv1a(`${attackerId}|${targetId}|${capturedAt}`).
2. Pure functions:
   - `capturePlanet(input: { attackerId: string; defenderId: string; targetId: string; outcome: BattleOutcome; cost: ConquestCost; casualties: CasualtyLedger; structureSurvival: number; capturedAt: number; universe: UniverseState }): CaptureResult` — victory → DELEGATE the handover to transfer.conquestTransfer (call it with the attacker as the new owner + survival fraction + universe + capturedAt); result 'captured' with the transfer event; defeat/stalemate → 'repelled', transfer null (cost/casualties still recorded — the price was paid; document); validation: outcome.result must be a terminal result; structureSurvival in [0,1]; capturedAt positive.
   - `captureSummary(result: CaptureResult): string` — deterministic ('Captured in 4h battle: 10,400 population · 5,200 fleet · 260K cr · 3 structures survived' / 'Repelled: attackers lost 3,000 troops').
   - `captureInvariants(result: CaptureResult): { ok: boolean; problems: string[] }` — captured ⇒ transfer non-null + owner = attacker; repelled ⇒ transfer null; cost/casualties present; structureSurvival respected (turret absent — DELEGATE's contract).
3. Invariants (test): victory → conquestTransfer DELEGATED (verify the transfer event comes from the locked function — construct a minimal universe + call the real transfer; attacker becomes owner); turrets absent + survival fraction applied (via the locked transfer); repelled paths (defeat/stalemate → no transfer); captureId determinism; validation; immutability; determinism.

TESTS (vitest, tests/capture.test.ts, ~28-34): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/capture.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (home-world immunity → T08; escalation → T09/T11).
