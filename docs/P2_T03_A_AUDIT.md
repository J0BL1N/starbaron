# P2-T03-A — Claim Flow Audit (new-player claim + colonise)

*Subtask `-A` for **P2-T03 Claim flow** (Phase 2 — Real Universe + Planets). Documentation-only audit. Nothing implemented, nothing committed, no work on `main`. Scope grounded in DESIGN.md §4b (Assignment: one unique planet per user, unclaimed pool, colonise empty planets, uniqueness), §4d (first-conquest timeline: colonise first empty planet day 1–2), §5 (unconquerable home planet, PvP defaults), §5c (onboarding step 1 "Claim your planet"), ROADMAP.md P2-T03 rows, `docs/P2_T02_EVIDENCE.md` (PlanetState, `makePlanet`, generator, FNV-1a), the committed catalogue `src/sim/data/planets.ts` (6,321 rows), and the P1 save layer `src/ui/save.ts`, all verified at HEAD `0ba8b5d` on `staging`.*

---

## 1. Claim Model — what "claiming" means pre-backend

### The honest frame

P3 owns Supabase + RLS (`ROADMAP.md` P3-T01). Until then **there is no shared universe** — no login, no server, no claim registry. The claim flow in P2 is therefore **the SIM layer + local session logic**: "claiming" is a **local, persisted statement of ownership**, not a server-enforced allocation. That has one hard consequence (stated up front, developed in §2): **uniqueness across players is NOT enforceable locally.** Each browser profile is an island; two islands can in principle end up holding the same catalogue name. A hash spreads installs so collisions are **rare but not impossible** (the ~94-install birthday bound of §2) — and that is precisely why the real "no two players share a planet" guarantee is a P3 RLS `unique` constraint on a server-side claim registry, not a claim this local layer can make.

### Proposed sim-level claim state

New pure module **`src/sim/claims/`** (a separate module over `PLANETS`, as P2-T02-A §5 reserved). It models the local claim registry per player:

```ts
// src/sim/claims/types.ts (proposed — -B decides exact layout)
export interface ClaimState {
  playerId: string            // anonymous install UUID (generated once on first boot, persisted)
  claimedPlanetName: string   // the single home-planet field per save (DESIGN §4b; local scope only) — name is the key, not an index
  colonisedNames: string[]    // additional colonised empty planets (DESIGN §5 PvP defaults) — grids are P2-T04
}
```

**First-boot flow (LOCKED for -B): claiming is automatic.** On first app load with empty storage, `playerId` is generated immediately — a local anonymous UUID persisted inside `ClaimState` — and the home planet is claimed via `claimHomePlanet(playerId)` and persisted right away. **No button, no user action performs the claim.** The onboarding "Claim your planet" step (DESIGN §5c step 1) is a **reveal/celebration** of the already-assigned planet — it shows "you now own Gliese 667 Cc" (with the real identity from `generate()`), it never *is* the mechanism. Migration v1→v2 performs the same automatic claim for existing saves (§6). `playerId` never changes for the life of the save, so re-claiming on load is idempotent (§7).

- **Keyed by catalogue `name`, not by array index.** The catalogue snapshot is a *manual, Jay-authorised refresh* (P2-T01 decision B — snapshot-not-live). An index stored in a save would silently point at the wrong planet after a re-import; `pl_name` is unique per row (P2-T01 dedupe confirmed) and is already the generator's identity anchor (`seedFromPlanetName`). Store names; derive `PlanetState` on demand via `makePlanet(lookupByName(name))` — the same derive-on-demand, zero-storage pattern P2-T02 locked (decision D3).
- **`playerId` is the deterministic seed (§2).** With no auth there is no server-assigned id; the anonymous UUID is generated **automatically at first boot** (before any user action) and persisted inside `ClaimState`. It never changes for the life of the save, so re-claiming on load is idempotent — same stored `playerId`, same planet, no double-claim (§1 first-boot flow).
- **`claimedPlanetName` IS the home planet** — no separate `isHome` boolean needed in the claim state; home is *defined by* this field (§3, §4).

