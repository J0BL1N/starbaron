# StarBaron — ROADMAP-STATUS.md

*Live execution tracker for `docs/MASTER-ROADMAP.md` (the canonical master roadmap). Updated by Hermes after every task verdict.*

**Execution model (Jay, locked 2026-08-12):** run ALL phases end to end — no stopping at blockers. Per task: OpenCode implements → Codex audits, max 6 FAIL rounds, then record blocker and MOVE ON. After all phases, every blocker gets 3 more attempts; any still failing is listed in the final blocker report.

**Status key:** ⬜ pending · 🔄 in progress · ✅ passed (Codex PASS) · ⛔ blocker (recorded, moved on) · 🔁 retry (blocker revisit)

---

## Phase 1 — Universe Foundation & Data Model

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Canonical Object Identity | ✅ | Codex PASS ×3 rounds — `src/sim/world/identity.ts` + `tests/identity.test.ts` (39 tests): branded GalaxyId/SystemId/BodyId, parent chains, round-trip validation, idSeed=fnv1a. Commits 0410b5d, 4a46bf2 |
| T02 Galaxy Data Model | ✅ | Codex PASS (round 3, pinned commit 7efa0eb) — `src/sim/world/galaxy.ts` + `tests/galaxy-model.test.ts` (29 tests): GalaxyRecord, seeded class/name/universe position (1800-6000 shell), immutable system registry |
| T03 Solar-System Data Model | ✅ | Codex PASS (commit f86ace7) — `src/sim/world/system.ts` + `tests/system-model.test.ts` (30 tests): SystemRecord, star metadata, spiral-arm galaxy-local positions, immutable body registry |
| T04 Celestial-Body Data Model | ✅ | Codex PASS (commit b5d2850) — `src/sim/world/body.ts` + `tests/body-model.test.ts` (42 tests): BodyRecord + typed orbit elements, per-type defaults, star zero-orbit rule, seeded names |
| T05 Real Astronomy Integration | ✅ | Codex PASS (commit 012b96a) — `src/sim/world/catalogue.ts` + `tests/catalogue.test.ts` (35 tests): 6,321 catalogue rows → 4,746 real systems + bodies, provenance flags, canonical-parent validation |
| T06 Persistence Schema | ✅ | Codex PASS (commit d957edd) — `supabase/migrations/0013_world_schema.sql` + `supabase/tests/07_world_schema.sql`: world_galaxies/systems/bodies, CHECKs/UNIQUEs/FKs/cascade, RLS locked. WRITE-ONLY — apply deferred to Jay authorisation |
| T07 Deterministic Universe Reconstruction | ✅ | Codex PASS (commit 58c298d) — `src/sim/world/reconstruct.ts` + `tests/reconstruct.test.ts` (30 tests): seed rebuild, byte-stable serialization, exact parent chains (catalogue galaxySlug option in catalogue.ts) |
| T08 World-State API | ✅ | Codex PASS (commit 77e1c1d) — `src/sim/world/api.ts` + `tests/api.test.ts` (37 tests): query layer, region queries, minimal renderer payloads |
| **Phase 1 whole-phase audit** | ⛔ BLOCKER (r6) | 6 audit rounds: all T01-T08 individually PASS; phase-level fixes r1-r5 landed (SQL grammar, trust removal, registry exactness, ordinal bounds, canonical ordering — 182 tests). Remaining r6 finding: api list/region queries must dedupe duplicate state records by ID (api.ts:168-179,224-231). → blocker revisit pass |

