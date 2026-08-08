# P2-T02 — Planet Model + Procedural Generator: Evidence

*Closeout evidence for **P2-T02 Planet model** (Phase 2 — Real Universe + Planets). Consolidates the subtask record for `-A`/`-B`/`-C`/`-D`. Per WORKFLOW.md, no HEAD SHAs are embedded in prose — SHAs appear only where the record already references them (commit subjects). The whole task is Codex-PASSED.*

---

## 1. Subtask Record

| Subtask | Scope | Status | Evidence |
|---|---|---|---|
| **-A** | Audit: tier system (T1–T5), stats mapping, structure slots | Complete | `docs/P2_T02_A_AUDIT.md` + DESIGN.md lock-ins (committed "docs: P2-T02-A planet model + procedural generator audit; DESIGN lock-ins (unlimited slots, tier pop-cap, renaming note)") |
| **-B** | Implement: planet entity — tier, stats, baseline income; procedural generator (visual + quirks + description) | Complete | `src/sim/planets/*` (committed "feat: P2-T02-B planet model + procedural generator (7 quirks, effectiveLevel, immutable entries, 317 tests)") |
| **-B (showcase)** | Planet generator showcase page (12 real planets, universe stats) | Complete | `tests/showcase-generate.test.ts` → `docs/showcase.html` (committed "docs: planet generator showcase page (12 real planets, universe stats)") |
| **-C** | Negative paths: tier bounds, seed uniqueness, trigger boundaries, D4 fallbacks, immutability | Complete | `tests/planets-model.test.ts`, `tests/planet-identity.test.ts`, `tests/planets-deep.test.ts` (committed "test: P2-T02-C planet/generator deep coverage (seed uniqueness, boundaries, fallbacks, +338 tests)") |
| **-D** | Evidence + Codex PASS | Complete | This doc; committed to `staging` |

---

## 2. Planet Entity — `PlanetState` (`src/sim/planets/`)

The first real sim-level planet entity over the 6,321-row catalogue (`src/sim/data/planets.ts`, P2-T01). It is **pure, serialisable sim data with no player identity** — ownership/claim are P3/P2-T03 concepts and are additive on top.

```ts
interface PlanetState {
  entry: PlanetCatalogueEntry   // deep immutable snapshot of the catalogue row (structuredClone, not spread)
  tier: PlanetTier              // mirrors entry.tier, kept flat for stats ergonomics
  baselineIncomePerSec: number  // 10 × tier (DESIGN §4d, from src/sim/core/economy)
  populationCapMultiplier: number // locked tier table (DESIGN §4d)
  generate: () => PlanetIdentity // derived on demand — generator output is a function call, NOT stored
}
```

- **Entry embedded by copy** (decision D2, audit §1): `makePlanet()` uses `structuredClone` (deep copy, not a spread) so `PlanetState` owns a **private snapshot**. Mutating `planet.entry` can never corrupt the shared 6,321-planet catalogue — test-enforced (§7, finding F1).
- **Derived stats stored as computed numbers** (decision D3); **generator output derived on demand** — zero storage, no 2–2.5 MB of precomputed blobs, no staleness/version skew. `generatePlanetIdentity(planetState.entry)` is the only call-site pattern.
- **`src/sim/data/planets.ts` untouched** by this task — confirmed (drift gate `--check` OK, §5).

---

## 3. Derived Stats — locked to DESIGN §4d

| Stat | DESIGN §4d rule | Implementation | Status |
|---|---|---|---|
| **Baseline passive income** | `10 × tier` credits/sec | `baselineIncomePerSec = baselinePassiveIncome(tier)` (`src/sim/core/economy.ts`, `BASE_INCOME_PER_TIER = 10`) | Tested for all 5 tiers |
| **Tier → pop-cap multiplier** | T1 ×1.0, T2 ×1.2, T3 ×1.4, T4 ×1.7, T5 ×2.0 on the `5,000 × (1 + 0.2 × housing)` base | `TIER_POP_CAP_MULTIPLIER` + `populationCapMultiplier(tier)` (`src/sim/planets/levels.ts`) | Locked, exact table asserted |
| **Structure effective level** | UNLIMITED slots; **diminishing returns**: fully effective to level 10, each level beyond 10 counts as half | `effectiveLevel(level) = min(level,10) + max(0,level−10)×0.5` (`src/sim/planets/levels.ts`) | Exact boundary table tested |
| **effectiveLevel wired into structureEffect** | — | `src/sim/structures/effects.ts:36` — every one of the 7 structures consumes `effectiveLevel(level)` for its per-level output | Level 10→11 halves the marginal effect; level 20 oreMine = `(5/60) × 15`; all 7 finite at level 100 |

