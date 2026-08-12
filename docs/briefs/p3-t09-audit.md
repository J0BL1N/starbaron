READ-ONLY AUDIT — StarBaron P3-T09 (master roadmap): Planet Quirks model.

READ LIST:
- src/sim/planets/quirk-model.ts   (NEW — under audit)
- tests/quirk-model.test.ts        (NEW — test suite)
- src/sim/planets/quirks.ts        (LOCKED: QUIRK_TABLE, quirkById, triggeredQuirks, pickQuirk)
- src/sim/planets/types.ts         (QuirkId, PlanetQuirk)
- src/sim/player/accrual.ts        (computePlanetDerived — the production-modifier mirror target)
- src/sim/planets/hash.ts          (fnv1a)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 1ca4bce677940016d7e9abdd703b4f3925494252 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p3-t09-brief.md + master roadmap P3-T09):
1. QuirkEffectSummary { id, name, category (atmosphere|gravity|environment|density|star|mass), structureModifier, productionModifier (mirrors locked accrual: binarySystem→trade-hub ×1.1, highGravity→ore-mine ×1.2, others null), blurb }.
2. quirkSummary from the locked table; deterministicQuirks = triggeredQuirks + fnv1a-seeded pick (NEVER a rand fn); quirkEffectOn product; quirkCategories counts.
3. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ planets/quirks, planets/types, planets/hash, structures/types, player/accrual (if needed), ../data/planets (TYPE-ONLY for PlanetCatalogueEntry — pure catalogue data; CONTRACT CORRECTION: this import is authorised), stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Category mapping covers ALL 7 locked quirks deterministically; productionModifier numbers EXACTLY mirror computePlanetDerived (verify 1.1/1.2 against the source).
C. deterministicQuirks: same entry → deep-equal; includes all triggered; no duplicates; ≤1 seeded pick; golden index derivation matches the implementation's own math.
D. quirkEffectOn product math (incl. multi-quirk product); quirkCategories counts.
E. Tests ~45 (it.each expansions) covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
