# P1-T03-A — Web Preview UI Audit

*Subtask `-A` for **P1-T03 Web preview UI** (Phase 1 — Core Idle Engine + Web Preview). Documentation-only audit. Nothing implemented, nothing committed. Per WORKFLOW.md no HEAD SHAs are embedded in docs (stable wording only). Scope grounded in DESIGN.md §4c/§4d/§5c, ROADMAP.md P1-T03 rows, and evidence docs P1_T01_EVIDENCE.md + P1_T02_EVIDENCE.md.*

---

## 1. Component Tree — Planet View (DESIGN §5c)

The screen spec for **Planet View** (home) is: *"The planet itself, structure grid, resource bar (credits/alloys/pop/fleet), build menu, garrison count"* — plus the §5c "offline summary on every open" modal, which ROADMAP P1-T03-C assigns to this task. No Galaxy Map / Fleet View / Attack Report screens yet (P3 — §7).

```
App                                        src/ui/App.tsx            (template shell, replaced in -B)
└── PlanetView                             src/ui/components/PlanetView.tsx
    ├── PlanetDisplay                      src/ui/components/PlanetDisplay.tsx     planet identity front-and-center
    ├── ResourceBar                        src/ui/components/ResourceBar.tsx       credits · alloys · pop · fleet · garrison
    ├── StructureGrid                      src/ui/components/StructureGrid.tsx     7 rows, level + per-level effect readout
    │   └── StructureRow                   (row component, inline or split out)
    ├── BuildMenu                          src/ui/components/BuildMenu.tsx          build/upgrade per structure + cost display
    │   └── BuildButton                    (per-structure action, disabled when unaffordable)
    └── OfflineSummary                     src/ui/components/OfflineSummary.tsx     "While you were away…" modal (T03-C)
```

State/derivation lives in one hook so the tree stays presentational:

```
└── useGameState (hook)                    src/ui/hooks/useGameState.ts
        ├── in-memory state (wallet + levels + lastTickAt)          §2
        ├── derived rates/caps from sim functions                   §3
        └── tick loop + offline-gap accrual                         §4
```

**Mapping to §5c UI principles:** big readable numbers (format via `formatNumber`) · planet identity front-and-center (PlanetDisplay on top) · offline summary on every open (modal) · one-thumb operations (mobile-first, build button as primary tap). Urgent-red attack styling is **P3-only — noted here, not implemented** (§5).

---

## 2. State Model

**What the UI needs from the sim** (per §5c resource bar + §4a currencies + garrison count):

| Value | Mutable or derived | Source |
|---|---|---|
| Credits | **stored (wallet)** | accrued from baseline income + shipyard income |
| Alloys | **stored (wallet)** | accrued from Ore Mine |
| Population | **stored** | DESIGN §4d start 1,000; accrues up to `populationCap` |
| Garrison (soldiers) | **stored** | produced by Barracks conversion, cap = `barracks.garrisonCap` |
| Fleet | **stored** | cap = `shipyard.fleetCap`; 0 in preview (no PvP) |
| Structure levels | **stored** | `Record<StructureId, number>`, all 0 initially |
| Planet tier | **stored** | 1 (placeholder home planet — real catalogue is P2) |
| lastTickAt | **stored** | epoch ms, drives timestamp-based accrual (§4) |
| Rates / caps / multiplier / DP | **derived** | recomputed each render from levels via sim (§3) |

### Wallet decision — UI-layer in-memory wallet (recommended)

**Background:** T02-C explicitly deferred wallet/affordability to T03/04, and `src/sim` has no wallet module today. The two options:

1. **Sim-level wallet module** — new `economy.wallet` (or similar) holding balances + deduction/affordability.
2. **Minimal in-memory wallet in the UI layer** — plain fields in `useGameState`, affordability = a 2-line check against `nextBuildCost`.

**Recommendation: option 2 (in-memory, UI layer, NOT a sim module).** Rationale:

- **Bounded.** T04 owns save/load; a wallet with persistence is exactly T04's data. Building a sim wallet now guarantees a T04 rework.
- **Preserves the sim boundary.** `src/sim` is deliberately pure/stateless (DESIGN §3) — it prices (`nextBuildCost`) and produces (`structureEffect`); it never holds balances. Keeping balances in the UI layer keeps that contract intact.
- **Not real sim math.** Affordability/deduction is presentation logic; there is no formula to unit-test in the engine. The sim's tested surface stays prices + effects.
- **Trivial to swap later.** The wallet is 4 fields in one hook; when T04 arrives, those fields move into the save schema and `useGameState` rehydrates from storage.

