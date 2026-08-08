# P1-T04-A — Save/Load + Onboarding Audit

*Subtask `-A` for **P1-T04 Save/load + onboarding** (Phase 1 — Core Idle Engine + Web Preview). Documentation-only audit. Nothing implemented, nothing committed, no work on `main`. Per WORKFLOW.md no HEAD SHAs are embedded in docs. Scope grounded in DESIGN.md §5c (session flow, onboarding, daily check-in), §4d (economy numbers, 8h offline cap), ROADMAP.md P1-T04 rows, docs/P1_T03_EVIDENCE.md (decisions G/H: simulated preview-only offline gap + 8h cap on every accrual path), and verified at HEAD on `staging`.*

---

## 1. Save Schema — What Persists

**Everything stored is the current `GameState` shape plus tutorial + offline-summary metadata. Everything derived is recomputed on load and is NOT persisted.**

### Stored (persisted)

```ts
interface SaveGameV1 {
  schemaVersion: 1
  savedAt: number          // epoch ms of last write — metadata/debug only, never authoritative
  game: {
    tier: number           // 1..5, integer — P1 fixed at 1 (placeholder home planet)
    credits: number        // wallet — accrued baseline + shipyard income
    alloys: number         // wallet — accrued from Ore Mine
    population: number     // wallet — accrues up to populationCap
    garrison: number       // wallet — Barracks conversion, cap = garrisonCap
    fleet: number          // wallet — cap = fleetCap; 0 in P1 (no PvP)
    levels: Record<StructureId, number>   // all 7 ids, integer ≥ 0
    lastTickAt: number     // epoch ms — drives the real offline-gap calc (§4)
  }
  tutorial: {
    step: number           // 0..3 — current guided onboarding step (§5)
    done: boolean          // all P1 steps complete → never show again
    skipped: boolean       // player pressed Skip → never show again
  }
  offlineSummarySeen: boolean  // offline-modal "seen" flag (§4) — set true once the current real gap's summary has been shown
}
```

**Field-by-field mapping to the current code** (verified at HEAD):

| Field | Source today | Notes |
|---|---|---|
| `tier`, `credits`, `alloys`, `population`, `garrison`, `fleet`, `levels`, `lastTickAt` | `GameState` — `src/ui/useGameState.ts:20-29` | 1:1 persist; the hook's whole in-memory wallet (`useGameState.ts:77-88` `initialState`) |
| `levels` keys | `STRUCTURE_IDS` — `src/sim/structures/data.ts:4-12` | 7 literal ids; validate each via `isStructureId` (`data.ts:16`) |
| `schemaVersion` | **new** | v1 = first schema; key for the migration path (§3) |
| `savedAt` | **new** | write-time stamp for debug/migration ordering |
| `tutorial` | **new** | P1-T04-C owns skip/resume; §5 below |
| `offlineSummarySeen` | **new** | offline-modal seen flag (§4) — persisted so a real gap's summary is announced once, not re-shown on every load |

### Derived — recomputed, NOT persisted

All rates/caps/multiplier/DP come from `computeDerived(levels, tier)` (`useGameState.ts:90-118`): `creditsPerSec` (baseline × Trade Hub multiplier + Shipyard income), `alloysPerSec`, `populationPerSec`, `populationCap`, `garrisonPerSec`, `garrisonCap`, `fleetCap`, `defensePower`. Build prices (`nextBuildCost`) and effect readouts (`structureEffect`) are likewise derived from persisted levels. **Persisting derived values would risk stale/contradictory saves — derive at load, always.**

### Explicitly NOT persisted (recommendation)

- `OfflineGain` (the modal payload) — recomputed at load (§4), cleared by `dismissOffline`.
- Any display-only UI state (modal open/closed, hover, tab) — trivial, not save-worthy.

The **offline-summary "seen" flag IS persisted** — `offlineSummarySeen` in the schema above. DESIGN §5c's "offline summary on every open" (line 178) means once per *real* gap; a session-scoped in-memory flag would re-announce on **every load**, spamming the reveal (e.g. after any refresh/close while a stale gap persists). Persisting it shows the summary **once per real offline gap**: cleared whenever a fresh qualifying gap (`now − lastTickAt` > threshold, §4) is banked at load, set `true` once that gap's summary is shown/dismissed. No new gap → flag stays `true` → no re-show. *Corrected from this draft's earlier DON'T-persist recommendation per the Codex finding.*

