TASK (StarBaron P3-T10, master roadmap): ECONOMY BALANCING HARNESS — automated economy simulations, cost curves, income curves, time-to-upgrade, early/mid/late progression tests, telemetry-ready outputs. (Phase 3 final task.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/core/economy.ts: LOCKED baselinePassiveIncome, structureCost (1.15^level), tier constants.
- src/sim/structures/framework.ts (P3-T04): buildCost, upgradeCost, canBuild, PREREQUISITES.
- src/sim/structures/production.ts (P3-T06): productionSummaryFor.
- src/sim/structures/housing.ts (P3-T05): housingSnapshot.
- src/sim/structures/queues.ts (P3-T07): queueConstruction, completeDueJobs.
- src/sim/core/offline-model.ts (P3-T08): offlineProgress.
- src/sim/player/types.ts: PlayerState (homePlanet tier, wallet, structureLevels).
- src/sim/structures/data.ts: STRUCTURES.

ALLOWED FILES (create ONLY):
- src/sim/balance/harness.ts   (new folder src/sim/balance/)
- tests/harness.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring. The harness SIMULATES using the locked modules — never re-derives their formulas.

DESIGN SPEC:
1. `ProgressionBand = 'early' | 'mid' | 'late'`.
2. `HarnessPoint = { atSeconds: number; credits: number; alloys: number; population: number; structureLevels: Record<StructureId, number>; income: { creditsPerSec: number; alloysPerSec: number }; band: ProgressionBand }`.
3. `HarnessRun = { config: { tier: number; initialCredits: number; initialAlloys: number; horizonSeconds: number; tickSeconds: number }; points: HarnessPoint[]; summary: { timeToFirstUpgradeSeconds: number; timeToBand: Record<ProgressionBand, number>; finalCredits: number; totalUpgrades: number } }`.
4. `runEconomySimulation(config): HarnessRun` — a DETERMINISTIC simulation:
   - starts with a fresh home planet (tier from config, wallet from config), empty grid, no queues.
   - each tick (tickSeconds, default 60s): accrue income (productionSummaryFor × tickSeconds, using the current grid + tier + no quirks), complete due queue jobs (completeDueJobs), spend to build the CHEAPEST affordable next upgrade (simple greedy policy: pick the structure whose nextBuildCost is smallest and affordable + prereqs met; enqueue via queueConstruction; debit wallet via the cost — the harness owns a simple wallet ledger, documented as the SIMULATION's spend logic, not a new economy module).
   - deterministic: same config → identical points (deep-equal).
   - bands: early = first 15 minutes (900s); mid = up to 4 hours (14400s); late = beyond (document thresholds as exported consts BAND_EARLY_SECONDS=900, BAND_MID_SECONDS=14400).
   - timeToFirstUpgrade = seconds until the first structure completes.
   - telemetry-ready: `harnessTelemetry(run): string` — a deterministic CSV-style line per band: band, creditsPerSec, alloysPerSec, population, structureLevels summary, upgrades — comma-separated, no locale formatting (for later telemetry ingestion; document).
5. `harnessInvariants(run): { ok: boolean; problems: string[] }` — points sorted by time; credits/alloys never negative; population within cap; levels non-negative; summary numbers finite; band thresholds consistent.
6. Invariants (test): determinism (2 runs deep-equal); time-to-first-upgrade positive + matches the cheapest build; credits never negative through the whole run; bands appear in order; totalUpgrades > 0 for a reasonable horizon (e.g. 4h, tier 1, 1000cr); the first upgrade completes within a sane window (documented); harnessInvariants ok on valid runs + catches tamper; telemetry line shape.

TESTS (vitest, tests/harness.test.ts, ~20-26): all invariants + edge configs (tiny horizon → early-only, zero initial credits → first upgrade delayed/never, high tier).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/harness.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (greedy policy documented as a balance-harness input, not a gameplay decision).
