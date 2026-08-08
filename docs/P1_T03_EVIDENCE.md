# P1-T03 — Planet View Web Preview Evidence

*Closeout evidence for **P1-T03 Web preview UI** (Phase 1 — Core Idle Engine + Web Preview). Consolidates the subtask record for `-A`/`-B`/`-C`/`-D`. Per WORKFLOW.md, no HEAD SHAs are embedded in prose — SHAs appear only where the record already references them (commit subjects). The whole P1-T03 change was Codex-PASSED.*

---

## 1. Planet View Summary

The screen spec for **Planet View** (home) is implemented end-to-end per DESIGN §5c: planet identity front-and-center, structure grid, resource bar (credits/alloys/pop/fleet + garrison), build menu, and the "offline summary on every open" modal. Presentation is separated from state — one hook (`useGameState`) owns all in-memory state + accrual, and the components stay presentational (as designed in `docs/P1_T03_A_AUDIT.md` §1).

```
src/ui/PlanetView.tsx                        # screen root — composes the tree, owns App.css styles
├── useGameState                             src/ui/useGameState.ts
│     ├── in-memory state (wallet + levels + lastTickAt)      §2
│     ├── derived rates/caps via sim functions (computeDerived) §3
│     └── bankElapsed() capped tick + 8h clamp + offline gap  §4
├── PlanetDisplay                            src/ui/components/PlanetDisplay.tsx    tier + defense power, emoji planet
├── ResourceBar                              src/ui/components/ResourceBar.tsx      credits · alloys · pop · fleet · garrison (formatted, cap + rate shown)
├── StructureGrid                            src/ui/components/StructureGrid.tsx    7 rows, level + per-level effect readout
├── BuildMenu                                src/ui/components/BuildMenu.tsx         build/upgrade per structure + cost + build-time metadata, disabled when unaffordable
└── OfflineSummary                           src/ui/components/OfflineSummary.tsx    "While you were away…" modal — one per session, dismissible
```

**`useGameState`** (`src/ui/useGameState.ts`) is the single state owner. It holds `GameState` in a ref (`tier 1, credits/alloys/pop/garrison/fleet, levels record, lastTickAt`), derives every rate/cap in `computeDerived` via the sim's pure functions, and accrues through one shared **`bankElapsed()`** helper — the interval tick, the buy-action snap, and the mount offline-gap check all go through it. `buy(id)` first banks elapsed time, then checks affordability against `nextBuildCost(id, level)` (+ `STRUCTURES[id].alloyCost` for the Turret), deducts and levels up — all through the same capped path. `now()` is injectable (`now` option) so tests are deterministic under `vi.useFakeTimers()` (audit §4).

**`PlanetDisplay`** — placeholder emoji planet (🪐) + tier badge + defense-power readout, front-and-center (DESIGN §5c "planet identity front-and-center"; real catalogue is P2). **`ResourceBar`** — the §4a/§4d currencies formatted via `formatNumber`, each chip showing live value, cap (where capped) and the per-sec rate. **`StructureGrid`** — one row per `STRUCTURE_IDS` (7), level + the per-level effect summary from `structureEffect` (e.g. "+5 alloys/min" per Ore Mine level). **`BuildMenu`** — build/upgrade button per structure, price shown via `nextBuildCost`, `buildTimeSec` as metadata (decision B — instant build), disabled when unaffordable (closes the T02-C "cannot afford" gap). **`OfflineSummary`** — the §5c reveal modal; fires exactly once on mount from the seeded away-gap, shows the 8h-capped per-resource gains, and is dismissible for the session.

---

## 2. Bounded Decisions — A–F (audit §8) + G/H (resolved, audit §8 "Resolved this round")

