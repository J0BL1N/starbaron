# StarBaron — ROADMAP.md

*Completion record. DESIGN.md = what we're building. WORKFLOW.md = how we build it. This file = what's done + evidence.*

**Subtask key (TradieHubAU pattern):**
- `-A` Audit/bound scope — what exists, exclusions, blockers (docs-only)
- `-B` Implement the primary bounded change
- `-C` Negative-path + regression coverage
- `-D` Package evidence + Codex audit PASS

---

## Phase 1 — Core Idle Engine + Web Preview

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
| **P1-T04** Save/load + onboarding | **-A** | Audit: save schema, tutorial steps (§5c), polish list | Not started |
| | **-B** | Implement: localStorage save/load, onboarding tutorial (claim planet → housing → ore mine → offline reveal → map intro) | Not started |
| | **-C** | Corrupt save handling, version migration, tutorial skip/resume | Not started |
| | **-D** | Evidence + Codex PASS | Not started |
| **P1-T05** Phase closeout | **-A** | Whole-phase audit prep: reconcile all evidence | Not started |
| | **-B** | Final whole-phase Codex audit across P1 stack | Not started |
| | **-C** | Fix any cross-cutting findings (same round), re-audit | Not started |
| | **-D** | Closeout evidence + ROADMAP update, report to Jay | Not started |

---

## Phase 2 — Real Universe + Planets

**Goal:** real exoplanet catalogue import, planet claiming, multi-planet economies.

| Task | Subtask | Scope | Status |
|---|---|---|---|
| **P2-T01** Catalogue import | **-A** | Audit: NASA Exoplanet Archive export format, fields needed (name, tier, star type, distance), licensing | Not started |
| | **-B** | Import script: fetch/parse archive → typed dataset (JSON/TS), size check | Not started |
| | **-C** | Edge cases: missing fields, duplicate names, format drift | Not started |
| | **-D** | Evidence + Codex PASS | Not started |
| **P2-T02** Planet model | **-A** | Audit: tier system (T1–T5), stats mapping, structure slots | Not started |
| | **-B** | Implement: planet entity — tier, stats, slots, baseline income by tier | Not started |
| | **-C** | Negative paths: tier bounds, slot overflow | Not started |
| | **-D** | Evidence + Codex PASS | Not started |
| **P2-T03** Claim flow | **-A** | Audit: new-player claim (1 unique planet), colonise empty planets | Not started |
| | **-B** | Implement: claim pool (unclaimed index), assign on signup, colonise flow | Not started |
| | **-C** | Edge: pool exhaustion, double-claim prevention | Not started |
| | **-D** | Evidence + Codex PASS | Not started |
| **P2-T04** Multi-planet economies | **-A** | Audit: per-planet grid isolation, shared player wallet vs per-planet | Not started |
| | **-B** | Implement: each planet = own structure grid + income; switch planets in UI | Not started |
| | **-C** | Cross-planet bugs: income mixing, structure bleed | Not started |
| | **-D** | Evidence + Codex PASS | Not started |

---

## Phase 3 — Supabase Backend + Async PvP

**Goal:** shared universe, async attacks, band-together, fortification.

| Task | Subtask | Scope | Status |
|---|---|---|---|
| **P3-T01** Supabase schema | **-A** | Audit: schema design — players, planets, structures, population, attack timers, RLS | Not started |
| | **-B** | Implement: forward-only migrations, tables + RLS + indexes | Not started |
| | **-C** | RLS probes: anon/authenticated/service_role behaviour | Not started |
| | **-D** | Evidence + Codex PASS | Not started |
| **P3-T02** Attack flow | **-A** | Audit: scout → commit → launch → travel (real distance) → resolve | Not started |
| | **-B** | Implement: full async attack lifecycle with distance-based travel timers | Not started |
| | **-C** | Edge: travel time calc, concurrent attacks, cancellation | Not started |
| | **-D** | Evidence + Codex PASS | Not started |
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
