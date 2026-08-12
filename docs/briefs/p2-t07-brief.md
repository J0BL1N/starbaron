TASK (StarBaron P2-T07, master roadmap): OWNERSHIP TRANSFER — conquest transfer mechanism with population/structure survival rules, previous-owner history, transaction safety, and notification hooks.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/player/ownership.ts (P2-T04): OwnershipRecord, OwnershipEvent, transferOwnership (throws on unconquerable — the protection integration), historyAppend, ownershipHistory.
- src/sim/player/protection.ts (P2-T03): deriveProtection, attemptedConquest.
- src/sim/player/colonisation.ts (P2-T06): colonise pattern (ladder + result unions).
- src/sim/player/types.ts: OwnedPlanet { population, garrison, fleet, structureLevels-ish }.
- src/sim/structures/types.ts: StructureGrid (Record<StructureId, number>) — read-only reference.

ALLOWED FILES (create ONLY):
- src/sim/player/transfer.ts
- tests/transfer.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring. Combat MATH is P7 — this task implements the transfer MECHANISM; survival fractions arrive as inputs (documented; P7 computes them).

DESIGN SPEC:
1. `SurvivalRules = { populationSurvival: number; structureSurvival: number; garrisonSurvival: number }` — fractions in [0,1] (validated; throw descriptive Error outside).
2. `TransferOutcome = { record: OwnershipRecord; event: OwnershipEvent; survivors: { population: number; garrison: number }; structures: StructureGrid; notifications: TransferNotification[] }`.
3. `TransferNotification = { kind: 'ownership-lost' | 'ownership-gained'; bodyId: BodyId; ownerId: string; at: number }` — the notification hook (P4-T07 wires the UI).
4. `conquestTransfer(input: { record: OwnershipRecord; toOwnerId: string; at: number; survival: SurvivalRules; structures: StructureGrid; previousHistory: OwnershipEvent[] }): TransferOutcome | { ok: false; reason: 'protected' | 'self-transfer' }`
   - uses ownership.transferOwnership semantics (throws on unconquerable → convert to { ok:false, reason:'protected' } — do NOT let the throw escape; determinism preserved).
   - survivors: roundHalfUp(population * survival.populationSurvival), garrison similarly (from input.record? — record has no population… see note: input carries current population/garrison — add to input: `current: { population: number; garrison: number }`).
   - structures: immutable map multiply — each level: floor(level * survival.structureSurvival) (per structure id), zero levels dropped.
   - previous-owner history: event.previousOwnerId = record.ownerId; historyAppend(previousHistory, event).
   - notifications: one 'ownership-lost' (to previous owner) + one 'ownership-gained' (to new owner).
5. `applySurvival(current: number, fraction: number): number` — exported: Math.round(current * fraction) with fraction clamp [0,1].
6. `structureSurvivors(grid: StructureGrid, fraction: number): StructureGrid` — exported, immutable.
7. Invariants (test): protected/self-transfer → ok:false; success — record (previousOwnerId = old owner, method 'conquest', at), event, survivors math (rounding), structure floor math + immutability, history appended (previousHistory not mutated), notifications exact (2, kinds + owners), determinism, survival fraction validation (outside [0,1] throws).

TESTS (vitest, tests/transfer.test.ts, ~26-32): all invariants + edge cases (zero survivors, zero structures, full survival = identity-ish, empty history).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/transfer.test.ts` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
