# StarBaron — ROADMAP.md

*Completion record. DESIGN.md = what we're building. WORKFLOW.md = how we build it. This file = what's done + evidence.*

**Subtask key (TradieHubAU pattern):**
- `-A` Audit/bound scope — what exists, exclusions, blockers (docs-only)
- `-B` Implement the primary bounded change
- `-C` Negative-path + regression coverage
- `-D` Package evidence + Codex audit PASS

---

## Phase 1 — Core Idle Engine + Web Preview

> **STATUS: COMPLETE** — whole-phase Codex PASS. 5 tasks, 217 tests / 13 files, tsc/build/lint all 0, dev 200. Evidence: `docs/P1_PHASE1_EVIDENCE.md`.

**Goal:** playable web preview of the idle loop (feel the game in days). No PvP, no backend yet.

| Task | Subtask | Scope | Status |
|---|---|---|---|
| **P1-T01** Scaffold | **-A** | Audit: confirm empty project, tool versions (node, npm, uv), decide Vite+TS+vitest layout | **Complete** — audit doc committed (3f1ebe6); decisions: flat root, latest majors, drop uv, skip re-init, lockfile committed |
| | **-B** | Scaffold Vite+TS project, vitest config, folder structure (src/sim, src/ui, tests), git init + main/staging branches | **Complete** — scaffold committed (fe9c8b4); vite react-ts, pinned deps, vitest 5/5 smoke PASS |
| | **-C** | Smoke test: dev server starts, vitest runs a trivial test, build passes — original T02 core sim engine scope folded in (income, ×1.15 cost curve, population, offline calc, formatting) | **Complete** — sim core 4 modules (economy/population/offline/format), 39 tests PASS, tsc 0, build 0 |
| | **-D** | Evidence: scaffold SHA, branch state, Codex PASS | **Complete** — docs/P1_T01_EVIDENCE.md, Codex PASS, see evidence |
| **P1-T02** Structures v1 | **-A** | Audit: structure interface, data shape for all 7 structures | **Complete** — docs/P1_T02_A_AUDIT.md (2fa0733); 7-structure roster + data model locked to DESIGN §4c/§4d; Shipyard income blocker resolved by Jay (+50cr/min, DESIGN §4d); exclusions + 5 bounded decisions |
| | **-B** | Implement: Ore Mine, Trade Hub, Housing, Hydroponics, Barracks, Shipyard, Defense Turret — cost, build time, effect per level | **Complete** — src/sim/structures (types/data/effects), 7 structures, discriminated effects, nextBuildCost wrapper, +64 tests (d04f9c3) |
| | **-C** | Negative paths: level/id validation, cost regression, large levels, data integrity (wallet "cannot afford" deferred to T03/04 per audit) | **Complete** — cost regression ×1.15, large levels (100/1,000) finite, data integrity, runtime id guard +19 tests (a116feb) |
| | **-D** | Evidence + Codex PASS | **Complete** — docs/P1_T02_EVIDENCE.md; Codex PASS per subtask; full suite 6 files/83 tests PASS, tsc 0, build 0, lint 0 |
| **P1-T03** Web preview UI | **-A** | Audit: screen spec (§5c DESIGN.md) — Planet View, structure grid, build menu, resource bar, offline summary modal | **Complete** — docs/P1_T03_A_AUDIT.md (584d700); component tree + sim inventory verified, exclusions, decisions A–F recommended + G/H resolved (simulated preview-only offline, 8h cap all paths) |
| | **-B** | Implement Planet View: planet display, structure grid, build menu, live resource bar | **Complete** — PlanetView + 5 components + useGameState, UI wallet (1,000cr/0/1,000pop), capped tick accrual, dark theme, +92 tests (e1ff985) |
| | **-C** | Offline summary modal ("While you were away…"), empty states, rapid-click safety | **Complete** — negative-path coverage; offline-summary cap-clamp bug fixed (+57.6K → +4K, test strengthened), sim-purity guard, +34 tests (5f1cb0d) |
| | **-D** | Evidence + Codex PASS | **Complete** — docs/P1_T03_EVIDENCE.md; Codex PASS per subtask; full suite 9 files/126 tests PASS, tsc 0, build 0, lint 0, dev 200 |
| **P1-T04** Save/load + onboarding | **-A** | Audit: save schema, tutorial steps (§5c), polish list | **Complete** — docs/P1_T04_A_AUDIT.md (885293f); SaveGameV1 schema + validation rules, hybrid persistence (debounce/buy/unload flush), real offline-gap replacing the T03 simulation, 4-step onboarding set, decisions A–H |
| | **-B** | Implement: localStorage save/load, onboarding tutorial (claim planet → housing → ore mine → offline reveal) | **Complete** — src/ui/save.ts + useGameState rehydrate/persist, hybrid save, real offline gap, 4-step tutorial, +33 tests, 159 total (d36ce5c) |
| | **-C** | Corrupt save handling, version migration, tutorial skip/resume | **Complete** — corrupt-save matrix + storage/privacy edges + gap-boundary tests + skip/resume/deep onboarding + round-trip integrity, +46 tests (52a75a9) |
| | **-D** | Evidence + Codex PASS | **Complete** — docs/P1_T04_EVIDENCE.md; Codex PASS per subtask; full suite 13 files/205 tests PASS, tsc 0, build 0, lint 0 |
| **P1-T05** Phase closeout | **-A** | Whole-phase audit prep: reconcile all evidence | **Complete** — all P1 evidence reconciled into `docs/P1_PHASE1_EVIDENCE.md` (5 tasks, commit log, 217 tests, gates) |
| | **-B** | Final whole-phase Codex audit across P1 stack | **Complete** — 6 cross-cutting findings (militia DP, barracks 1:1 conservation, sync offline checkpoint, Qa/Qi/Sx suffixes, ROADMAP wording, dead assets) |
| | **-C** | Fix any cross-cutting findings (same round), re-audit | **Complete** — all 6 fixed in 18fd410 (3 correction rounds → re-audit); +12 regression tests → 217 |
| | **-D** | Closeout evidence + ROADMAP update, report to Jay | **Complete** — docs/P1_PHASE1_EVIDENCE.md + this row; whole-phase Codex PASS; see evidence |

