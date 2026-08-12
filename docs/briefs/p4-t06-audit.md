READ-ONLY AUDIT — StarBaron P4-T06 (master roadmap): Empire Overview.

READ LIST:
- src/sim/ui/empire-overview.ts   (NEW — under audit)
- tests/empire-overview.test.ts   (NEW — test suite)
- src/sim/player/accrual.ts       (empireRates, planetTotals, computePlanetDerived — locked)
- src/sim/player/types.ts         (OwnedPlanet — no systemId field; verify)
- src/sim/structures/effects.ts   (defensePower — locked)
- src/sim/world/identity.ts       (systemId derivation via CATALOGUE_SLUG+hostname)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT bc4bd5442dfb662d14666c44ed366c32473588ff (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p4-t06-brief.md + master roadmap P4-T06):
1. EmpireRow { name, tier, isHome, population, income, defense, systemId }; EmpireOverview { playerId, empireName, totals {planets, systems, population, creditsPerSec, alloysPerSec, defense}, rows, topPlanet|null, sortedBy, filter }.
2. empireOverviewFor: totals via LOCKED empireRates/planetTotals; systems = distinct system ids (derived via the locked systemId(CATALOGUE_SLUG, hostname) derivation — the same one claim/assignment use); defense via locked defensePower per planet; topPlanet = max population (ties: name, id).
3. sortEmpire (population desc / income credits desc / name asc; ties name then id) + filterEmpire (totals RECOMPUTED over visible rows) — both immutable.
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ the listed modules + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Totals match locked empireRates/planetTotals exactly; systems count distinct + derived via the SAME derivation as claim/assignment (consistent ids).
C. Per-row income via locked computePlanetDerived (reconciles with empireRates); defense via locked defensePower.
D. topPlanet; sort orders + tie-breaks; filter semantics + totals recompute (tests pin both paths equal).
E. Validation (bad at); determinism; tests ~30 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
