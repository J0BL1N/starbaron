# Phase 1 — Core Idle Engine + Web Preview: Whole-Phase Closeout Evidence

*Phase 1 completion record for **StarBaron** (Core Idle Engine + Web Preview). Consolidates the five task records (`P1-T01` → `P1-T05`) and the whole-phase Codex audit into one closeout. Per WORKFLOW.md, no HEAD SHAs are embedded in prose — SHAs appear only where the record references them (commit subjects). The whole phase was Codex-PASSED.*

---

## 1. Phase 1 Completion Summary

**5 tasks**, **20 commits on `staging`** (19 pre-closeout + this closeout), **217 tests across 13 files**, all four verification gates green (see §4).

| Task | Scope (locked to DESIGN.md) | Result | Evidence |
|---|---|---|---|
| **P1-T01** Scaffold + sim core | Flat-root Vite+TS project; pure `src/sim` (economy, population, offline, format); vitest; `main`/`staging` | **Complete** — 39 sim tests PASS, tsc/build 0 | `docs/P1_T01_EVIDENCE.md` |
| **P1-T02** Structures v1 | 7 structures (Ore Mine, Trade Hub, Housing, Hydroponics, Barracks, Shipyard, Defense Turret), ×1.15 cost curve, discriminated effects, runtime id guard | **Complete** — +64 then +19 tests, 83 total, lint 0 | `docs/P1_T02_EVIDENCE.md` |
| **P1-T03** Web preview UI | Planet View, structure grid, build menu, live resource bar, offline-summary modal, dark theme | **Complete** — 126 tests PASS, dev 200 | `docs/P1_T03_EVIDENCE.md` |
| **P1-T04** Save/load + onboarding | `SaveGameV1` + hybrid persistence, real offline-gap (replaces T03 simulation), 4-step tutorial | **Complete** — 205 tests PASS | `docs/P1_T04_EVIDENCE.md` |
| **P1-T05** Phase closeout | Whole-phase Codex audit, cross-cutting fixes, this evidence | **Complete** — 6 findings → 3 correction rounds → **PASS** (see §5–§6) | this document |

**Phase deliverable:** a playable, local-only web preview of the idle loop — economy + population sim, 7 buildable structures, Planet View UI, save/load, onboarding, and real offline-earnings reveal. No PvP, no backend, no Capacitor — all bounded to Phase 2/3 by DESIGN.md.

---

## 2. Commit Record (full log, oldest → newest)

19 commits carried Phase 1 to whole-phase PASS; this closeout is the 20th. No work on `main`; no push, tag, or deploy.

| # | SHA (subject) | Task |
|---|---|---|
| 1 | `61cca88` docs: StarBaron design, workflow and roadmap (P1-P4) | Phase setup |
| 2 | `3f1ebe6` docs: P1-T01-A scaffold audit (toolchain, layout, pinned deps, lockfile determinism) | T01-A |
| 3 | `fe9c8b4` feat: P1-T01-B scaffold (Vite react-ts, pinned deps, src/sim+src/ui+tests, vitest) | T01-B |
| 4 | `f7a0fd6` feat: P1-T01 complete — sim core (economy/population/offline/format) + 39 tests, Codex PASS | T01-C/D |
| 5 | `2fa0733` docs: P1-T02-A structures audit + DESIGN Shipyard income +50cr/min (Jay) | T02-A |
| 6 | `d04f9c3` feat: P1-T02-B structures module (7 structures, StructureId union, discriminated effects, +64 tests) | T02-B |
| 7 | `a116feb` test: P1-T02-C structures deep coverage (cost regression, large levels, data integrity) +83 tests | T02-C |
| 8 | `1975366` docs: P1-T02 complete — structures system, Codex PASS | T02-D |
| 9 | `955dfe5` docs: reconcile P1 roadmap (T03=web UI next, fold sim into T01, drop dups) | Roadmap reconcile |
| 10 | `584d700` docs: P1-T03-A web preview UI audit (component tree, UI wallet, tick design) | T03-A |
| 11 | `e1ff985` feat: P1-T03-B Planet View web preview (UI wallet, tick accrual, dark theme, 92 tests) | T03-B |
| 12 | `5f1cb0d` fix+test: P1-T03-C offline-summary cap clamp bug + negative-path UI tests (126 tests) | T03-C |
| 13 | `48124a7` docs: note Kimi K3 3D planet design (art stage, Jay) | Art note |
| 14 | `bb23289` docs: P1-T03 complete — Planet View web preview, Codex PASS | T03-D |
| 15 | `885293f` docs: P1-T04-A save/load + onboarding audit (schema, persistence, real offline gap) | T04-A |
| 16 | `d36ce5c` feat: P1-T04-B save/load + onboarding (localStorage, real offline gap, 4-step tutorial, 159 tests) | T04-B |
| 17 | `52a75a9` test: P1-T04-C save/onboarding edge coverage (corrupt matrix, storage edges, gap boundaries) | T04-C |
| 18 | `df71a14` docs: P1-T04 complete — save/load + onboarding, Codex PASS | T04-D |
| 19 | `18fd410` fix: P1-T05 whole-phase audit corrections (militia DP, 1:1 barracks conservation, sync offline checkpoint, Qa/Qi/Sx, assets) | T05 whole-phase fixes |
| 20 | this closeout (`docs/P1_PHASE1_EVIDENCE.md` + ROADMAP.md) | T05-D |