---

## Phase 2 — Real Universe + Planets

> **STATUS: COMPLETE** — whole-phase Codex PASS. 4 tasks, 508 tests / 32 files, tsc/build/lint all 0, drift gate OK. Evidence: `docs/P2_PHASE2_EVIDENCE.md`. Whole-phase findings fixed: effectiveLevel live-path bypass (`3addad9`), binary quirk level-0 **Option A resolved by Jay 2026-08-09** (baseline-trait; pinned by `tests/binarysystem-level0.test.ts`).

**Goal:** real exoplanet catalogue import, planet claiming, multi-planet economies.

| Task | Subtask | Scope | Status |
|---|---|---|---|
| **P2-T01** Catalogue import | **-A** | Audit: NASA Exoplanet Archive export format, fields needed (name, tier, star type, distance), licensing | **Complete** — docs/P2_T01_A_AUDIT.md; TAP source verified live (6,336 confirmed planets), 7-field set + derived tier, half-open tier mapping, public-domain licensing, snapshot-not-live, decisions A–G |
| | **-B** | Import script: fetch/parse archive → typed dataset (JSON/TS), size check | **Complete** — scripts/import-planets.mjs (zero-dep) + pinned CSV (ps-export-2026-08-08.csv) → src/sim/data/planets.ts (6,321 planets, PLANET_SNAPSHOT), 7 columns SELECTed, radius-first tier, drift gate |
| | **-C** | Edge cases: missing fields, duplicate names, format drift | **Complete** — 3 test files: import negatives (width/dedupe/schema/empty), exact boundary semantics, sha-pinned drift gate, min-row guard (6,000), missing-field policy; +45 tests + sim-purity +3 |
| | **-D** | Evidence + Codex PASS | **Complete** — docs/P2_T01_EVIDENCE.md; Codex PASS per subtask + whole task; full suite 16 files/265 tests PASS, tsc 0, build 0, lint 0, --check OK |
| **P2-T02** Planet model | **-A** | Audit: tier system (T1–T5), stats mapping, structure slots | **Complete** — docs/P2_T02_A_AUDIT.md + DESIGN lock-ins (unlimited slots, tier pop-cap, renaming note); entity shape + derived stats + generator design, D1–D4, B3–B5 |
| | **-B** | Implement: planet entity — tier, stats, slots, baseline income by tier | **Complete** — src/sim/planets (9 modules): PlanetState immutable snapshot, 10×tier income, tier pop-cap 1.0/1.2/1.4/1.7/2.0, effectiveLevel (half-after-10) wired into all 7 structure effects, FNV-1a+mulberry32 generator (visual/quirk/description), 7-quirk table, D4 fallbacks, 317 tests |
| | **-C** | Negative paths: tier bounds, slot overflow | **Complete** — planets-model/planet-identity/planets-deep coverage: seed uniqueness (all 6,321), trigger >=/< boundaries, D4 fallback paths, deep immutability, purity +9 modules; showcase page (docs/showcase.html); full suite 20 files/338 tests PASS, tsc 0, build 0, lint 0, --check OK |
| | **-D** | Evidence + Codex PASS | **Complete** — docs/P2_T02_EVIDENCE.md; Codex PASS per subtask + whole task; decisions B1–B5 resolved (incl. renaming parked); findings fixed (immutable copy, seed-uniqueness test, palette-combinatorics resolved empirically) |
| **P2-T03** Claim flow | **-A** | Audit: new-player claim (1 unique planet), colonise empty planets | **Complete** — docs/P2_T03_A_AUDIT.md; auto-claim first boot (no button), sim-layer PlayerState, hash→index assignment, PvP hooks (isHome/unconquerable/claimedAt), save v1→v2 migration, decisions D1–D8 |
| | **-B** | Implement: claim pool (unclaimed index), assign on signup, colonise flow | **Complete** — src/sim/player (5 modules), wallet promoted UI→sim, deterministic fnv1a("starbaron-claim-v1")%catalogue, auto-claim at first boot, SaveGameV2 + MIGRATIONS[1], colonise validated, 394 tests |
| | **-C** | Edge: pool exhaustion, double-claim prevention | **Complete** — claims-deep/player-wallet/save-migration-edge + expanded save/corrupt/savepersist; pool exhaustion edge, double-claim RangeError, corrupt-v2 matrix, stable playerId + synchronous write, fabricated-home repair, +82 tests, 420 total |
| | **-D** | Evidence + Codex PASS | **Complete** — docs/P2_T03_EVIDENCE.md; Codex PASS per subtask + whole task; findings fixed (migration stability, v2 validation, fixture ??-swallow, corrupt-v2); spurious stale-fixture finding disproven |
| | **+UI** | Colonise button (2026-08-09 follow-up) | **Complete** — 'Colonise' button in PlanetView (useGameState colonise action); placeholder `COLONISE_COST_CREDITS = 1000` (exactly starter wallet) — **FLAGGED: playtest balance question** (DESIGN D5 locks colonise FREE; cost is UI-layer placeholder, ~3-line strip if Jay decides free at playtest). 7 tests; suite 33 files / 515 PASS |
| **P2-T04** Multi-planet economies | **-A** | Audit: per-planet grid isolation, shared player wallet vs per-planet | **Complete** — docs/P2_T04_A_AUDIT.md; wallet scope D1 (shared credits+alloys, per-planet pop/garrison/fleet), name-keyed grids, per-planet accrual, planet selector (UI-only, D5), v2→v3 migration shape, decisions D1–D8, §9 known findings |
| | **-B** | Implement: each planet = own structure grid + income; switch planets in UI | **Complete** — src/sim/player accrual.ts + per-planet OwnedPlanet fields + Record<name,StructureGrid>, quirks + tier pop-cap wiring (both audit gaps closed), PlanetSelector, SaveGameV3 + MIGRATIONS[2] with tombstone, PvP tunables draft in DESIGN §5a, 462 tests |
| | **-C** | Cross-planet bugs: income mixing, structure bleed | **Complete** — planets-multideep/save-v3-deep/planetview-selector + expanded save/planetview; income-sum isolation, structure bleed, per-planet caps + quirks, v2→v3 matrix, corrupt-v3 shapes, +71 tests, 491 total |
| | **-D** | Evidence + Codex PASS | **Complete** — docs/P2_T04_EVIDENCE.md; Codex PASS per subtask + whole task; binary quirk level-0 FLAGGED for Jay (Option A/B pending), live-grid-reference + saveHelpers fixture notes carried |

