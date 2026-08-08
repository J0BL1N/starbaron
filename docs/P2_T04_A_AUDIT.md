# P2-T04-A — Multi-Planet Economies Audit (per-planet grids, shared wallet, accrual)

*Subtask `-A` for **P2-T04 Multi-planet economies** (Phase 2 — Real Universe + Planets). Documentation-only audit. Nothing implemented, nothing committed, no work on `main`. Scope grounded in DESIGN.md §4/§4a/§4b/§4c/§4d (income model, structures per planet, population rules, wallet semantics, growth curve), §5/§5a (conquest hooks, garrison model), `docs/P2_T03_EVIDENCE.md` (PlayerState: homePlanet + colonies, wallet promoted UI→sim, save v2), ROADMAP.md P2-T04 rows, and the shipping sim/save/UI sources, all verified at HEAD `6102586` on `staging` (working tree clean).*

---

## 1. Economy Model Per Planet — per-planet production, ONE shared wallet

### What exists today (verified at HEAD)

`PlayerState` (`src/sim/player/types.ts:23-30`) holds **one shared `WalletState`** (`types.ts:4-10`: `credits`, `alloys`, `population`, `garrison`, `fleet` — five single numbers) and **one flat `structureLevels: Record<StructureId, number>`** (`types.ts:28`). `OwnedPlanet` (`types.ts:12-21`) carries only identity/derived tier data (`name`, `entry`, `tier`, `baselineIncomePerSec`, `populationCapMultiplier`, `claimedAt`, `isHome`, `unconquerable`) — **no per-planet wallet, population, garrison, or grid**.

Accrual today is single-planet: `useGameState.accrue` (`src/ui/useGameState.ts:159-210`) applies **one** `computeDerived(structureLevels, homePlanet.tier, wallet.population)` (`useGameState.ts:130-157`) and feeds every produced unit into the one wallet. `baselineIncomePerSec` is computed per `OwnedPlanet` at claim time (`src/sim/player/claim.ts:36`) from `baselinePassiveIncome(tier) = 10 × tier` (`src/sim/core/economy.ts:6-11`) — it already exists **per planet**, but only the home planet's is ever read.

### DESIGN wording

| Source | Wording | Implication |
|---|---|---|
| §4 item 3 | "colonise/claim more planets as you grow (**each new planet = new structure grid**)" | Per-planet grids are LOCKED |
| §4c income model | "every planet has **baseline passive income** (auto, scales with planet tier + population). Structures don't create the income — they **add/multiply** it." | Per-planet production streams |
| §4d growth curve | "each claimed planet **adds its own baseline income + structure grid**, so expansion IS the progression" | Per-planet streams **sum** into the player's economy |
| §4a Credits/Alloys | "The everyday currency" / "Slower, rarer production" | Currencies are the **player's**, not a planet's — losing a planet never mentions losing credits/alloys |
| §4a Population | "Grows over time **on each planet** … **Losing a planet = losing its people**" | Population is **per planet** |

### Decision (RECOMMENDED)

**Per-planet production → ONE shared wallet for `credits` + `alloys`.** Each owned planet contributes its own income stream (baseline `10×tier` + its structures, quirks applied per planet); the player spends the pooled credits/alloys anywhere (build on any planet, raise any grid). Population, garrison, and fleet become **per-planet** (each `OwnedPlanet` is its own economy; the shared wallet holds only the two empire currencies).

This is faithful to DESIGN with **no contradiction**:

- DESIGN never mentions per-planet credit/alloy wallets; the currencies are described as the player's, and conquest escalation (§4d) is paid from the empire's resources.
- Population/garrison are **explicitly per planet** (§4a "on each planet", §5a "every planet has its own soldiers (garrison)").
- The only wording tension: §4c says baseline "scales with planet tier **+ population**", while §4d (the operative locked number) says "`10 × tier` … Trade Hub multiplies it; **nothing else touches the floor**." Current code implements §4d. **Flag for Jay** (§8 D2) — do not double-count population into baseline without a decision; §4d is treated as the binding spec here.

### P1/P2 legacy caveat

