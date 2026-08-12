READ-ONLY AUDIT — StarBaron P4-T08 (master roadmap): Responsive / Touch UI contract.

READ LIST:
- src/sim/ui/layout.ts        (NEW — under audit)
- tests/layout.test.ts        (NEW — test suite)
- DESIGN.md (mobile section — the implementer says no numeric touch target pinned; verify)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 08bb36956940183b8fa5ddfcb8c498271ff930f5 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p4-t08-brief.md + master roadmap P4-T08):
1. classifyViewport: phone < 600, tablet 600-1023, desktop >= 1024 (width-only, documented); layoutRulesFor: panelMode phone→bottom-sheet / tablet→side-panel / desktop→floating; minTouchTargetPx 44 touch / 32 pointer; gridColumns 1/2/3; safeInsets default 0.
2. panelLayout: phone stacks ALL panels (overlay true); tablet/desktop first panel persistent (overlay false) + rest stacked; touchTargetOk math; validateLayout (viewport-consistency, minTouchTarget >= 0, gridColumns 1..3, panelMode matches class).
3. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Breakpoint boundaries (599/600/1023/1024); per-class mappings; touch-target 44/32.
C. panelLayout stacking per class + active/visible/overlay semantics; touchTargetOk.
D. validateLayout tamper classes; determinism; validation (bad width/height).
E. Tests ~31 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
