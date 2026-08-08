# P2-T04 — Multi-Planet Economies: Evidence

*Closeout evidence for **P2-T04 Multi-planet economies** (Phase 2 — Real Universe + Planets). Consolidates the subtask record for `-A`/`-B`/`-C`/`-D`. Per WORKFLOW.md, no HEAD SHAs are embedded in prose — SHAs appear only where the record already references them (commit subjects). The whole task is Codex-PASSED.*

---

## 1. Subtask Record

| Subtask | Scope | Status | Evidence |
|---|---|---|---|
| **-A** | Audit: per-planet grid isolation, shared player wallet vs per-planet | Complete | `docs/P2_T04_A_AUDIT.md` — wallet scope (D1), quirk + tier-cap wiring (D3/D4), planet selector (D5), save v2→v3 migration shape, exclusions, decisions D1–D8, §9 known findings |
| **-B** | Implement: each planet = own structure grid + income; switch planets in UI | Complete | `src/sim/player/accrual.ts` (per-planet derivation + empire sums), per-planet `OwnedPlanet` fields, name-keyed grids, `PlanetSelector`, v2→v3 migration, PvP tunables draft in DESIGN §5a (committed "feat: P2-T04-B multi-planet economies (per-planet grids, quirk+tier-cap wiring, v2->v3 migration, 462 tests) + PvP tunable drafts") |
| **-C** | Cross-planet bugs: income mixing, structure bleed | Complete | `tests/planets-multideep.test.ts`, `tests/save-v3-deep.test.ts`, `tests/planetview-selector.test.tsx` + expanded `save.test.ts`/`planetview.test.tsx` (committed "test: P2-T04-C multi-planet deep coverage (isolation, quirks, caps, v2->v3 matrix, +491 tests)") |
| **-D** | Evidence + Codex PASS | Complete | This doc; committed to `staging` |

---

## 2. Multi-Planet Economy — ONE shared wallet, per-planet everything else

`PlayerState` (`src/sim/player/types.ts:25-31`) now splits "empire" from "planet":

- **Shared `WalletState` = exactly `{ credits, alloys }`** (`types.ts:4-7`). The two empire currencies pool across every owned planet and are spent anywhere (build on any planet, raise any grid) — DESIGN §4a ("the player's currencies").
- **`OwnedPlanet` carries per-planet `population`, `garrison`, `fleet`** (`types.ts:18-20`) — DESIGN §4a "Grows over time **on each planet**", §5a "every planet has its own soldiers (garrison)". A colony is its own economy.
- **`structureLevels` is now `Record<planetName, StructureGrid>`** (`types.ts:30`), keyed by catalogue name (never array index) — every owned name (home + colonies) has its own grid. The T03 audit's exact flagged refactor ("the HOME planet's grid in P2; per-planet = P2-T04").

The v2 wallet's `population/garrison/fleet` are gone from the wallet — they were always the home planet's (P1/P2 single-planet sims); the migration assigns them (§6).

## 3. Accrual — sums ALL owned planets; quirks + tier caps wired

`src/sim/player/accrual.ts` replaces the old single-planet accrue:

- **`computePlanetDerived(owned, levels)`** (`accrual.ts:56-105`) derives every rate for **one** planet from its own identity + its own grid: baseline `10×tier`, Trade Hub × shipyard income, Ore Mine alloys, Housing/Hydroponics growth, Barracks garrison, Shipyard fleet cap, Turret DP. Quirks are applied per planet via `applyQuirks` (`accrual.ts:45-54` → `applyQuirk`).
- **`accruePlayer`** (`accrual.ts:151-184`) loops home + **all colonies**: `wallet.credits/alloys += Σ derivedPerSec × dt` (empire sums), while population/garrison/fleet accrue **independently per planet** (`accruePlanet` — garrison conversion is fed from that planet's own population, never the wallet; fleet clamps to its planet's Shipyard cap).
- **`empireRates`** (`accrual.ts:186-195`) = Σ credits/alloys per sec across all planets — what the ResourceBar shows.
- **`buildStructure(player, planetName, id)`** (`accrual.ts:209-228`) spends the shared wallet transactionally and raises only the **named planet's** grid level; unknown owned planet → `RangeError`.
- **`planetTotals`** (`accrual.ts:197-207`) sums population/garrison/fleet empire-wide where a single number is needed.

### The two audit gaps are closed

Both were DESIGN-locked numbers stored-but-unwired at `-A` (audit §3); `-B` wired them into the per-planet derivation — no new features, no balance changes:

