# Phase 2 — Real Universe + Planets: Whole-Phase Closeout Evidence

*Phase 2 completion record for **StarBaron** (Real Universe + Planets). Consolidates the four task records (`P2-T01` → `P2-T04`) and the whole-phase Codex audit into one closeout. Per WORKFLOW.md, no HEAD SHAs are embedded in prose — SHAs appear only where the record references them (commit subjects). The whole phase was Codex-PASSED.*

---

## 1. Phase 2 Completion Summary

**4 tasks**, **20 commits on `staging`** (19 carried the phase + this closeout; 20 P1 + 20 P2 = 40 total), **502 tests across 31 files**, all five verification gates green (see §4).

| Task | Scope (locked to DESIGN.md) | Result | Evidence |
|---|---|---|---|
| **P2-T01** Catalogue import | NASA Exoplanet Archive export → typed dataset (7 fields + derived tier, half-open mapping), pinned CSV, drift gate | **Complete** — 6,321 real planets in `src/sim/data/planets.ts`, min-row guard, 265 tests PASS | `docs/P2_T01_EVIDENCE.md` |
| **P2-T02** Planet model + generator | Planet entity (tier, stats, slots, baseline income), FNV-1a + mulberry32 procedural generator (visual/quirk/description), 7-quirk table, effectiveLevel | **Complete** — immutable `PlanetState`, 10×tier income, tier pop-cap 1.0→2.0, all 6,321 seeds unique, showcase page, 338 tests PASS | `docs/P2_T02_EVIDENCE.md` |
| **P2-T03** Claim flow | New-player auto-claim (1 unique planet), colonise empty planets, sim-layer `PlayerState`, PvP hooks | **Complete** — deterministic `fnv1a("starbaron-claim-v1")%catalogue`, SaveGameV2 + MIGRATIONS[1], pool-exhaustion/double-claim edge coverage, 420 tests PASS | `docs/P2_T03_EVIDENCE.md` |
| **P2-T04** Multi-planet economies | Per-planet grids + income, ONE shared wallet, planet switcher UI, quirks + tier-cap wiring, v2→v3 migration | **Complete** — `accruePlayer` sums all owned planets, both T04 audit gaps closed, SaveGameV3 + tombstone, 491 tests PASS | `docs/P2_T04_EVIDENCE.md` |
| **P2 whole-phase** Audit | Cross-cutting review of the full P2 stack | **Complete** — 1 finding (effectiveLevel live-path bypass) fixed in `3addad9` with 11 regression tests → **PASS** (see §5–§6) | this document |

**Phase deliverable:** a real, deterministic exoplanet universe — 6,321 real catalogue planets, tiered with procedural identity (visual + quirk + description), a claim/colonise flow, and per-planet economies under one shared wallet. No PvP, no backend, no push/deploy — all bounded to Phase 3/4 by DESIGN.md.

---

## 2. Commit Record (full Phase 2 log, oldest → newest)

20 commits carried Phase 2 to whole-phase PASS; this closeout is the 21st Phase-2 commit (40th total). No work on `main`; no push, tag, or deploy.

