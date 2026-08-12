TASK (StarBaron P4-T07, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/ui/notifications.ts, tests/notifications.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS.

CODEX FINDING (fix exactly this):
[src/sim/ui/notifications.ts:192] `react` carries forward `state.unreadCount` instead of recomputing it from the resulting items — a tampered count stays incorrect after a reaction transition. Fix: return `unreadCount: recomputeUnreadCount(items)` (or equivalent recomputation). Add a test: `react` on a state with a DELIBERATELY mismatched unreadCount repairs it.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/notifications.test.ts --pool threads` all pass (report counts). Report changed lines + results.