`effectiveLevel` validates its input (`RangeError` for negative/fractional/non-finite levels — no silent flooring), and is **consumed by all 7 structure effects** rather than living in the planet module alone, so the sim cannot bypass diminishing returns (B1).

---

## 4. Procedural Generator — `generatePlanetIdentity(entry)`

### Seed scheme — FNV-1a + mulberry32 (decision B5)

- **`hash.ts`:** `fnv1a` — 32-bit FNV-1a (offset `0x811c9dc5`, prime `0x01000193`), zero-dep, stable across runs/runtimes.
- **`prng.ts`:** `mulberry32(seed)` — seeded integer→float PRNG; `seedFromPlanetName(version, name) = fnv1a("starbaron-v1|" + name)`.
- **`generator.ts`:** `GENERATOR_VERSION = "starbaron-v1"` is **salted into the seed**, so future re-rolls are explicit and deliberate (bump the version → golden tests update) rather than accidental output drift. Same `entry` → same seed → **byte-identical identity** (golden tests for Kepler-452 b and Gliese 12 b).

### Visual profile — from spectral class + radius (`visual.ts`)

- Star spectral letter (`O/B/A/F/G/K/M`) maps to a base **hue bucket** (`SPECTRAL_HUES`, 3 hexes each; `unknown` → neutral grey).
- Radius band (rocky `<1.6` / earthlike `1.6–2.5` / superearth `2.5–4.0` / gaseous `≥4.0`) maps to a **texture archetype** (3 hexes each).
- Seeded jitter picks the final palette; **rings/moons are seeded with a tier bias** (giants more likely ringed, more moons); atmosphere tint from hot-star irradiance (`O/B/A` haze, `F/G` faint 25%).
- `emoji` from band (`🪨 / 🌍 / 🌊 / 🪐`) — P1 art rule (simple shapes first).

### Quirk table — 7 quirks, deterministic triggers, numbers (decision B3)

Each quirk hooks exactly one existing `structureEffect` kind and is applied as a multiplier via `applyQuirk(quirk, effect)` — no new sim mechanics. **One quirk per planet max** (seeded pick from the triggered candidates); triggers fire only on real data, never fabricated (D4).

