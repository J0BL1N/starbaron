TASK (StarBaron P3-T06, Codex FAIL round 1 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/structures/production.ts ONLY (tests untouched unless a compile fix requires a type-only change).

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no behavior changes.

CODEX FINDINGS (fix exactly these):

1. [src/sim/structures/production.ts:34] `QuirkId` is imported from '../planets/types' — outside the authorised set (planets/quirks). Fix: remove that import and derive the type from the permitted import — e.g. `type QuirkId = Parameters<typeof quirkById>[0]` using the `quirkById` export from ../planets/quirks (VERIFY that export exists and its parameter type is QuirkId; if the export shape differs, use the cleanest permitted derivation and document).

2. [src/sim/structures/production.ts:140-147] `planetEfficiency` must EXPLICITLY document itself as an informational approximation: its scalar combines modifiers that apply to DIFFERENT structures, so it must NOT be applied uniformly; state that `productionSummaryFor`'s per-structure path is the exact accrual mirror and is authoritative.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/production.test.ts --pool threads` all pass. Report changed lines + results.