---

## Phase 3 — Supabase Backend + Async PvP

**Goal:** shared universe, async attacks, band-together, fortification.

| Task | Subtask | Scope | Status |
|---|---|---|---|
| **P3-T01** Supabase schema | **-A** | Audit: schema design — players, planets, structures, population, attack timers, RLS | **Complete** — docs/P3_T01_A_AUDIT.md (b8f5b24); 12 decisions D1–D12 approved by Jay 2026-08-09 (anon auth, JSONB grids, no server catalogue, game_config balance seed, DB-function resolve, server-authoritative) |
| | **-B** | Implement: forward-only migrations, tables + RLS + indexes | **Complete** — supabase/migrations 0001–0007 (players/owned_planets JSONB grids + uniqueness, meta tables, claim/colonise RPCs, attacks/attack_members, attack RPCs + lazy resolve, game_config seed, 0007 security revokes); **Codex PASS after 6 audit rounds** (8+3+3+2+2 findings all fixed: anon sign-ins, resolve gating, RLS recursion, NaN/∞ guards, game_config ordering, FOR UPDATE, doc sync); isfinite() → float8-safe NaN/∞ guards (13 sites, unapplied migrations) |
| | **-C** | RLS probes: anon/authenticated/service_role behaviour | **Complete** — supabase/tests 01_claim_rls / 02_attack_rls / 03_config contract suites + P3_T01_C_PLAN; **all 7 migrations applied to live (ogsleukfykumxsyvyusz, Sydney)**; all 3 suites **exit 0**; 0007 closes the authenticated-EXECUTE leak on resolve_attack (found by live probe) + RPC signature alignment + ACL assertions |
| | **-D** | Evidence + Codex PASS | **Complete** — docs/P3_T01_EVIDENCE.md; 515 tests / 33 files PASS, tsc 0, lint 0, live suites exit 0; Codex PASS per subtask; see evidence |
| **P3-T02** Attack flow | **-A** | Audit: scout → commit → launch → travel (real distance) → resolve | **Complete** — docs/P3_T02_A_AUDIT.md; lifecycle map + read-RPC gap (B6) + blockers B1–B8; shield-rejection block added to 02_attack_rls.sql; Codex PASS after 1 correction round (2 accuracy findings reworded) |
| | **-B** | Implement: full async attack lifecycle with distance-based travel timers | **Complete** — 0008 read RPCs (get_player_state/get_galaxy/get_attack, lazy resolve on-read + pvp knobs) + B1 weariness off-by-one fixed forward (1st=1.0×, 4th=1.2³) via war_weariness_multiplier_for + attacks.defender_id; 0009 attack_report column RLS (column-grant mechanics after 2 Codex FAIL rounds); @supabase/supabase-js client + api.ts wrappers + estimator (PVP_CONSTANTS seed parity closes balance-drift finding); 551 tests |
| | **-C** | Edge: travel time calc, concurrent attacks, cancellation | **Complete** — 02_attack_rls.sql full edge suite (shield rejection, travel 600/6000/172800, band-together join, 0009 report gate, foreign-conqueror found:false, original-defender report read); %rowtype positional trap fixed → scalar vars (22P02); all 3 live suites exit 0 / HTTP 201 |
| | **-D** | Evidence + Codex PASS | **Complete** — docs/P3_T02_EVIDENCE.md; Codex PASS per subtask; 35 files/551 tests PASS, tsc 0, lint 0, build 0, live suites exit 0 |
| **P3-T03** Conquest math | **-A** | Audit: AP/DP ratio, 4 outcomes, militia 15%, garrison/deploy model | Not started |
| | **-B** | Implement: ratio resolution, casualty tables, garrison vs deployed state | Not started |
| | **-C** | Boundary ratios (1.5, 1.0, 0.75), zero-defender edge | Not started |
| | **-D** | Evidence + Codex PASS | Not started |
| **P3-T04** Band-together | **-A** | Audit: multi-attacker join window, combined AP, highest-commitment wins | Not started |
| | **-B** | Implement: joinable attacks, combined AP vs fixed DP, winner allocation | Not started |
| | **-C** | Edge: join after launch window, simultaneous commits, tie | Not started |
| | **-D** | Evidence + Codex PASS | Not started |
| **P3-T05** Fortification + war-weariness | **-A** | Audit: 10× ceiling curve, war-weariness +20%/24h per player | Not started |
| | **-B** | Implement: fortification cost curve (alloy-heavy, escalating), war-weariness counter | Not started |
| | **-C** | Edge: ceiling clamp, weariness reset, counter accuracy | Not started |
| | **-D** | Evidence + Codex PASS | Not started |
| **P3-T06** Anti-grief | **-A** | Audit: home planet safe, new-player shield (3 days), attack reports | Not started |
| | **-B** | Implement: unconquerable flag, shield timer, full attack report (who/what/when) | Not started |
| | **-C** | Edge: shield expiry, report for all parties, home-planet attack rejection | Not started |
| | **-D** | Evidence + Codex PASS | Not started |

