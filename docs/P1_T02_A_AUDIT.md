# P1-T02-A — Structures Audit Map (data model + roster scope)

*Subtask `-A` for **P1-T02 Core sim engine / P1-T03 Structures v1** (Phase 1 — Core Idle Engine + Web Preview). Documentation-only audit: bounds the structure data model, locks the 7 structure definitions to DESIGN §4c/§4d, and confirms reuse of the existing sim core. Nothing implemented, nothing committed. Per WORKFLOW.md no HEAD SHAs are embedded in docs.*

---

## 1. Structure Data Model

Proposed TS interface for `src/sim/structures/` (data-only — no logic on the record):

```ts
export enum StructureCategory {
  Economy = 'Economy',
  Population = 'Population',
  Military = 'Military',
  Defense = 'Defense',
}

export type StructureId =
  | 'oreMine'
  | 'tradeHub'
  | 'housing'
  | 'hydroponics'
  | 'barracks'
  | 'shipyard'
  | 'defenseTurret';

export interface Structure {
  id: StructureId            // 7-literal union — discriminant; arbitrary ids rejected at compile time
  name: string               // display name, e.g. 'Ore Mine'
  category: StructureCategory
  baseCost: number           // credits — cost of the FIRST build (level 0 → 1), §3
  alloyCost?: number         // credits-only structures omit; only Defense Turret sets it
  buildTimeSec: number       // seconds for the first build (flat across levels per §6-1)
  maxLevel?: number          // undefined = uncapped (v1 default; DESIGN sets no per-structure cap)
}
```

**Per-level effect** is **not** stored as data fields — it is a **derived function** `structureEffect(id: StructureId, level): StructureEffect` returning a **discriminated effect-result type** (each variant below), because the 7 structures do not share one effect shape (produce/sec, multiplier, convert, additive boost). Effect formula per structure is locked in §4 and maps to existing `src/sim/core` functions (see §3) rather than duplicating math.

```ts
export type StructureEffect =
  | { kind: 'alloys'; alloysPerSec: number }                                  // oreMine
  | { kind: 'incomeMultiplier'; multiplier: number }                          // tradeHub
  | { kind: 'population'; popCapBonus: number; popGrowthBonusPerSec: number } // housing
  | { kind: 'growthMultiplier'; multiplier: number }                          // hydroponics
  | { kind: 'barracks'; soldierConversionPerSec: number; garrisonCap: number }
  | { kind: 'shipyard'; fleetCap: number; shipbuildingIncomePerSec: number }   // income = (50/60) × L cr/sec (§4)
  | { kind: 'defense'; defensePower: number };                                // defenseTurret

// One switch over the 7 StructureIds returns the matching variant; id/effect
// consistency is enforced because a non-StructureId is a compile error.
```

Mapping to the 7 structures (all values from DESIGN §4d):

| Structure | id (proposed) | category | baseCost (cr) | alloyCost | buildTimeSec |
|---|---|---|---|---|---|
| Ore Mine | `oreMine` | Economy | 500 | – | 30 |
| Trade Hub | `tradeHub` | Economy | 2,000 | – | 120 |
| Housing | `housing` | Population | 300 | – | 20 |
| Hydroponics | `hydroponics` | Population | 800 | – | 45 |
| Barracks | `barracks` | Military | 1,500 | – | 60 |
| Shipyard | `shipyard` | Military | 5,000 | – | 300 |
| Defense Turret | `defenseTurret` | Defense | 2,000 | 1,000 | 180 |

---

## 2. The 7 Structures — Exact Numbers (from DESIGN §4d, verified against source)

All costs are the **first-build price** (level 0 → 1); every subsequent level follows the ×1.15 curve (§3). Build time is the level-1 figure from §4d.

