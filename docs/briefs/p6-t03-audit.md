READ-ONLY AUDIT — StarBaron P6-T03 (master roadmap): Scout Ships.

READ LIST:
- src/sim/intel/scouts.ts     (NEW — under audit)
- tests/scouts.test.ts        (NEW — test suite)
- src/sim/fleet/ships.ts      (P5-T01: LOCKED SHIP_CLASSES.scout stats)
- src/sim/intel/levels.ts     (P6-T02: IntelLevel)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT d5fa3e141dee473c58bdac0b70cebfabc161a5c8 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p6-t03-brief.md + master roadmap P6-T03):
1. ScoutProfile { scoutCount, scoutingPower (scoutCount × LOCKED 100 — delegated), sensorRangePc (5 + log10(1+power), draft), scoutSpeedPcPerSec (LOCKED 1.5 — delegated), detectionChance (clamp 0.05 + power/10000, 0.05..0.95), maxIntelLevel (0→none; 1-2→scanned; 3-9→scouted; 10+→deep recon; 'full intelligence' unreachable by scouts — probe/attack-only, documented) }.
2. canScout (scoutCount > 0); scoutSummary deterministic.
3. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ fleet/ships + intel/levels + stdlib + (CONTRACT CORRECTION — pure type): ../fleet/fleet (TYPE-ONLY FleetComposition); banned comment tokens absent; no re-derived locked constants (source-scan guarded).

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Profile math (hand-computed 3 scouts: power 300, range ≈7.48, speed 1.5, detection 0.08, intel 'scouted'); delegation to LOCKED roster values (no literal 100/1.5).
C. maxIntelLevel thresholds (0/1/2/3/9/10); unreachable 'full intelligence' documented; canScout; validation (bad counts).
D. scoutSummary determinism; determinism overall.
E. Tests ~33 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
