TASK (StarBaron P2-T02, Codex FAIL round 3 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/player/assignment.ts, tests/assignment.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic, total attempts never exceed 3 × eligible.length.

CODEX FINDING (fix exactly this):
[src/sim/player/assignment.ts + tests/assignment.test.ts:48-50, 212-229] The odd-sized fixture asserts same-base players CONVERGE, contradicting the task invariant that different same-base players get DISTINCT results when collision probing occurs; the per-attempt player-specific hash is missing. Fix the probe sequence to satisfy ALL requirements simultaneously:

1. PHASE A — player-specific hash probes (up to 2 × n attempts): probe_k = (base + fnv1a(`${salt}|${playerId}|probe|${k}`) % n) % n for k = 1..2n. Player-specific per-attempt offsets → different same-base players diverge at odd sizes (and usually at any size).
2. PHASE B — complete-coverage rotation (only if phase A found nothing): probe = (base + k) % n for k = 1..n (full rotation — guarantees every free body is found; phase A misses a free body only when its offsets skip it).
3. Budget: phase A (2n) + phase B (n) = 3n max. Document the two-phase scheme in the module JSDoc.
4. Tests to update/add:
   - odd-sized set, same-base players, base taken → DISTINCT results (phase A divergence) — update the round-1 fixture test accordingly.
   - power-of-two sized set, same-base players, base taken → converge (documented phase-A property at 2^k sizes) — keep this test.
   - round-1 coverage case ('coverage-probe', 19 eligible, all-but-12 taken → ok with id 12) — must pass via phase A or phase B.
   - budget assertion: the maximum attempts observed across the collision/exhaustion tests is <= 3 × n (export or document maxAttempts).
   - exhaustion still returns { ok:false, reason:'exhausted', attempt } after both phases.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/assignment.test.ts` all pass (report counts). Report changed lines + results + which test covers which requirement.
