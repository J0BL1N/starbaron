READ-ONLY AUDIT — StarBaron P6-T06 (master roadmap): Intel Staleness.

READ LIST:
- src/sim/intel/staleness.ts   (NEW — under audit)
- tests/staleness.test.ts      (NEW — test suite)
- src/sim/intel/levels.ts      (P6-T02: TargetIntel, IntelLevel ladder)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 78cd58162445b26c38374ec5c86422cb2f1cfb97 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p6-t06-brief.md + master roadmap P6-T06):
1. Freshness fresh|aging|stale|expired via 3 thresholds (FRESH 6h / AGING 24h / STALE 72h; exact edges land on the OLDER state — 6h→aging, 24h→stale, 72h→expired; EXPIRED_AFTER const dropped as redundant — documented).
2. decayedLevel: fresh→unchanged; aging→−1 rung; stale→−2 rungs; expired→none (never shows better-than-current data).
3. needsRescout: stale or expired (age ≥ 24h — fires at the AGING window so the player can refresh before the 72h drop; documented).
4. applyDecay: expired/never-updated → null; else decayed level + lastUpdatedAt UNCHANGED (only recordIntel resets the clock); stalenessSummary deterministic ('Fresh · scanned · updated 2h ago' / 'Expired — rescout needed').
5. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ intel/levels + ui/validate + stdlib; banned comment tokens absent.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Freshness boundaries (exact 6h/24h/72h edges); thresholds frozen.
C. Decay table (6 levels × 4 states — hand-computed; e.g. full intelligence aging → deep recon; observed aging → none); monotonic degradation.
D. needsRescout boundary (exactly 24h); applyDecay (immutability, null on expired, clock preservation); summary determinism + clamp of negative age.
E. Tests ~34 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