| # | SHA (subject) | Task |
|---|---|---|
| 1 | `e1a76e6` docs: P2-T01-A exoplanet catalogue audit (NASA TAP, 7 fields, half-open tier mapping) | T01-A |
| 2 | `9d7bf27` feat: P2-T01-B exoplanet catalogue import (6321 real planets, tiered, drift-gated) | T01-B |
| 3 | `968afca` test: P2-T01-C catalogue edge coverage (import negatives, boundaries, drift) + DESIGN procedural generator note | T01-C |
| 4 | `f77b706` fix: P2-T01 min-row guard (no silent catalogue overwrite on truncated input) | T01-C |
| 5 | `ef89527` docs: P2-T01 complete — exoplanet catalogue (6321 planets), Codex PASS | T01-D |
| 6 | `840785e` docs: P2-T02-A planet model + procedural generator audit; DESIGN lock-ins (unlimited slots, tier pop-cap, renaming note) | T02-A |
| 7 | `4b78ce9` feat: P2-T02-B planet model + procedural generator (7 quirks, effectiveLevel, immutable entries, 317 tests) | T02-B |
| 8 | `0d7c602` docs: planet generator showcase page (12 real planets, universe stats) | T02-C |
| 9 | `62a9945` test: P2-T02-C planet/generator deep coverage (seed uniqueness, boundaries, fallbacks, +338 tests) | T02-C |
| 10 | `0ba8b5d` docs: P2-T02 complete — planet model + procedural generator, Codex PASS | T02-D |
| 11 | `6c6495f` docs: P2-T03-A claim flow audit (auto-claim first boot, sim/player, PvP hooks, v1->v2 migration) | T03-A |
| 12 | `1f13d82` feat: P2-T03-B claim flow (auto-claim, sim/player wallet, v1->v2 migration, 394 tests) | T03-B |
| 13 | `03f46a9` test: P2-T03-C claim/wallet/migration edge coverage (420 tests) + DESIGN Kimi map-layer note | T03-C |
| 14 | `6102586` docs: P2-T03 complete — claim flow, Codex PASS | T03-D |
| 15 | `4592442` docs: README (game overview, in-development banner, roadmap, stack) | Docs |
| 16 | `ab87843` docs: P2-T04-A multi-planet economies audit (per-planet grids, shared wallet, v2->v3 migration) | T04-A |
| 17 | `950f9c1` feat: P2-T04-B multi-planet economies (per-planet grids, quirk+tier-cap wiring, v2->v3 migration, 462 tests) + PvP tunable drafts | T04-B |
| 18 | `03d7a26` test: P2-T04-C multi-planet deep coverage (isolation, quirks, caps, v2->v3 matrix, +491 tests) | T04-C |
| 19 | `92a81d9` docs: P2-T04 complete — multi-planet economies, Codex PASS | T04-D |
| 20 | `3addad9` fix: P2 whole-phase audit — effectiveLevel in live sim paths (housing growth, turret DP) + live-path tests (502) | Whole-phase fixes |
| 21 | this closeout (`docs/P2_PHASE2_EVIDENCE.md` + ROADMAP.md) | Closeout |

---

## 3. Test Counts (verified at closeout)

`npx vitest run` — **31 files / 502 tests PASS** (exact, **3.44s** runtime). Per-file breakdown:

| File | Tests |
|---|---|
| `tests/sim-purity.test.ts` | 50 |
| `tests/structures.test.ts` | 28 |
| `tests/savepersist-edge.test.tsx` | 26 |
| `tests/save.test.ts` | 25 |
| `tests/planetview-negative.test.tsx` | 24 |
| `tests/save-corrupt.test.ts` | 24 |
| `tests/planet-identity.test.ts` | 21 |
| `tests/planets-economy.test.ts` | 21 |
| `tests/planets-deep.test.ts` | 20 |
| `tests/savepersist.test.tsx` | 20 |
| `tests/import-planets-edge.test.ts` | 19 |
| `tests/structures-deep.test.ts` | 19 |
| `tests/claim.test.ts` | 17 |
| `tests/planets-edge.test.ts` | 17 |
| `tests/player-save.test.ts` | 17 |
| `tests/planets-multideep.test.ts` | 14 |
| `tests/format.test.ts` | 13 |
| `tests/planets-model.test.ts` | 13 |
| `tests/save-v3.test.ts` | 13 |
| `tests/effectivelevel-live-path.test.ts` | 11 |
| `tests/planetview.test.tsx` | 11 |
| `tests/economy.test.ts` | 10 |
| `tests/population.test.ts` | 10 |
| `tests/save-v3-deep.test.ts` | 10 |
| `tests/offline.test.ts` | 9 |
| `tests/planets.test.ts` | 9 |
| `tests/save-migration-edge.test.ts` | 9 |
| `tests/claims-deep.test.ts` | 8 |
| `tests/player-wallet.test.ts` | 8 |
| `tests/planetview-selector.test.tsx` | 5 |
| `tests/showcase-generate.test.ts` | 1 |
| **Total** | **502** |

Growth curve across the phase: 217 (P1 closeout) → 265 (T01) → 338 (T02) → 420 (T03) → 491 (T04) → **502** after the whole-phase audit added 11 live-path regression tests (`3addad9`: `tests/effectivelevel-live-path.test.ts`).

---

## 4. Verification Gates (all green)

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **31 files / 502 tests PASS** (3.44s) |
| Typecheck | `npx tsc -b` | **exit 0** |
| Build | `npm run build` | **exit 0** (896.06 kB JS / 6.78 kB CSS, 159 ms) |
| Lint | `npm run lint` | **exit 0** (oxlint) |
| Drift gate | `node scripts/import-planets.mjs --check` | **OK (exit 0)** — `planets.ts` matches the pinned snapshot |

---

## 5. Whole-Phase Audit — Findings + Fixes

