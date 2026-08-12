TASK (StarBaron P2-T06, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/player/colonisation.ts ONLY.

RESTRICTIONS: unchanged — purity, no behavior changes.

CODEX FINDING (fix exactly this):
[src/sim/player/colonisation.ts:12] A comment contains the prohibited wall-clock API token `Date.now()`. Reword the purity documentation without naming that API (e.g. "timestamps are caller-supplied inputs").

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/colonisation.test.ts` all pass. Report changed line + results.
