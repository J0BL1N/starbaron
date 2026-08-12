TASK (StarBaron P4-T03, Codex FAIL round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/ui/info.ts ONLY.

RESTRICTIONS: unchanged — purity, no behavior changes.

CODEX FINDING (fix exactly this):
[src/sim/ui/info.ts:39] A comment contains the banned token `locale` ("no locale APIs"). Reword without that token (e.g. "no environment-dependent formatting APIs").

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/info.test.ts --pool threads` all pass. Report changed line + results.
