TASK (StarBaron PHASE 2 re-audit round 3 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/player/transfer.ts, tests/transfer.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
[transfer.ts:151-168,198] conquest structure survival applies the caller's fraction to EVERY structure INCLUDING defenseTurret — a structureSurvival of 1 preserves turrets. DESIGN §5 locks: conquered planets retain all structures EXCEPT defenses — Turrets are ALWAYS destroyed in the fall (the SQL resolution already removes defenseTurret, so the layers disagree). Fix: unconditionally OMIT defenseTurret from structureSurvivors/conquestTransfer results (the survival fraction applies to all OTHER structures only); document the DESIGN lock; add regression coverage: conquestTransfer with structureSurvival 1 → defenseTurret level 0 in the survivor grid (all other structures survive); with fraction 0.5 → turret 0 + others halved.

VERIFY: `npx tsc -b` exit 0; run tests/transfer.test.ts with --pool threads — all pass (report counts). Report changed lines + results.
