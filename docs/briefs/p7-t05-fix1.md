TASK (StarBaron P7-T05, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/combat/casualties.ts, tests/casualties.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
[casualties.ts:184] permits a fractional defenderGarrisonBefore while the victory branch copies it directly into garrisonLoss — a fractional garrison produces a ledger rejected by its own integer invariant. Fix: validate defenderGarrisonBefore as a non-negative INTEGER (RangeError on fractional/negative — use the shared validator if one fits, else a local integer check with the established message style); add a fractional-garrison rejection test.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/casualties.test.ts --pool threads` all pass (report counts). Report changed lines + results.
