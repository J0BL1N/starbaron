# P2-T02-A — Planet Model + Procedural Generator Audit

*Subtask `-A` for **P2-T02 Planet model** (Phase 2 — Real Universe + Planets). Documentation-only audit. Nothing implemented, nothing committed, no work on `main`. Scope grounded in DESIGN.md §4b (the Real Universe: catalogue + the NEW procedural-generator note, Jay decision 2026-08-08), §4d (planet tiers T1–T5, baseline income `10 × tier`, structure costs/effects), ROADMAP.md P2-T02 rows, the committed catalogue `src/sim/data/planets.ts` (6,321 rows, `PlanetCatalogueEntry` shape), and the existing P1 sim core (`src/sim/core/*`, `src/sim/structures/*`) at HEAD on `staging`.*

---

## 1. Planet Entity Model — what the sim carries now vs P3

### Current state (P1 — no real planet exists yet)

P1's `GameState` (`src/ui/useGameState.ts:29`) models **one abstract home planet as a scalar `tier: number`**, defaulted to `STARTING_TIER = 1` (`useGameState.ts:21,82`), plus wallet/levels/population. The 6,321-row catalogue (`src/sim/data/planets.ts`) is committed and tested (P2-T01) but is **not yet referenced by the sim loop**. P2-T02 introduces the first real planet entity over that catalogue.

### Proposed sim-level planet entity (P2-T02 carries this now)

The planet entity is **pure, serialisable sim data with no player identity**. Ownership/claim concepts are P3 (backend). Proposed shape:

```ts
// src/sim/planets/types.ts (proposed — -B decides exact layout)
interface PlanetState {
  entry: PlanetCatalogueEntry   // embedded copy of the catalogue row (immutable snapshot)
  tier: PlanetTier              // mirrors entry.tier (kept flat for stats ergonomics)
  // derived gameplay stats — computed from entry, locked to DESIGN §4d (§2 below)
  baselineIncomePerSec: number  // 10 × tier
  // structure slots: UNLIMITED (Jay 2026-08-08) — no slot count to store;
  //   effective level = min(level,10) + max(0,level−10)×0.5 (§2, DESIGN §4d)
  // procedural profile — derived on demand from entry (§3, §4)
  //   generation: () => PlanetGeneration  — recommended as a function, NOT stored
}
```

- **Catalogue reference:** embed a copy of the `PlanetCatalogueEntry` (immutable snapshot data; ~8 fields, trivially small) rather than a `name` string indirection — the entity stays self-contained and serialisable for future save/load, and the generator needs the real stats (`radiusEarth`, `massJup`, `starType`, `distancePc`, `systemCount`) anyway. `PLANETS` remains the canonical array (claim pool indexes into it, P2-T03).
- **Derived stats** live on the entity as computed numbers, not functions — the entity is data the UI/renderer can read, and derived values stay frozen at their DESIGN-defined formulas (§2).

### P3 additions (deferred — backend)

`ownerId?`, `isHome`, `claimedAt?`, per-planet structure-grid instances, per-planet population/garrison/fleet instances, and the claim-pool index are **persistence-layer concepts** (Supabase schema P3-T01, claim flow P2-T03) — declared here so the P2 entity shape does not paint itself into a corner, but **not implemented** now. P2 keeps the sim entity owner-free; the ownership fields are additive on top in P3.

**Decisions D1–D4:**
- **D1** — Entity carries `entry` (catalogue ref + real stats) + derived gameplay stats + on-demand generator output. No ownership/claim fields in P2.
- **D2** — `entry` embedded by copy, not name-reference (self-contained, serialisable, generator-friendly).
- **D3** — Derived stats are stored computed numbers (locked formulas); generator output is a **function call**, not stored (§4).
- **D4** — The generator must succeed for **every** catalogue entry. Optional fields get deterministic fallbacks: missing `starType` → `'unknown'` spectral class + default palette; missing `radiusEarth`/`massJup` → tier-derived seeded default (documented band); missing `distancePc` → distance clause omitted (§3a/§3c). Quirks needing a missing field are skipped, never fabricated.

---

## 2. Derived Stats — locked to DESIGN §4d only

### Defined in DESIGN (usable as-is)

