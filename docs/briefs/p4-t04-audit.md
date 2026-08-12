READ-ONLY AUDIT — StarBaron P4-T04 (master roadmap): Planet Management Panel.

READ LIST:
- src/sim/ui/planet-panel.ts   (NEW — under audit)
- tests/planet-panel.test.ts   (NEW — test suite)
- src/sim/player/accrual.ts    (computePlanetDerived, gridForPlanet — locked)
- src/sim/structures/production.ts (P3-T06)
- src/sim/structures/framework.ts  (P3-T04: buildCost, canBuild)
- src/sim/structures/queues.ts     (P3-T07: jobsAt)
- src/sim/structures/effects.ts    (defensePower — locked)
- src/sim/ui/hud.ts                (P4-T01: HUD_STALE_SECONDS)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 8a4d13e54b8311242fb698a9f0549fe5ae7a6f93 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p4-t04-brief.md + master roadmap P4-T04):
1. PanelSection { structures[], population {current,cap,growthPerSec}, production, queues {building, nextCompletionAt|null}, defenses {defensePower}, ownership {ownerId, isHome, protected}, activity string }.
2. planetPanelStateFor: structures from grid + framework (buildable via canBuild); population from LOCKED computePlanetDerived; production from locked productionSummaryFor; queues building count + next completion from jobsAt; defenses via locked defensePower; ownership from the record; activity Building/Idle/Offline (Offline when stale > 24h, wins).
3. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ the locked modules + hud (HUD_STALE_SECONDS) + stdlib; no re-derived formulas. PLUS (CONTRACT CORRECTION — all pure): ../player/claim (planet lookup helpers), ../player/player (createPlayer/state helpers — type/read use), ../player/ownership (OwnershipRecord type), ../player/types (OwnedPlanet/PlayerState types), ../structures/data (STRUCTURE_IDS/STRUCTURES metadata), ../structures/types (StructureId).

CHECK:
A. Purity + imports; no banned tokens in comments.
B. All section values come from the LOCKED modules (no formula re-derivation — spot-check population cap/rate, production, defense).
C. Structures rows: level, nextCost (buildCost), buildable ladder (canBuild) — order by STRUCTURE_IDS.
D. Queues: building count excludes complete/cancelled; nextCompletionAt = earliest building finishesAt (null when none).
E. Ownership fields; activity strings incl. Offline precedence + 24h boundary; validation (unknown planet, bad at).
F. Tests ~32 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