The shared wallet's `population/garrison/fleet` are single numbers because P1/P2 were single-planet sims — they were always the **home planet's**. v2→v3 migration assigns them to the home planet (§6), then they leave the wallet for good.

---

## 2. Structure Levels Per Planet — `Record<planetName, Record<StructureId, number>>`

### Scope confirmation

The T03 wallet-promotion audit **flagged this exact refactor** (P2_T03_A_AUDIT.md §3, `PlayerState` sketch): `levels: Record<StructureId, number> // the HOME planet's grid (single grid in P2; per-planet = P2-T04)`. T04-B executes it.

**Target shape:**

```ts
// PlayerState (v3)
structureLevels: Record<string, Record<StructureId, number>>   // keyed by catalogue planet name
```

- **Keyed by catalogue name** (not array index) — consistent with claim/ownership (P2-T03 §4 "keyed by name, not index", save stores names). A re-import can never re-point a grid.
- Every owned name (home + colonies) has a grid; a fresh colony gets `emptyStructureLevels()` (`src/sim/player/player.ts:9-15`).
- The **flat helper stays**: `emptyStructureLevels()` is reused per planet.
- The **buy path** (`useGameState.ts:332-351`) reads/writes `structureLevels[id]` — becomes `structureLevels[selectedPlanetName][id]` with the level + cost derived from the *selected* planet's grid.
- **`computeDerived` must be per-planet**: baseline from that planet's `baselineIncomePerSec` (already on `OwnedPlanet`), structure effects from that planet's grid, quirks from that planet's identity (§3).

### Planet selector (minimal)

**`selectedPlanetName` lives in UI state only** (hook-level `useState` in `useGameState`), never in the save:

- Defaults to `homePlanet.name` on load; switching sets it; `project()` renders the **selected** planet's grid + population into the existing `GameState` shape so `PlanetView`/`StructureGrid`/`BuildMenu` churn stays minimal (same field names — the P1 pattern already used for the T03 wallet promotion).
- `GameState` gains a `selectedPlanetName` (or the hook exposes `selectedPlanet: OwnedPlanet`); `ResourceBar`'s population/garrison/fleet numbers show the **selected planet's**, credits/alloys show the **shared** wallet.
- The selector UI itself = a planet list/dropdown (dropdown recommended for v1 — a full galaxy screen is P3/P4, excluded §5). No backend, no persistence of selection.

---

## 3. Accrual — sum over owned planets; population/garrison/fleet per planet

### Per-planet derived rates

Replace the single `computeDerived(levels, tier, population)` (`useGameState.ts:130-157`) with a **per-planet derivation** applied to every owned planet each tick:

```
for each owned planet p:
  identity(p)   → quirks                       # deterministic, cached (P2-T02 generator)
  levels = structureLevels[p.name]
  base = p.baselineIncomePerSec                # 10 × tier (already per-planet, claim.ts:36)
  creditsPerSec_p = base × tradeHubMult_p      # + shipyard income_p   (quirks applied)
  alloysPerSec_p   = oreMine_p                  # × highGravity quirk if present
  popGrowth_p      = populationGrowthPerSec(levels.housing, levels.hydroponics)  # × cold/hotStar
  popCap_p         = populationCap(levels.housing) × p.populationCapMultiplier
  garrisonCap_p    = barracks garrison cap (× gasGiant has no garrison quirk; shipyard quirk → fleet)
  fleetCap_p       = shipyard fleet cap × gasGiant quirk
  defensePower_p   = defensePower(levels.defenseTurret, p.population) × massiveWorld quirk

wallet.credits += Σ creditsPerSec_p × dt       # shared empire currency
wallet.alloys   += Σ alloysPerSec_p × dt       # shared empire currency
p.population    += popGrowth_p × dt  (clamped at popCap_p)
p.garrison      += conversion_p × dt (capped at garrisonCap_p, fed from p.population)
p.fleet         += shipyard build_p × dt (capped at fleetCap_p)
```

### Population/garrison/fleet: per planet (RECOMMENDED)

