TASK (StarBaron PHASE 4 phase audit round 4 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/ui/display.ts (NEW), src/sim/ui/hover.ts, src/sim/ui/system-overview.ts, tests/display.test.ts (NEW), tests/hover.test.ts, tests/system-overview.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS.

CODEX FINDING (fix exactly this):
hover.ts:97 and system-overview.ts:125 independently implement the identical `starType → "<letter>-class star"` mapping + unknown/blank fallback ('Unknown star', trimming/capitalisation). Fix:
1. Create src/sim/ui/display.ts exporting `starSummaryFor(starType: string | null | undefined): string` — the shared mapping with the EXACT existing behavior ('G-class star'; unknown/blank → 'Unknown star'; trimming/capitalisation preserved).
2. hover.ts + system-overview.ts import and use it; delete their local copies.
3. tests/display.test.ts (~10-12 tests: known types, unknown, blank, whitespace, null, undefined, determinism). Update hover/system-overview tests that pinned the local behavior (they should still pass via the shared helper).

VERIFY: `npx tsc -b` exit 0; run the 3 test files with --pool threads — all pass (report per-file counts). DO NOT run the full suite.

REPORT: changed lines + which test covers which case.