⚠️ **Consequence to note:** without save/load, all state is ephemeral — a page refresh resets the preview (see §7 exclusion). The §5c offline modal therefore demonstrates the mechanic with an **explicitly simulated preview-only gap** (in-memory only — see §4); it cannot claim real tab-closed/reopened earnings, because a closed tab loses `lastTickAt` with the rest of the in-memory state. True offline earnings across app-closes are T04.

---

## 3. Data Flow — Sim Function Inventory (each verified in `src/sim`)

All values below were confirmed to exist at their listed locations at HEAD (branch `staging`). UI imports `src/sim`, never the reverse (P1-T01-A §2 engine rule).

### Inventory

| Sim function / value | Location | Signature | Verified |
|---|---|---|---|
| `baselinePassiveIncome(tier)` | `src/sim/core/economy.ts:6` | `(tier: number) => number` (`10 × tier`, throws on tier ∉ [1,5]) | ✅ |
| `structureCost(baseCost, level)` | `src/sim/core/economy.ts:13` | `(baseCost, level) => number` (`base × 1.15^level`) | ✅ |
| `populationCap(housingLevels)` | `src/sim/core/population.ts:7` | `(housingLevels: number) => number` (`5,000 × (1 + 0.2L)`) | ✅ |
| `populationGrowthPerSec(housingLevels, hydroponicsLevels?)` | `src/sim/core/population.ts:14` | `(h, hyd = 0) => number` (`(2 + 2h)(1 + 0.5·hyd)`) | ✅ |
| `calculateOfflineEarnings(ratePerSec, elapsedSeconds)` | `src/sim/core/offline.ts:3` | `(rate, elapsed) => number`, banks at 8h cap | ✅ |
| `formatNumber(value)` | `src/sim/core/format.ts:10` | `(value: number \| null \| undefined) => string` (K/M/B/T… sci. at ≥1e15) | ✅ |
| `STRUCTURE_IDS` | `src/sim/structures/data.ts:4` | readonly 7-literal tuple | ✅ |
| `STRUCTURES` | `src/sim/structures/data.ts:20` | `Readonly<Record<StructureId, Structure>>` (costs, buildTimeSec, category) | ✅ |
| `isStructureId(value)` | `src/sim/structures/data.ts:16` | runtime guard `value is StructureId` | ✅ |
| `structureEffect(id, level)` | `src/sim/structures/effects.ts:31` | `(id, level) => StructureEffect` (7-kind discriminated union) | ✅ |
| `nextBuildCost(id, level)` | `src/sim/structures/effects.ts:70` | `(id, level) => number` — thin wrapper over `structureCost` | ✅ |
| `Structure` / `StructureEffect` / `StructureId` / `StructureCategory` | `src/sim/structures/types.ts` | types | ✅ |
| Effect constants (ORE 5/min, SHIPYARD 50/min, etc.) | `src/sim/structures/effects.ts:11-17` | per-min sources converted to /sec in `structureEffect` | ✅ |

**All 11 callables + the type set exist.** No missing sim surface for T03-B.

### How the UI derives live numbers (per §1 tree)

| UI number | Derivation |
|---|---|
| credits/sec | `baselinePassiveIncome(tier) × tradeHub.multiplier` **+** `shipyard.shipbuildingIncomePerSec` |
| alloys/sec | `structureEffect('oreMine', L).alloysPerSec` |
| pop cap | `populationCap(housingLevels)` |
| pop growth/sec | `populationGrowthPerSec(housing, hydroponics)` |
| garrison cap | `structureEffect('barracks', L).garrisonCap` |
| fleet cap | `structureEffect('shipyard', L).fleetCap` |
| defense power | `structureEffect('defenseTurret', L).defensePower` (display-only in preview) |
| build price | `nextBuildCost(id, L)` (+ `STRUCTURES[id].alloyCost` for the Turret) |
| build time | `STRUCTURES[id].buildTimeSec` (displayed as metadata — §8 decision B) |

Caps clamp accrual (§4). DP has no in-preview consumer but shows the Turret is meaningful; combat is P3.

---

## 4. Tick / Refresh Design

**Recommendation: timestamp-based accrual + a 1-second `setInterval` purely as a render refresh trigger.** This is the idle-genre standard (compute from last-update timestamp, not per-frame accumulation).

