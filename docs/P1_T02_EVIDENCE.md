# P1-T02 — Structures System Evidence

*Closeout evidence for **P1-T02 Structures v1** (Phase 1 — Core Idle Engine + Web Preview). Consolidates the subtask record for `-A`/`-B`/`-C`/`-D`. Per WORKFLOW.md, no HEAD SHAs are embedded in prose — SHAs appear only where the record already references them (commit subjects). The whole P1-T02 change was Codex-PASSED.*

---

## 1. Structure Module Summary

```
src/sim/structures/
├── types.ts     # StructureId union (7 literals), StructureCategory const-object, Structure, StructureEffect
├── data.ts      # STRUCTURE_IDS, isStructureId runtime guard, STRUCTURES record (7 data-only records)
└── effects.ts   # per-min effect constants, structureEffect(id, level) derived switch, nextBuildCost wrapper
```

**`types.ts`** — `StructureId` is a 7-literal union (`oreMine | tradeHub | housing | hydroponics | barracks | shipyard | defenseTurret`); arbitrary ids are a compile error. `StructureCategory` is a `const`-object + derived type (not a TS `enum`, §5 #6). `Structure` is **data-only** (`id, name, category, baseCost, alloyCost?, buildTimeSec, maxLevel?`). `StructureEffect` is a **discriminated result type** — 7 variants (`alloys`, `incomeMultiplier`, `population`, `growthMultiplier`, `barracks`, `shipyard`, `defense`), one per structure, because the 7 structures do not share one effect shape.

**`data.ts`** — `STRUCTURE_IDS` (readonly tuple, `satisfies readonly StructureId[]`), `isStructureId(value): value is StructureId` backed by a `Set` (runtime guard for untyped input, §5 #7), and `STRUCTURES: Readonly<Record<StructureId, Structure>>` with exactly the 7 audited records — costs/build times are the DESIGN §4d first-build numbers; no logic on the records.

**`effects.ts`** — keeps the **per-min source numbers** (`ORE_ALLOYS_PER_MIN = 5`, `SHIPYARD_INCOME_PER_MIN = 50`) and converts to per-sec inside `structureEffect` (§5 #5). `structureEffect(id, level)` is one switch over the 7 ids returning the matching variant (no effect math in `data.ts` — single source of truth, §5 #4). `nextBuildCost(id, level)` is a thin wrapper that delegates to the existing `economy.structureCost(struct.baseCost, level)` — no reimplemented cost math (§5 #8).

---

## 2. The 7 Structures — DESIGN §4d Numbers

All costs are the first-build price (level 0 → 1); every subsequent level follows the ×1.15 curve via `economy.structureCost`. Build time is flat across all levels (§5 #2). `maxLevel` is unset (uncapped) for all 7 (§5 #3). All values locked in `docs/P1_T02_A_AUDIT.md` §2 and asserted by tests.

| Structure | id | category | baseCost | alloyCost | buildTimeSec | Effect per level (§4d) |
|---|---|---|---|---|---|---|
| Ore Mine | `oreMine` | Economy | 500 cr | – | 30s | +5 alloys/min → `(5/60) × L` alloys/sec |
| Trade Hub | `tradeHub` | Economy | 2,000 cr | – | 120s (2min) | +10% baseline passive income → `1 + 0.10 × L` |
| Housing | `housing` | Population | 300 cr | – | 20s | +1,000 pop cap, +2 pop/sec growth per level |
| Hydroponics | `hydroponics` | Population | 800 cr | – | 45s | +50% growth rate → `1 + 0.50 × L` |
| Barracks | `barracks` | Military | 1,500 cr | – | 60s (1min) | 10 civs/sec → soldiers; garrison cap `5,000 × L` |
| Shipyard | `shipyard` | Military | 5,000 cr | – | 300s (5min) | +1,000 fleet cap + **+50 credits/min** shipbuilding income (§5, Jay) |
| Defense Turret | `defenseTurret` | Defense | 2,000 cr | 1,000 alloys | 180s (3min) | +500 DP → `500 × L` (militia `+0.15 × pop` is P3-T03) |

---

## 3. Verification Results

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **6 files / 83 tests PASS** — structures `25 + 19` (structures.test.ts 25, structures-deep.test.ts 19) + core 39 (economy 10, population 10, offline 9, format 10) |
| Typecheck | `npx tsc -b` | **exit 0** |
| Build | `npm run build` | **exit 0** (tsc -b + vite build) |
| Lint | `npm run lint` | **exit 0** (oxlint) |

---

## 4. Codex Verdicts (per subtask)

| Subtask | Verdict | Evidence |
|---|---|---|
| -A | **PASS** | Audit + bound scope, data model, 7-structure roster, exclusions, blockers (`docs/P1_T02_A_AUDIT.md`, commit 2fa0733) |
| -B | **PASS** | Structures module implemented (`types/data/effects`), 7 structures + 64 tests, commit d04f9c3 |
| -C | **PASS** | Deep coverage — cost regression, large levels, data integrity, +19 tests, commit a116feb |
| -D | **PASS** | This evidence + closeout, committed to `staging` |

---

## 5. Bounded Decisions Taken

| # | Decision | Choice |
|---|---|---|
| 1 | Level indexing on the cost curve | **0-indexed** — `nextBuildCost` reuses `economy.structureCost` unchanged; first build (level 0 → 1) costs the DESIGN §4d table number exactly (audit §6 #5) |
| 2 | Build time at higher levels | **Flat** — `buildTimeSec` is a constant across all levels; queue-scaling is out of P1 (audit §6 #1) |
| 3 | `maxLevel` | **Uncapped** — `maxLevel?: number` is optional and unset for all 7; DESIGN defines caps only derivatively (audit §6 #2) |
| 4 | Effect representation | **Derived function** — single `structureEffect(id, level)` switch over the 7 `StructureId`s; no data-field effect storage on `Structure` (audit §6 #3) |
| 5 | Ore Mine / Shipyard per-min → per-sec | **Per-min source kept** — `ORE_ALLOYS_PER_MIN`/`SHIPYARD_INCOME_PER_MIN` match DESIGN wording; converted to `/sec` inside the effect function (audit §6 #4) |
| 6 | Category enum vs `erasableSyntaxOnly` | **`const`-object** — `StructureCategory` is `as const` + derived type, not a TS `enum`, keeping the module erasable under TypeScript's `erasableSyntaxOnly` |
| 7 | Runtime id guard | **Set-backed `isStructureId`** — `assertKnownStructure` throws `RangeError` for unknown ids at runtime, covering untyped input beyond the compile-time union |
| 8 | Pricing wrapper | **`nextBuildCost(id, level)`** — thin wrapper over `economy.structureCost(struct.baseCost, level)` so callers price by `StructureId` without threading `baseCost` manually; no duplicated math |

---

## 6. The Blocker Saga

- **Shipyard income — resolved by Jay (2026-08-08).** DESIGN §4d originally said only "small shipbuilding income" (unquantified) for the Shipyard — unusable as a locked number. The -A audit surfaced it as a blocker; Jay resolved it to **+50 credits/min shipbuilding income per level**, DESIGN.md §4d updated in the -A commit (2fa0733). Implemented as `shipbuildingIncomePerSec = (50/60) × L`. The Shipyard row is now fully locked (§2).
- **Decision-list renumbering.** With the Shipyard blocker removed, the audit §6 blocker/decision table was renumbered to 1–5 and all section references aligned to DESIGN's letter-labelled subsections (§4c roster, §4d numbers, §5a conquest math). The 5 remaining decisions map to §5 #1–#5 above.

---

## 7. Branch / Remote State

- Branch: `staging` (no work on `main`).
- No push, no tag, no deploy — remote unchanged pending authorisation.

---

*Prepared by OpenCode (deepseek-v4-flash) for P1-T02-D. Only `docs/P1_T02_EVIDENCE.md` + ROADMAP.md changed in this subtask.*
