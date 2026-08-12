READ-ONLY AUDIT — StarBaron P3-T06 (master roadmap): Production Structures.

READ LIST:
- src/sim/structures/production.ts   (NEW — under audit)
- tests/production.test.ts           (NEW — test suite)
- src/sim/structures/effects.ts      (LOCKED rate constants + structureEffect)
- src/sim/player/accrual.ts          (LOCKED composition: computePlanetDerived, effectiveLevel, quirk targeting)
- src/sim/core/economy.ts            (baselinePassiveIncome)
- src/sim/structures/data.ts         (STRUCTURES, STRUCTURE_IDS, isStructureId)
- src/sim/planets/quirks.ts          (QuirkId)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 89c7cb2bd0f50268b4d4d82503661b5607a7a6fa (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p3-t06-brief.md + master roadmap P3-T06):
1. structureRates mirrors effects.ts (ore mine 5/60 per level; trade hub 0.1/level on tier-1 reference baseline; shipyard 50/60); productionSummaryFor applies modifiers PER-STRUCTURE exactly where the locked accrual path does (trade hub tier-scaled + binarySystem; ore mine highGravity; shipyard flat); summary.total + baselinePassiveIncome(tier) === computePlanetDerived.creditsPerSec (verify the identity holds); perStructure sorted by id; empty grid → zero structure production (baseline passive income is NOT structure production — verify this matches the brief's framing).
2. planetEfficiency exposes the composition as a scalar (documented approximation — per-structure application is the exact path).
3. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ structures/**, core/economy, player/accrual (types or values as needed), planets/quirks (RUNTIME imports authorised — quirkById is a pure lookup; CONTRACT CORRECTION: the earlier 'type-only' wording was too strict), stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Rate math EXACTLY mirrors effects.ts (hand-compute: ore Lv3 = 0.25/s; hub Lv2 = 2/s on tier-1 baseline).
C. The credits identity: summary.total.creditsPerSec + baselinePassiveIncome(tier) × binarySystemFactor === computePlanetDerived.creditsPerSec (verify by reading both sides; the implementer claims it — check a tier-3 + quirk example).
D. Per-structure modifier placement matches accrual (tier on trade hub only, highGravity on ore mine, binarySystem on hub, shipyard flat, non-production quirks excluded).
E. Empty grid → zero structure production + seven zero rows; ordering; determinism; validation (bad tier, unknown structure/quirk).
F. Tests ~37 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