- **Model:** one capped accrual helper, `bankElapsed()`, shared by **every** elapsed-time path — the interval tick, the user-action snap, and the mount/offline-gap check. It computes `elapsedMs = Date.now() - lastTickAt`, **clamps it to the sim's 8-hour offline cap (`8 × 3600 × 1000` ms, DESIGN §4d)** so no path can over-accrue, accrues `balance += ratePerSec × cappedMs/1000` for each resource, **clamped to its cap** (pop → `populationCap`, garrison/fleet → their caps; credits/alloys uncapped), then sets `lastTickAt = Date.now()` so the banked window is never double-counted.
- **`setInterval(1000)` is not the accumulator.** It only triggers a recompute of `elapsedMs` from timestamps. If the tab is backgrounded, browsers throttle `setInterval` to ~1/min — timestamp math makes the catch-up **correct** regardless, which per-frame accumulation would drift on.
- **`requestAnimationFrame` is not needed.** Idle numbers update 1/s; rAF costs CPU for zero benefit. If smooth counting animation is wanted later, animate the *displayed* value only, never the model.
- **Snap-accrue on user actions too.** Before reading balances or prices in `BuildMenu`, call the same `bankElapsed()` so the current tick is banked — through the same 8h-capped path — before any deduction.
- **Offline gap on mount** (T03-C modal): two cases, both through `bankElapsed()`. **(1) Backgrounded-tab resume** (hook never unmounted): the interval was throttled to ~1/min; on resume `bankElapsed()` banks the real gap (8h-capped) and, if it exceeds a small threshold (e.g. 5 min), shows the modal with the per-resource amounts via `calculateOfflineEarnings(rate, elapsedSec)`. **(2) Tab closed/reopened — explicitly simulated preview-only:** the preview keeps all state in memory, so a closed tab loses `lastTickAt` along with everything else (see §2) — **tab close = state lost in the preview** is an honest limitation. The modal therefore also fires on a **seeded "away" gap** (in-memory simulation, e.g. a preview/debug seed) so the mechanic can be demonstrated without claiming real tab-reopen accrual. Real cross-close persistence is T04.
- **Clock source:** `Date.now()` in the hook; inject it / use `vi.useFakeTimers()` in tests for deterministic tick assertions.

---

## 5. Styling

**Recommendation: plain CSS — extend the existing `src/ui/index.css` (global theme vars) + `src/ui/App.css` (co-located component styles). No CSS modules.**

- The repo has **zero** CSS modules today; the template is plain CSS. CSS modules (`.module.css`) would add tooling/lint surface for no P1 benefit.
- `index.css` already has the right seam — a `:root` custom-property block plus a `prefers-color-scheme: dark` override. For a space game, re-tint to a **dark-first** palette in `-B`: deep-space background, planet accent colour, keep the `--mono` font for the resource numbers (idle-genre "big readable numbers" §5c), keep the existing `--accent` mechanism.
- `App.css` today is Vite template boilerplate (hero/counter/next-steps/ticks) — **replace it wholesale in `-B`**; none of it is used by Planet View.
- **Planet identity front-and-center** (§5c): a large placeholder planet mark (emoji/simple shape per DESIGN §2 "emoji + simple shapes first" — e.g. 🪐) + placeholder name, until P2 catalogue + T04 claim flow supply a real planet.
- **Urgent red for attacks:** DESIGN §5c UI principles mandate urgent red for attack events — that is **P3 UI** (attack flow, reports). Define a `--danger` token in `index.css` now (reserved, unused) so P3 slots in without a theming pass; do **not** build attack visuals in T03.

---

## 6. Testing Approach

Follow the pattern established in P1-T01-A §2/§3 and used by the existing suites (`tests/*.test.ts`, default **node** env — verified in `vitest.config.ts`):

- **Sim tests:** stay in `node` (no docblock) — do not disturb the 6 existing files / 83 tests.
- **UI tests:** new `tests/ui/*.test.tsx`, each opting into jsdom via the per-file docblock:
  ```tsx
  /* @vitest-environment jsdom */
  ```
  `vitest.config.ts` `include` already covers `tests/**/*.test.tsx` (verified). `jsdom`, `@testing-library/react` (16.3.2), `@testing-library/jest-dom` (7.0.0) and `@testing-library/user-event` (14.6.3) were installed at T01-B (verified in `package.json`).
- **jest-dom matchers:** import `@testing-library/jest-dom/vitest` — either per-file or via a vitest `setupFiles` entry. Decide at `-B`; the current config has no setup file.
- **Typical T03-B/C cases:** renders the 7 structure rows · BuildMenu shows `nextBuildCost` · clicking build increments level + deducts credits (and alloys for the Turret) · build button disabled when unaffordable (T02-C "cannot afford" gap lands here) · rapid-click safety (no double-build / double-deduct) · resource numbers formatted via `formatNumber` · population clamps at `populationCap` · OfflineSummary appears after the elapsed threshold and is dismissible · timestamp accrual correctness under fake timers.
- **Full gates per AGENTS.md:** `npx vitest run`, `npx tsc -b` exit 0, `npm run build` exit 0.