---

## 3. Test Counts (verified at closeout)

`npx vitest run` — **13 files / 217 tests PASS** (exact, 2.04s). Per-file breakdown:

| File | Tests |
|---|---|
| `tests/structures.test.ts` | 28 |
| `tests/savepersist-edge.test.tsx` | 26 |
| `tests/planetview-negative.test.tsx` | 24 |
| `tests/save-corrupt.test.ts` | 20 |
| `tests/structures-deep.test.ts` | 19 |
| `tests/savepersist.test.tsx` | 17 |
| `tests/save.test.ts` | 17 |
| `tests/sim-purity.test.ts` | 15 |
| `tests/format.test.ts` | 13 |
| `tests/economy.test.ts` | 10 |
| `tests/population.test.ts` | 10 |
| `tests/planetview.test.tsx` | 9 |
| `tests/offline.test.ts` | 9 |
| **Total** | **217** |

Growth curve across the phase: 39 (T01) → 83 (T02) → 126 (T03) → 205 (T04) → **217** after the whole-phase audit added 12 regression tests (`18fd410`: format +3, structures +3, planetview-negative +5, savepersist +1).

---

## 4. Verification Gates (all green)

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **13 files / 217 tests PASS** |
| Typecheck | `npx tsc -b` | **exit 0** |
| Build | `npm run build` | **exit 0** (207.45 kB JS / 6.70 kB CSS, 102 ms) |
| Lint | `npm run lint` | **exit 0** (oxlint) |
| Dev server | `npm run dev` | **HTTP 200** |

---

## 5. Whole-Phase Audit — Findings + Fixes

The whole-phase Codex audit surfaced **6 findings** across the P1 stack. All six were corrected in one consolidated commit (`18fd410`) with regression tests:

| # | Finding | Fix | Where |
|---|---|---|---|
| **F1** | **Militia defence power not displayed** — DESIGN §4c fixes militia at 15% of population, but `defensePower` came from turrets only, so the UI's DP understated a planet's true defence | New `defensePower(turretLevels, population)` = `500 × turrets + 0.15 × population`; `computeDerived` now takes `population` and derives DP from turrets **+ militia**. Unit + UI regression tests (`structures.test.ts`, `planetview-negative.test.tsx`) | `src/sim/structures/effects.ts`, `src/ui/useGameState.ts` |
| **F2** | **Barracks 1:1 conservation exploit** — the old `accrue` clamped population and garrison independently, so conversion could create garrison without consuming civilians (a free army) | Rewrote `accrue` as a **per-second loop simulation**: each tick converts `garrisonPerSec` from civilians (`population −= converted; garrison += converted`), capped by available population, `garrisonCap` and `populationCap`; a fractional remainder is handled once after the loop. 6 accrual-regression tests prove no free army, 1:1 drain, and pop regrow at full garrison | `src/ui/useGameState.ts`, `tests/planetview-negative.test.tsx` |
| **F3** | **Offline gap not checkpointed synchronously** — banking a real offline gap updated `lastTickAt` only via the debounced path, risking double-counting if the tab closed immediately after | `bankElapsed(at, durable)` — the offline-load path calls it with `durable = true`, which **synchronously flushes the save** right after committing, pinning `lastTickAt` at the exact bank moment. Regression test asserts the synchronous checkpoint | `src/ui/useGameState.ts`, `tests/savepersist.test.tsx` |
| **F4** | **Formatting gap above `T`** — values ≥ 1e15 fell straight to scientific notation with no named suffix | Added `Qa` (1e15), `Qi` (1e18), `Sx` (1e21) suffixes; scientific notation now only ≥ 1e22. 3 new format tests | `src/sim/core/format.ts`, `tests/format.test.ts` |
| **F5** | **ROADMAP wording drift** — the T04-B scope row advertised a "→ map intro" step that the 4-step onboarding does not implement (map is P2/P3) | Removed "→ map intro" from the T04-B row so the record matches the shipped 4-step flow | `ROADMAP.md` |
| **F6** | **Dead template assets shipped** — unused Vite/React boilerplate (`hero.png`, `react.svg`, `vite.svg`, unused `icons.svg` entries) | Deleted the dead assets; nothing references them (build + sim-purity gates still green) | `src/assets/`, `public/icons.svg` |

---

## 6. Audit-Loop Story — 6 Findings → 3 Correction Rounds → PASS