| Structure | Base cost | Alloy cost | Build time | Effect per level |
|---|---|---|---|---|
| Ore Mine | 500 cr | – | 30s | +5 alloys/min |
| Trade Hub | 2,000 cr | – | 2min | +10% baseline passive income |
| Housing | 300 cr | – | 20s | +1,000 pop cap, +2 pop/sec growth |
| Hydroponics | 800 cr | – | 45s | +50% population growth rate |
| Barracks | 1,500 cr | – | 1min | Converts 10 civilians/sec → soldiers (while running) |
| Shipyard | 5,000 cr | – | 5min | +1,000 fleet cap +50 credits/min shipbuilding income |
| Defense Turret | 2,000 cr | 1,000 alloys | 3min | +500 DP |

**Supporting formulas DESIGN §4d provides** (anchors for effect math — all are "per level" from the table or direct):
- Population cap = `5,000 × (1 + 0.2 × Housing levels)` → **+1,000/level** (5,000 × 0.2) ✓ matches table
- Garrison (soldier) cap = `5,000 × Barracks levels`
- Fleet cap = `1,000 × Shipyard levels`
- Defense power = `500 × Turret levels + 0.15 × current population`
- Baseline passive income = `10 × tier` credits/sec, always running; **only** Trade Hub multiplies it
- Base population growth = 2/sec, **+2/sec per Housing level**, then multiplied by Hydroponics bonus

---

## 3. Cost Curve — Reuse Existing `economy.structureCost`, No New Math

`src/sim/core/economy.ts` already implements the DESIGN §4d curve exactly:

```ts
COST_GROWTH_PER_LEVEL = 1.15
structureCost(baseCost, level) = baseCost * 1.15^level   // validates baseCost > 0, integer level ≥ 0
```

**Implementation requirement (not yet built).** `src/sim/structures/` is empty as of P1-T01 (`docs/P1_T01_EVIDENCE.md:27`); this is what P1-T03 `-B` must deliver, not confirmed reuse. When the structure module is implemented it **will** call `structureCost(struct.baseCost, level)` (and `baselinePassiveIncome(tier)` for Trade Hub math) rather than reimplement the formula. Interpreted as: *next level's price = base × 1.15^(currentLevel)*, so the first build (level 0 → 1) costs the table's `baseCost` exactly. Flagged for Jay as decision **5** (§6) to avoid a 0-vs-1-indexed ambiguity.

**Existing `src/sim/core` reuse map for effects:**

| Structure effect | Core function/constant to reuse | New math needed? |
|---|---|---|
| Trade Hub multiplier | `economy.baselinePassiveIncome(tier)` | No — multiplier formula is `1 + 0.10 × level` (§4) |
| Housing cap + growth | `population.populationCap()`, `population.populationGrowthPerSec()` | No — both already take `housingLevels` |
| Hydroponics boost | `population.HYDROPONICS_GROWTH_BONUS` (=0.5) | No — already folded into `populationGrowthPerSec` |
| All others | – | Per-level formulas only (§4) |

---

## 4. Category Enum + Per-Level Effect Formulas

**Enum (4 values):** `Economy | Population | Military | Defense`

| Structure | Category | Per-level effect formula (level `L` ≥ 1) |
|---|---|---|
| Ore Mine | Economy | `alloysPerSec = (5/60) × L` = `L/12` alloys/sec |
| Trade Hub | Economy | `incomeMultiplier = 1 + 0.10 × L` (applies to baseline `10 × tier` only) |
| Housing | Population | `popCapBonus = 1,000 × L`; `popGrowthBonus = 2 × L` per sec |
| Hydroponics | Population | `growthMultiplier = 1 + 0.50 × L` |
| Barracks | Military | `soldierConversionPerSec = 10 × L` (while running); `garrisonCap = 5,000 × L` |
| Shipyard | Military | `fleetCap = 1,000 × L`; `shipbuildingIncomePerSec = (50/60) × L` = `0.8333… × L` credits/sec |
| Defense Turret | Defense | `defensePower = 500 × L` (militia term `+0.15 × population` is P3-T03, excluded §5) |

**Composition with existing core** (verified consistent): Housing cap formula `5,000 × (1 + 0.2 × L)` equals the table's `+1,000/L`; growth `(2 + 2×L) × (1 + 0.5×hydroponics)` equals base+table; Hydroponics' `+50%/L` is the `0.5` already in `population.ts`. No contradictions between DESIGN §4d and the P1-T01 sim core.

