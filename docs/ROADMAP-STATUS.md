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
| T05 Empire Territory | ⬜ | |
| T06 Colonisation | ⬜ | |
| T07 Ownership Transfer | ⬜ | |
| T08 New-Player Entry Flow | ⬜ | |

## Phase 3 — Planet Economy & Structures

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Credits | ⬜ | (src/sim/core/economy.ts exists) |
| T02 Alloys / Ore | ⬜ | |
| T03 Population | ⬜ | (src/sim/core/population.ts exists) |
| T04 Structure Framework | ⬜ | (src/sim/structures exists) |
| T05 Housing | ⬜ | |
| T06 Production Structures | ⬜ | |
| T07 Construction Queues | ⬜ | |
| T08 Offline Progression | ⬜ | (src/sim/core/offline.ts exists) |
| T09 Planet Quirks | ⬜ | (src/sim/planets/quirks.ts exists) |
| T10 Economy Balancing Harness | ⬜ | |

## Phase 4 — Core Game UI

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Main HUD | ⬜ | |
| T02 Contextual Hover Intelligence HUD | ⬜ | |
| T03 Object Information Contracts | ⬜ | |
| T04 Planet Management Panel | ⬜ | |
| T05 System Overview | ⬜ | |
| T06 Empire Overview | ⬜ | |
| T07 Notifications Framework | ⬜ | |
| T08 Responsive / Touch UI | ⬜ | |
| T09 UI Mock/Real Data Boundary | ⬜ | |

## Phase 5 — Fleets & Space Travel

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Ship Definitions | ⬜ | |
| T02 Shipyard | ⬜ | |
| T03 Fleet Creation | ⬜ | |
| T04 Fleet Movement | ⬜ | |
| T05 Timestamp-Based Positioning | ⬜ | |
| T06 Fleet Rendering | ⬜ | (Kimi K3: ship/fleet visual language first) |
| T07 Fleet Orders | ⬜ | |
| T08 Fleet UI | ⬜ | |
| T09 Travel Routes | ⬜ | |
| T10 Fleet Persistence | ⬜ | |

## Phase 6 — Scouting, Sensors & Intelligence

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Intel Permission Model | ⬜ | |
| T02 Intel Levels | ⬜ | |
| T03 Scout Ships | ⬜ | |
| T04 Scout Missions | ⬜ | |
| T05 Intel Reports | ⬜ | |
| T06 Intel Staleness | ⬜ | |
| T07 PvP Information Gating | ⬜ | |
| T08 Intel-Safe Backend | ⬜ | |
| T09 Hover HUD Integration | ⬜ | |
| T10 Future Sensor Hooks | ⬜ | |

## Phase 7 — Combat & Planet Conquest

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Attack Orders | ⬜ | |
| T02 Invasion Fleet | ⬜ | |
| T03 Combat Resolution | ⬜ | |
| T04 Planet Defense | ⬜ | |
| T05 Population Casualties | ⬜ | |
| T06 Conquest Cost | ⬜ | |
| T07 Planet Capture | ⬜ | |
| T08 Home-World Immunity | ⬜ | |
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