## Phase 2 — Players, Home Worlds & Empire Ownership

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Player Profile | ✅ | Codex PASS (first round) — `src/sim/player/profile.ts` + `tests/profile.test.ts` (27 tests): canonical profile, name/level validation, immutable home-world link |
| T02 Home-World Assignment | ✅ | Codex PASS (round 4) — `src/sim/player/assignment.ts` + `tests/assignment.test.ts` (34 tests): 6,321-body eligible set, two-phase probing (coverage + divergence + 3n budget), exhaustion, repeat-login idempotency |
| T03 Home-World Protection | ✅ | Codex PASS (round 2) — `src/sim/player/protection.ts` (20 tests) + `supabase/migrations/0014_home_world_protection.sql` + `supabase/tests/08` (write-only): transfer/delete trigger, UI protection state, attempted-conquest detection |
| T04 Planet Ownership | ✅ | Codex PASS (first round) — `src/sim/player/ownership.ts` (26 tests) + `supabase/migrations/0015_ownership_audit.sql` + `supabase/tests/09` (write-only): ownership records, transfer events, audit trigger |
| T05 Empire Territory | ✅ | Codex PASS (round 2) — `src/sim/player/territory.ts` + `tests/territory.test.ts` (25 tests): owned bodies, controlled systems, totals, ownership-independent render payloads + separate overlay |
| T06 Colonisation | ✅ | Codex PASS (round 2) — `src/sim/player/colonisation.ts` + `tests/colonisation.test.ts` (32 tests): eligibility ladder, seeded cost 0.9-1.1x, external fleet/travel flags, duplicate prevention |
| T07 Ownership Transfer | ✅ | Codex PASS (round 2) — `src/sim/player/transfer.ts` + `tests/transfer.test.ts` (31 tests): conquest transfer, survival rules, structure survival, notification hooks |
| T08 New-Player Entry Flow | ✅ | Codex PASS (round 3) — `src/sim/player/onboarding.ts` + `tests/onboarding.test.ts` (38 tests): profile+home+starter bundle, camera destination, onboarding state machine, caller-supplied eligibility |
| **Phase 2 whole-phase audit** | ✅ PASS (re-audit round 3) | Outage-blocked re-audit cleared: claim legacy path delegates to canonical flow (injected eligible, full rejection propagation), conquest always destroys turrets (DESIGN §5) — layer parity with SQL |

## Phase 3 — Planet Economy & Structures

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Credits | ✅ | Codex PASS (round 4) — `src/sim/core/transactions.ts` + `tests/transactions.test.ts` (37 tests): validated credit ledger, injective deterministic ids, balance invariants |
| T02 Alloys / Ore | ✅ | Codex PASS (first round) — `src/sim/core/alloys.ts` + `tests/alloys.test.ts` (29 tests): alloy ledger, scarcity curve, defensive demand per DESIGN |
| T03 Population | ✅ | Codex PASS (first round) — `src/sim/core/population-model.ts` + `tests/population-model.test.ts` (38 tests): timestamp recovery, cap/growth wrappers on locked formulas, war-loss hook |
| T04 Structure Framework | ✅ | Codex PASS (round 3) — `src/sim/structures/framework.ts` + `tests/framework.test.ts` (33 tests): prereq table (draft, T10 input), locked cost wrappers, canBuild ladder, deep-frozen immutability |
| T05 Housing | ✅ | Codex PASS (first round) — `src/sim/structures/housing.ts` + `tests/housing.test.ts` (28 tests): locked cap/growth wrappers, upgrade curve, offline outcome, deterministic UI state |
| T06 Production Structures | ✅ | Codex PASS (round 2) — `src/sim/structures/production.ts` + `tests/production.test.ts` (38 tests): per-structure rates mirroring locked accrual, summary API, informational efficiency scalar |
| T07 Construction Queues | ✅ | Codex PASS (round 2) — `src/sim/structures/queues.ts` + `tests/queues.test.ts` (35 tests): reservations, idempotent completion, full-refund cancel, overflow-safe timestamps |
| T08 Offline Progression | ✅ | Codex PASS (round 5) — `src/sim/core/offline-model.ts` + `tests/offline-model.test.ts` (36 tests): locked 8h bank policy, delta contract, population window, construction completion |
| T09 Planet Quirks | ✅ | Codex PASS (round 2) — `src/sim/planets/quirk-model.ts` + `tests/quirk-model.test.ts` (45 tests): effect summaries, deterministic generation, production modifiers mirroring accrual |
| T10 Economy Balancing Harness | ✅ | Codex PASS (round 2) — `src/sim/balance/harness.ts` + `tests/harness.test.ts` (39 tests): deterministic simulations, cost/income curves, bands, telemetry; surfaced tier-1 stall balance finding |
| **Phase 3 whole-phase audit** | ✅ PASS (round 2) | All 8 findings fixed (shared ledger invariants, invented-constraint removal, derived population/income paths via computePlanetDerived, locale-free ordering, frozen tables) — 332 tests across 8 modules |