**Defense Turret DP note:** `structureEffect('defenseTurret', L)` returns `defensePower = 500 × L`. The DESIGN §4d/§5a militia component (`+ 0.15 × population`) and §5a casualty outcomes are **P3-T03** scope — out of P1 (see §5).

---

## 5. Exclusions (bounded for P1)

| Excluded | Why |
|---|---|
| **UI / build menu / planet view** | P1-T05 — structure data is pure TS; no DOM, no rendering (P1-T01-A §2 engine rule) |
| **Build-queue system** | No queues, no multi-build, no build-progress timers in P1. `buildTimeSec` is data only; queuing is a later phase |
| **Resource wallet / spend check** | P1-T05/06 — the wallet/bank comes with UI (T05) and save/load (T06), so it is **excluded from P1-T03**. Consequently "cannot build without resources" is **not** a P1-T03-C negative-path test: cost functions alone establish the *price*, not affordability — that requires wallet state, which does not exist yet. Marked as a **wallet-dependent test to add with the wallet in T05/06**, not in T03 |
| **PvP stats beyond Defense Turret DP** | AP/DP ratios, militia 15%, garrison/deploy, casualties, war-weariness, fortification ceiling — all P3 (conquest math). Only Turret's `500 × L` DP is in scope |
| **Barracks "while running" toggle** | Conversion is active/queued-state dependent — no runtime state machine in P1. Formula `10 × L` + garrison cap only |
| **Shield Generator / research / special structures** | DESIGN §4c explicitly RESERVED FOR LATER — not v1 |
| **Multi-planet grids** | P2-T04 — P1 is a single placeholder planet |

---

## 6. Blockers / Decisions for Jay

> **The Shipyard-income blocker was REMOVED** — resolved by Jay 2026-08-08 (+50 credits/min per level, DESIGN §4d). Remaining blockers are numbered 1-5.

| # | Decision | Options | My recommendation |
|---|---|---|---|
| **1** | **Build time at higher levels** | DESIGN shows level-1 build time only. (1) flat across all levels; (2) scale with level (e.g. ×1.15 like cost) | **Flat** for v1 — simplest, matches the data shape (`buildTimeSec` is a constant), and build-queue scaling is out of P1 anyway |
| **2** | **`maxLevel`** | (1) undefined/uncapped for all 7; (2) per-structure caps | **Uncapped** — DESIGN defines caps only derivatively (pop cap, fleet cap, garrison cap grow with structure levels; no structure-level cap anywhere in §4) |
| **3** | **Effect representation** | (1) single derived `structureEffect(id: StructureId, level): StructureEffect` with a discriminated effect-result type; (2) data-driven fields on `Structure` (e.g. `alloysPerMin`, `incomeMultiplier`) | **(1) Derived function** — one switch over the 7 `StructureId`s, single source of truth, trivial to unit-test each formula against §2's table. Data-fields invite drift between the record and the formulas |
| **4** | **Ore Mine alloys/min → /sec** | §4d gives "5 alloys/min". (1) store per-min and divide at calc time; (2) precompute per-sec `5/60` | **(1) Keep the source number per-min** (matches DESIGN wording), convert to `/sec` in the effect function — the doc and the sim stay directly comparable |
| **5** | **Level indexing on the cost curve** | DESIGN §4d labels the column "Base cost" with formula `base × 1.15^level`, but "build time shown for level 1" hints at 1-indexing. (1) `level` = current level, next build = `base × 1.15^level` → first build costs exactly the table number (matches existing `economy.structureCost` as-is); (2) 1-indexed — first build costs `1.15 × base` and the table numbers are a level-1 discount | **(1) 0-indexed, reuse `structureCost` unchanged** — table numbers are the first-build price, zero new math. Confirm so the wallet (T05) prices match the docs |

---

*Prepared by OpenCode (deepseek-v4-flash) for P1-T02-A. Only `docs/P1_T02_A_AUDIT.md` created/modified. No commit made — awaiting Jay's decisions + Hermes launch of P1-T02-B.*