### Validation rules (`validateSave`)

| Rule | Disposition |
|---|---|
| `schemaVersion` missing / ≠ current after migration | corrupt → fresh start + notice (§3) |
| `tier` not finite integer in `[1,5]` | corrupt |
| any wallet field not finite ≥ 0 (`credits`, `alloys`, `population`, `garrison`, `fleet`) | corrupt |
| `levels` contains an unknown key | corrupt (reject — strict) |
| `levels` missing one of the 7 ids | lenient default → `0` (additive forward-compat) |
| `levels` value not finite integer ≥ 0 | corrupt |
| `lastTickAt` missing or non-finite | corrupt |
| `tutorial` missing | lenient default → `{ step: 0, done: false, skipped: false }` |
| `offlineSummarySeen` missing / non-boolean | lenient default → `false` (next qualifying real gap announces) |

Strict on corruption, lenient only on additive fields — predictability over forgiveness (a corrupt negative balance must never silently load).

---

## 2. Persistence Mechanism

### Storage + key

- **`localStorage`**, single key **`starbaron.save.v1`** (mirrors `schemaVersion: 1`).
- **Version the KEY, not just the field.** When v2 arrives, write `starbaron.save.v2`, migrate from the v1 key, keep the v1 key until the v2 write succeeds (crash-safe migration), then tombstone it. Old formats are zero-cost to abandon because they live under their own key — no "did we already migrate?" ambiguity.
- No backend, no cross-device sync, no cloud (Phase 3, §7).

### Serialisation

Plain `JSON.stringify` of the `SaveGameV1` object. All numbers are well under `2^53` (idle balances stay in the K–T range), so no precision loss. Round-trip is `stringify → parse → validate` — validation is the contract (§1 rules).

### Write strategy — hybrid: debounced auto-save + action flush + lifecycle flush

| Trigger | Strategy | Why |
|---|---|---|
| Any committed state change | **Debounced auto-save (~5s)** | The 1s interval tick mutates balance + `lastTickAt` every second — saving every change is churn. A 5s debounce coalesces ticks into ≤1 write/5s. |
| `buy(id)` | **Immediate synchronous flush** | A purchase is high-value, low-frequency — never allow a crash/close to eat a build. |
| `beforeunload` / `pagehide` / `visibilitychange→hidden` | **Synchronous flush** | Tab close or app background must persist the freshest `lastTickAt`, or the next load's real offline gap inflates (≤5s of stale `lastTickAt` is negligible and still 8h-capped by `bankElapsed`, but flush anyway). |
| 1s interval tick | coalesces into the debounce | no dedicated write |

**`lastTickAt` freshness is the correctness lever.** Because `bankElapsed()` updates `lastTickAt` on every path (`useGameState.ts:153-168`) and every save carries the snapshot's `lastTickAt`, the real offline gap on the next load = `now − lastTickAt` — bounded, never double-counted, always 8h-capped.

### Size limits + failure handling

- Save is ~200–400 bytes serialised. localStorage quota is ~5 MB per origin — **no practical limit; document it, don't engineer around it.**
- `setItem` failure (e.g. `QuotaExceededError`, Safari private mode): **try/catch, degrade gracefully** — keep playing in-memory, surface a one-time non-blocking notice ("progress this session may not be saved"), never crash, never retry-loop.

### Placement

New module **`src/ui/save.ts`** — pure functions (`loadSave`, `saveGame`, `validateSave`, `migrateSave`, `clearSave`) + a thin storage adapter (default `window.localStorage`, injectable for tests). `src/sim` stays pure/stateless (DESIGN §3, T03-A §2 contract) — persistence is a UI-layer concern, exactly as T03 decision A reserved ("when T04 arrives, those fields move into the save schema and `useGameState` rehydrates from storage").

---

## 3. Load Flow (on mount)

```
mount (StrictMode-guarded once)
  ├─ read key via storage adapter
  │   ├─ absent        → fresh initialState(now()) + tutorial step 0  → no offline modal (§1: lastTickAt = now ⇒ gap 0)
  │   └─ present
  │       ├─ JSON.parse fails         → CORRUPT → fresh + notice
  │       ├─ schemaVersion > current  → FUTURE  → fresh + notice (never downgrade)
  │       └─ migrateSave(raw)         → v1 (no-op today; mechanism exists) → validateSave
  │             ├─ invalid            → CORRUPT → fresh + notice
  │             └─ valid              → hydrate state
  ├─ bank the real offline gap (§4): gap = now − lastTickAt → bankElapsed() (8h cap) → if gap > threshold, this is a new real gap: clear offlineSummarySeen and set offlineGain
  ├─ start the 1s interval tick (existing)
  └─ render tutorial per progress (§5)
```

