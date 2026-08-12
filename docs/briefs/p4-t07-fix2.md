TASK (StarBaron P4-T07, Codex FAIL round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/ui/notifications.ts, tests/notifications.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS.

CODEX FINDING (fix exactly this):
[src/sim/ui/notifications.ts:263-271] `validateNotifications` accepts an empty reaction (a tampered state with `reactions: ['']` reports valid), while `react` rejects one — violating "collects ALL tamper classes". Fix: while iterating reactions, add a per-reaction non-empty-string validation problem ('' or whitespace-only → problem). Add a tamper test: `reactions: ['']` → not ok with the new problem entry.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/notifications.test.ts --pool threads` all pass (report counts). Report changed lines + results.
