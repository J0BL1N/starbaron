READ-ONLY AUDIT — StarBaron P6-T09 (master roadmap): Hover HUD Integration.

READ LIST:
- src/sim/ui/hover-intel.ts    (NEW — under audit)
- tests/hover-intel.test.ts    (NEW — test suite)
- src/sim/ui/hover.ts          (P4-T02: hoverInfoFor — signature incl. viewerLevel)
- src/sim/intel/pvp-gate.ts    (P6-T07: pvpGatedView — authoritative)
- src/sim/intel/levels.ts      (P6-T02: coverageFor, IntelLevel)
- src/sim/intel/staleness.ts   (P6-T06: Freshness)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 5d65148730689c8d815de0d1424a6484cc2fca6d (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p6-t09-brief.md + master roadmap P6-T09):
1. IntelHoverInfo { base (HoverInfo), intelLine|null, blocked|null, shownFromIntel }.
2. hoverIntelInfo: base = hoverInfoFor (viewerLevel 'public' when blocked; reveal tier when intel-sourced; relationship tier otherwise); gated = pvpGatedView (authoritative); blocked → public-safe base + no intel line; intel-sourced → stats replaced by the gated visible fields (null → 'Unknown'), ownedBy forced null (no owner leak), intelLine from coverageFor + freshness + age ('Scouted intel · aging · updated 3h ago'); owner/alliance/unowned → plain hover; integrity guard: target.id === targetContext.targetId (RangeError otherwise); miss → null (hoverInfoFor convention).
3. intelStatusLine standalone (deterministic; stored level headline — documented choice; floored s/m/h/d age).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ ui/hover + intel/* + ui/validate + stdlib + (CONTRACT CORRECTION — pure types): ./info (InfoField — the gated field type) + ../world/* (type-only: UniverseState/positions for the hoverInfoFor input shape); banned comment tokens absent.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Blocked path: public-safe base (NO owner stats leak — verify ownedBy/stats); no intel line.
C. Intel path: stats from gated visible fields; ownedBy null; intelLine format; decayed-vs-stored level documented consistently with stalenessSummary.
D. Owner/alliance/unowned plain hover (unchanged); integrity guard; null on miss.
E. intelStatusLine determinism; validation; tests ~32 covering; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