---

## 7. Exclusions (bounded for T03)

| Excluded | Why |
|---|---|
| **Save/load (localStorage)** | ROADMAP P1-T04 — T03 state is in-memory; refresh resets the preview |
| **Onboarding tutorial** | ROADMAP P1-T04 — claim-planet walkthrough is T04-B |
| **PvP UI** | Phase 3 — no Galaxy Map / Fleet View / Attack Report / Leaderboard / Notifications screens; garrison/fleet shown read-only |
| **Capacitor** | DESIGN §2/§3 — web preview first; mobile wrapper later |
| **Supabase / backend** | Phase 3 — preview is fully local |
| **Real planet catalogue / claim flow** | Phase 2 — single placeholder home planet, tier 1 |
| **Build queues / build timers** | No queue system in sim; `buildTimeSec` shown as metadata only (decision B, §8) |
| **Tap-to-earn** | DESIGN §4 core loop mentions tapping, but T03-B scope is the passive idle bar + build menu; tapping is a later phase decision |
| **Attack/combat math** | Phase 3 (AP/DP, militia, conquest) — DP displayed as structure info only |

---

## 8. Blockers / Decisions for Jay

| # | Decision | Options | My recommendation |
|---|---|---|---|
| **A** | **Wallet placement** (§2) | (1) UI-layer in-memory wallet; (2) sim-level wallet module | **UI-layer in-memory** — bounded, T04 owns persistence, keeps `src/sim` stateless. Confirm so T03-B proceeds on it |
| **B** | **Build timing in preview** | (1) Instant build (click → deduct → level up, `buildTimeSec` shown as metadata); (2) timed build with per-structure countdown timers | **Instant** — no queue/timer system exists in the sim; async timers are backend territory (P3). Timed builds only if Jay wants the "build in progress" feel now |
| **C** | **Starter resources** | DESIGN §4d fixes pop (start 1,000 / cap 5,000) but defines **no starting credits/alloys**. (1) 1,000 cr / 0 alloys — enough to build the first Housing (300) + Ore Mine (500) per §5c onboarding steps; (2) Jay-specified numbers | **1,000 cr / 0 alloys / 1,000 pop** — matches onboarding step 2 ("build first Housing → watch pop grow") and step 3 (Ore Mine → see alloys) with the first two clicks feelable immediately |
| **D** | **Placeholder planet identity** | (1) Emoji/simple shape + "Home Planet" placeholder; (2) hold PlanetDisplay until P2 | **Emoji placeholder now** — §5c wants planet identity front-and-center from day one; catalogue name arrives with P2 claim flow |
| **E** | **Dark theme direction** | (1) Dark-first space palette in `index.css` (replaces template light-default); (2) keep template light/dark auto-switch | **Dark-first** — matches the space theme hint; template's light mode is boilerplate |
| **F** | **Offline summary scope** | Simulated preview-only gap (in-memory seed; honest that tab close loses state) vs true cross-close offline (needs localStorage) | **Simulated preview-only** — localStorage is T04; the T03 modal demonstrates the reveal mechanic with a seeded away-gap, without claiming real tab-reopen accrual or inventing a save layer |

### Resolved this round (per Codex T03-A correction)

| # | Decision | Resolution |
|---|---|---|
| **G** | **Offline-summary semantics** | **Simulated preview-only gap.** In-memory only — closing the tab loses all state (honest limitation, §2/§4); the T03-C modal demonstrates the mechanic with a seeded "away" gap. Real cross-close persistence is T04. |
| **H** | **8-hour cap on every accrual path** | **Capped accrual everywhere.** The 8h offline cap (DESIGN §4d) lives inside the single shared `bankElapsed()` helper — interval tick, user-action snap, and mount/offline-gap check alike — so a backgrounded tab resumed after >8h cannot over-accrue. |

**Decisions pending — none block T03-B.** Nothing in `src/sim` is missing for T03-B (§3 inventory is fully verified). The two semantics gaps raised by the Codex audit (offline-summary = simulated preview-only; 8h cap on every accrual path) are **resolved in decisions G–H above**. Decisions **A–F are bounded UI input points for Jay** (wallet placement, build timing, starter resources, placeholder planet, dark theme, offline-summary scope) — recommendations are given above and each default is safe to proceed on; none of them block T03-B implementation.

---

*Prepared by OpenCode (deepseek-v4-flash) for P1-T03-A. Only `docs/P1_T03_A_AUDIT.md` created. No commit made, no work on `main`.*
