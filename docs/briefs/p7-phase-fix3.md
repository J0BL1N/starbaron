TASK (StarBaron PHASE 7 phase audit round 3 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/combat/sim-harness.ts, tests/sim-harness.test.ts, src/sim/ui/attack-notifications.ts, tests/attack-notifications.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDINGS (fix exactly these):

1. [sim-harness.ts:300-321,423-445] runScenario FABRICATES the target owner, ownership record, settlement state, and empty history — every harness target is forcibly a normal colony, so protected-home capture can't be replayed through the harness. Fix: REQUIRE real records on BattleScenario — add `targetPlayer: PlayerState`, `targetOwnership: OwnershipRecord`, `targetCurrent: { population, garrison, structures }`, `targetHistory: OwnershipEvent[]` (READ capture.ts's CaptureInput — it now requires exactly these — and mirror); validate them (the capture binding checks — bodyId/ownerId match); pass them UNCHANGED to launch (targetOwner), resolution (targetOwner), and capture (targetOwnership/targetCurrent/targetHistory). Add a protected-home scenario test (targetPlayer whose home is the target → runScenario throws the home-world guard Error).

2. [attack-notifications.ts:107-116] notificationId uses DECIMAL FNV-1a (`String(fnv1a(...))`) — the phase convention is HEX (attack/battle/capture/report ids all use .toString(16)). Fix: `fnv1a(...).toString(16)`; update the decimal expectations in tests/attack-notifications.test.ts:108-113 to hex.

VERIFY: `npx tsc -b` exit 0; run tests/sim-harness.test.ts + tests/attack-notifications.test.ts with --pool threads — all pass (report counts). DO NOT run the full suite.

REPORT: changed lines + which test covers which finding.