Per WORKFLOW.md, Codex (read-only) audits each deliverable and OpenCode implements corrections; a whole-phase Codex audit runs at phase end. The Phase 1 loop:

1. **Per-task audit passes (T01 → T04):** each `-A` audit and `-B`/`-C` implementation was independently Codex-PASSED as it landed (records in each task evidence doc).
2. **Whole-phase audit (T05):** Codex reviewed the full P1 stack cross-cutting — across sim, UI, persistence, docs and assets — and returned **6 findings** (F1–F6 above).
3. **Correction round 1 — sim correctness:** F1 (militia DP) and F2 (barracks conservation) fixed together; both change `accrue`/`computeDerived` and share the per-second accrual path, so they were landed as one round with 9 regression tests.
4. **Correction round 2 — persistence + display:** F3 (synchronous offline checkpoint) and F4 (Qa/Qi/Sx suffixes) fixed together; both are user-visible correctness gaps in the load/format paths, with 4 regression tests.
5. **Correction round 3 — docs + hygiene:** F5 (ROADMAP wording) and F6 (dead assets) fixed together; docs-only + asset removal, verified by the same green gates.
6. **Re-audit → PASS:** Codex confirmed all six findings resolved on `18fd410`; **217/217 tests, tsc 0, build 0, lint 0, dev 200**.

The loop's discipline: fixes landed in bounded batches by concern, each batch re-verified by the full suite before the next, and nothing merged until the independent audit returned PASS (max-6-attempts rule not needed).

---

## 7. Bounded Decisions Log (Phase 1)

Decisions were scoped per task, each default safe to proceed on and none inventing beyond DESIGN.md:

| # | Decision | Record | Choice |
|---|---|---|---|
| 1 | **Flat root layout** | T01-A decision A | Single flat package at repo root (no `web/` subfolder, no monorepo); Capacitor can add `ios/`+`android/` at root later |
| 2 | **Latest versions** | T01-A decision B | Latest majors (React 19, Vite 8, vitest 4, TS 7); peer ranges cross-checked; determinism via committed `package-lock.json` |
| 3 | **oxlint** | AGENTS.md gates | Lint = `oxlint` (no ESLint customisation) |
| 4 | **UI-layer in-memory wallet** | T03-A decision A | Wallet lives in the UI layer (`useGameState`), keeping `src/sim` stateless/pure; persistence is a UI concern (T04) |
| 5 | **Instant builds** | T03-A decision B | Click → deduct → level up; `buildTimeSec` shown as metadata only (no queue/timer system — timed builds are P3 backend territory) |
| 6 | **Starter resources** | T03-A decision C | 1,000 cr / 0 alloys / 1,000 pop (DESIGN §4d fixes pop; credits/alloys were undefined) |
| 7 | **Dark theme** | T03-A decision E | Dark-first space palette in `index.css` (replaces template light-default) |
| 8 | **Simulated → real offline gap** | T03-A F–H → T04-A | T03 shipped a simulated preview-only gap; T04 replaced it with the real persisted gap driven by `lastTickAt`, always through the single 8h-capped `bankElapsed()` path |
| 9 | **`schemaVersion`** | T04-A | `SaveGameV1`, `SAVE_SCHEMA_VERSION = 1`, strict-on-corruption validation, forward-compatible lenient defaults, empty migration map at v1 |
| 10 | **4-step onboarding** | T04-A F/G | Claim planet → Housing → Ore Mine → offline reveal; non-gating, skippable, persisted; map/scout steps deferred to P2/P3 |
| 11 | **0-indexed levels** | T02-A decision 5 | `level` = current level; first build (0 → 1) costs the table `baseCost` exactly, reusing `economy.structureCost` ×1.15 unchanged |
| 12 | **Per-sec derived storage** | T02-A decision 4 | DESIGN's per-min figures (e.g. Ore Mine "5 alloys/min") kept per-min as the source-of-truth and converted to per-sec at effect time (`alloysPerSec`, `creditsPerSec`, `populationPerSec`, `garrisonPerSec`) so the doc and sim stay comparable |
| 13 | **enum → const-object** | T02-B | No TS `enum` in `src/sim` — `STRUCTURE_IDS`/`STRUCTURES`/`StructureCategory` are `as const` const-objects with `satisfies` typing, keeping the module erasable and tree-shakeable |
| 14 | **Runtime id guard** | T02-B | `isStructureId` runtime check + `assertKnownStructure` (RangeError on unknown id) as the defensive seam on every structure access |

---

## 8. Branch / Remote State

- Branch: `staging` (no work on `main`).
- No push, no tag, no deploy — remote unchanged pending authorisation.
- HEAD at closeout: `18fd410` (whole-phase fixes); this closeout adds docs only.
- Working tree clean after commit.

---

*Prepared by OpenCode (deepseek-v4-flash) for P1-T05-D. Only `docs/P1_PHASE1_EVIDENCE.md` + ROADMAP.md changed in this subtask.*