| Stat | DESIGN §4d source | Formula | Status |
|---|---|---|---|
| **Baseline passive income** | line 89: "`10 × tier` credits/sec, always running. Trade Hub multiplies it" | `10 × tier` credits/sec | **Defined** — already implemented as `baselinePassiveIncome(tier)` in `src/sim/core/economy.ts` (constants `MIN_TIER=1`, `MAX_TIER=5`, `BASE_INCOME_PER_TIER=10`) |
| **Population cap** | lines 103 + 89: "Cap = `5,000 × (1 + 0.2 × Housing levels)`" **× tier multiplier (Jay 2026-08-08): T1 ×1.0, T2 ×1.2, T3 ×1.4, T4 ×1.7, T5 ×2.0** | `5,000 × (1 + 0.2 × housingLevels) × tierMult(tier)` | **Defined** — base `populationCap()` in `src/sim/core/population.ts` (tier-independent); the tier multiplier is a locked P2-T02-B addition layered on the base |
| **Pop growth (base)** | line 103: "Base growth 2/sec, boosted by Hydroponics" | `(2 + 2 × housingLevels) × (1 + 0.5 × hydroponicsLevels)` | **Defined** — `populationGrowthPerSec()` in `src/sim/core/population.ts` |
| **Structure costs** | line 91: "cost = `base × 1.15^level`" | `base × 1.15^level` | **Defined** — `structureCost()` in `src/sim/core/economy.ts` |
| **Garrison / fleet / DP** | lines 105–109 | §4d tables | **Defined** — `src/sim/structures/effects.ts` |

### Locked by Jay (2026-08-08) — resolved, not blockers

| Stat | DESIGN §4d locked rule |
|---|---|
| **Structure slots** | line 88: **UNLIMITED** — no hard slot cap. Diminishing returns per structure type: fully effective to level 10; each level beyond 10 counts as half — effective level = `min(level,10) + max(0,level−10)×0.5` |
| **Tier → pop-cap multiplier** | line 89: T1 ×1.0, T2 ×1.2, T3 ×1.4, T4 ×1.7, T5 ×2.0, applied on top of the `5,000 × (1 + 0.2 × housing)` base |

### Undefined in DESIGN (flagged — Jay decision)

| Stat | DESIGN says | What is missing |
|---|---|---|
| **Quirk effects on structure efficiency** | §4b line 64: "planet stats … can subtly affect structure efficiency"; line 65 gives one example (high gravity → +20% alloy output) | The quirk table + numeric effects are a new decision (§3b). **Blocker B3** |

Per DESIGN §4d's own rule ("tune from real data, never guesses"), the only numbers the audit proposes as bounded defaults (§7) are the quirk effects (B3) — the structure-slot rule and the tier pop-cap multipliers are **locked** (§2, DESIGN §4d lines 88–89) and bake into the sim as-is. Nothing else from §4d is referenced by the planet entity — income/income-multiplier, pop growth, garrison, fleet, DP, and cost math stay exactly as P1 defined them.

---

## 3. Procedural Generator — DESIGN §4b note (Jay decision 2026-08-08)

### Design principles

- **Deterministic:** the same `pl_name` always produces the identical profile — same visual, same quirks, same description. Requirement, test-enforced (§6).
- **Pure TS:** no state, no `Math.random`, no `Date`, no I/O — lives under `src/sim/planets/` and passes the existing sim-purity test (`tests/sim-purity.test.ts`).
- **Zero storage:** output is derived on demand from the catalogue entry (§4).
- **Seeded content, not per-planet content:** the module ships content *libraries* (adjective pools, quirk templates, description archetypes, palette definitions). Kimi Code CLI authorship of those libraries is the DESIGN §4b note — **parked**; the generator API is designed so the libraries can be swapped for Kimi-authored pools later without changing the interface (content change, not code change).

### Proposed files (P2-T02-B creates these)

```
src/sim/planets/
├── hash.ts          # FNV-1a 32-bit (or djb2) string hash — zero-dep, stable across runs/runtimes
├── prng.ts          # mulberry32 seeded PRNG (deterministic integer→float stream)
├── visual.ts        # palette/rings/moons/atmosphere derivation from star type + radius + seed
├── quirks.ts        # quirk candidate evaluation + seeded selection
├── description.ts   # template-built 2–3 sentence prose from real stats + seeded adjectives
├── types.ts         # PlanetGeneration / PlanetVisualProfile / PlanetQuirk / Description types
└── generator.ts     # generatePlanetProfile(entry): PlanetGeneration — the single public entry point
```