`wallet.population` is **one number today** (`types.ts:7`) — a T04 blocker for multi-planet. The audit **recommends per-planet population, garrison, AND fleet** (the task's guidance; DESIGN §4a/§5a mandate per-planet population + garrison, and fleet is produced per-planet by each Shipyard). Each `OwnedPlanet` gains:

```ts
// OwnedPlanet (v3)
population: number   // own people (DESIGN §4a "on each planet")
garrison:   number   // own soldiers (DESIGN §5a "every planet has its own soldiers")
fleet:      number   // own assembled fleet (shipyard per planet, §4d)
```

The shared `WalletState` reduces to `{ credits, alloys }` — **the only save/UI-change surface**, precisely bounded:

- **Save**: v2→v3 migration moves `wallet.population/garrison/fleet` into `homePlanet` (they were always the home's — §1), then drops them from the wallet (§6).
- **UI**: `ResourceBar` population/garrison/fleet become the **selected planet's**; credits/alloys stay global.
- **P3 note**: T03-Evidence §6 said "P3's deploy model reads the wallet `garrison`/`fleet` fields". After T04 those are per-planet (`OwnedPlanet.garrison/fleet`) — P3 reads the planet's fields instead; flag this in the -B/-D report so P3-T02/T03 don't assume a wallet field.

### Correctness gap found (not a new feature — a DESIGN-mandated number not yet wired)

`populationCapMultiplier` is stored on `OwnedPlanet` (`types.ts:17`) and `PlanetState` (`src/sim/planets/types.ts:8`) and asserted in tests, but **`computeDerived` never applies it** (`useGameState.ts:152` = `populationCap(levels.housing)` with no tier multiplier). DESIGN §4d line 89 locks: cap = `5,000 × (1 + 0.2 × housing) × tierMult`. **T04-B fixes this as part of the per-planet derivation** (tier-scaled caps make colonies meaningful). Also gap-noted: `applyQuirk` (`src/sim/planets/quirks.ts:123-150`) is implemented + unit-tested but **never wired into derived rates** — T04-B wires it per planet (DESIGN §4b "planet stats… subtly affect structure efficiency"; decision D3 §8).

### Fleet deployment (note only)

Fleet is the invasion instrument (§4a). T04 stores it per planet; P3 owns deployment/commitment ("deployment doesn't consume soldiers permanently until combat" — §4d). No T04 behaviour.

---

## 4. PvP Hooks — colonies conquerable, home safe; no changes needed

- **Colonies are already conquerable**: `unconquerable: false` for every colony, `true` iff `isHome` (`src/sim/player/claim.ts:26-42`, `buildOwnedPlanet`; validated in `save.ts:159-163`). DESIGN §5 "any planet except your home planet can be taken" already modelled.
- **Home is safe**: `isHome`/`unconquerable`/`claimedAt` (P2-T03 §4) unchanged. P3-T06's home-attack rejection reads these — **no field changes**.
- **Conqueror takes the planet's structures (P3 detail, note only):** DESIGN §5 line 129 LOCKED — everything survives **except defenses**; Turrets are destroyed in the fall. With per-planet grids, T04-B should (a) store structures **on the planet** (done — §2 shape makes the grid part of ownership), and (b) **NOT implement transfer/teardown logic** now. P3-T03 will copy the grid minus `defenseTurret` on conquest — the flat `Record<planetName, …>` keyed by name makes that a direct map. No T04 action beyond noting it.
- **Losing a planet loses its people** (§4a) — with per-planet population this is now *representable*; the transfer/destruction itself is P3, not T04.

---

## 5. Exclusions (bounded for P2-T04)

| Excluded | Why |
|---|---|
| **Galaxy map / full planet picker UI** | P3/P4. T04 ships only the minimal `selectedPlanetName` selector (dropdown/list), §2 |
| **Backend / Supabase / RLS** | Phase 3 (P3-T01). T04 is pure sim + local save |
| **PvP / conquest / garrison deployment / fleet travel** | Phase 3. T04 stores per-planet state; P3 owns combat |
| **Conquest transfer / turret teardown of structures** | P3-T03 (§4 — note only, no code) |
| **New structures / new quirks / new currencies** | Roster is LOCKED at 7 (DESIGN §4c). Quirks are wired (existing 7), never added |
| **Colonise cost / travel / cooldown** | No cost in DESIGN §4d; timeline + cost are P3. A fresh colony's starting population is a decision (§8 D6) but **not** a cost |
| **Persisting the selected planet** | UI-state only (§2); the save stays selection-agnostic |
| **Balance changes / number tuning** | §4d numbers untouched; only the tier pop-cap multiplier is *wired* (was already locked + asserted, §3) |

---

## 6. Save Migration — v2 → v3

### Why v3

`structureLevels` restructures flat → per-planet, and `WalletState` loses three fields (population/garrison/fleet move into `OwnedPlanet`). `validateSave` rejects any `schemaVersion !== SAVE_SCHEMA_VERSION` (`save.ts:194-199`), so a version bump + forward migration is mandatory. Mechanism already ships (`MIGRATIONS`, `migrateSave` — `save.ts:337-358`); T03 set exactly this precedent (v1→v2, key-per-version, `SAVE_V2_KEY`, tombstone).

### Target (v3)

```ts
// src/ui/save.ts — proposed v3
interface SaveGameV3 {
  schemaVersion: 3
  savedAt: number
  player: {
    playerId: string
    homePlanet: OwnedPlanet & { population: number; garrison: number; fleet: number } // v3 fields
    colonies: (OwnedPlanet & { population: number; garrison: number; fleet: number })[]
    wallet: { credits: number; alloys: number }              // population/garrison/fleet REMOVED
    structureLevels: Record<string, Record<StructureId, number>>  // per planet
    lastTickAt: number
  }
  tutorial: TutorialState
  offlineSummarySeen: boolean
}
```

### Migration v2→v3 transform (`MIGRATIONS[2]`)

| v2 source | v3 destination |
|---|---|
| `player.wallet.credits` | `player.wallet.credits` (unchanged) |
| `player.wallet.alloys` | `player.wallet.alloys` (unchanged) |
| `player.wallet.population` | `player.homePlanet.population` (was always the home's — §1) |
| `player.wallet.garrison` | `player.homePlanet.garrison` |
| `player.wallet.fleet` | `player.homePlanet.fleet` |
| — (none) | every **colony** gets `population: 0, garrison: 0, fleet: 0` (fresh settlement, §8 D6) |
| `player.structureLevels` (flat) | `{ [homePlanet.name]: <flat map> }` — the home grid nests under its own name |
| — (none) | every **colony** gets `structureLevels[colony.name] = emptyStructureLevels()` |
| `playerId`, `homePlanet` identity fields, `claimedAt`, `isHome`, `unconquerable`, `lastTickAt` | carried 1:1 |
| `tutorial`, `offlineSummarySeen` | carried 1:1 |

Idempotent by construction (only runs on v2 input; v3 passes straight through `migrateSave`). `loadSave` probes keys newest-first `v3 → v2 → v1`; successful v3 write tombstones the v2 key (same same-call synchronous write + tombstone pattern as T03, `save.ts:384-421`, `saveGame` `423-438`).

### v3 validation (extends the T03 F2 matrix)

- `wallet` = **exactly** `{ credits, alloys }` finite-non-negative; population/garrison/fleet in the wallet → **corrupt** (structural change — a v2-shaped wallet must not silently pass).
- `structureLevels` is `Record<planetName, …>`: every owned name (home + colonies) has a grid; **missing grid → additive `emptyStructureLevels()`** (lenient, matches the existing "missing colony fields" additive-default precedent); **a key not in the owned set → corrupt** (inconsistency, same class as duplicate claims).
- Each grid validates exactly like today's `validateStructureLevels` (`save.ts:177-192` — known structure ids, integer levels ≥ 0).
- Per-planet `population/garrison/fleet` finite-non-negative; `savedAt` lenient (non-finite → 0, unchanged).
- Home `population` must be ≤ home cap? **No** — cap is derived and clamping happens in accrual; validation asserts finite-non-negative only (matching today's wallet policy). Over-cap populations are tolerated (the game clamps on next tick).
- `repairHomePlanetClaim` (`save.ts:362-382`) unaffected (name-keyed logic is shape-agnostic).

### Key / constants

`SAVE_SCHEMA_VERSION = 3`, `SAVE_V3_KEY = 'starbaron.save.v3'`, `MIGRATIONS[2] = migrateV2ToV3`, `SAVE_KEYS_NEWEST_FIRST = [v3, v2, v1]`. Existing v1→v2 stays the only path for v1 saves (forward loop already handles multi-hop: v1 → v2 → v3).

---

## 7. Testing Approach (P2-T04-C / -B scope)

Follow the established pattern (node suites in `tests/**/*.test.ts`; `@vitest-environment jsdom` only for UI suites; injectable `now`; `tests/saveHelpers.ts` MemoryStorage/seeded-save fixtures). **Full gates per AGENTS.md:** `npx vitest run` PASS, `npx tsc -b` exit 0, `npm run build` exit 0, `npm run lint` exit 0, `node scripts/import-planets.mjs --check` exit 0.

| Suite | Env | Cases |
|---|---|---|
| `tests/planets-economy.test.ts` (new) | node | **Per-planet income sums** — 2–3 owned planets (home + colonies via `colonise`/`coloniseFirstUnclaimed`): total `creditsPerSec = Σ(10×tier×tradeHubMult + shipyard)`, `alloysPerSec = Σ oreMine`; adding a planet adds exactly its stream. **Structure isolation** — buy `oreMine` on planet A: A's alloys rate up, B's `oreMine` level and B's income **unchanged**. **Population independence** — growth on A never touches B's population; per-planet caps apply `× populationCapMultiplier(tier)` (locks the §3 gap fix); **tier-scaled caps** boundary asserts. **Quirks per planet** — a `highGravity` planet's alloys rate is ×1.2, another planet's is not (wires `applyQuirk` at derived level) |
| `tests/planets-economy.test.ts` (cont.) | node | **Buy targets selected planet** — `buy(id, planetName)` (or hook selection) increments only that planet's grid + spends the **shared** credits/alloys; insufficient funds → no change (transactional `walletSpend` reuse, `src/sim/player/wallet.ts:40-58`). **Defense/garrison/fleet per planet** — turret DP uses that planet's population; barracks feed that planet's garrison; shipyard fills that planet's fleet, never the wallet |
| `tests/save-v3.test.ts` (new) | node | **Migration v2→v3** — seed real v2 (wallet pop/garrison/fleet + flat levels) → `migrateSave` → `schemaVersion 3`, wallet = credits+alloys only, home carries the old pop/garrison/fleet, `structureLevels` nested under `homePlanet.name`, colonies have empty grids + 0 pop. **Round-trip** — save v3 → validate → load → identical (per-planet grids, per-planet pop, wallet). **Tombstone** — v2 key removed after v3 write, v3 key written same-call. **Corrupt v3** — wallet containing `population`, unknown planet-name grid key, negative pop, bad nested level → `{ kind: 'corrupt' }`, never a throw. **Lenient additive** — missing colony grid → empty grid, still `ok` |
| `tests/savepersist.test.tsx` / new | jsdom | **Hook rehydration v3** — seeded v3 restores per-planet grids + per-planet pop; **planet selector** — switching `selectedPlanetName` renders the colony's grid/population/defense while credits/alloys stay global; **offline gap** — `lastTickAt` still drives the 8h-capped gap, now accruing per planet (P1-T04 regression, v3 node) |
| `tests/player-save.test.ts` / `save-migration-edge.test.ts` | node | Existing v1→v2 tests unchanged (multi-hop v1→v2→v3 asserted); v2 corrupt matrix still yields corrupt; validate-before-repair ordering intact |
| `tests/planetview-negative.test.tsx` | jsdom | Selector edge: colony with zero structures/pop renders empty states; buy-with-no-funds on a colony; switching back to home restores home data |
| Purity | node | New/changed `src/sim` modules pass the recursive purity scan automatically (`tests/sim-purity.test.ts` walks `src/sim/**/*.ts`) |

**Existing suites touched by the shape change (expected, bounded):** `tests/player-wallet.test.ts` (wallet loses pop/garrison/fleet → assertions move to per-planet), `tests/save.test.ts`/`save-corrupt.test.ts`/`save-migration-edge.test.ts` (flat `structureLevels` + 5-field wallet fixtures), `tests/savepersist.test.tsx`, `tests/planetview*.test.tsx`, `tests/player-save.test.ts`. Core-function suites (`economy`, `population`, `offline`, `structures`, `planets-*`) are **unchanged** — they test tier-independent primitives; the tier multiplier + quirk wiring live in the new per-planet derivation, not the core.

---

## 8. Blockers / Decisions for Jay

| # | Decision | Options | My recommendation |
|---|---|---|---|
| **D1** | **Wallet scope** | (1) **per-planet production → shared `credits+alloys` wallet**, population/garrison/fleet per planet; (2) per-planet wallets entirely; (3) keep pop/garrison/fleet shared | **(1)** — DESIGN says currencies are the player's (§4a) and population/garrison are "on each planet" (§4a/§5a); fleet follows Shipyard per planet. Single wallet = spend-anywhere empire economy; §3 accrual design |
| **D2** | **Baseline wording tension (§4c "tier + population" vs §4d "10 × tier, nothing else touches the floor")** | (1) keep §4d `10×tier` as the floor (current code); (2) add a population-scaled component to baseline | **(1)** — §4d is the locked number; population already contributes via Housing growth + garrison/conquest. Do **not** change the income curve without Jay (tune-from-data rule, §12). This is a DESIGN-doc wording flag, not a code blocker |
| **D3** | **Wire quirks into per-planet rates now?** | (1) yes — apply `applyQuirk` per planet in the derived rates (small; hooks already exist + tested); (2) defer to P3 | **(1)** — per-planet economies are *where* flavour must land (DESIGN §4b "structure-efficiency hooks"); it's the difference between quirks being decoration vs gameplay. Bounded: existing 7 quirks, no new table |
| **D4** | **Tier pop-cap multiplier** | (1) wire it in T04-B (locked §4d, currently stored-but-unwired — §3 gap); (2) leave for later | **(1)** — it's already DESIGN-locked and asserted on the type; wiring is a few lines in the per-planet derivation and makes higher-tier colonies meaningful |
| **D5** | **Planet selector scope** | (1) `selectedPlanetName` UI-state only, dropdown; (2) persist selection in save; (3) full galaxy picker now | **(1)** — minimal, no save churn; galaxy map is P3/P4 (§2, §5) |
| **D6** | **Fresh colony starting population** | (1) 0 pop / 0 garrison / 0 fleet (empty planet just settled); (2) a small starter population | **(1)** — DESIGN says "empty planets can be colonised"; empty = empty. Home keeps the migrated 1,000 from v2. Flag: zero-pop colonies already grow at the base rate (2/sec, `populationGrowthPerSec(0,0)` — `src/sim/core/population.ts:26`), so Housing is **not** required to start growth; Housing instead raises both the pop cap and the growth rate. Colonise→first Housing is still the onboarding rhythm (P3 can revisit if it feels dead) |
| **D7** | **Fleet per planet vs shared** | (1) per planet (Shipyard produces there, deployment is from there); (2) keep one empire fleet | **(1)** — consistent with garrison; **P3 note**: T03-Evidence §6 said P3 reads wallet `garrison`/`fleet` — after T04 those are `OwnedPlanet` fields; P3-T02/T03 must read per-planet |
| **D8** | **Conquest structure semantics** | Confirm DESIGN §5 line 129 in T04: per-planet grid makes "conqueror keeps everything except Turrets" a copy-minus-defenseTurret at P3-T03 | **No T04 code** — note only (§4); grid lives on the planet so P3 transfers it by name-keyed map |

**Blockers:** none engineering-blocking. Every item is a decision; `-B` proceeds with the recommended defaults if Jay pre-approves. The load-bearing choices are **D1** (wallet scope — determines the v3 migration and the per-planet field set) and **D3/D4** (whether per-planet derivation wires quirks + tier caps — both already DESIGN-locked, recommended on). No live service, no backend, no push, no deploy — the whole task runs in pure TS + tests on `staging`.

---

## 9. Known findings (documented this round)

*Added during the P2-T04-C correction round per independent Codex audit (read-only). No code changed; these three behaviours were verified against the sources at the same HEAD and are documented here so they are explicit — not silently assumed. Each is a note/flag, not a blocker for `-B`.*

### 9.1 Binary-system quirk applies at level-0 Trade Hub (baseline ×1.1) — behaviour is real, currently UNTESTED, FLAGGED FOR JAY

`src/sim/player/accrual.ts:63` applies the planet's quirks to the Trade Hub effect **before** any level gate: `applyQuirks(quirks, structureEffect('tradeHub', levels.tradeHub))`. At `tradeHub = 0`, `structureEffect` returns `{ kind: 'incomeMultiplier', multiplier: 1 + 0.1 × 0 = 1 }` (`src/sim/structures/effects.ts:40-44`), and `src/sim/planets/quirks.ts:142-145` multiplies that by the binarySystem `1.1` — so a level-0 Trade Hub on a binarySystem planet still yields **baseline × 1.1** (verified: `computePlanetDerived.creditsPerSec = baselineIncomePerSec × (tradeHubEffect?.multiplier ?? 1)`).

- **Status: real behaviour, currently UNTESTED.** The existing quirk test (`tests/planets-economy.test.ts:216-225`) only asserts the **level-1** case (`50 × 1.1 × 1.1`). No test pins the level-0 binarySystem case (`50 × 1.1` with an empty grid), so this behaviour is not locked by a regression assertion.
- **FLAGGED FOR JAY as a design decision** (mirrors §8 D2/D3's "quirks land per-planet" framing):
  - **Option A (baseline-trait):** binarySystem is a planetary trait that lifts the income floor itself (baseline ×1.1 regardless of Trade Hub level). This is what the code does today.
  - **Option B (structure-gated):** binarySystem only applies once a Trade Hub is built (`levels.tradeHub ≥ 1`); a level-0 hub contributes nothing.
  - **Recommendation: A.** Quirks are described in DESIGN §4b as planet-level flavour ("planet stats subtly affect structure efficiency"), and the income `floor` (§4d) is explicitly "*10 × tier* … Trade Hub multiplies it". Keeping the quirk as a baseline trait is simplest and matches current behaviour; **Option B requires a `-B` wiring change + a level-0 regression test**, so Jay's decision is needed before `-B` if B is chosen.
- **Note the DESIGN §4d "floor" wording tension:** §4d says "Trade Hub multiplies it; **nothing else touches the floor**", yet the binarySystem quirk *does* touch the floor at level 0 under Option A. This is the same §4c/§4d wording family as §8 D2 — documented together here so the design read is complete.

### 9.2 `gridForPlanet` returns a live reference (not a copy) — defensive note, no active bug

`src/sim/player/accrual.ts:38-43` returns `player.structureLevels[name] ?? emptyStructureLevels()` — the **stored grid object itself**, not a clone (callers mutate a spread, e.g. `useGameState.ts:117` `{ ...gridForPlanet(...) }`, and `buildStructure` writes a new object via `{ ...grid, [id]: level + 1 }`). **No active bug today.** Defensive note for future callers: `gridForPlanet` hands out the live reference — **do not mutate the returned grid in place**; spread it first (as the current call sites do).

### 9.3 `saveHelpers.makeSave` gives unspecified colony grids a copy of the home grid — fixture behaviour only

`tests/saveHelpers.ts:129-132`: any colony passed without an explicit grid in `overrides.structureLevels` gets `{ ...homeGrid }` — a **copy of the home grid**. **Fixture behaviour only** (production `colonise` assigns `emptyStructureLevels()` — `src/sim/player/claim.ts:107-110`); tests that care pass explicit per-colony grids. No production impact; documented so nobody reads the fixture as a production default.

---

*Prepared by OpenCode (deepseek-v4-flash) for P2-T04-A. Only `docs/P2_T04_A_AUDIT.md` created. No commit made, no work on `main`.*