## Phase 4 — Core Game UI

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Main HUD | ✅ | Codex PASS (round 3) — `src/sim/ui/hud.ts` + `tests/hud.test.ts` (32 tests): HUD state contract, derived alerts, locked aggregates, deterministic summary |
| T02 Contextual Hover Intelligence HUD | ✅ | Codex PASS (round 2) — `src/sim/ui/hover.ts` + `tests/hover.test.ts` (31 tests): per-kind hover info, ownership overlay, smooth-switch contract |
| T03 Object Information Contracts | ✅ | Codex PASS (round 3) — `src/sim/ui/info.ts` + `tests/info.test.ts` (33 tests): visibility levels, hidden-truth-excluding projection, display schema |
| T04 Planet Management Panel | ✅ | Codex PASS (round 2) — `src/sim/ui/planet-panel.ts` + `tests/planet-panel.test.ts` (32 tests): structures/population/production/queues/defenses/ownership/activity via locked modules |
| T05 System Overview | ✅ | Codex PASS (round 2) — `src/sim/ui/system-overview.ts` + `tests/system-overview.test.ts` (36 tests): star summary, body cards (tier/ownership/colonisable), selection |
| T06 Empire Overview | ✅ | Codex PASS (first round) — `src/sim/ui/empire-overview.ts` + `tests/empire-overview.test.ts` (30 tests): planet rows, locked totals, distinct systems, sort/filter |
| T07 Notifications Framework | ✅ | Codex PASS (round 3) — `src/sim/ui/notifications.ts` + `tests/notifications.test.ts` (36 tests): dedup, read/reaction state, expiry, validation |
| T08 Responsive / Touch UI | ✅ | Codex PASS (round 2) — `src/sim/ui/layout.ts` + `tests/layout.test.ts` (34 tests): viewport classes, breakpoints, panel stacking, touch targets, frozen tables |
| T09 UI Mock/Real Data Boundary | ✅ | Codex PASS (round 2) — `src/sim/ui/data-sources.ts` + `tests/data-sources.test.ts` (31 tests): tagged adapters, deterministic mock, guardReal, boundary report |
| **Phase 4 whole-phase audit** | ⛔ BLOCKER #2 (6-round cap) | 5 fix rounds landed (owner-top level hierarchy, per-section gating, gesture contract, shared validator/display helpers, frozen tables, estimated-state emission). Remaining finding for the revisit pass: duplicated deterministic sort comparator (hud.ts:197 vs notifications.ts:195) → extract shared helper |

## Phase 5 — Fleets & Space Travel

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Ship Definitions | ✅ | Codex PASS (first round) — `src/sim/fleet/ships.ts` + `tests/ships.test.ts` (26 tests): 5-class roster, deep-frozen stats, validation |
| T02 Shipyard | ✅ | Codex PASS (first round) — `src/sim/fleet/shipyard.ts` + `tests/shipyard.test.ts` (30 tests): locked fleet-cap/income wrappers, build eligibility ladder, cost math |
| T03 Fleet Creation | ✅ | Codex PASS (first round) — `src/sim/fleet/fleet.ts` + `tests/fleet.test.ts` (34 tests): composition model, cost/size math, eligibility ladder, deterministic ids |
| T04 Fleet Movement | ✅ | Codex PASS (first round) — `src/sim/fleet/movement.ts` + `tests/movement.test.ts` (30 tests): travel math, slowest-ship fleet speed, overflow-safe arrival |
| T05 Timestamp-Based Positioning | ✅ | Codex PASS (round 2) — `src/sim/fleet/positioning.ts` + `tests/positioning.test.ts` (30 tests): deterministic interpolation, boundary contract, no-aliasing |
| T06 Fleet Rendering | ✅ | Codex PASS (round 3) — `src/sim/fleet/render-state.ts` + `tests/render-state.test.ts` (34 tests): LOD apportionment (largest-remainder), scale hints, deterministic labels (mesh art → P12/Kimi K3) |
| T07 Fleet Orders | ✅ | Codex PASS (first round) — `src/sim/fleet/orders.ts` + `tests/orders.test.ts` (34 tests): order queue, one-active semantics, lifecycle, invariants |
| T08 Fleet UI | ✅ | Codex PASS (first round) — `src/sim/ui/fleet-panel.ts` + `tests/fleet-panel.test.ts` (29 tests): list/detail/panel state contracts, deterministic locations |
| T09 Travel Routes | ✅ | Codex PASS (first round) — `src/sim/fleet/routes.ts` + `tests/routes.test.ts` (39 tests): multi-leg planning, ETA, leg indexing |
| T10 Fleet Persistence | ✅ | Codex PASS (round 2) — `src/sim/fleet/persistence.ts` + `tests/persistence.test.ts` (39 tests) + write-only `0017_fleets.sql`/`11_fleets.sql`: serialization contract, round-trip, fleet schema |
| **Phase 5 whole-phase audit** | ✅ PASS (round 6) | 5 fix rounds landed (shared validator, order lifecycle bounds, route geometry validation, numeric-ms SQL mirror, orientation, shipyard queue, frozen tables) — 360+ tests across 10 modules |

