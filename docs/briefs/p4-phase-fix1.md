TASK (StarBaron PHASE 4 whole-phase audit FAIL — FIX ALL 7 FINDINGS, no broadening; this closes Phase 4):

ALLOWED FILES (ONLY): src/sim/ui/*.ts (hud, hover, info, planet-panel, system-overview, empire-overview, notifications, layout, data-sources) + tests/hud.test.ts, tests/hover.test.ts, tests/info.test.ts, tests/planet-panel.test.ts, tests/system-overview.test.ts, tests/empire-overview.test.ts, tests/notifications.test.ts, tests/layout.test.ts, tests/data-sources.test.ts. NEW file allowed: src/sim/ui/validate.ts (the shared validator) + tests/validate.test.ts. Do NOT touch anything else (locked modules stay unmodified).

RESTRICTIONS: purity preserved (no nondeterministic APIs, no module-level MUTABLE state — tables deep-frozen, no wall-clock, no locale APIs, no banned comment tokens — do NOT write the literal tokens 'any', 'Math.random', 'Date.now', 'performance.now', 'localeCompare', 'locale', 'global state', 'shared mutable data' in code comments); no `any`; strict TS; deterministic.

FINDINGS (fix exactly these; current staging state):

1. [T01/T07 — hud.ts:203] HUD alerts sort OLDEST-first (a.at - b.at); notifications are NEWEST-first with id tie-break. Fix: sort HUD alerts newest-first: `b.at - a.at || idAscending`. Update the hud tests that pin the old order.

2. [T05/T07 — unknown-id semantics] markRead/react throw RangeError('unknown notification id …'); selectBody + systemOverviewFor throw generic Error. Fix: ALL unknown-id operations throw RangeError with ONE message style: `unknown ${kind} id ${JSON.stringify(id)}` (kinds: 'notification', 'body', 'system'). Update the affected tests to assert RangeError.

3. [T02/T03/T04/T05 — info-gating] hover.ts exposes ownedBy whenever an ownership map is supplied; system-overview.ts exposes ownerId/colonisable/coloniseCost WITHOUT a viewer level; planet-panel.ts lets a caller-supplied ownership record override ownership fields. Fix: add an explicit `viewerLevel: InfoLevel` input to hoverInfoFor, systemOverviewFor, planetPanelStateFor (default? NO — make it REQUIRED, callers must pass their authorization) and derive the gated fields through info.ts's contract:
   - hover.ts: ownedBy only when 'owner' or above; otherwise null.
   - system-overview.ts: ownerId/colonisable/coloniseCost only when 'owner' or above; otherwise null/undefined per the shape (colonisable false + coloniseCost null for non-owner viewers — document).
   - planet-panel.ts: ownership fields only when 'owner' or above; otherwise the ownership section shows the public subset (ownerId null etc.).
   Add tests: public-viewer calls get no ownership/colonisation data; owner-level calls get it.

4. [T03 — info.ts] projectInfo rewrites present intel fields to verified/stale, discarding the 'estimated' base qualifier — no display projection can ever emit estimated. Fix: after null/stale handling, RETAIN `field.state === 'estimated'` for present estimated fields (only absent → unknown; stale flag → stale; otherwise keep the contract's base state). Add tests: a present intel field projects with state 'estimated'.

5. [T01/T02/T03 — frozen tables] info.ts (GALAXY_FIELDS/SYSTEM_FIELDS/BODY_FIELDS/FIELD_DEFS/DISPLAY_SCHEMAS), hover.ts (~68-81), hud.ts (~88-94) module-level tables are mutable at runtime. Fix: deep-freeze them (Object.freeze on each table AND each contained object/array; keep readonly typing). Add/extend purity tests asserting Object.isFrozen (deep) on the tables.

6. [T01/T02/T04-T09 — duplicated validator] assertPositiveAt is implemented 7 times. Fix: create src/sim/ui/validate.ts exporting ONE `assertPositiveAt(at: number): void` (RangeError, the established message) + `assertNonEmptyString` if needed; import it in hud, hover, planet-panel, system-overview, empire-overview, notifications, data-sources, layout (wherever the pattern exists); delete the local copies. tests/validate.test.ts (~8-10 tests). Update any tests that asserted the exact old message text (keep the message identical).

7. [T08 — missing gesture contract] layout.ts has no gesture contract. Fix: add to layout.ts:
   - `GestureKind = 'tap' | 'long-press' | 'swipe' | 'pinch'`.
   - `GestureContract = { kind: GestureKind; durationMs: number | null; distancePx: number | null; scaleDelta: number | null }`.
   - `classifyGesture(input: { kind: GestureKind; durationMs: number; distancePx: number; scaleDelta?: number }): GestureContract` — bounds (exported consts): tap duration <= 500ms, distance <= 10px; long-press duration >= 500ms; swipe distance >= 30px; pinch scaleDelta >= 0.1 (min zoom) — validate: kind requires its fields (pinch without scaleDelta throws; swipe without distance throws; etc.); returns the frozen-ish contract (document determinism).
   - `gestureAction(kind: GestureKind, rules: LayoutRules): string` — deterministic mapping: tap → 'select'; long-press → 'context-menu'; swipe → 'navigate'; pinch → 'zoom' (documented as the v1 mapping; the exact handlers are the UI's concern).
   Tests: classification per kind + boundary cases (499/500ms; 9/10px; 29/30px; 0.09/0.1) + rejection (missing required field) + gestureAction mapping.

VERIFY (focused per-file runs only): `npx tsc -b` exit 0; run ALL 10 test files with --pool threads — all pass (report per-file counts). DO NOT run the full suite.

REPORT: per-finding changed lines + which test covers which finding.
