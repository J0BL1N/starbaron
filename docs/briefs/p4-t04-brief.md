TASK (StarBaron P4-T04, master roadmap): PLANET MANAGEMENT PANEL — structures, population, production, queues, defenses, ownership, current activity. (Pure UI-state contract — components consume it.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/ui/hud.ts (P4-T01): HudState pattern.
- src/sim/structures/production.ts (P3-T06): productionSummaryFor.
- src/sim/structures/framework.ts (P3-T04): buildCost, canBuild (post-phase-fix: no prereqs/maxLevel).
- src/sim/structures/queues.ts (P3-T07): ConstructionQueue, completeDueJobs, jobsAt.
- src/sim/core/population-model.ts (P3-T03): applyGrowth, populationCapFor.
- src/sim/player/accrual.ts: computePlanetDerived (derived cap/rate — the LOCKED composition).
- src/sim/structures/effects.ts: defensePower (locked).
- src/sim/player/ownership.ts: OwnershipRecord.
- src/sim/core/format.ts: formatNumber.
- src/sim/player/types.ts: PlayerState, OwnedPlanet.

ALLOWED FILES (create ONLY):
- src/sim/ui/planet-panel.ts
- tests/planet-panel.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no React wiring. Everything delegates to the locked modules (no re-derived formulas).

DESIGN SPEC:
1. `PanelSection = { structures: { id: string; name: string; level: number; nextCost: number; buildable: boolean }[]; population: { current: number; cap: number; growthPerSec: number }; production: { creditsPerSec: number; alloysPerSec: number }; queues: { building: number; nextCompletionAt: number | null }; defenses: { defensePower: number }; ownership: { ownerId: string; isHome: boolean; protected: boolean }; activity: string }`.
2. `planetPanelStateFor(input: { player: PlayerState; planetName: string; queue: ConstructionQueue; at: number; ownership?: OwnershipRecord }): PanelSection`
   - structures: from player.structureLevels[planetName] (grid) + framework buildCost for each; buildable = canBuild with the wallet (empty grid check); ordered by STRUCTURE_IDS.
   - population: computePlanetDerived for the planet (LOCKED cap/rate) + current from the OwnedPlanet.
   - production: productionSummaryFor for the planet's grid/tier.
   - queues: building count + next completion (from queue jobsAt/completeDueJobs semantics — the next finishesAt among building jobs; null when none).
   - defenses: defensePower(turretLevels, population) (LOCKED).
   - ownership: from the ownership record (ownerId, isHome, protected = isHome && unconquerable).
   - activity: deterministic one-line ('Building Housing → Lv 2 · completes in 20s' from the queue; 'Idle' when no jobs; 'Offline' when at - lastTickAt > 24h — reuse HUD_STALE_SECONDS semantics; export the const or duplicate with a comment).
3. Invariants (test): structures rows (level, cost, buildable ladder), population from derived (LOCKED numbers), production from locked summary, queue building/next-completion, defensePower locked math, ownership fields, activity strings (building/idle/offline), determinism, validation (unknown planetName throws).

TESTS (vitest, tests/planet-panel.test.ts, ~26-32): all invariants + edges (no queue, no ownership record, stale player).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/planet-panel.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
