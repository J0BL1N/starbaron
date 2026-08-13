TASK (StarBaron P7-T10, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/combat/sim-harness.ts, tests/sim-harness.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
[sim-harness.ts:313] replayCheck is not field-by-field: it ignores outcome identity/timestamp/victory fields, ledger identity/timestamp/result fields, and most conquest-cost fields (targetId, tier, base, escalation) — tampering only one of those returns identical: true, violating the replay gate. Fix: compare EVERY leaf of ScenarioResult in a FIXED DOCUMENTED ORDER, returning the diverging field path (e.g. 'outcome.battleId', 'ledger.result', 'cost.escalation.reason'); add tamper tests for representative omitted fields (outcome.battleId, ledger.result, cost.escalation.reason — and at least one nested numeric like cost.total.population).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/sim-harness.test.ts --pool threads` all pass (report counts). Report changed lines + which tamper test covers which field.
