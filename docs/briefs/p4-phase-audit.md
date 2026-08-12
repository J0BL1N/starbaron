READ-ONLY WHOLE-PHASE AUDIT — StarBaron PHASE 4 (Core Game UI), cross-task coherence.

READ LIST (all Phase 4 deliverables in src/sim/ui/):
- hud.ts + tests/hud.test.ts                 (T01 main HUD)
- hover.ts + tests/hover.test.ts             (T02 hover intelligence)
- info.ts + tests/info.test.ts               (T03 object info contracts)
- planet-panel.ts + tests/planet-panel.test.ts (T04 planet management panel)
- system-overview.ts + tests/system-overview.test.ts (T05 system overview)
- empire-overview.ts + tests/empire-overview.test.ts (T06 empire overview)
- notifications.ts + tests/notifications.test.ts (T07 notifications)
- layout.ts + tests/layout.test.ts           (T08 responsive/touch)
- data-sources.ts + tests/data-sources.test.ts (T09 mock/real boundary)
- Locked sources they consume: player/accrual.ts, world/api.ts, core/format.ts, structures/* (framework/production/queues/effects/data), core/population-model.ts, planets/hash.ts

AUDIT TARGET: the whole Phase 4 feature set on staging (through the P4-T09 PASS state, INCLUDING the phase-fix commit 7fd1f22 which addresses all 7 prior findings). Docs commits OUT OF SCOPE.

CHECK — CROSS-TASK COHERENCE:
A. LOCKED-FORMULA DISCIPLINE: every Phase 4 module delegates to the locked sources (accrual/api/format/structures/population-model) — no re-derived economy/population/defense formula anywhere in src/sim/ui/ (spot-check planet-panel population/defense, empire-overview totals, hover stats).
B. ID/DETERMINISM CONVENTIONS: fnv1a is the ONLY hash; alert/notification ids deterministic; no Math.random/Date/performance/locale APIs (comments included) in ANY of the 9 modules; no module-level MUTABLE state (deep-frozen tables — check layout/info/others).
C. VALIDATION CONSISTENCY: `at` validated the same way across modules (positive finite; RangeError); unknown-id throws consistent (markRead/selectBody/react); the same error-message style.
D. INFO-GATING CONSISTENCY: info.ts levels (public/owner/alliance/intel) are the single source; hover/system-overview/planet-panel present only what their consumers are allowed (spot-check: planet-panel ownership fields vs info contract levels; system-overview coloniseCost visibility).
E. UI-STATE SHAPE CONSISTENCY: PanelSection/EmpireOverview/SystemOverview/HudState use the same number formatting (locked formatNumber, no locale); the same date/time conventions; the same sorting conventions (at desc id tie-break where sorting by time).
F. MOCK/REAL BOUNDARY: data-sources is the ONLY place mock fixtures live; no other module fabricates player/universe state; guardReal is exported and would be the only gate (spot-check nothing bypasses).
G. GAP SCAN vs the roadmap's P4 subtask list (HUD location/resources/population/alerts/focus; galaxy/system/star/planet/moon/asteroid hover + smooth switching; public/owner/alliance/intel-gated fields + unknown/estimated/stale/verified states + display schema; structures/population/production/queues/defenses/ownership/activity; star summary/body cards/colonisable/selection; planet list/totals/system counts/top planets/sort/filter; types/creation/dedup/ordering/expiry/unread/read/reaction; layout classification/breakpoints/touch targets/panel stacking/gesture contract; mock/real separation/adapters/switch mechanics) — flag any subtask with NO implementation surface.
H. No duplicated logic across the 9 modules (same validation/formula implemented twice).

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix, implicated task). PASS → phase-level invariants verified. Keep under ~1300 words.
