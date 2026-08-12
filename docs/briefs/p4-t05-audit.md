READ-ONLY AUDIT — StarBaron P4-T05 (master roadmap): System Overview.

READ LIST:
- src/sim/ui/system-overview.ts   (NEW — under audit)
- tests/system-overview.test.ts   (NEW — test suite)
- src/sim/world/api.ts            (querySystem, queryBodiesBySystem)
- src/sim/world/body.ts, system.ts (record shapes)
- src/sim/player/colonisation.ts  (COLONISATION_BASE_COST — locked)
- src/sim/player/territory.ts     (ownership overlay pattern)
- src/sim/data/planets.ts         (pinned catalogue tier mapping — the implementer's locked tier source, since levels.ts has NO planetTier; verify that claim)
- src/sim/planets/quirks.ts       (GAS_GIANT_DENSITY_MAX — gas-giant exclusion)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT e4e750f748e31c4956b63cf2c6faa7e624a87900 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p4-t05-brief.md + master roadmap P4-T05):
1. BodyCard { id, name, type, radiusKm, tier|null, ownerId|null, colonisable, coloniseCost|null }; SystemOverview { systemId, systemName, starSummary, bodies (radius-descending, id tie-break), selectedBodyId|null }.
2. systemOverviewFor: resolves via query layer; starSummary deterministic; ownership from the map; selection passthrough (null when not in list); selectBody immutable (unknown id throws).
3. Tier: pinned-catalogue tier by body name with gas-giant exclusion (tier 5 + density < GAS_GIANT_DENSITY_MAX → null); non-planets never colonisable; coloniseCost = credits component of COLONISATION_BASE_COST when colonisable.
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ the listed modules + stdlib, PLUS (CONTRACT CORRECTION — pure type imports): ../world/reconstruct + ../world/identity (type-only: UniverseState/BodyId).

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Star summary (class + body count, 'Unknown star' fallback); body ordering (radius desc, id tie-break).
C. Tier mapping: planet vs non-planet; gas-giant exclusion; ownership; colonisable/coloniseCost (owned vs free vs gas giant/star/asteroid).
D. Selection passthrough + selectBody (unknown id throws); at validation.
E. Tests ~36 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
