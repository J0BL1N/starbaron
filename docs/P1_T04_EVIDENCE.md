# P1-T04 — Save/Load + Onboarding Evidence

*Closeout evidence for **P1-T04 Save/load + onboarding** (Phase 1 — Core Idle Engine + Web Preview). Consolidates the subtask record for `-A`/`-B`/`-C`/`-D`. Per WORKFLOW.md, no HEAD SHAs are embedded in prose — SHAs appear only where the record already references them (commit subjects). The whole P1-T04 change was Codex-PASSED.*

---

## 1. Save/Load Summary

**`src/ui/save.ts`** is the persistence layer — pure functions (`loadSave`, `saveGame`, `validateSave`, `migrateSave`, `clearSave`) plus a thin storage adapter (default `window.localStorage`, injectable for tests). `src/sim` stays pure/stateless (T03 decision A contract); persistence is a UI-layer concern, exactly as the audit reserved.

### Schema (`SaveGameV1`, `SAVE_SCHEMA_VERSION = 1`)

| Group | Fields | Notes |
|---|---|---|
| **Game state** | `tier` (int 1–5), `credits`, `alloys`, `population`, `garrison`, `fleet` (finite ≥ 0), `levels` (`Record<StructureId, number>`, int ≥ 0), `lastTickAt` (finite epoch ms) | 1:1 persist of the `useGameState` wallet; `levels` validated against `STRUCTURE_IDS`/`isStructureId` |
| **Metadata** | `schemaVersion` (v1), `savedAt` (debug/migration ordering only, never authoritative) | `savedAt` is lenient — missing/non-finite → `0` |
| **Tutorial** | `tutorial.step` (0–3, int), `done`, `skipped` (booleans) | Persisted so a refresh/close resumes mid-flow; skip is permanent |
| **Offline** | `offlineSummarySeen` (boolean) | Persisted so a real gap's summary is announced **once per real offline gap**, not on every load |

**Everything derived is recomputed at load, never persisted** — `computeDerived` (`creditsPerSec`, `alloysPerSec`, `populationPerSec`, `populationCap`, `garrisonPerSec`, `garrisonCap`, `fleetCap`, `defensePower`), `nextBuildCost`, `structureEffect`, and the `OfflineGain` modal payload all derive from persisted levels/wallet. Persisting derived values would risk stale/contradictory saves.

### Validation (`validateSave`) — strict on corruption, lenient only on additive fields

- **Corrupt (fresh start + notice, never a crash):** missing/wrong-typed `schemaVersion`; `tier` not an int in `[1,5]`; any wallet field not finite ≥ 0; a **string wallet value** (the JSON form that survives stringify but must not load); an **unknown `levels` key** (strict reject, not a lenient drop); a non-finite/missing `lastTickAt`; raw JSON containing a `NaN` token; null wallet fields (the round-trip form of `NaN`).
- **Lenient defaults (additive forward-compat only):** a missing single level key → `0`; a missing/out-of-range `tutorial` → `{ step: 0, done: false, skipped: false }`; non-boolean `done`/`skipped` → `false`; missing/non-boolean `offlineSummarySeen` → `false`; missing/non-finite `savedAt` → `0`. A missing wallet field or a missing `levels` object is **corrupt**, not defaulted.

### Persistence strategy — hybrid (audit decision C)

| Trigger | Strategy |
|---|---|
| Any committed state change / 1s interval tick | **Debounced auto-save (~5s, `AUTOSAVE_DEBOUNCE_MS`)** — coalesces the per-second accrual into ≤1 write/5s |
| `buy(id)` (purchase) | **Immediate synchronous flush** — a crash/close never eats a build |
| `beforeunload` / `pagehide` / `visibilitychange→hidden` | **Synchronous flush** — persists the freshest `lastTickAt` so the next load's real gap isn't inflated |
| `dismissOffline` / tutorial advance/skip | **Immediate flush** (tutorial progress + seen-flag writes are durable) |