**Corrupt/future-save handling — a fresh start + a NOTICE, never a crash:**

- A **distinct inline banner/notice** ("Saved game couldn't be read — starting a new game"), dismissible. **Not** the OfflineSummary modal — different semantics, don't overload the §5c reveal.
- Do **not** pre-delete the corrupt key on first failure (a future code fix could recover the data); the next successful fresh-start save overwrites it naturally. Document this choice in a code comment.

**StrictMode double-invoke (verified integration detail):** `src/main.tsx` wraps the app in `<StrictMode>`, so the mount/load effect runs twice in dev. Reuse today's once-guard pattern (`simulatedRef`, `useGameState.ts:195-197`) for the load effect. `bankElapsed()` is idempotent — a second invoke sees gap ≈ 0 — so no double-accrual; the guard only guarantees the offline modal fires once.

**Version migration path:** `MIGRATIONS: Record<number, (old) => SaveGameVNext>` keyed by source `schemaVersion`, applied forward until current. v1 ships with an empty map (the mechanism exists so v2 doesn't need a structural rework). Future-save (`schemaVersion` > current) = unreadable → fresh + notice.

---

## 4. The Offline-Gap Fix — real persistence replaces the mount simulation

**Confirmed: this replaces the mount simulation.** Today the preview fires the modal from a seeded in-memory away-gap:

- `DEFAULT_SIMULATED_GAP_MS = 12h`, `simulatedGapMs` option, and the `simulatedRef` mount effect (`useGameState.ts:16, 51-54, 195-223`) rewind `lastTickAt`, call `bankElapsed()`, and set `offlineGain` — explicitly a preview stand-in, honest that tab close loses state (T03 decisions F/G).

With real persistence the gap becomes **real**:

1. **Load** the save (§3) — `lastTickAt` is real.
2. **Compute** `gap = now() − lastTickAt` and **bank** it through the **existing `bankElapsed()`** (`useGameState.ts:153-168`) — the single shared capped path (T03 decision H), so a >8h absence is clamped to `MAX_OFFLINE_BANK_SECONDS` (`src/sim/core/offline.ts:1`) identically to the interval tick and buy-snap. No new accrual code.
3. **Show** `OfflineSummary` when the banked gap exceeds a threshold (recommend ~60s; tuning knob, §8) — reusing the **existing presentational modal unchanged** (`src/ui/components/OfflineSummary.tsx`) and the **T03-C clamp fix** verbatim: the announced population/garrison gains are clamped to `Math.max(0, cap − before)` against the **loaded** pre-gap balance (`useGameState.ts:213-220`) — so the modal announces exactly what the wallet banks on a real load too. Dismissal persists `offlineSummarySeen = true` — a real gap's summary then fires once, not on every load (§1).
4. **Delete** the simulation: `DEFAULT_SIMULATED_GAP_MS`, `simulatedGapMs`, `simulatedRef`, and the seeded-gap effect. Tests that pass `simulatedGapMs: 0` switch to an injectable storage adapter (seed a save, or seed `lastTickAt`), keeping the injectable `now` (`useGameState.ts:52`) for determinism under fake timers.

**Why this is sound:** `bankElapsed()` + the clamp live in the hook and already compare against the pre-gap balance (`before`); on a real load `before` is simply the persisted balance. The T03-C regression assertions ("content shows the 8h-capped amounts", "announced population/garrison gains equal what the wallet banks") extend from the simulated gap to the real load unchanged.

---

## 5. Onboarding Tutorial — the P1-realistic Step Set

DESIGN §5c (lines 166-172) defines 6 steps. P1 has **no galaxy map (P3) and no PvP (P3)**, and the real claim flow is **P2** (T03 decision D: placeholder 🪐 "Home Planet"). So:

| # | DESIGN step | P1-realistic? | Decision |
|---|---|---|---|
| 1 | Claim your planet | **Partial** | **Include as a lightweight intro** — a welcome card "This is your home planet" + Confirm/Claim that advances the tutorial. No catalogue, no claim pool (honest fiction, P2 replaces the content later). Keeps the §5c "hook lands in 10 seconds" with zero sim work. |
| 2 | Build first Housing | **Yes** | **Include** — event trigger: complete when `housing ≥ 1`. Starter 1,000 cr covers it (T03 decision C). |
| 3 | Build Ore Mine | **Yes** | **Include** — event trigger: complete when `oreMine ≥ 1` (see alloys appear). |
| 4 | First offline earnings reveal | **Yes** | **Include** — completes when a real `OfflineSummary` is dismissed (§4). Non-gating: a player who never leaves the tab stays on this step without soft-locking. |
| 5 | Open Galaxy Map → see neighbours | **No (P3)** | **Defer entirely** — the map is a §5c screen that ships with P3. No stub map. |
| 6 | Tutorial scout + attack preview | **No (P3)** | **Defer entirely** — PvP is Phase 3. No fake scout. |

**Recommended bounded P1 set: steps 1–4 (claim intro → Housing → Ore Mine → offline reveal), steps 5–6 deferred to P2/P3.** On completing step 4, `tutorial.done = true`.

**Model — non-gating guided overlay, event-driven advancement, skip/resume:**

- Progress = `tutorial.step` (0–3) + `done`/`skipped` flags (§1), **persisted** so a refresh/close resumes mid-flow (this is the ROADMAP P1-T04-C "tutorial skip/resume" requirement).
- Advancement is **event-driven** (build Housing / build Ore Mine / dismiss offline reveal / confirm intro) — never time-gated, never a hard gate on play.
- **Skip/dismiss is always available** (one tap, anywhere in the flow) → sets `skipped = true`, hides immediately, never re-shown on later loads. No DESIGN conflict — §5c doesn't mandate unskippable onboarding.
- Optional (recommended: omit to stay bounded) end-card noting the galaxy arrives in Phase 3 — flavour only.

---

## 6. Testing Approach

Follow the established pattern (vitest config: default **node**, `tests/**/*.test.ts` + `tests/**/*.test.tsx`; UI suites opt into **jsdom** via the `@vitest-environment jsdom` docblock; `@testing-library/*` installed; per-file `@testing-library/jest-dom/vitest` import — see `tests/planetview-negative.test.tsx:1-2`). Deterministic clocks via the existing injectable `now` (`useGameState.ts:52`) + `vi.useFakeTimers()`.

| Suite | Env | Cases |
|---|---|---|
| `tests/save.test.ts` | node | **Round-trip** — serialize→parse→validate identity. **Validation** — missing/invalid `tier`, negative/non-finite wallet, unknown level key, bad `lastTickAt` → corrupt; missing level key / missing `tutorial` / missing `offlineSummarySeen` → lenient default (`false`). **Migration** — forward map applies; future `schemaVersion` → unsupported. |
| `tests/savepersist.test.tsx` | jsdom | **Hook round-trip** — render `useGameState` with an in-memory storage adapter, advance fake timers → save written; unmount + remount → state restored (balances, levels, `lastTickAt`). **Corrupt save** — seed garbage → fresh starter state + the notice banner appears, no crash, game playable. **Offline gap on real load** — seed a save with `lastTickAt = now − 12h` → after mount state is banked at the 8h cap and `OfflineSummary` shows the clamped amounts (reuse the T03-C assertions: modal shows `+4K` not `+57.6K`; announced == banked). **Quota failure** — `setItem` throws → no crash, in-memory play continues. **StrictMode guard** — double effect invoke banks once, modal fires once. **Offline seen-flag persistence** — `offlineSummarySeen` round-trips; seed `lastTickAt = now − 12h` with `offlineSummarySeen: true` → new gap clears the flag and shows the modal once; no-gap remount → not re-shown. |
| Tutorial (in `tests/savepersist.test.tsx` or `tests/tutorial.test.tsx`) | jsdom | **Progression** — build Housing → step 2; build Ore Mine → step 3; dismiss offline reveal → `done`. **Skip** — click Skip → `skipped`, overlay gone, not shown on remount. **Resume** — save mid-flow (step 1), remount → resumes at step 1. |

**Full gates per AGENTS.md:** `npx vitest run`, `npx tsc -b` exit 0, `npm run build` exit 0 (lint: `npm run lint` exit 0).

---

## 7. Exclusions (bounded for T04)

| Excluded | Why |
|---|---|
| **Supabase / backend / cross-device sync** | Phase 3 — save is local-only localStorage; a server save is P3-T01 |
| **Capacitor** | DESIGN §2/§3 — web preview first; the `visibilitychange`/`pagehide` flush (§2) is the web seam the Capacitor app will later hook |
| **Multi-planet economies** | Phase 2 — P1 schema holds a single planet's wallet + levels; per-planet grid isolation is P2-T04 |
| **PvP / Galaxy Map / scout preview** | Phase 3 — onboarding steps 5–6 deferred (§5) |
| **Real planet catalogue / claim pool** | Phase 2 — claim intro is a placeholder card; real claim is P2-T03 |
| **Achievements** | DESIGN §10 lists them with save/load; not in ROADMAP P1 scope — record-only note, not built |
| **Build queues / async timers** | No queue system in sim; instant builds (T03 decision B) unchanged |

**Minor discrepancy on record:** DESIGN §10's 8-point build-phase sketch lists "save/load, onboarding tutorial" as its step 2, while ROADMAP executes it as P1-T04 in Phase 1. ROADMAP is the execution record and already has P1-T04 rows; this audit proceeds per ROADMAP and notes the DESIGN ordering for Jay (§8).

---

## 8. Blockers / Decisions for Jay

| # | Decision | Options | My recommendation |
|---|---|---|---|
| **A** | **Offline-modal seen flag** (task brief listed it as persisted) | (1) persist it; (2) session-scoped in-memory only | **Persist it** as `offlineSummarySeen` — the summary shows once per real offline gap, not on every load; session-scoped would re-announce on every open. Cleared on a fresh qualifying gap at load, set on dismissal (§1) |
| **B** | **Save key + versioning** | (1) `starbaron.save.v1`, key embeds version, tombstone old keys; (2) stable key `starbaron.save` with `schemaVersion` inside | **Key-per-version** — crash-safe migration, zero ambiguity on format drift (§2) |
| **C** | **Write strategy** | (1) debounced (~5s) + immediate-on-buy + beforeunload/pagehide flush; (2) on-interval only; (3) on-unload only | **Hybrid (1)** — purchase safety + `lastTickAt` freshness + negligible write churn (§2) |
| **D** | **Offline-summary threshold** | (1) ~60s; (2) ~5 min (T03 audit §4 suggested); (3) any real gap > 0 | **~60s** — DESIGN's "on every open" without reload-spam noise; pure tuning knob |
| **E** | **Corrupt-save UX** | (1) inline dismissible banner "starting fresh"; (2) blocking modal; (3) silent fresh start | **Banner + keep the raw key** (recoverable by a future fix, overwritten by the next save) (§3) |
| **F** | **Onboarding step set** | (1) 4 steps (claim intro, Housing, Ore Mine, offline reveal) + defer 5–6; (2) 6 steps with P3 stubs | **4 steps, defer 5–6** — stubs would fake PvP that doesn't exist (§5). Include the lightweight claim intro (P2 replaces content later) |
| **G** | **Tutorial gating** | (1) non-gating guided overlay, always skippable; (2) forced sequential with blocking prompts | **Non-gating + skip/resume persisted** — no soft-locks, matches ROADMAP P1-T04-C |
| **H** | **Placement of persistence layer** | (1) new `src/ui/save.ts` (pure functions + thin storage adapter); (2) inside `useGameState`; (3) new `src/sim/save.ts` | **`src/ui/save.ts`** — keeps `src/sim` pure (T03 decision A contract); validate/migrate are pure and node-testable, the adapter is the only jsdom part |

**Blockers:** none blocking T04-B. The design is fully grounded in verified code (state shape `useGameState.ts:20-29`, single capped `bankElapsed` path `useGameState.ts:153-168`, the removable mount simulation `useGameState.ts:195-223`, reusable `OfflineSummary.tsx`, T03-C clamp `useGameState.ts:213-220`, `isStructureId`/`STRUCTURE_IDS` in `src/sim/structures/data.ts`). Decisions A–H are bounded input points for Jay; each default is safe to proceed on.

---

*Prepared by OpenCode (deepseek-v4-flash) for P1-T04-A. Only `docs/P1_T04_A_AUDIT.md` created. No commit made, no work on `main`.*
