TASK (StarBaron P4-T01, Codex FAIL round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/ui/hud.ts ONLY.

RESTRICTIONS: unchanged — purity, no behavior changes.

CODEX FINDING (fix exactly this):
[src/sim/ui/hud.ts:20] A comment contains the banned token `any` ("maps any provided alerts"). Reword without the token (e.g. "maps provided alerts").

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/hud.test.ts --pool threads` all pass. Report changed line + results.
