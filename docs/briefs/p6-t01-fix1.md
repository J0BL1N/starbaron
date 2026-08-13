TASK (StarBaron P6-T01, Codex FAIL round 1 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/intel/permissions.ts, tests/permissions.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDINGS (fix exactly these):

1. [permissions.ts:46-48] Runtime imports of INFO_LEVELS (ui/info) + assertNonEmptyString (ui/validate) violate the type-only import policy. Fix: define a LOCAL frozen level list (deep-frozen `INTEL_LEVELS` const, documented as mirroring the info.ts order) + a LOCAL non-empty-string assertion; retain only the InfoLevel TYPE import from ui/info.

2. [permissions.ts:189-193] intelGrants skips assertViewer/assertTarget — an empty viewerId (or invalid target ids) yields grants instead of the validation error the other exports produce. Fix: call both assertions before computing grants; add tests: intelGrants with empty viewerId throws; with empty targetId throws.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/permissions.test.ts --pool threads` all pass (report counts). Report changed lines + results + which test covers which finding.
