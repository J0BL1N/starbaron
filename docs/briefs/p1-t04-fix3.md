TASK (StarBaron P1-T04, Codex FAIL round 3 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/world/body.ts, tests/body-model.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic.

CODEX FINDINGS (fix exactly these):

1. [src/sim/world/body.ts:5] A comment contains the banned purity phrase `global state`. Reword it without that exact phrase (e.g. "no shared mutable data").

2. [tests/body-model.test.ts:374] Distinct IDs are tested but their default orbits are never compared. Add a deterministic regression assertion: two bodies of the same type with distinct ordinals (e.g. planet ordinal 1 vs 2, same system) must have DIFFERENT default orbits (compare at least one field, e.g. semiMajorAxis or period, with a strict inequality).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/body-model.test.ts` all pass (report counts). Report changed lines + results.