| # | Decision | Resolution (locked at -B/-C) |
|---|---|---|
| **A** | Wallet placement | **UI-layer in-memory wallet** — 4 fields in `useGameState`, affordability is a 2-line check; `src/sim` stays pure/stateless (audit §2). T04 owns save/load. |
| **B** | Build timing in preview | **Instant builds** — click → deduct → level up in one step; `buildTimeSec` displayed as metadata only (no queue/timer system in sim; async timers are P3). |
| **C** | Starter resources | **1,000 cr / 0 alloys / 1,000 pop** — matches §5c onboarding steps 2–3; first Housing (300) + Ore Mine (500) feelable immediately. Locked as `STARTER_CREDITS/ALLOYS/POPULATION` constants. |
| **D** | Placeholder planet identity | **Emoji placeholder (🪐)** + "Home Planet" tier-1 placeholder — planet identity front-and-center from day one; catalogue name arrives with P2 claim flow. |
| **E** | Dark theme direction | **Dark-first** — deep-space palette re-tinted in `index.css` (dark-first `:root`, `--danger` token reserved for P3 attack styling), `App.css` boilerplate replaced wholesale. |
| **F** | Offline summary scope | **Simulated preview-only gap** — a seeded in-memory away-gap (`DEFAULT_SIMULATED_GAP_MS`, 12h → clamped to 8h) demonstrates the reveal mechanic; honest that a closed tab loses state (no localStorage — T04). |
| **G** | Offline-summary semantics (Codex T03-A correction) | **Simulated preview-only** — in-memory only, modal fired from the seeded gap on mount, exactly once per session (tested); real cross-close persistence is T04. |
| **H** | 8-hour cap on every accrual path (Codex T03-A correction) | **Capped accrual everywhere** — the 8h cap (`MAX_OFFLINE_BANK_SECONDS`) lives inside the single shared `bankElapsed()` helper, so the interval tick, buy-action snap, and mount offline-gap check all clamp identically; a >8h gap cannot over-accrue. |

---

## 3. Verification Results

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **9 files / 126 tests PASS** — sim core 39 (economy 10, population 10, offline 9, format 10) + structures 44 (structures 25, structures-deep 19) + UI/guards 43 (planetview 9, planetview-negative 19, sim-purity 15) |
| Typecheck | `npx tsc -b` | **exit 0** |
| Build | `npm run build` | **exit 0** (tsc -b + vite build) |
| Lint | `npm run lint` | **exit 0** (oxlint) |
| Dev server | `npm run dev` + HTTP GET | **200** on the served root (Vite dev server, index.html served) |

*UI suites opt into jsdom via the `@vitest-environment jsdom` docblock; sim tests stay in `node` (audit §6).*

---

## 4. The Bug Found + Fixed (-C)

**Offline-summary overstating capped population (+57.6K vs +4K).** The -C negative-path review caught that the offline-summary modal computed its announced population gain as `calculateOfflineEarnings(popGrowthPerSec, elapsedSec)` without clamping to the *actual* headroom: with starter pop 1,000 and base cap 5,000, the raw 8h accrual is **+57,600** (2 pop/s × 28,800 s) but the wallet could only ever bank **+4,000** (cap 5,000 − start 1,000). The summary would have *announced* more than the game ever credited. Fixed in `useGameState` by clamping the announced population and garrison gains to `Math.max(0, cap − before)` at the 8h-capped window — the announced amount now equals what the wallet banks (`src/ui/useGameState.ts:213-220`). The regression test was strengthened to assert both sides: the modal shows `+4K` and `queryByText('+57.6K')` is absent, and the hook's `offlineGain.population === 4_000` while `state.population === 5_000` (`tests/planetview-negative.test.tsx` "content shows the 8h-capped amounts", "announced population/garrison gains equal what the wallet banks"). Committed with the other -C negative-path coverage in 5f1cb0d.

---

## 5. Codex Verdicts (per subtask)

| Subtask | Verdict | Evidence |
|---|---|---|
| -A | **PASS** | Audit + bound scope, component tree, sim inventory verified, exclusions, 6 decisions + G/H resolved (`docs/P1_T03_A_AUDIT.md`, commit 584d700) |
| -B | **PASS** | Planet View implemented — `PlanetView` + 5 components + `useGameState`, UI wallet, capped tick accrual, dark theme, +92 tests (commit e1ff985) |
| -C | **PASS** | Negative-path + regression coverage — cap-clamp bug fixed, rapid-buy/affordability/empty/modal-edge tests, sim-purity guard, +34 tests (commit 5f1cb0d) |
| -D | **PASS** | This evidence + closeout, committed to `staging` |

---

## 6. Branch / Remote State

- Branch: `staging` (no work on `main`).
- No push, no tag, no deploy — remote unchanged pending authorisation.
- HEAD at closeout: `5f1cb0d` (the -C commit; -D adds docs only).

---

*Prepared by OpenCode (deepseek-v4-flash) for P1-T03-D. Only `docs/P1_T03_EVIDENCE.md` + ROADMAP.md changed in this subtask.*
