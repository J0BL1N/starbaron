TASK (StarBaron PHASE 7 phase audit round 2 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/combat/capture.ts, tests/capture.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDINGS (fix exactly these):

1. [capture.ts:321-324] capturePlanet validates the outcome and casualty ledger INDEPENDENTLY but never proves they describe the SAME battle — a valid victory outcome can pair with a valid ledger from a different battle/target and still transfer ownership. Fix: add the same identity/result/survivor/defender-loss cross-check used by combat-reports.ts:168-190 (READ it and mirror its cross-source binding: battleId equality, result equality, survivors consistency, defender-loss consistency); add negative tests (outcome.battleId ≠ ledger.battleId throws; result mismatch throws; survivor mismatch throws).

2. [capture.ts:345-358] capturePlanet derives a SYNTHETIC settlementFor(bodyId) and passes it as the conquered planet's current population/garrison/structures — transfer survival is NOT derived from the actual battle state; also supplies previousHistory: []. Fix: REQUIRE the real current target state/history as capture inputs (add `targetCurrent: { population: number; garrison: number; structures: StructureGrid }` + `previousHistory: OwnershipEvent[]` to the input — READ transfer.ts's conquestTransfer input to match the exact shape), delegate those UNCHANGED to conquestTransfer; keep deterministic synthetic fixtures ONLY in tests. Update tests (the victory test passes real target state; survival is derived from the actual battle population).

VERIFY: `npx tsc -b` exit 0; run tests/capture.test.ts with --pool threads — all pass (report counts). Report changed lines + which test covers which finding.
