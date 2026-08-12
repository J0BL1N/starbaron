# StarBaron — ROADMAP-STATUS.md

*Live execution tracker for `docs/MASTER-ROADMAP.md` (the canonical master roadmap). Updated by Hermes after every task verdict.*

**Execution model (Jay, locked 2026-08-12):** run ALL phases end to end — no stopping at blockers. Per task: OpenCode implements → Codex audits, max 6 FAIL rounds, then record blocker and MOVE ON. After all phases, every blocker gets 3 more attempts; any still failing is listed in the final blocker report.

**Status key:** ⬜ pending · 🔄 in progress · ✅ passed (Codex PASS) · ⛔ blocker (recorded, moved on) · 🔁 retry (blocker revisit)

---

## Phase 1 — Universe Foundation & Data Model

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Canonical Object Identity | ✅ | Codex PASS ×3 rounds — `src/sim/world/identity.ts` + `tests/identity.test.ts` (39 tests): branded GalaxyId/SystemId/BodyId, parent chains, round-trip validation, idSeed=fnv1a. Commits 0410b5d, 4a46bf2 |
| T02 Galaxy Data Model | ⬜ | |
| T03 Solar-System Data Model | ⬜ | |
| T04 Celestial-Body Data Model | ⬜ | |
| T05 Real Astronomy Integration | ⬜ | (catalogue snapshot + drift gate exist — verify canonical mapping) |
| T06 Persistence Schema | ⬜ | (migration apply = Jay authorisation only) |
| T07 Deterministic Universe Reconstruction | ⬜ | |
| T08 World-State API | ⬜ | |

## Phase 2 — Players, Home Worlds & Empire Ownership

| Task | Status | Verdict / evidence |
|---|---|---|
| T01 Player Profile | ⬜ | |
| T02 Home-World Assignment | ⬜ | (claim.ts exists, audited — verify against new spec) |
| T03 Home-World Protection | ⬜ | |
| T04 Planet Ownership | ⬜ | |
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
