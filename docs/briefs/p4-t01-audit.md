READ-ONLY AUDIT — StarBaron P4-T01 (master roadmap): Main HUD state contract.

READ LIST:
- src/sim/ui/hud.ts          (NEW — under audit)
- tests/hud.test.ts          (NEW — test suite)
- src/sim/player/accrual.ts  (planetTotals, computePlanetDerived — aggregates)
- src/sim/world/api.ts       (queryBody)
- src/sim/core/format.ts     (formatNumber — locked)
- src/sim/player/types.ts    (PlayerState)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = the CURRENT state of src/sim/ui/hud.ts + tests/hud.test.ts on staging (HEAD). The implementation commits (feat + audit-fix amends) modify ONLY these two files. Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p4-t01-brief.md + master roadmap P4-T01):
1. HudState { at, location {kind,id,name}, resources, population {total, home, cap}, alerts, focusedBody|null }; HudAlert { id (fnv1a(message|at) deterministic), severity, message, at }.
2. hudStateFor: resources from wallet; population via LOCKED aggregates (planetTotals/computePlanetDerived — verify); focusedBody via queryBody (null when absent/unparseable); alerts mapped + sorted (at, id).
3. hudAlertsFor: derived alerts (cap → info, low credits < 100 → warning, stale > 24h → info, colonise suggestion → info) with exported thresholds; fixed derivation order; deterministic.
4. hudSummary uses locked formatNumber (no locale APIs).
5. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ player/accrual, world/api, core/format, player/types (+ colonies/colonisation for the cost const), stdlib, PLUS (CONTRACT CORRECTION — all pure): ../planets/hash (fnv1a — the canonical hash), ../world/identity + ../world/reconstruct (TYPE-ONLY for BodyId/UniverseState).

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Population aggregates match the locked path (total + summed caps); resources exact.
C. focusedBody resolution incl. absent/fabricated/unparseable → null.
D. Alert derivation: each of the 4 triggers fires on the right state; id determinism (same inputs → same ids); sort order.
E. hudSummary determinism + no locale; validation (bad at, bad location).
F. Tests ~31 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