## Phase 6 — Scouting, Sensors & Intelligence

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Intel Permission Model | ✅ | Codex PASS (round 2) — `src/sim/intel/permissions.ts` + `tests/permissions.test.ts` (36 tests): relationship-exclusive granted sets (owner/alliance/stranger/unowned), validation |
| T02 Intel Levels | ✅ | Codex PASS (first round) — `src/sim/intel/levels.ts` + `tests/levels.test.ts` (32 tests): roadmap ladder (observed→full intelligence), promotion, coverage, HUD interop |
| T03 Scout Ships | ✅ | Codex PASS (round 2) — `src/sim/intel/scouts.ts` + `tests/scouts.test.ts` (33 tests): scouting profile (power/range/detection/intel ceiling) over locked roster |
| T04 Scout Missions | ✅ | Codex PASS (round 3) — `src/sim/intel/missions.ts` + `tests/missions.test.ts` (39 tests): lifecycle, projected status windows, promotion-only re-record, abort bounds |
| T05 Intel Reports | ✅ | Codex PASS (first round) — `src/sim/intel/reports.ts` + `tests/reports.test.ts` (36 tests): reveal matrix, field projection via info contract, invariants |
| T06 Intel Staleness | ✅ | Codex PASS (first round) — `src/sim/intel/staleness.ts` + `tests/staleness.test.ts` (34 tests): freshness ladder, level decay, rescout hook, store drop |
| T07 PvP Information Gating | ✅ | Codex PASS (round 2) — `src/sim/intel/pvp-gate.ts` + `tests/pvp-gate.test.ts` (39 tests): combined gate, strict no-leak, up-front record validation |
| T08 Intel-Safe Backend | ✅ | Codex PASS (round 3) — `src/sim/intel/store.ts` + `tests/store.test.ts` (47 tests) + write-only `0018_intel.sql`/`12_intel.sql`: store ops, RLS no-leak schema, never-throwing invariants |
| T09 Hover HUD Integration | ✅ | Codex PASS (round 2) — `src/sim/ui/hover-intel.ts` + `tests/hover-intel.test.ts` (32 tests): gated hover compose, intel status line, caller-supplied inputs (no runtime world API), no-leak blocked base |
| T10 Future Sensor Hooks | ✅ | Codex PASS (round 2) — `src/sim/intel/sensors.ts` + `tests/sensors.test.ts` (74 tests): sensor range, signature/stealth hook, detection, counter-intel draft contract |
| **Phase 6 whole-phase audit** | ⛔ BLOCKER #3 (6-round cap) | 5 fix rounds landed (field-key reveal matrix — no alliance leak, read-only decay, mission intel caps, nullable SQL timestamps, server-gate boundary, shared validators/helpers). Remaining finding for the revisit pass: extract the shared TargetIntel record-shape validator (pvp-gate.ts vs store.ts duplication) |

