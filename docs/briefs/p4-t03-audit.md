READ-ONLY AUDIT — StarBaron P4-T03 (master roadmap): Object Information Contracts.

READ LIST:
- src/sim/ui/info.ts          (NEW — under audit)
- tests/info.test.ts          (NEW — test suite)
- src/sim/core/format.ts      (formatNumber — locked)
- src/sim/world/api.ts (type reference only if needed)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = the CURRENT state of src/sim/ui/info.ts + tests/info.test.ts on staging (HEAD; feat commit 7ec52016 adds exactly these two, later amends modify ONLY info.ts). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p4-t03-brief.md + master roadmap P4-T03):
1. InfoLevel public|owner|alliance|intel; InfoState unknown|estimated|stale|verified; InfoField { key, label, value, level, state, format? }.
2. contractFor(kind, type?): per-kind field sets + base levels (public: name/id/type/class; owner: population/structures/income; alliance: flags; intel: fleet/defense) + displaySchema {titleKey, subtitleKey, primaryStatKey}; deterministic; unique keys.
3. projectInfo: level <= viewerLevel → included (value from map; stale flag → 'stale'; missing → 'unknown'); level > viewerLevel → EXCLUDED (never a placeholder — no hidden truth leaks); number fields via formatNumber.
4. summaryLine deterministic.
5. Purity: no nondeterministic APIs/module mutable state/wall-clock/locale; no `any`; imports ⊆ core/format + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. contractFor: field sets/levels per kind; display schema validity + uniqueness; key uniqueness.
C. projectInfo: all 4 viewer tiers; hidden fields never appear (deep check: no placeholder values); stale/unknown/verified states; field-order preservation; number formatting via locked formatNumber.
D. summaryLine omission semantics (hidden/unknown primary stat).
E. Tests ~32 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