### Pure functions (`src/sim/claims/claim.ts`, all deterministic, node-testable)

```ts
claimIndexForPlayer(playerId: string): number        // fnv1a("starbaron-claim-v1|" + playerId) % PLANETS.length
claimHomePlanet(playerId: string): PlanetCatalogueEntry  // PLANETS[claimIndexForPlayer(playerId)]
homePlanetState(claims: ClaimState): PlanetState     // makePlanet(lookup(claimedPlanetName)) + generate() (§3)
unclaimedPlanets(claims: ClaimState): PlanetCatalogueEntry[]  // PLANETS minus claimedPlanetName minus colonisedNames
colonise(claims: ClaimState, name: string): ClaimState        // validates name is unclaimed, appends — or throws (§7)
```

Everything in `src/sim/claims/` is pure sim code — it joins the existing recursive `src/sim` purity scan (`tests/sim-purity.test.ts`, which walks `src/sim/**/*.ts` automatically) at no extra cost.

### Save persistence (see §6 for the full migration)

`ClaimState` must be **persisted** (it is the "you own Gliese 667 Cc" truth). It extends `SaveGameV1` → **`SaveGameV2`**. Without persistence, every load would re-hash to the same planet (deterministic) but *colonised names and the playerId would reset* — the save is the registry for the local player. Flag: **save migration v1 → v2 is required** (§6).

---

## 2. Assignment Strategy — one planet assigned per new player (local assignment; cross-player uniqueness via P3 RLS)

### Deterministic hash → catalogue index (pre-backend)

DESIGN §4b is explicit that assignment is "just an index into the unclaimed pool." Pre-backend we make that index **deterministic from the player** rather than a random/pointer allocation:

```
homeIndex = fnv1a("starbaron-claim-v1|" + playerId) % PLANETS.length
homeName  = PLANETS[homeIndex].name
```

- **Reuses the existing zero-dep FNV-1a** (`src/sim/planets/hash.ts`, exported `index.ts:7`) with a **new, claim-specific salt** (`"starbaron-claim-v1"`) — deliberately separate from the generator's `"starbaron-v1"` seed salt (`src/sim/planets/prng.ts`), so claim assignment and visual generation can't interfere and each gets its own deliberate re-roll version.
- **Stable across runs and installs (while the save survives):** same `playerId` → same planet, forever. This is the *determinism* property the tests assert (§7) and it makes the onboarding hook reproducible ("you now own Gliese 667 Cc" — DESIGN §5c step 1).
- **Spread, not guarantee.** With 6,321 planets and a 32-bit hash, the birthday bound puts a ~50% collision chance at ~√(2·6321·ln 2) ≈ 94 independent installs *in the abstract hash space*. Collisions across installs are therefore **rare but not impossible at meaningful scales** — the honest limit, stated in code comments and here:
  - **Local claim = best-effort uniqueness** (deterministic, spread, persisted).
  - **Real uniqueness = P3 RLS** — a server-side `claims` table with `UNIQUE(planet_name)`, and assignment from a true server-side unclaimed pool at signup (`ROADMAP.md` P3-T01). The local `ClaimState` shape is designed to map 1:1 into that table (playerId → user id, name → row) so P3 doesn't refactor the model, only *enforces* it.

### Why not a "next unclaimed index" pointer?

A shared pool pointer (`firstUnclaimed++`) is the DESIGN-proposed mechanism **for a server**. Locally it would mean *every* fresh install starts at the same pointer (index 0 = "11 Com b" for everyone) — the exact opposite of "every player gets their own." A hash spreads installs across the catalogue; collisions are rare but possible and resolved server-side in P3. A pointer is also stateful (needs a shared counter = the server). So: **hash for P2, pointer+RLS for P3.**

### Colonise — pick from unclaimed (local)

