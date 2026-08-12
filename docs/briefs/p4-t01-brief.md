TASK (StarBaron P4-T01, master roadmap): MAIN HUD — canonical HUD state contract: current location, resources, population, alerts, selected/focused body, responsive layout data. (Phase 4 = Core Game UI; keep the pure-model-first pattern — this task delivers the HUD STATE CONTRACT + UI-ready projections; the React components consume them in later tasks.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/player/types.ts: PlayerState { homePlanet, colonies, wallet, structureLevels, lastTickAt }.
- src/sim/player/accrual.ts: planetTotals, empireRates (locked aggregates).
- src/sim/world/api.ts (P1-T08): querySystem, queryBody.
- src/sim/world/reconstruct.ts (P1-T07): UniverseState.
- src/sim/core/format.ts: formatNumber (LOCKED formatting).
- src/sim/structures/production.ts (P3-T06): productionSummaryFor.
- src/ui/PlanetView.tsx + src/ui/useGameState.ts: the EXISTING UI (read-only reference for what the HUD must cover: location, resources bar, population, focus).

ALLOWED FILES (create ONLY):
- src/sim/ui/hud.ts   (new folder src/sim/ui/ for UI-state contracts)
- tests/hud.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no React/rendering wiring (this is the state contract; components come later).

DESIGN SPEC:
1. `HudLocation = { kind: 'planet' | 'moon' | 'system' | 'galaxy' | 'universe'; id: string; name: string }`.
2. `HudState = { at: number; location: HudLocation; resources: { credits: number; alloys: number }; population: { total: number; home: number; cap: number }; alerts: HudAlert[]; focusedBody: { id: string; name: string; type: string } | null }`.
3. `HudAlert = { id: string; severity: 'info' | 'warning' | 'danger'; message: string; at: number }` — id deterministic (fnv1a of message+at).
4. Pure functions:
   - `hudStateFor(input: { player: PlayerState; universe: UniverseState; at: number; location: HudLocation; focusedBodyId?: string; alerts?: readonly { severity: 'info'|'warning'|'danger'; message: string; at: number }[] }): HudState`
     - resources from player.wallet; population: total via empireRates(player) or planetTotals (READ accrual for the exact aggregate + cap); location passthrough; focusedBody resolved via queryBody when the id is given (name/type from the record; null when absent or not given); alerts mapped + id'd deterministically, sorted by at then id.
   - `hudAlertsFor(player: PlayerState, at: number): HudAlert[]` — DERIVED alerts from state: population at cap → 'info' alert; wallet credits below a threshold (e.g. < 100) → 'warning'; lastTickAt stale (> 24h) → 'info' offline alert; colony count 0 with colonise cost affordable → 'info' suggestion. Thresholds exported as consts (HUD_CREDIT_WARNING_THRESHOLD=100, HUD_STALE_SECONDS=24*3600). Deterministic order.
   - `hudSummary(state: HudState): string` — one-line deterministic summary for tooltips ('HD 564 b · 2.3M cr · 8.5K pop · 0 alerts' style; use formatNumber — NO locale APIs; comma grouping manual).
5. Invariants (test): resources/population from the locked aggregates; focusedBody resolution (present/absent); alerts id determinism + sort; hudAlertsFor each derived alert (cap, low credits, stale, colony suggestion — trigger each by constructing the right state); hudSummary shape; determinism; validation (bad at, bad location kind).

TESTS (vitest, tests/hud.test.ts, ~24-30): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/hud.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