1. **`populationCapMultiplier` now applies** (`accrual.ts:81-85`): cap = `(BASE_POPULATION_CAP + housingBonus × denseCore) × populationCapMultiplier(tier)`. Higher-tier colonies are now meaningfully bigger (DESIGN §4d: cap scales with tier).
2. **Quirks now affect derived rates per planet** (`accrual.ts:45-54, 62-103`): `applyQuirk` is applied to the Ore Mine / Trade Hub / Shipyard / Barracks / Hydroponics effects, plus the `denseCore` pop-cap and `massiveWorld` defense multipliers. Quirks are gameplay, not decoration (DESIGN §4b).

## 4. Planet Switcher UI

- **`selectedPlanetName` lives in UI state only** (`src/ui/useGameState.ts:168-170` — hook `useState`, never persisted; defaults to `homePlanet.name`). Selection is **not** in the save (audit D5).
- **`ProjectSelector`** (`src/ui/components/PlanetSelector.tsx`) is a minimal dropdown of owned planets (`name (Tier N)`); switching calls `selectPlanet` and re-renders.
- **`project(player, selectedName)`** (`useGameState.ts:108-121`) renders the **selected** planet's grid/population/garrison/fleet into the existing `GameState` shape, while credits/alloys always come from the **shared** wallet — so `PlanetView`/`ResourceBar`/`BuildMenu` churn stayed minimal (same field names). `buy()` targets the selected planet (`useGameState.ts:432`).
- Full galaxy map / planet picker screen is explicitly excluded — P3/P4 (audit §5).

## 5. Save Migration — v2 → v3 (with tombstone)

`src/ui/save.ts` ships `SAVE_SCHEMA_VERSION = 3`, `SAVE_V3_KEY = 'starbaron.save.v3'`, `MIGRATIONS[2] = migrateV2ToV3` (`save.ts:390-427`), probe order `v3 → v2 → v1` (`save.ts:453`).

