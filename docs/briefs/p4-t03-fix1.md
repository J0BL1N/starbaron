TASK (StarBaron P4-T03, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/ui/info.ts, tests/info.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no behavior changes to the contract fields.

CODEX FINDING (fix exactly this):
[src/sim/ui/info.ts:45,94,216-222] `BodyType` is imported from '../world/identity' — outside the authorised import set (core/format + stdlib). Fix: remove the import and the unsupported body-type whitelist/validation (`type` is already declared as `string | undefined` by the contract). Update the tests that assert the whitelist rejection (bad body type no longer throws — instead it's accepted as an arbitrary string, documented).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/info.test.ts --pool threads` all pass (report counts). Report changed lines + results.