---

## Phase 4 — Meta + Monetisation + Launch

| Task | Subtask | Scope | Status |
|---|---|---|---|
| **P4-T01** Leaderboards + seasons | **-A** | Audit: weekly + all-time metrics, season rotation (Realmcraft pattern) | Not started |
| | **-B** | Implement: leaderboard queries, season timers, rank display | Not started |
| | **-C** | Edge: ties, empty season, timezone handling | Not started |
| | **-D** | Evidence + Codex PASS | Not started |
| **P4-T02** Notifications | **-A** | Audit: push events (under attack, invasion landed, planet fell, revenge) | Not started |
| | **-B** | Implement: notification triggers + delivery + in-app list | Not started |
| | **-C** | Edge: offline delivery, dedupe, opt-out | Not started |
| | **-D** | Evidence + Codex PASS | Not started |
| **P4-T03** Monetisation | **-A** | Audit: rewarded ads (2× offline), speed-ups, premium currency; shields = v1.1 | Not started |
| | **-B** | Implement: AdMob rewarded + IAP purchases + currency flow | Not started |
| | **-C** | Edge: purchase restore, ad failure fallback, double-reward prevention | Not started |
| | **-D** | Evidence + Codex PASS | Not started |
| **P4-T04** Launch | **-A** | Audit: store requirements, ASO keywords, soft-launch plan | Not started |
| | **-B** | Prepare: store listings, screenshots, privacy policy, test accounts | Not started |
| | **-C** | Soft launch + retention data collection | Not started |
| | **-D** | Launch evidence + Codex PASS + Jay approval | Not started |

---

## Reserves (not v1)
Alliances/guilds · galaxy chat · timed events · feuds/notoriety · Shield Generator (only if playtest demands) · Kimi planet-content engine
