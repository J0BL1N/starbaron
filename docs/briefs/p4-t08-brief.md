TASK (StarBaron P4-T08, master roadmap): RESPONSIVE / TOUCH UI — layout classification, breakpoints, touch-target rules, panel stacking, gesture contract. (Pure layout-state contract — the roadmap's mobile-first UX is a locked requirement: phone users are the primary audience.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/ui/hud.ts (P4-T01): HudState.
- src/sim/ui/planet-panel.ts (P4-T04): PanelSection.
- src/sim/ui/empire-overview.ts (P4-T06): EmpireOverview.
- src/sim/ui/notifications.ts (P4-T07): NotificationsState.
- DESIGN.md: read the mobile/layout section if present (any locked breakpoints/touch sizes).

ALLOWED FILES (create ONLY):
- src/sim/ui/layout.ts
- tests/layout.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock; no `any`; strict TS; NO modification of existing files; no React wiring.

DESIGN SPEC:
1. `ViewportClass = 'phone' | 'tablet' | 'desktop'`.
2. `LayoutRules = { viewport: ViewportClass; width: number; height: number; isTouch: boolean; minTouchTargetPx: number; panelMode: 'bottom-sheet' | 'side-panel' | 'floating'; gridColumns: number; safeInsetsPx: { top: number; bottom: number; left: number; right: number } }`.
3. Pure functions:
   - `classifyViewport(width: number, height: number): ViewportClass` — LOCKED breakpoints (export consts): phone < 600px wide; tablet 600–1023px; desktop >= 1024px. (Document: width is the driver; height only matters for orientation edge cases — keep it simple: width-only, documented).
   - `layoutRulesFor(input: { width: number; height: number; isTouch: boolean; safeInsetsPx?: { top?; bottom?; left?; right? } }): LayoutRules` — panelMode: phone → 'bottom-sheet'; tablet → 'side-panel'; desktop → 'floating' (documented mapping); minTouchTargetPx: 44 when isTouch else 32 (roadmap's mobile-first: touch targets >= 44px — verify DESIGN; if DESIGN pins a different number use it); gridColumns: phone 1, tablet 2, desktop 3; safeInsets default 0.
   - `panelLayout(input: { rules: LayoutRules; panels: readonly string[]; activePanel: string | null }): { stacked: string[]; visible: string | null; overlay: boolean }` — phone: ALL panels stack (ordered, one visible, overlay true — bottom-sheet semantics); tablet/desktop: first panel side/floating (overlay false), rest stack. Deterministic.
   - `touchTargetOk(rules: LayoutRules, widthPx: number, heightPx: number): boolean` — width >= minTouchTargetPx && height >= minTouchTargetPx.
   - `validateLayout(rules: LayoutRules): { ok: boolean; problems: string[] }` — viewport consistent with width (phone <600, etc.), minTouchTarget >= 0, gridColumns in 1..3, panelMode matches viewport class.
4. Invariants (test): classifyViewport at boundaries (599/600/1023/1024); layoutRulesFor per class (panelMode, gridColumns, touch target 44/32); panelLayout stacking per class + active/visible + overlay; touchTargetOk math; validateLayout tamper classes; determinism; validation (bad width/height).

TESTS (vitest, tests/layout.test.ts, ~26-30): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/layout.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