### Seed scheme

- `GENERATOR_VERSION` constant (e.g. `"starbaron-v1"`) **salted into the seed**: `seed = fnv1a(GENERATOR_VERSION + "|" + entry.name)`. Same input → same seed → same output (determinism). The version salt makes future re-rolls **explicit and deliberate** (bump the version, golden tests update) rather than accidental output drift from a code change.
- Seed derives: quirk selection, moons presence/count, ring presence, seeded adjectives, palette micro-variation.

### (a) Visual profile

```ts
interface PlanetVisualProfile {
  surfacePalette: string[]   // 2–3 hex colours
  atmosphereTint: string | null
  ringed: boolean
  moons: number              // 0–n, seeded, biased by tier
  emoji: string              // P1 art rule = emoji/simple shapes first (DESIGN §2)
}
```

- **Surface palette from star type + radius:** star spectral letter (`O/B/A/F/G/K/M`) maps to a base hue bucket; radius band (rocky `<1.6` → earthlike `1.6–2.5` → gaseous `≥4.0`, per the P2-T01 tier bands) maps to texture archetype (rocky browns/greys, water-world blue/green, gas-giant banded pastels). Seeded jitter picks the final palette.
- **Rings/moons:** seeded booleans/counts, with a **tier bias** (giants more likely ringed) so visuals feel physically plausible — but the trigger is always the seeded hash, not wall-clock randomness.
- **Atmosphere tint:** seeded from star type (hot-star irradiance → hazy tint) or `null` (no detectable atmosphere).
- **Optional-field fallbacks (every catalogue planet must generate — no undefined state):** `starType`, `radiusEarth`, `massJup`, and `distancePc` are **optional** in `PlanetCatalogueEntry` (`src/sim/data/planets.ts:11-14`), so every field the visual/description paths read gets a deterministic fallback:
  - **Missing `starType`** → treat as **`'unknown'` spectral class**: no star-letter hue bucket; use a default neutral palette (seeded jitter still applies). Description then reads "orbiting a star of unknown spectral class".
  - **Missing `radiusEarth` and/or `massJup`** → **derive from tier** using a documented default radius band and mass band (or a seeded value from the name hash within that band — stable per planet). Quirks whose trigger needs the missing field (e.g. High Gravity's density proxy) are **skipped**, not given fabricated values.
  - **Missing `distancePc`** → **omit the distance clause** from the description; distance-dependent prose is dropped.
  These fallbacks are locked as decision **D4** (§1).

### (b) Flavour quirks — structure-efficiency hooks (proposal, 7 quirks)

Each quirk has a **deterministic trigger** (real stats + seed) and a **numeric effect** expressed as a multiplier on an existing P1 structure-effect kind (`src/sim/structures/types.ts`), so the sim applies quirks by multiplying the matching `structureEffect` output — no new sim mechanics. A planet gets **0–2 quirks** (seeded selection from the triggered candidates) so most planets have one, some have two, few have none.

| # | Quirk | Deterministic trigger | Numeric effect | Hook (effect kind) |
|---|---|---|---|---|
| 1 | **High Gravity** | dense — density proxy `massJup / radiusEarth³ ≥ 0.005` (units: Jupiter-mass per Earth-radius-cubed; Earth's own mean density in these units ≈ 0.0031 = 1/317.83, so the threshold is ≈ **1.6× Earth's mean density** — fires on dense rocky/iron super-Earths, never on gas giants ≈ 0.0007; verified against the committed catalogue: 153/1,545 planets with both fields qualify). Quirk skipped when either field is missing (§3a fallback). **Threshold tunable — B3 proposal, not canonical** | **Ore Mine +20% alloy output** (DESIGN-specified example) | `alloys` |
| 2 | **Cold Star** | host `starType` M-class | **−10% population growth** (proposed — magnitude for Jay, blocker B3) | `growthMultiplier` |
| 3 | **Mineral-Rich Crust** | seeded on rocky tiers (1–3) | Ore Mine +10% alloy output | `alloys` |
| 4 | **Thick Atmosphere** | high radius + low mass (diffuse) | Trade Hub income multiplier +5% | `incomeMultiplier` |
| 5 | **Sparse Biosphere** | seeded on earthlike band (tiers 2–3) | Housing pop-cap bonus +10% | `population` |
| 6 | **Gravity Well** | seeded on massive tiers (4–5) | Defense Turret +10% DP (harder to siege) | `defense` |
| 7 | **Ringed World** | seeded (giant-tier biased) | **visual only** — no sim effect (pure flavour) | — |

Rules: quirks are **additive across structure levels** (a ×1.2 alloy multiplier applies at every Ore Mine level), **never stack** (at most one quirk per effect kind per planet — prevents multiplicative runaway), and effects stay small (±5–20%) so no planet is a strict must-pick. These numbers are a **proposal** — Jay locks them (blocker B3). Only the high-gravity example (→ +20% alloy) is DESIGN-specified and canonical; **Cold Star and its −10% magnitude are a proposal** for Jay under B3, as are all the remaining quirk effects.

### (c) Template-built description

2–3 sentences, assembled from real stats + seeded adjectives (prose = deterministic templates, not LLM):

1. **Identity:** name + category + host + distance — distance clause is **omitted when `distancePc` is missing** (D4); e.g. *"Gliese 667 Cc is a tier-3 super-Earth orbiting an M-class star 6.3 pc from Sol."*
2. **Physical flavour:** seeded adjectives over real stats (radius/mass/star) — e.g. *"A dense, iron-cored world whose thin, pale atmosphere scatters a dim orange light."*
3. **Gameplay hook:** quirk(s) spelled out — e.g. *"Its crushing gravity makes ore extraction 20% more efficient."*

Adjective pools are seeded content libraries (Kimi-parkable per §3 principles).

---

## 4. Where Generator Output Lives

**Recommendation: derived on demand (function call), NOT precomputed into `planets.ts`.**

- **Zero storage:** no generated blobs — the 6,321-row catalogue stays the only data module. Precomputing would add ~6,321 × ~300–400 bytes ≈ **2–2.5 MB** to the bundle for zero runtime benefit (hash + small PRNG is microseconds per planet).
- **Instant + consistent:** same input → same output *by construction*; no staleness/version skew between stored blobs and current generator code (the classic failure mode of precomputed derived data).
- **`planets.ts` stays as-is:** the generated catalogue module and its P2-T01 drift gate / min-row guard / `PLANET_SNAPSHOT` are untouched — confirmed. The sim-purity test's coverage of `planets.ts` is unaffected.
- The generator never reads `planets.ts`; it consumes a `PlanetCatalogueEntry` passed in. `generatePlanetProfile(planetState.entry)` is the only call site pattern.

**Confirmed:** `src/sim/data/planets.ts` is not modified by this task; all generator state is code constants (libraries + `GENERATOR_VERSION`).

---

## 5. Exclusions (bounded for P2-T02)

| Excluded | Why |
|---|---|
| **Claim pool (unclaimed index, assignment, colonise)** | P2-T03 — this task models one planet; the pool is a separate module over `PLANETS` |
| **Multi-planet economies / per-planet grids** | P2-T04 — `sy_pnum` deliberately dropped at import (§2 of the T01 audit); per-planet grid isolation is a later task |
| **Owner/claim fields (`ownerId?`, `isHome`, `claimedAt?`)** | P3 / P2-T03 — no backend in P1/P2 (§1 D1) |
| **UI** | Phase 2 UI (galaxy map, planet picker, PlanetDisplay art switch) is not in P2-T02 scope |
| **Backend / Supabase schema** | Phase 3 (P3-T01) |
| **PvP / conquest / garrison deployment** | Phase 3 — nothing combat-related in the planet model |
| **Kimi Code CLI content authorship** | DESIGN §4b "FOR LATER" — the generator API is Kimi-parkable; hand-authored placeholder libraries ship in -B. **Kimi K3 3D planet visuals** — parked, revisit at art/asset stage |
| **Structure-slot gameplay (building on slots)** | Slots are **UNLIMITED** (DESIGN §4d line 88, Jay 2026-08-08) — no slot *count* to store; per-structure diminishing returns (`effective level = min(level,10) + max(0,level−10)×0.5`) apply in the effect math. Slot *enforcement* (grid build caps) is P2-T04 grid work |

---

## 6. Testing Approach (P2-T02-C / -B scope)

| Test | What it proves |
|---|---|
| **Determinism (same seed → same output)** | Same `entry` → byte-equal `PlanetGeneration` across repeated calls and across a fresh module instance (re-require); plus a **golden test** — a known planet name (e.g. `Gliese 667 Cc`) asserts the exact expected generation object, so any unintended re-roll fails loudly (deliberate changes bump `GENERATOR_VERSION`) |
| **Uniqueness spread** | Sample ~500 distinct catalogue planets → assert distinct seeds, ≥N distinct palettes, moons counts vary, ringed/atmosphere booleans vary (no degenerate uniform output); assert within-sample seed uniqueness (collision-tolerance: spread, not absence) |
| **Quirk numbers match the locked table** | high-gravity = **+20% alloy** is DESIGN-specified and exact; cold-star **−10% growth** is the B3-proposed value, so the test asserts it against the *proposed* constant, not as DESIGN-exact; every quirk's effect multiplies the matching `structureEffect` kind; no two quirks on one planet share an effect kind |
| **Tier bounds** | Generator never mutates the entry; `baselineIncomePerSec` = `10 × tier` for all 5 tiers (already locked in `economy.test.ts`); pop-cap tier multiplier matches the locked T1–T5 table `1.0/1.2/1.4/1.7/2.0` (DESIGN §4d line 89); diminishing-returns structure levels land on `min(level,10) + max(0,level−10)×0.5` (line 88); quirks only assigned to legal tier bands (e.g. `Ringed World` only on tiers 4–5) |
| **Purity** | New modules under `src/sim/planets/` pass the existing sim-purity scan (no React/DOM imports) |
| **Regression** | Full suite + `tsc -b` + `npm run build` + `npm run lint` + `node scripts/import-planets.mjs --check` all exit 0 (drift gate confirms `planets.ts` untouched) |

---

## 7. Blockers / Decisions for Jay

**Resolved by Jay (2026-08-08, DESIGN §4d) — no longer blockers:**
- **Structure slots** (line 88): **UNLIMITED**, diminishing returns per structure type — effective level = `min(level,10) + max(0,level−10)×0.5`.
- **Tier → pop-cap multiplier** (line 89): T1 ×1.0, T2 ×1.2, T3 ×1.4, T4 ×1.7, T5 ×2.0 on the `5,000 × (1 + 0.2 × housing)` base.
- **Renaming** (line 90): parked by Jay as a later note ("players can rename their planets") — not a P2-T02 decision.

Open decisions:

| # | Decision | Options | My recommendation |
|---|---|---|---|
| **B3** | **Quirk table + numbers** — §3b proposal is new content, not in DESIGN | (1) adopt the 7-quirk table as proposed; (2) trim to 5 quirks (drop Sparse Biosphere + Gravity Well); (3) different numbers | **(1) adopt as proposed** — 7 quirks, small ±5–20% effects, 0–2 per planet, at most one per effect kind; only high-gravity +20% alloy is DESIGN-fixed; **Cold Star's −10% growth and every other number are proposed defaults Jay may change** |
| **B4** | **Generator scope** | (1) full package (visual + quirks + description) in P2-T02-B; (2) quirks only now, visual/description parked | **(1) full package** — it's one pure module + tests; splitting delays the "every planet feels like a place" hook (§4b flavour) |
| **B5** | **Seed algorithm + version salt** | (1) FNV-1a + `GENERATOR_VERSION` salt; (2) a stronger hash (xxhash, adds a dep) | **(1) FNV-1a + version salt** — zero-dep, deterministic, stable; collision spread verified by the uniqueness test (§6) |

**Blockers:** B3–B5 are all **decisions**, not engineering blockers — none block the P2-T02-B skeleton (entity + locked §4d derived stats + `generatePlanetProfile` harness). P2-T02-B can proceed with the recommended defaults if Jay pre-approves; only the quirk numbers (B3) need Jay's explicit sign-off before gameplay-facing values are baked in (the structure-slot rule and tier pop-cap multipliers are already locked in DESIGN §4d). No live service, no backend, no UI dependency — the whole task runs in pure TS + tests.

---

*Prepared by OpenCode (deepseek-v4-flash) for P2-T02-A. Only `docs/P2_T02_A_AUDIT.md` created. No commit made, no work on `main`.*