## Phase 7 — Combat & Planet Conquest

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Attack Orders | ✅ | Codex PASS (round 2) — `src/sim/combat/attack-orders.ts` + `tests/attack-orders.test.ts` (36 tests): DESIGN-locked launch cost via estimator, committed troops, status projection |
| T02 Invasion Fleet | ✅ | Codex PASS (round 2) — `src/sim/combat/invasion.ts` + `tests/invasion.test.ts` (39 tests): locked garrison-cap recruitment, committed-whether-win-or-lose, dup-name rejection |
| T03 Combat Resolution | ✅ | Codex PASS (round 2) — `src/sim/combat/resolution.ts` + `tests/resolution.test.ts` (42 tests): locked AP/DP delegation, 3-way outcome (victory/stalemate/defeat), casualties |
| T04 Planet Defense | ✅ | Codex PASS (round 2) — `src/sim/combat/defense.ts` + `tests/defense.test.ts` (52 tests): garrison-inclusive DP, breakdown (no double-count), readiness threshold |
| T05 Population Casualties | ✅ | Codex PASS (round 2) — `src/sim/combat/casualties.ts` + `tests/casualties.test.ts` (38 tests): outcome delegation, DESIGN committed-loss, garrison mapping (victory wipe / 20% / 0) |
| T06 Conquest Cost | ✅ | Codex PASS (first round) — `src/sim/combat/conquest-cost.ts` + `tests/conquest-cost.test.ts` (38 tests): escalating curve, empire multiplier cap ×2.0, summary |
| T07 Planet Capture | ⬜ | |
| T08 Home-World Immunity | ✅ | Codex PASS (round 2) — `src/sim/combat/home-immunity.ts` + `tests/home-immunity.test.ts` (26 tests) + write-only `0019_home_immunity.sql`/13: launch + conquest guards over locked protection, RLS SQL |
| T09 Combat Reports | ⬜ | |
| T10 Combat Simulation Harness | ⬜ | |
| T11 Attack Notifications | ⬜ | |

## Phase 8 — Diplomacy & Alliances

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Alliance Creation | ⬜ | |
| T02 Membership | ⬜ | |
| T03 Alliance Roles | ⬜ | |
| T04 Diplomatic States | ⬜ | |
| T05 Alliance Territory | ⬜ | |
| T06 Shared Intelligence | ⬜ | |
| T07 Alliance Wars | ⬜ | |
| T08 Alliance Coordination | ⬜ | |
| T09 Diplomacy UI | ⬜ | |

## Phase 9 — Trading & Galactic Economy

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Tradable Resources | ⬜ | |
| T02 Direct Trade | ⬜ | |
| T03 Trade Fleets | ⬜ | |
| T04 Trade Routes | ⬜ | |
| T05 Market | ⬜ | |
| T06 Market Pricing | ⬜ | |
| T07 Alliance Trading | ⬜ | |
| T08 Trade Risk | ⬜ | |
| T09 Economy Telemetry | ⬜ | |
| T10 Trading UI | ⬜ | |

## Phase 10 — Persistent MMO World

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 World Event Scheduler | ⬜ | |
| T02 Timestamp Simulation | ⬜ | |
| T03 Event Resolution | ⬜ | |
| T04 Regional Loading | ⬜ | |
| T05 Viewport Reconstruction | ⬜ | |
| T06 Continuous Player Population | ⬜ | |
| T07 Concurrency | ⬜ | |
| T08 Server Authority | ⬜ | |
| T09 World History | ⬜ | |
| T10 Scale Testing | ⬜ | |
| T11 Observability | ⬜ | |

## Phase 11 — 4X Progression & Long-Term Game

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Explore Progression | ⬜ | |
| T02 Expand Progression | ⬜ | |
| T03 Exploit Progression | ⬜ | |
| T04 Exterminate Progression | ⬜ | |
| T05 Technology System | ⬜ | |
| T06 Empire Specialisation | ⬜ | |
| T07 Leaderboards | ⬜ | |
| T08 Seasonal Layer | ⬜ | |
| T09 Achievements | ⬜ | |
| T10 Retention Balancing | ⬜ | |

## Phase 12 — Visual Assets, Release, Mobile & Scale Polish

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Three.js Performance Pass | ⬜ | |
| T02 Full LOD Audit | ⬜ | |
| T03 Procedural Planet & Galaxy Generation Upgrade | ⬜ | (Kimi K3 generator expertise first) |
| T04 Ship / Station / Structure Art Pipeline | ⬜ | (Kimi K3) |
| T05 Adaptive Graphics | ⬜ | (photo mode prototype exists in previews — port here) |
| T06 Mobile Controls | ⬜ | |
| T07 Capacitor App | ⬜ | |
| T08 Save / Reconnect Resilience | ⬜ | |
| T09 Security Audit | ⬜ | |
| T10 Performance Testing | ⬜ | |
| T11 FLUX Avatar / 2D Asset Pipeline | ⬜ | (local FLUX pipeline) |
| T12 Launch Readiness | ⬜ | (deploy = Jay authorisation only) |

---

## Blocker log (recorded when a task hits the 6-FAIL cap; revisited ×3 after all phases)

| Task | Blocker | Attempts | Final |
|---|---|---|---|
| — | — | — | — |