Single key **`starbaron.save.v1`** (key-per-version, audit decision B). `lastTickAt` freshness is the correctness lever — every save carries the snapshot's `lastTickAt`, so the next load's gap = `now − lastTickAt`, bounded, never double-counted, always 8h-capped. `setItem` failures (`QuotaExceededError`, Safari private mode, throwing `window.localStorage` getter, throwing reads) degrade gracefully: in-memory play continues, a one-time non-blocking notice surfaces once, no crash, no retry-loop.

---

## 2. Real Offline-Gap Integration (replaces the T03 simulation)

The T03 mount simulation (`DEFAULT_SIMULATED_GAP_MS = 12h`, `simulatedGapMs`, `simulatedRef`, seeded-gap effect) is **deleted**. The offline reveal is now driven by a **real persisted gap**:

1. **Load** the save (§1) — `lastTickAt` is real.
2. **Compute** `gap = now() − lastTickAt`, **bank** it through the existing single shared **`bankElapsed()`** (`useGameState.ts`) — the same capped path as the interval tick and buy-snap (T03 decision H), so a >8h absence clamps to `MAX_OFFLINE_BANK_SECONDS` identically. No new accrual code.
3. **Show** `OfflineSummary` when the banked gap exceeds `OFFLINE_SUMMARY_THRESHOLD_MS` (60s, audit decision D) — reusing the T03 presentational modal unchanged, including the T03-C clamp fix verbatim: announced population/garrison gains are clamped to `Math.max(0, cap − before)` against the **loaded** pre-gap balance, so the modal announces exactly what the wallet banks.
4. **Seen-flag lifecycle** (audit decision A): a fresh qualifying real gap clears `offlineSummarySeen` and fires the modal once; dismissing persists `offlineSummarySeen = true`; a no-gap remount with the flag set does **not** re-show.

Boundary tests confirm: a gap **exactly at** 60s banks but does **not** announce; **+1ms past** announces (`elapsedSec = 60.001`); a 10-day gap banks exactly 8h and announces the clamped summary; an exact-8h gap banks 8h and announces.

---

## 3. Onboarding — 4-Step Guided Flow (audit decision F/G)

Non-gating guided overlay (`Onboarding.tsx`), always skippable, progress persisted (`tutorial.step`/`done`/`skipped`). Steps 5–6 (galaxy map, scout/attack) deferred to P2/P3 per the audit — no P3 stubs.

| Step | Title | Advance trigger |
|---|---|---|
| 0 | Welcome, Commander (claim intro — placeholder 🪐 "Home Planet", real claim is P2) | "Claim" button (`advanceTutorial`) |
| 1 | Grow your population (Build Housing) | event-driven — auto-advances when `housing ≥ 1` |
| 2 | Mine the ore (Build Ore Mine) | event-driven — auto-advances when `oreMine ≥ 1` |
| 3 | Offline earnings (offline reveal) | dismissing a real `OfflineSummary` → `done = true` |

**Skip** sets `skipped = true`, hides immediately, persists, never re-shown on later loads (verified for saves at steps 0–3). **Resume** restores the persisted step on remount. A `done` save never re-shows. The step-3 completion is non-gating — a player who never leaves the tab stays on step 3 without soft-locking.

---

## 4. The 2 Bugs Found + Fixed

### Bug 1 — lifecycle-flush listener stability (`useGameState.ts`)
The `beforeunload` / `pagehide` / `visibilitychange→hidden` flush wiring is registered in one effect and its cleanup cancels a pending debounced auto-save (`clearTimeout` on `debounceRef`). The stability fix: `flushSave` is a `useCallback` over the stable `buildPayload`/`writeSave` (both `[]`-stable), so the listener effect subscribes **exactly once** — if `flushSave` were recreated per render, the effect would tear down and re-subscribe on every render and the cleanup would clear a pending debounce timer on every cycle, silently breaking auto-save. The flush path itself cancels the pending debounce **before** writing, so a pending 5s auto-save is not lost when the tab hides mid-debounce, and the effect cleanup prevents a stale timer firing after teardown. Verified by the debounced auto-save round-trip test (a pending debounce survives renders and lands) and the buy-flush + save-on-dismiss tests.