The whole-phase Codex audit surfaced **1 cross-cutting finding** across the P2 stack. Fixed in one consolidated commit (`3addad9`) with 11 regression tests:

| # | Finding | Fix | Where |
|---|---|---|---|
| **F1** | **`effectiveLevel` bypassed in the LIVE sim paths** — the DESIGN-locked diminishing-returns rule (levels beyond 10 count as half, `min(level,10) + max(0,level−10)×0.5`) was applied inside `structureEffect`, but the live derivation paths read the **raw** level: housing growth (`populationGrowthPerSec(levels.housing, 0)`), housing pop cap (`populationCap(levels.housing)`), and turret DP (`TURRET_DEFENSE_POWER_PER_LEVEL × turretLevels`). So a level-11 Housing grew and capped as if level-11-effective, and a level-21 Turret defended as 21 raw levels — bypassing the cap that kills the "one type only" exploit | `computePlanetDerived` now derives `effHousing = effectiveLevel(levels.housing)` and applies it to both housing growth (`BASE_GROWTH_PER_SEC + HOUSING_GROWTH_PER_LEVEL × effHousing`) and the pop cap (`BASE_POPULATION_CAP × (1 + HOUSING_CAP_MULTIPLIER × effHousing)`); `defensePower` uses `effectiveLevel(turretLevels)`. 11 live-path regression tests (`tests/effectivelevel-live-path.test.ts`) pin: level 11/21 turret DP, the halved 10→11 marginal growth (+1/sec not +2/sec), hydroponics multiplier, pop cap, and the `accruePlayer` live accrual paths (housing/hydroponics growth + turret DP) | `src/sim/player/accrual.ts`, `src/sim/structures/effects.ts` |

**Coverage completed:** the audit's concern was that unit tests only pinned `effectiveLevel` on the `structureEffect` direct path, not on the derived rates players actually accrue against. The new suite asserts the half-after-10 rule through `computePlanetDerived` and `accruePlayer` — the live paths — closing the gap.

---

## 6. Audit-Loop Story — Per-Task PASS → Whole-Phase Finding → PASS

Per WORKFLOW.md, Codex (read-only) audits each deliverable and OpenCode implements corrections; a whole-phase Codex audit runs at phase end. The Phase 2 loop:

1. **Per-task audit passes (T01 → T04):** each `-A` audit and `-B`/`-C` implementation was independently Codex-PASSED as it landed (records in each task evidence doc). P2-T01 even hit a mid-task correction round (`f77b706` min-row guard, caught in `-C` coverage) before its own PASS.
2. **Whole-phase audit (closeout):** Codex reviewed the full P2 stack cross-cutting — catalogue, planet model/generator, claim flow, multi-planet economies, migrations — and returned **1 finding** (F1 above): the effectiveLevel rule was inconsistently applied — present in the direct structure-effect layer, missing in the live sim derivation paths (housing growth/cap, turret DP).
3. **Correction round 1 — sim correctness:** F1 fixed in one bounded commit (`3addad9`) touching exactly `accrual.ts` + `effects.ts`, with the 11-test live-path suite proving the fix through the paths the game actually runs.
4. **Re-audit → PASS:** Codex confirmed the finding resolved on `3addad9`; **502/502 tests, tsc 0, build 0, lint 0, drift gate OK**.

The loop's discipline: fixes landed in bounded batches, each re-verified by the full suite, and nothing merged until the independent audit returned PASS (max-6-attempts rule not needed).

---

## 7. Bounded Decisions Log (Phase 2)

Decisions were scoped per task, each default safe to proceed on and none inventing beyond DESIGN.md:

