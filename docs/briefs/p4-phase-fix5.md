TASK (StarBaron PHASE 4 phase audit round 5 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/ui/hover.ts, src/sim/ui/empire-overview.ts ONLY (comment rewording, no behavior changes).

RESTRICTIONS: unchanged — purity.

CODEX FINDING (fix exactly this):
- [hover.ts:26] A comment contains the banned token `locale`. Reword without it (e.g. "no environment-dependent formatting APIs").
- [empire-overview.ts:49] A comment contains the banned token `locale`. Reword without it.

VERIFY: `npx tsc -b` exit 0; run tests/hover.test.ts + tests/empire-overview.test.ts with --pool threads — all pass. Report changed lines + results.