### Bug 2 — state-based onboarding out-of-order deadlock (`useGameState.ts`)
Tutorial advancement is **state-driven**: an effect watches `snapshot.levels` and advances when `tutorial.step === 1 && housing ≥ 1` (→ step 2) or `step === 2 && oreMine ≥ 1` (→ step 3). The deadlock scenario is **out-of-order building**: a player builds Housing and/or Ore Mine **before** Claiming (step 0), so the build condition is already satisfied when the step is entered. The fix: the effect advances **one step per render pass** driven by fresh `[tutorial, snapshot, advanceTutorial]` state, letting the cascade settle across sequential re-renders (step 0 → 1 → 2 → 3). A single-pass multi-step advance or a stale-step read would deadlock at a step whose build is already done. Regression tests cover exactly this: "advances through the housing step without re-buying when housing was bought before Claim" and "cascades through both build steps when housing and ore mine were bought before Claim" (`tests/savepersist.test.tsx`).

---

## 5. Test Counts

| Measurement | Count |
|---|---|
| **Runtime (vitest — exact)** | **205 tests PASS across 13 files** |
| Declared via grep (`it(`/`it.each`) | 187 across the suite; 73 in the four P1-T04 files |

**Per-file runtime breakdown:**

| File | Tests |
|---|---|
| `tests/savepersist-edge.test.tsx` (T04-C) | 26 |
| `tests/save-corrupt.test.ts` (T04-C) | 20 |
| `tests/save.test.ts` (T04-B) | 17 |
| `tests/savepersist.test.tsx` (T04-B) | 16 |
| `tests/structures.test.ts` | 25 |
| `tests/structures-deep.test.ts` | 19 |
| `tests/planetview-negative.test.tsx` | 19 |
| `tests/sim-purity.test.ts` | 15 |
| `tests/population.test.ts` | 10 |
| `tests/format.test.ts` | 10 |
| `tests/economy.test.ts` | 10 |
| `tests/planetview.test.tsx` | 9 |
| `tests/offline.test.ts` | 9 |
| **Total** | **205** |

T04 added **79 tests** (save 17, savepersist 16, save-corrupt 20, savepersist-edge 26) on top of the T03-closeout 126 (matches the -B commit subject "159 tests", +46 more in -C). The `it.each` suites expand at runtime: `it.each([0,1,2,3])` skip-persistence ×4 and `it.each(RESUME_STEPS)` resume ×4 in `savepersist-edge.test.tsx`.

---

## 6. Verification Results

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **13 files / 205 tests PASS** |
| Typecheck | `npx tsc -b` | **exit 0** |
| Build | `npm run build` | **exit 0** (tsc -b + vite build, 207 KB JS / 6.7 KB CSS) |
| Lint | `npm run lint` | **exit 0** (oxlint) |

---

## 7. Codex Verdicts (per subtask)

| Subtask | Verdict | Evidence |
|---|---|---|
| -A | **PASS** | Audit + bound scope: schema/validation rules, hybrid persistence, load flow, real offline-gap replacement of the T03 simulation, 4-step onboarding set, decisions A–H (`docs/P1_T04_A_AUDIT.md`, commit 885293f) |
| -B | **PASS** | `save.ts` (schema + validation + migration) + hybrid persistence + real offline-gap integration + 4-step tutorial, both bugs fixed, +33 tests (commit d36ce5c) |
| -C | **PASS** | Negative-path + regression coverage — corrupt matrix, storage/privacy edges, gap-boundary tests, skip/resume/deep onboarding, round-trip integrity, +46 tests (commit 52a75a9) |
| -D | **PASS** | This evidence + closeout, committed to `staging` |

---

## 8. Branch / Remote State

- Branch: `staging` (no work on `main`).
- No push, no tag, no deploy — remote unchanged pending authorisation.
- HEAD at closeout: `52a75a9` (the -C commit; -D adds docs only).
- Working tree clean after commit.

---

*Prepared by OpenCode (deepseek-v4-flash) for P1-T04-D. Only `docs/P1_T04_EVIDENCE.md` + ROADMAP.md changed in this subtask.*