| Quirk | Trigger (deterministic) | Hook | Effect |
|---|---|---|---|
| **High Gravity** | density proxy `massJup/radiusEarth³ ≥ 0.005` (≈1.6× Earth's mean density) | `oreMine` | **×1.2** alloy output (+20% — DESIGN-specified) |
| **Cold Star** | host star K/M-class | `hydroponics` | **×0.9** growth multiplier (−10%) |
| **Hot Star** | host star O/B/A-class | `hydroponics` | **×1.1** growth multiplier (+10%) |
| **Dense Core** | density proxy `≥ 0.002` | `housing` | **×1.1** pop-cap bonus (+10%) |
| **Gas Giant** | tier 5 AND density `< 0.0007` | `shipyard` | **×1.1** fleet cap (+10%) |
| **Binary System** | `systemCount ≥ 2` | `tradeHub` | **×1.1** income multiplier (+10%) |
| **Massive World** | `massJup ≥ 3.0` | `defenseTurret` | **×1.1** defense power (+10%) |

Thresholds: `HIGH_GRAVITY_DENSITY_THRESHOLD = 0.005`, `DENSE_CORE_DENSITY_THRESHOLD = 0.002`, `GAS_GIANT_DENSITY_MAX = 0.0007`, `MASSIVE_WORLD_MASS_MIN = 3.0`. Only High Gravity's +20% is DESIGN-fixed; the other magnitudes are the B3-adopted proposals. Cold/Hot Star are mutually exclusive (`>=` vs `<` semantics boundary-tested, §7).

### D4 fallbacks — every one of the 6,321 catalogue entries must generate

| Missing field | Behaviour (never fabricated) |
|---|---|
| `starType` | `'unknown'` spectral class → neutral grey palette; description reads "orbiting a star of unknown spectral class" |
| `radiusEarth` and/or `massJup` | tier-derived seeded default radius band (`DEFAULT_RADIUS_BAND`); density/mass quirks **skipped**, not invented; no density adjective |
| `distancePc` | **distance clause omitted** from the description |

Covered per-field (incl. all-four-missing → complete identity on the zero-quirk path) in `planets-deep.test.ts`.

### Template-built description (`description.ts`)

2–3 sentences, deterministic templates (no LLM): identity (name + tier + category + star + distance clause) → physical flavour (seeded adjectives over real radius/mass/star) → gameplay hook (quirk blurb, or a seeded quiet line when no quirk). Adjective pools are seeded content libraries — the DESIGN §4b **Kimi-parkable** seam (content change, not code change).

---

## 5. Showcase Page

- **`tests/showcase-generate.test.ts`** runs as a vitest test (vitest resolves TS + extensionless imports natively) and writes **`docs/showcase.html`**.
- Renders **12 real planets** (2 per tier), palette swatches, rings/moons/atmosphere features, quirk blurb + structure ×multiplier, generated description, and live universe stats (6,321 planets, tier mix, missing-fields-handled, quirk counts, duplicates, determinism check on Kepler-452 b, snapshot sha).
- Regenerate: `npx vitest run tests/showcase-generate.test.ts`.

---

## 6. Files

```
src/sim/planets/
├── hash.ts          # FNV-1a 32-bit (offset 0x811c9dc5, prime 0x01000193)
├── prng.ts          # mulberry32 + seedFromPlanetName (FNV-1a of "starbaron-v1|name")
├── levels.ts        # effectiveLevel + TIER_POP_CAP_MULTIPLIER + populationCapMultiplier
├── types.ts         # PlanetState / PlanetIdentity / PlanetVisualProfile / PlanetQuirk / QuirkId
├── visual.ts        # spectral class, radius band, palette/rings/moons/atmosphere, tier default radius
├── quirks.ts        # QUIRK_TABLE (7), triggeredQuirks, pickQuirk, applyQuirk, density thresholds
├── description.ts   # template-built 2–3 sentence prose
├── generator.ts     # generatePlanetIdentity(entry) — public entry point, GENERATOR_VERSION
└── index.ts         # makePlanet(entry) immutable snapshot factory + public exports
tests/
├── planets-model.test.ts     # -B entity + derived stats + effectiveLevel→structureEffect wiring
├── planet-identity.test.ts   # -B determinism, golden tests, 7-quirk table, D4 fallbacks, purity
├── planets-deep.test.ts      # -C seed uniqueness, trigger boundaries, fallback paths, immutability
└── showcase-generate.test.ts # docs/showcase.html generation
docs/
└── showcase.html             # generated showcase page (12 real planets, universe stats)
```

---

## 7. Verification Results

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **20 files / 338 tests PASS** (exact, 2.30s) |
| Typecheck | `npx tsc -b` | **exit 0** |
| Build | `npm run build` | **exit 0** (207.61 kB JS / 6.70 kB CSS, 104 ms) |
| Lint | `npm run lint` | **exit 0** (oxlint) |
| Drift gate | `node scripts/import-planets.mjs --check` | **OK (exit 0)** — `planets.ts` matches the pinned snapshot (untouched) |

## 8. Test Counts (exact runtime, `--reporter=json`)

**20 files / 338 tests PASS** at closeout (was 338 as expected; growth +73 from the P2-T01 closeout base of 265).

| File | Tests |
|---|---|
| `tests/sim-purity.test.ts` | 36 |
| `tests/structures.test.ts` | 28 |
| `tests/savepersist-edge.test.tsx` | 26 |
| `tests/planetview-negative.test.tsx` | 24 |
| `tests/planet-identity.test.ts` | 21 |
| `tests/planets-deep.test.ts` | 20 |
| `tests/save-corrupt.test.ts` | 20 |
| `tests/import-planets-edge.test.ts` | 19 |
| `tests/structures-deep.test.ts` | 19 |
| `tests/planets-edge.test.ts` | 17 |
| `tests/save.test.ts` | 17 |
| `tests/savepersist.test.tsx` | 17 |
| `tests/format.test.ts` | 13 |
| `tests/planets-model.test.ts` | 13 |
| `tests/economy.test.ts` | 10 |
| `tests/population.test.ts` | 10 |
| `tests/offline.test.ts` | 9 |
| `tests/planets.test.ts` | 9 |
| `tests/planetview.test.tsx` | 9 |
| `tests/showcase-generate.test.ts` | 1 |
| **Total** | **338** |

Growth: 265 (P2-T01 closeout) → **338**. New P2-T02 coverage: `planets-model.test.ts` +13, `planet-identity.test.ts` +21, `planets-deep.test.ts` +20, `showcase-generate.test.ts` +1, `sim-purity.test.ts` +18 (the 9 `src/sim/planets/*.ts` modules joined the recursive `src/sim` purity scan — 2 assertions each) = +73.

---

## 9. Codex Verdicts (per subtask)

| Subtask | Verdict |
|---|---|
| -A | **PASS** — audit scope/boundaries (entity shape, derived stats locked to DESIGN §4d, generator design, D1–D4 + B3–B5, exclusions) |
| -B | **PASS** — planet entity + procedural generator (7 quirks, effectiveLevel, immutable entries, 317 tests) |
| -B (showcase) | **PASS** — showcase page (12 real planets, universe stats) |
| -C | **PASS** — negative-path + regression coverage (seed uniqueness, trigger boundaries, D4 fallbacks, immutability, purity) |
| -D | **PASS** — evidence + closeout |

Whole task: **P2-T02 Codex-PASSED**.

---

## 10. Jay Decisions B1–B5 (resolved — locked)

| # | Decision | Choice taken |
|---|---|---|
| **B1** | Structure slots (DESIGN §4d, Jay 2026-08-08) | **UNLIMITED** — no hard slot cap; diminishing returns per structure type: `effectiveLevel = min(level,10) + max(0,level−10)×0.5`, consumed by every structure effect |
| **B2** | Tier → pop-cap multiplier (DESIGN §4d, Jay 2026-08-08) | T1 ×1.0, T2 ×1.2, T3 ×1.4, T4 ×1.7, T5 ×2.0 on the `5,000 × (1 + 0.2 × housing)` base |
| **B3** | Quirk table + numbers (audit proposal) | **Adopted as proposed** — 7 quirks, ±10–20% effects, one per planet, each hooking one structure; only High Gravity +20% alloy is DESIGN-fixed |
| **B4** | Generator scope (audit proposal) | **Full package** — visual + quirks + description in one pure module + tests |
| **B5** | Seed algorithm + version salt (audit proposal) | **FNV-1a + `GENERATOR_VERSION` salt** — zero-dep, deterministic, collision-free on the full catalogue |
| **Renaming** | Players can rename their planets (DESIGN §4d, Jay 2026-08-08) | **Parked** — UI/backend work, not P2 core; no rename field on `PlanetState` |

---

## 11. Findings Fixed (Codex review rounds)

| # | Finding | Resolution | Locked by |
|---|---|---|---|
| **F1** | **Immutable copy** — a shallow object spread on `makePlanet` would let the `PlanetState` share the catalogue row by reference, so a future mutation of `planet.entry` could corrupt the shared 6,321-planet catalogue | `makePlanet` snapshots the entry with **`structuredClone`** (deep copy) — `PlanetState` owns a private copy; mutations never reach `PLANETS` | `planets-model.test.ts` (mutating the returned entry leaves the source name untouched) + `planets-deep.test.ts` (mutating all nested fields leaves the source byte-identical; independent snapshots per call) |
| **F2** | **Seed-uniqueness test missing** — the seed scheme (`FNV-1a`) must be proven collision-free at catalogue scale or identical seeds would silently force identical visuals/quirks on distinct planets | Test asserts **distinct seeds across all 6,321 planets** (`seeds.size === PLANETS.length`) and on a 1,000-planet sample (collision rate zero) | `planet-identity.test.ts` (full-catalogue seed uniqueness) + `planets-deep.test.ts` (1,000-planet sample) |
| **F3** | **Palette-combinatorics dispute** — whether the seeded palette/feature combinatorics could degenerate into uniform output (few distinct palettes, no moons, no rings) was disputed in review | Resolved **empirically**, not by argument: a uniqueness-spread test over the sample measures actual output variety — >50 distinct palettes on 1,000 planets, ≥3 distinct emojis, moons counts vary, ringed/atmosphere both fire, ≥5 distinct quirk-set outcomes | `planets-deep.test.ts` ("the SEED, not the name-embedded description, drives visual + quirk variation") + `planet-identity.test.ts` (500-planet variation spread) |

---

## 12. Branch / Remote State

- Branch: `staging` (no work on `main`).
- No push, no tag, no deploy — remote unchanged pending authorisation.
- Working tree clean after this closeout commit.

---

*Prepared by OpenCode (deepseek-v4-flash) for P2-T02-D. Only `docs/P2_T02_EVIDENCE.md` + ROADMAP.md changed in this subtask.*