| # | Decision | Record | Choice |
|---|---|---|---|
| 1 | **Tier multipliers** | P2-T02-B / DESIGN §4d | Baseline income `10 × tier` (Trade Hub multiplies it; nothing else touches the floor — §4c/§4d wording tension flagged, §4d binding). Tier pop-cap multiplier `1.0 / 1.2 / 1.4 / 1.7 / 2.0` for T1–T5 (DESIGN-locked) |
| 2 | **Unlimited slots + diminishing returns** | P2-T02-A (Jay 2026-08-08) | **UNLIMITED** structure slots — no hard cap. Instead `effectiveLevel = min(level,10) + max(0,level−10)×0.5` per structure type: fully effective to 10, half-effective beyond. Keeps everything buildable forever, kills the "one type only" exploit |
| 3 | **Quirks wired into gameplay** | P2-T04-A D3 → T04-B | `applyQuirk` applied per planet in the derived rates (Ore Mine / Trade Hub / Shipyard / Barracks / Hydroponics effects + denseCore pop-cap + massiveWorld defense). Quirks are gameplay, not decoration (DESIGN §4b); existing 7-quirk table only, no new quirks |
| 4 | **Wallet scope** | P2-T04-A D1 | ONE shared `{ credits, alloys }` wallet pools across every owned planet; population/garrison/fleet are **per-planet** (`OwnedPlanet` fields). Single wallet = spend-anywhere empire economy; colonies are their own economies |
| 5 | **v2 → v3 migration** | P2-T04-A/B | `SaveGameV3` + `MIGRATIONS[2] = migrateV2ToV3` with **tombstone** (old key removed in the same call). v2 wallet pop/garrison/fleet → home planet; colonies get `0/0/0` + empty grids; wallet carrying pop/garrison/fleet → corrupt |
| 6 | **PvP tunables drafted (not locked)** | P2-T04-B / DESIGN §5a | Draft table (marked "Jay audits at playtest"): travel `distancePc × 1 min` (floor 10 min, cap 48h), launch cost `200 cr + fleet × 0.2 cr + distancePc × 10 cr`, war-weariness +20% per 24h. Documentation only — no code consumes these; P3-T02/T03/T05 reference |
| 7 | **Binary quirk at level-0 Trade Hub — RESOLVED (Option A, Jay 2026-08-09)** | P2-T04-A §9.1 / T04-D | `applyQuirk` runs before any level gate, so a level-0 Trade Hub on a binarySystem planet yields baseline ×1.1. **Option A (baseline-trait, current code) chosen by Jay** — no wiring change; DESIGN §4d updated to note the exception; pinned by `tests/binarysystem-level0.test.ts` (6 tests) |
| 8 | **Catalogue snapshot-not-live** | P2-T01-A | Import is a one-shot snapshot (pinned CSV `ps-export-2026-08-08.csv`, sha-pinned, drift-gated), not a live TAP poll — no network dependency at runtime; re-import is an explicit offline script step |
| 9 | **Half-open tier mapping, radius-first** | P2-T01-A/B | Tier derived from stellar radius (T1–T5 half-open buckets); radius is the stable catalogue field (missing/dubious values fall back per D4 fallbacks in P2-T02) |
| 10 | **Deterministic claim assignment** | P2-T03-B | `fnv1a("starbaron-claim-v1") % catalogue` — stable, no server, no bias; pool exhaustion and double-claim are RangeError-guarded |
| 11 | **Fresh colony = empty** | P2-T04-A D6 | New colonies start `population/garrison/fleet = 0` and `emptyStructureLevels()`; home keeps the migrated 1,000 from v2. Zero-pop colonies still grow at the base rate |
| 12 | **Planet selector UI-only** | P2-T04-A D5 | `selectedPlanetName` lives in UI state only (never persisted); galaxy map / full picker deferred to P3/P4 |

---

## 8. Known Findings (carried)

These were documented during the phase and verified at closeout — they remain **open** and explicitly noted, not silently resolved:

1. **`gridForPlanet` returns a live reference, not a copy** (`accrual.ts:38-43`) — no active bug; all current call sites spread before mutating. Defensive note for future callers: don't mutate the returned grid in place.
2. **`tests/saveHelpers.ts` gives unspecified colony grids a copy of the home grid** — fixture behaviour only (production `colonise` assigns `emptyStructureLevels()`); tests that care pass explicit per-colony grids.
3. **`savepersist` timing flake noted** — the jsdom hook-suite (`savepersist*.test.tsx`) exercises debounced save + fake-timer paths; an intermittent timing sensitivity has been observed. It has not reproduced in the final whole-phase run (502/502 PASS); flagged so a future red run is checked against this note rather than treated as new. If it recurs, the debounced save assertion is the first suspect.
4. **Binary quirk level-0 — RESOLVED (Option A, Jay 2026-08-09)** — see §7 item 7; baseline-trait decision locked, DESIGN §4d updated, pinned by `tests/binarysystem-level0.test.ts`. No open decisions remain for P3.

---

## 9. Branch / Remote State

- Branch: `staging` (no work on `main`).
- No push, no tag, no deploy — remote unchanged pending authorisation.
- HEAD at closeout: `3addad9` (whole-phase fixes); this closeout adds docs only.
- Working tree clean after commit.

---

*Prepared by OpenCode (deepseek-v4-flash) for P2 whole-phase closeout. Only `docs/P2_PHASE2_EVIDENCE.md` + ROADMAP.md changed in this subtask.*