Colonise = pick **any planet not in the player's own claimed/colonised set** (`unclaimedPlanets(claims)`). Pre-backend the only "unclaimed" set that exists is *this player's own set* — there is no global emptiness knowledge (the galaxy map that would show *other players'* planets is P3/P4). So local colonise semantics are:

- **Deterministic pick (recommended for -B):** `firstUnclaimedByIndex(claims)` = lowest catalogue index not already owned. Testable, order-stable, no RNG in the sim.
- **Validated pick:** `colonise(claims, name)` rejects (throws) any name that is already `claimedPlanetName` or in `colonisedNames` — the **local double-claim prevention** (§7).
- **Pool exhaustion locally:** the catalogue is 6,321 planets; a single player exhausting it is a test edge, not a real path. Real pool exhaustion (all planets held across players) is P3.
- **No cost in P2-T03.** DESIGN §4d says colonise-first-empty is a day-1–2 *timeline*, but specifies **no colonise cost**; the economy of expansion (and any cost/travel/cooldown) belongs to P2-T04 (per-planet economies) / P3 (async PvP travel). Bounded decision D5 (§8).

---

## 3. PlanetState Integration + PlayerState shape

### Claiming builds a real `PlanetState`

P2-T02 already gives us everything: `makePlanet(entry)` deep-snapshots the catalogue row and computes `baselineIncomePerSec`/`populationCapMultiplier`; `state.generate()` yields the deterministic identity (visual + quirks + description). Claiming a planet therefore builds **exactly one** `PlanetState`:

```
home = makePlanet(claimHomePlanet(playerId))   // entry + tier + income + pop-cap from REAL catalogue data
home.generate()                                // visual/quirks/description — the "Gliese 667 Cc" hook
```

- The placeholder `tier: 1` scalar in the P1 `GameState` (`useGameState.ts:29-38`, `STARTING_TIER = 1` line 21) is **replaced by the claimed entry's real tier** — the migration discards the placeholder tier (P1-T04 decision D: placeholder 🪐 was always honest fiction).
- `PlanetState` itself is **unchanged and owner-free** (P2-T02 decision D1 — locked). Ownership is layered **on top** in `PlayerState`, never inside `PlanetState`. This keeps `makePlanet`/generator/tests untouched and the P2-T02 immutability guarantees intact.

### `PlayerState` — where does it live?

**Recommendation: the sim layer, `src/sim/player/types.ts`.** Rationale:

- It is **pure serialisable sim data** — the same philosophy as `PlanetState` (pure, serialisable, node-testable).
- The save schema persists *sim* data; P3 needs a canonical server-side `PlayerState`; defining it in `src/sim` makes the P3 schema mapping direct (and the sim-purity scan covers it free).
- The wallet currently lives in the **UI** hook `GameState` (`useGameState.ts:29-38`) only because P1 had no player concept — that was flagged in P1-T03-A decision A as a temporary arrangement. **Flag the move:** P2-T03-B promotes the wallet + home planet into `PlayerState`; `GameState` in the hook becomes a *rendered projection* of `PlayerState.homePlanet` so `PlanetView`/`ResourceBar`/`BuildMenu` churn is minimal (same field names).

```ts
// src/sim/player/types.ts (proposed — -B decides exact layout)
export interface WalletState {
  credits: number        // shared currency (P1 semantics; per-planet split = P2-T04)
  alloys: number         // shared currency (P1 semantics; per-planet split = P2-T04)
  population: number     // home planet's population (single-planet in P2)
  garrison: number       // home planet's garrison (P3 uses it: §4)
  fleet: number          // home planet's fleet (P3 uses it: §4)
}

export interface OwnedPlanet {
  name: string           // catalogue name — the key
  isHome: boolean        // true iff name === claims.claimedPlanetName (§4)
  unconquerable: boolean // true iff isHome (DESIGN §5, §4) — the P3 hook
  claimedAt: number      // epoch ms of claim — P3 attack-window/history metadata
}

export interface PlayerState {
  claims: ClaimState                      // §1 — the registry (playerId + home + colonies)
  homePlanet: OwnedPlanet                 // index 0 of planets; always present after the first-boot claim (§1)
  colonies: OwnedPlanet[]                 // empty in P2-T03 (colonise validated; grids = P2-T04)
  wallet: WalletState                     // the P1 game wallet, promoted from UI (§ above)
  levels: Record<StructureId, number>     // the HOME planet's grid (single grid in P2; per-planet = P2-T04)
  lastTickAt: number                      // drives the real offline gap (unchanged, P1-T04)
}
```

- **`OwnedPlanet[]` vs `homePlanet`/`colonies` split:** a flat `planets` array with `isHome` on each (home forced to index 0) is the most P3-faithful shape (the server has a `planets` table with an `is_home` column). The audit recommends the **`homePlanet` + `colonies` split above for P2** (no empty-array indirection, no "which is home?" lookups in P2 code), and notes P3 will flatten to a `planets[]` array. Either is a -B layout decision; the *fields* are what matter (D1, §8).
- **`wallet` promotion is the flagged move.** `GameState` in `useGameState.ts` today *is* the wallet + grid (`GameState` interface lines 29-38, `buildPayload` lines 218-236 persist it 1:1). Promoting it into `PlayerState` and having the hook rehydrate from it keeps the save as the single source of truth and unblocks T04 (where wallet splits per planet). This is the one cross-layer refactor in the task; it is contained to `useGameState` + `save.ts` + `PlanetView` wiring, and the hook's public interface (fields returned) can stay field-for-field identical to avoid UI churn.

---

## 4. PvP Hooks (P3) — define the fields NOW so P3 doesn't refactor

P2-T03 must not implement combat, but the **ownership model must already carry the two flags P3's conquest math reads** (`ROADMAP.md` P3-T02/T03/T06). Lock these on `OwnedPlanet` (§3):

| Field | Type | Semantics (P3 reads this) |
|---|---|---|
| `isHome` | `boolean` | **`true` only for `claims.claimedPlanetName`.** DESIGN §5 line 127: home planet is unconquerable. P3-T06 rejects attacks where `target.isHome`; `isHome` also gates the "lose progress, never the game" invariant. Derived at claim time, persisted (denormalised so a re-parse never has to re-derive). |
| `unconquerable` | `boolean` | **`true` iff `isHome`.** DESIGN §5 line 127 ("Unconquerable home planet") + §6 anti-grief ("Unconquerable home planet — never a total loss"). The explicit `conquerable`/`unconquerable` flag on non-home planets is what P3-T06's "home-planet attack rejection" asserts against. Future-proof: if a shield or special world ever needs to flip a non-home to unconquerable (not in v1 — DESIGN reserves Shield Generator), the flag already exists. |
| `claimedAt` | `number` (epoch ms) | Metadata for P3 attack reports ("when was this planet taken"), the `colonies` timeline, and any future shield/grace logic. Cheap to store, avoids a P3 migration for the field. |

**Non-home planets are `conquerable` by default** — `unconquerable: false` is the implicit default; only the home planet flips it. P3 needs **no schema/field changes** to implement "any planet except your home planet can be taken" (DESIGN §5 line 123) — it reads `unconquerable`/`isHome` and nothing else about ownership was left unmodelled.

Deliberately NOT added (P3 owns these): attack timers, garrison deployment, war-weariness counters, DP/AP state beyond the existing P1 `defensePower`/`garrison` wallet fields. The `garrison` and `fleet` fields already persist in the wallet (§3) and are what P3's deploy model reads — the model is ready.

---

## 5. Exclusions (bounded for P2-T03)

| Excluded | Why |
|---|---|
| **Supabase / backend / RLS / server-side uniqueness** | Phase 3 (P3-T01). Local claim = best-effort (§1, §2). The `ClaimState` shape maps 1:1 to the P3 `claims` table so the RLS `UNIQUE` constraint is an enforcement add, not a remodel |
| **Claim registry across players / galaxy map** | P4/P3 — other players' planets don't exist locally; there is no "who owns what" global view in P2 |
| **Multi-planet economies (per-planet grids)** | P2-T04 — colonise records names; colony structure grids/wallets/income are T04 (this audit keeps `colonies: []` and a single `levels` grid) |
| **PvP / conquest / garrison deployment** | Phase 3 — only the *fields* `isHome`/`unconquerable`/`claimedAt` are added now (§4), never combat code |
| **Colonise cost / travel time / cooldown** | No colonise cost in DESIGN §4d; cost/travel are P2-T04 / P3-T02. P2-T03 colonise is the validated set-logic (free, instant) — decision D5 |
| **UI screens for claim** | **Minimal, recommended:** the claim is **automatic at first boot** (§1, §6) — no user action performs it. The *existing* onboarding step-0 "Claim your planet" (`src/ui/components/Onboarding.tsx`) becomes a **reveal/celebration step** that shows the already-assigned planet + identity, and `PlanetDisplay.tsx`'s hard-coded 🪐 "Home Planet" is swapped for the real claimed entry. A dedicated claim screen / galaxy picker is P3/P4 (decision D6 — it can also be excluded entirely if Jay wants zero UI) |
| **Player login / profile / cross-device** | No auth until P3; `playerId` is an anonymous install UUID inside the save |
| **Catalogue re-import during this task** | Snapshot refresh is a manual, Jay-authorised step (P2-T01 decision B); `planets.ts` stays byte-identical (drift gate `--check` still passes) |

---

## 6. Save Migration — `SaveGameV1` → `SaveGameV2`

### Why a new schema version

`ClaimState` + `PlayerState` are a **structural change** to what's persisted: the single-placeholder `game` node (`SaveGameV1`, `src/ui/save.ts:16-31`) becomes the home planet's slice of a `player` node. `validateSave` already **rejects any `schemaVersion !== SAVE_SCHEMA_VERSION`** (`save.ts:94`), so a version bump is mandatory and the mechanism to handle it already exists (`MIGRATIONS`, `migrateSave` — `save.ts:41,163-180`).

### Target shape (v2)

```ts
// src/ui/save.ts — proposed v2
interface SaveGameV2 {
  schemaVersion: 2
  savedAt: number
  player: PlayerState        // claims + homePlanet + colonies + wallet + levels + lastTickAt (§3)
  tutorial: TutorialState
  offlineSummarySeen: boolean
}
```

### Migration path design (mechanism already ships)

The P1-T04-A audit (§2) locked **key-per-version** and a forward migration map: "when v2 arrives, write `starbaron.save.v2`, migrate from the v1 key, keep the v1 key until the v2 write succeeds (crash-safe), then tombstone it." Concretely for -B:

1. `loadSave` probes keys newest-first: `starbaron.save.v2` (new constant) → `starbaron.save.v1` (existing `SAVE_KEY`, `save.ts:5`).
2. If only v1 exists: `parse → migrateSave(v1) → validateSave(v2)`.
3. `MIGRATIONS[1] = (v1) => v2` — the **only entry** in the map (today `MIGRATIONS = {}`, `save.ts:41`; `migrateSave` loops forward while `version < SAVE_SCHEMA_VERSION`, `save.ts:163-180` — it will pick up the v2 target automatically once `SAVE_SCHEMA_VERSION = 2`).
4. On successful v2 write, tombstone the v1 key (`storage.removeItem(SAVE_KEY)`).

### The v1→v2 transformation (`MIGRATIONS[1]`)

| v1 source | v2 destination |
|---|---|
| — (none) | `player.claims.playerId` = **newly generated anonymous UUID** (no such concept in v1 — a v1 save has no player; the migration creates one) |
| — (none) | `player.claims.claimedPlanetName` = `claimHomePlanet(playerId).name` (§2) — **the placeholder planet becomes a real catalogue planet at migration** (the honest P1-T04 decision D fiction is retired) |
| — (none) | `player.claims.colonisedNames = []` |
| `game.tier` (placeholder 1) | **dropped** — replaced by the claimed entry's real tier (via `makePlanet`) |
| `game.credits` | `player.wallet.credits` |
| `game.alloys` | `player.wallet.alloys` |
| `game.population` | `player.wallet.population` |
| `game.garrison` | `player.wallet.garrison` |
| `game.fleet` | `player.wallet.fleet` |
| `game.levels` | `player.levels` |
| `game.lastTickAt` | `player.lastTickAt` (drives the offline gap unchanged — P1-T04 §4) |
| `homePlanet` | `{ name: claimedPlanetName, isHome: true, unconquerable: true, claimedAt: savedAt }` |
| `tutorial`, `offlineSummarySeen` | carried 1:1 |

**Notes:** a brand-new install (no save at all) skips migration entirely — it generates `playerId` and **claims automatically at first boot** (no button, no user action; §1). An existing v1 save gets the **same automatic claim inside the migration** (rows above: the migration creates `playerId` and `claimedPlanetName`). The migration is **idempotent by construction** (only runs on v1 input; a v2 save goes straight through). Future-save (`schemaVersion > 2`) keeps the existing `{ kind: 'future' }` rejection (`save.ts:204`), never downgrades.

---

## 7. Testing Approach (P2-T03-C / -B scope)

Follow the established pattern (node suites in `tests/**/*.test.ts`; `@vitest-environment jsdom` only for UI suites; injectable `now`; in-memory storage adapter in `tests/saveHelpers.ts`). New suites:

| Suite | Env | Cases |
|---|---|---|
| `tests/claims.test.ts` | node | **Assignment determinism** — same `playerId` → same claimed name across repeated calls and re-import; `claimIndexForPlayer` in `[0, PLANETS.length)` for every input. **Collision spread in bounded fixture** — a fixed sample of 50 distinct synthetic `playerId`s asserts distinct claimed names as an **expected fixture**, not a guarantee (collisions are possible at scale and resolved server-side in P3, §2 — the test pins the current fixture's spread, it does not assert a uniqueness property of the hash). **Salt separation** — `"starbaron-claim-v1"` seed differs from the generator's `"starbaron-v1"` seed (the two systems don't interfere). |
| `tests/claims.test.ts` (cont.) | node | **Colonise picks unclaimed** — after claiming, `unclaimedPlanets` excludes `claimedPlanetName` and every `colonisedNames` entry; `colonise` appends a valid name and is rejected for a duplicate (double-claim prevention) or an unknown/non-catalogue name. **Exhaustion edge** — colonising the whole remaining catalogue (6,320 steps on a synthetic tiny subset or the real array) terminates; colonising the last unclaimed planet then attempting more throws/returns failure. |
| `tests/player-state.test.ts` | node | **Claim builds a real PlanetState** — `homePlanetState(claims)` returns a `PlanetState` whose `entry.name` matches the claim, whose tier/income come from the catalogue entry (not placeholder 1), and whose `generate()` runs (P2-T02 contract intact). **PvP hooks** — `isHome` true only for the claimed planet, `unconquerable` true iff `isHome`, every colony `unconquerable: false`. **Immutability** — mutating a returned `PlanetState.entry` never corrupts `PLANETS` (reuses the P2-T02 F1 guarantee). |
| `tests/save-v2.test.ts` | node | **Migration v1→v2** — seed a real v1 save (wallet + levels + tutorial) → `migrateSave` → `schemaVersion 2`, `player.claims.playerId` set, `claimedPlanetName` = a valid catalogue name, wallet/levels/lastTickAt carried 1:1, `homePlanet.unconquerable === true`. **Round-trip** — save v2 → validate → load → identical claims + wallet. **Corrupt v2** — bad `player.claims.playerId` / missing `claimedPlanetName` / duplicate colonised name → corrupt (fresh + notice), never a crash. **Key tombstoning** — after a successful v2 write the v1 key is removed; a fresh v2 key is written. |
| `tests/savepersist-claims.test.tsx` | jsdom | **Hook rehydration** — render `useGameState` with a seeded v2 save → home planet name/wallet/levels restored; claimed planet identity (`generate()`) matches the seed. **Automatic first-boot claim** — empty storage → a claim is made *on first load with no UI action*, save written with `claimedPlanetName`, remount restores the same planet (deterministic, no double-claim). **Offline gap** — `lastTickAt` still drives the 8h-capped gap (P1-T04 regression, now on the `player` node). |
| Purity | node | New `src/sim/claims/*` + `src/sim/player/*` pass the existing recursive `src/sim` purity scan automatically (no React/DOM imports — verified by the scan, not a new test). |

**Full gates per AGENTS.md:** `npx vitest run` PASS, `npx tsc -b` exit 0, `npm run build` exit 0, `npm run lint` exit 0, and `node scripts/import-planets.mjs --check` exit 0 (confirms `src/sim/data/planets.ts` untouched).

---

## 8. Blockers / Decisions for Jay

| # | Decision | Options | My recommendation |
|---|---|---|---|
| **D1** | **Where `PlayerState` lives + the wallet move** | (1) sim layer `src/sim/player/`, wallet promoted out of UI `GameState`; (2) keep wallet in UI, only add `claims` to the hook | **(1)** — pure serialisable sim data, P3-mappable, save-as-single-source-of-truth; the hook keeps the same public fields so UI churn is minimal (§3). The wallet move is the one cross-layer refactor in the task — flag it in the -B report |
| **D2** | **Save v2 shape** | (1) restructure to `player: PlayerState` node; (2) additive — add `claims` inside the v1 `game` node, keep wallet/levels flat | **(1) restructure** — `PlayerState` is the canonical root; T04 adds `colonies` grids as a v3 migration cleanly; the additive path leaves a half-placed owner model that P3 would have to unravel |
| **D3** | **`playerId` source** | (1) anonymous install UUID generated **automatically at first boot**, persisted; (2) derive from a device fingerprint (unreliable); (3) fixed constant (everyone same planet — defeats the hook) | **(1)** — deterministic per install, survives re-install-with-save, honest about the "no account yet" reality (§1) |
| **D4** | **Migration of the placeholder tier** | (1) v1→v2 replaces placeholder tier-1 with the claimed real planet's tier; (2) preserve the v1 tier as a "kept" planet | **(1)** — the placeholder was honest fiction (P1-T04 decision D); the whole point of T03 is that the real catalogue planet lands at migration (§6) |
| **D5** | **Colonise cost / rules in P2-T03** | (1) free + instant, validated set-logic only; (2) invent a cost now | **(1)** — DESIGN §4d specifies no colonise cost; inventing one violates "tune from real data, never guesses". Cost/travel land in P2-T04/P3 with the economy (§2, §5) |
| **D6** | **Claim UI in P2-T03** | (1) **minimal** — claim is automatic at first boot; the existing onboarding step-0 Claim button + `PlanetDisplay` become a **reveal/celebration** of the already-assigned planet (no user action performs the claim); (2) zero UI (sim + save only); (3) full claim screen + galaxy picker | **(1) minimal** — delivers DESIGN §5c step 1 ("You now own Gliese 667 Cc") with a tiny bounded diff; the full picker/planet grid UI is P3/P4. Zero-UI is also acceptable if Jay wants a strict sim-first phase — the sim/save work is identical either way |
| **D7** | **Colonise pick determinism** | (1) deterministic `firstUnclaimedByIndex` for -B; (2) player-chosen pick now (needs the galaxy UI) | **(1)** — order-stable, node-testable, no RNG; player choice arrives with the galaxy map UI (P3/P4) and uses the same validated `colonise(claims, name)` |
| **D8** | **`OwnedPlanet` shape** | (1) `homePlanet` + `colonies` split (P2); (2) flat `planets[]` with `isHome`, home forced index 0 (P3-faithful) | **(1) for P2** — no empty-array indirection, no "which is home?" lookups; P3 flattens to `planets[]` with the same fields (the migration cost is one v3 map, noted, not paid now) |

**Blockers:** none engineering-blocking — every item above is a *decision*, and the -B skeleton (claims module over `PLANETS`, `PlayerState` in sim, save v2 + `MIGRATIONS[1]`) proceeds with the recommended defaults if Jay pre-approves. The only genuinely *load-bearing* choice is **D2** (v2 shape) because it determines the migration + the `useGameState` refactor; the rest are additive on top. No live service, no backend, no push, no deploy — the whole task runs in pure TS + tests on `staging`.

---

*Prepared by OpenCode (deepseek-v4-flash) for P2-T03-A. Only `docs/P2_T03_A_AUDIT.md` created. No commit made, no work on `main`.*