| v2 source | v3 destination |
|---|---|
| `player.wallet.credits/alloys` | `player.wallet.credits/alloys` (unchanged) |
| `player.wallet.population/garrison/fleet` | `player.homePlanet.population/garrison/fleet` (were always the home's) |
| — (none) | every **colony** gets `population: 0, garrison: 0, fleet: 0` (fresh settlement, D6) |
| `player.structureLevels` (flat) | `{ [homePlanet.name]: <flat map> }` — home grid nests under its own name |
| — (none) | every **colony** gets `structureLevels[colony.name] = emptyStructureLevels()` |

- **Same-call synchronous write + tombstone** (`loadSave`, `save.ts:487-524`): a v2/v1 key is migrated → validated → written as v3 **and the old key removed in the same call**, so a reload before any deferred save sees the migrated state (the T03 crash-safe precedent, carried forward).
- **v3 validation** (`validateSave`, `save.ts:247-319`): wallet must be **exactly** `{ credits, alloys }` — a wallet still carrying `population`/`garrison`/`fleet` → **corrupt**; `structureLevels` keyed by owned names only (unknown key → corrupt; **missing owned grid → additive `emptyStructureLevels()`**, lenient); per-planet pop/garrison/fleet finite-non-negative; name-keyed identity validation unchanged.
- `repairHomePlanetClaim` (`save.ts:455-485`) is shape-agnostic — rebuilds name-keyed grids the same way, re-import safe.

## 6. DESIGN §5a — PvP tunables v0.1 DRAFT

`DESIGN.md` §5a gains a **draft table** (marked "Jay audits at playtest, 2026-08-08" — explicitly a draft, not a lock): **Travel time** `distancePc × 1 min`, floor 10 min, cap 48h · **Launch cost** `200 cr + fleet × 0.2 cr + distancePc × 10 cr` · **War-weariness** +20% required force per conquest within 24h. No code consumes these yet — they are documentation for P3-T02/T03/T05.

## 7. Files

```
src/sim/player/
├── types.ts        # WalletState = {credits, alloys}; OwnedPlanet + population/garrison/fleet; Record<name, StructureGrid>
├── accrual.ts      # computePlanetDerived, accruePlayer (Σ all planets), empireRates, buildStructure, planetTotals, gridForPlanet
├── claim.ts        # colonise assigns empty grid + 0 pop/garrison/fleet to a fresh colony
├── grid.ts         # emptyStructureLevels (per-planet)
├── player.ts       # createPlayer / ownedPlanetIdentity (quirks per planet)
├── wallet.ts       # walletSpend (shared credits/alloys, transactional)
└── index.ts        # public exports
src/ui/save.ts                  # SaveGameV3, MIGRATIONS[2] = migrateV2ToV3, v3 keys/probe order, tombstone
src/ui/useGameState.ts          # selectedPlanetName (UI-only), project(selected), selectPlanet, buy→selected planet
src/ui/components/PlanetSelector.tsx  # dropdown switcher
src/ui/PlanetView.tsx / PlanetDisplay.tsx / ResourceBar.tsx  # render selected planet; credits/alloys stay global
tests/
├── planets-economy.test.ts       # -B income sums, structure isolation, pop independence, per-planet quirks, tier caps
├── save-v3.test.ts               # -B migration v2→v3, round-trip, tombstone, corrupt-v3 matrix, lenient additive
├── planets-multideep.test.ts     # -C isolation/deep coverage (income mixing, structure bleed, caps, quirks)
├── save-v3-deep.test.ts          # -C v2→v3 matrix edges (multi-hop, corrupt shapes, repair)
├── planetview-selector.test.tsx  # -C selector switching renders the right planet; shared wallet stays global
└── (expanded) save.test.ts, planetview.test.tsx, save-corrupt.test.ts, player-save.test.ts, saveHelpers.ts
```

## 8. Verification Results

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **30 files / 491 tests PASS** (exact, 3.62s) |
| Typecheck | `npx tsc -b` | **exit 0** |
| Build | `npm run build` | **exit 0** |
| Lint | `npm run lint` | **exit 0** (oxlint) |
| Drift gate | `node scripts/import-planets.mjs --check` | **OK (exit 0)** — `planets.ts` matches the pinned snapshot (untouched) |

## 9. Test Counts (exact, `--reporter=json`)

**30 files / 491 tests PASS** at closeout (growth +71 from the P2-T03 closeout base of 420).

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
| **Total** | **491** |

Growth: 420 (P2-T03 closeout) → **491** = **+71**. New P2-T04 coverage: `planets-economy.test.ts` +21, `save-v3.test.ts` +13, `planets-multideep.test.ts` +14, `save-v3-deep.test.ts` +10, `planetview-selector.test.tsx` +5, expanded `save.test.ts` (+2 → 25), `planetview.test.tsx` (+2 → 11), `sim-purity.test.ts` (+4 → 50 — `accrual.ts`/`grid.ts` joined the scan).

## 10. Codex Verdicts (per subtask)

| Subtask | Verdict |
|---|---|
| -A | **PASS** — audit scope/boundaries (shared wallet vs per-planet, per-planet grids, accrual sum, planet selector, v2→v3 migration, D1–D8, exclusions) |
| -B | **PASS** — implementation (per-planet grids keyed by name, per-planet pop/garrison/fleet, quirks + tier-cap wiring closing both audit gaps, planet switcher, v2→v3 migration + tombstone, 462 tests) |
| -C | **PASS** — negative-path + regression coverage (income mixing, structure bleed, per-planet caps/quirks, v2→v3 matrix, corrupt-v3 shapes, selector switching, 491 tests) |
| -D | **PASS** — evidence + closeout |

Whole task: **P2-T04 Codex-PASSED**.

## 11. Known Findings (carried)

These were documented at `-A` (§9) and verified against the sources again at closeout. **Entry 1 is RESOLVED** (binary-system decision, Option A, chosen by Jay 2026-08-09); **entries 2–3 remain open** and explicitly flagged, not silently resolved:

1. **Binary-system quirk at level-0 Trade Hub (baseline ×1.1) — RESOLVED: Option A chosen by Jay 2026-08-09.** binarySystem is a baseline-trait: it lifts the income floor (baseline ×1.1) at **any** Trade Hub level including 0, on top of the Trade Hub's own per-level multiplier. `src/sim/player/accrual.ts:68` applies quirks before any level gate, so this is exactly what the code already does — no wiring change was needed. Now pinned by `tests/binarysystem-level0.test.ts` (6 tests: plain anchor, deterministic binarySystem colony, level-0 floor lifted ×1.1, non-binary planet NOT boosted at level 0, level 0 vs 1 stacking, live `accruePlayer` x1.1 path). DESIGN §4d wording updated to note the binarySystem exception.
2. **`gridForPlanet` returns a live reference, not a copy** (`accrual.ts:38-43`) — no active bug; all current call sites spread before mutating. Defensive note for future callers: don't mutate the returned grid in place. **Still open / FLAGGED FOR JAY.**
3. **`tests/saveHelpers.ts` gives unspecified colony grids a copy of the home grid** — fixture behaviour only (production `colonise` assigns `emptyStructureLevels()`); tests that care pass explicit per-colony grids. **Still open / FLAGGED FOR JAY.**

## 12. Branch / Remote State

- Branch: `staging` (no work on `main`).
- No push, no tag, no deploy — remote unchanged pending authorisation.
- Working tree clean after this closeout commit.

---

*Prepared by OpenCode (deepseek-v4-flash) for P2-T04-D. Only `docs/P2_T04_EVIDENCE.md` + ROADMAP.md changed in this subtask.*
