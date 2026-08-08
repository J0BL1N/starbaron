# P2-T03 — Claim Flow (new-player claim + colonise): Evidence

*Closeout evidence for **P2-T03 Claim flow** (Phase 2 — Real Universe + Planets). Consolidates the subtask record for `-A`/`-B`/`-C`/`-D`. Per WORKFLOW.md, no HEAD SHAs are embedded in prose — SHAs appear only where the record already references them (commit subjects). The whole task is Codex-PASSED.*

---

## 1. Subtask Record

| Subtask | Scope | Status | Evidence |
|---|---|---|---|
| **-A** | Audit: new-player claim (1 unique planet), colonise empty planets | Complete | `docs/P2_T03_A_AUDIT.md` + DESIGN lock-ins (auto-claim, hash assignment, sim-layer `PlayerState`, PvP hooks, save v2 migration, decisions D1–D8) |
| **-B** | Implement: claim pool (deterministic hash → catalogue index), auto-claim on first boot, sim/player wallet promotion, save v1→v2 migration, colonise flow | Complete | `src/sim/player/*` (5 modules) + `src/ui/save.ts` + `src/ui/useGameState.ts` + UI reveal wiring (committed "feat: P2-T03-B claim flow (auto-claim, sim/player wallet, v1->v2 migration, 394 tests)") |
| **-C** | Edge: pool exhaustion, double-claim prevention, corrupt-v2 matrix, migration stability, fabricated-home repair | Complete | `tests/claims-deep.test.ts`, `tests/player-wallet.test.ts`, `tests/save-migration-edge.test.ts`, expanded `save.test.ts`/`save-corrupt.test.ts`/`savepersist.test.tsx` (committed "test: P2-T03-C claim/wallet/migration edge coverage (420 tests) + DESIGN Kimi map-layer note") |
| **-D** | Evidence + Codex PASS | Complete | This doc; committed to `staging` |

---

## 2. Sim / Player Layer — `src/sim/player/`

The claim flow lives in a **pure sim module** over the 6,321-row catalogue (`src/sim/data/planets.ts`) — the seam P2-T02-A §5 reserved. `PlanetState` itself is unchanged and owner-free (P2-T02 decision D1); ownership is layered **on top** in `PlayerState`.

| File | Role |
|---|---|
| `src/sim/player/types.ts` | `PlayerState` (playerId, homePlanet, colonies, wallet, structureLevels, lastTickAt), `OwnedPlanet` (name, entry, tier, baselineIncomePerSec, populationCapMultiplier, claimedAt, isHome, unconquerable), `WalletState` |
| `src/sim/player/claim.ts` | `claimIndexForPlayer`, `claimHomePlanet`, `claimColony`, `ownedNames`, `unclaimedPlanets`, `firstUnclaimedByIndex`, `colonise`, `coloniseFirstUnclaimed`, `catalogueEntryByName` — all deterministic, node-testable |
| `src/sim/player/player.ts` | `createPlayer` (first-boot auto-claim), `generatePlayerId` (crypto.randomUUID), `ownedPlanetIdentity`, `emptyStructureLevels` |
| `src/sim/player/wallet.ts` | `startWallet` (1,000cr/0 alloy/1,000 pop), `walletAdd`, `walletSpend` — the P1 UI wallet, promoted into the sim |
| `src/sim/player/index.ts` | Public exports |

All 5 modules join the existing recursive `src/sim` purity scan (`tests/sim-purity.test.ts`) at no extra cost — the scan walks `src/sim/**/*.ts` automatically (36 → 46 purity assertions).

---

## 3. Automatic Claim on First Boot (no button)

Per DESIGN §5c step 1 ("Claim your planet") and the locked audit decision D3, **claiming is automatic**:

- `useGameState.ts` `initialPlayer(now)` → `createPlayer(generatePlayerId(), now)` on empty storage — `playerId` (anonymous install UUID via `crypto.randomUUID`) is generated **before any user action** and the home planet is claimed + persisted immediately.
- The onboarding step-0 Claim button (`Onboarding.tsx`) and `PlanetDisplay.tsx`'s hard-coded 🪐 "Home Planet" became a **reveal/celebration** of the already-assigned planet — the real claimed entry + generated identity, never the mechanism.
- Re-claiming on load is **idempotent**: same stored `playerId` → same planet, no double-claim.

---

## 4. Deterministic Assignment — hash → catalogue index

```
homeIndex = fnv1a("starbaron-claim-v1|" + playerId) % PLANETS.length
homeName  = PLANETS[homeIndex].name
```

- Reuses the zero-dep FNV-1a (`src/sim/planets/hash.ts`) with a **new claim-specific salt** `CLAIM_SALT = "starbaron-claim-v1"` — deliberately separate from the generator's `"starbaron-v1"` seed salt (`src/sim/planets/prng.ts`), so claim assignment and visual generation never interfere (salt-separation test).
- `claimIndexForPlayer` **validates input** (`RangeError` on empty/non-string `playerId`) and is in `[0, PLANETS.length)` for every input.
- **Keyed by catalogue `name`, not array index** — a save stores the name; `PlanetState` is derived on demand via `makePlanet(lookupByName(name))` (the same derive-on-demand, zero-storage pattern P2-T02 locked). A re-import can never silently re-point a save.
- **Spread, not guarantee** (the honest frame, §2 of audit): local claim = best-effort deterministic spread; real cross-player uniqueness is the P3 RLS `UNIQUE(planet_name)` on a server-side `claims` table, which `PlayerState` maps 1:1 into. The 50-id collision fixture pins the **current** spread — it asserts the fixture, not a hash property.
- **Colonise** = validated set-logic over the player's own claimed/colonised names: `colonise` rejects duplicates (double-claim prevention) and unknown/non-catalogue names (`RangeError`); `coloniseFirstUnclaimed` takes the lowest free catalogue index (decision D7). Pool exhaustion locally = test edge (6,321 planets vs one player), not a real path; real pool exhaustion is P3.

---

## 5. Wallet Promotion — UI → sim

The P1 game wallet (formerly `GameState` in `useGameState.ts:29-38`) was **promoted into the sim** (`src/sim/player/wallet.ts`), the flagged cross-layer refactor from audit §3/D1:

- `startWallet()` → `{ credits: 1_000, alloys: 0, population: 1_000, garrison: 0, fleet: 0 }` (matches P1 UI starters exactly).
- `walletAdd`/`walletSpend` are **pure + guarded**: finite-non-negative assertions on every delta; `walletSpend` throws `RangeError("insufficient funds…")` on a short balance and leaves the wallet untouched (transactional).
- `useGameState.ts` `project(player)` renders `PlayerState` into the existing `GameState` shape — **same field names**, so `PlanetView`/`ResourceBar`/`BuildMenu` churn is minimal (only the placeholder `tier: 1` and hard-coded home display were swapped for the claimed entry's real tier/name).

---

## 6. PvP Hooks — `isHome` / `unconquerable` / `claimedAt`

Ownership carries the three fields P3's conquest math reads (`ROADMAP.md` P3-T02/T03/T06) so P3 needs **no schema/field changes**:

| Field | Semantics (P3 reads this) |
|---|---|
| `isHome` | `true` only for `claims.claimedPlanetName` — DESIGN §5 line 127 (home unconquerable); derived at claim time, persisted denormalised |
| `unconquerable` | **`true` iff `isHome`** — the explicit flag P3-T06's home-planet attack rejection asserts; non-home planets are `conquerable` by default (DESIGN §5 line 123) |
| `claimedAt` | epoch ms of the claim — P3 attack-report / colony-timeline / shield-grace metadata |

**Not added** (P3 owns these): attack timers, garrison deployment, war-weariness, DP/AP state — the `garrison`/`fleet` wallet fields P3's deploy model reads already persist.

---

## 7. Save Migration — v1 → v2

`SaveGameV2` (`src/ui/save.ts:42`) restructures the persisted root: the placeholder `game` node becomes a `player: PlayerState` node (audit decision D2 — restructure, not additive). Keys: `starbaron.save.v1` (legacy) → `starbaron.save.v2`; `SAVE_SCHEMA_VERSION = 2`.

- **Stable playerId + synchronous write** (migration-stability finding F2, §10): `migratePlayerIdFromV1` derives a **stable** id from the v1 content fingerprint — `"migrated-" + fnv1a(MIGRATION_SALT + fingerprint).toString(36)` — never a fresh UUID per run. Repeated loads from the same (or duplicated) v1 storage yield the **identical playerId + home planet** (asserted across two independent `MemoryStorage` instances).
- `MIGRATIONS[1] = migrateV1ToV2` is the only entry; `migrateSave` loops forward while `version < SAVE_SCHEMA_VERSION` and is **idempotent by construction** (a v2 save passes through unchanged).
- The v1→v2 transform: creates `playerId` (stable-derived) + `claimedPlanetName` (via `claimHomePlanet(playerId)`), **drops** the placeholder `game.tier`, carries wallet/levels/lastTickAt 1:1, builds `homePlanet` with `isHome: true`/`unconquerable: true`/`claimedAt: savedAt`, carries tutorial/offlineSummarySeen (additive defaults when absent).
- **Synchronous write + tombstone** (crash-safe, P1-T04-A §2): `loadSave` on the v1 key → migrate → validate → `saveGame(...)` writes v2 and removes the v1 key **in the same call**, so a reload before any deferred save sees the migrated state (asserted).
- **Degenerate v1 never crashes**: `migrateSave`/`loadSave` tolerate empty/absent `game`/`tutorial`/`savedAt`/`schemaVersion` and always resolve to a defined `LoadResult` (`ok`/`corrupt`/`future`/`absent`); an empty `game` node resolves deterministically to `corrupt` (fresh-start path), never a throw.

---

## 8. Fabricated-Home Repair + Corrupt-v2 Handling

- **Repair** (`repairHomePlanetClaim` in `save.ts:362`): if a v2 save's `homePlanet.name !== claimHomePlanet(playerId).name`, the home is **repaired to the deterministic claim** and any colony holding that name is dropped (no home/colony twin). The repair is persisted on load.
- **Corrupt, not silently repaired**: a home that is a valid catalogue planet but carries **wrong flags** (`isHome`/`unconquerable` inconsistent), a **fabricated name not in the catalogue**, a tier/income/pop-cap **mismatch with the entry**, or a **duplicate claim** is rejected by `validateSave` **before any repair runs** → `{ kind: 'corrupt' }` (fresh + notice at the UI level, game stays playable).
- Corrupt-v2 matrix (finding F3, §10): wrong types (string wallet/playerId/lastTickAt, `schemaVersion: '2'`), null/missing structure, NaN through stringify/parse, raw `NaN` token, malformed legacy v1 key — all resolve to `corrupt`, never a crash. Lenient additive defaults (missing colony fields, non-finite `savedAt` → 0) are explicitly asserted as *not* corrupt.

---

## 9. Files

```
src/sim/player/
├── types.ts        # PlayerState / OwnedPlanet / WalletState
├── claim.ts        # claimIndexForPlayer, claimHomePlanet, colonise, firstUnclaimedByIndex, …
├── player.ts       # createPlayer, generatePlayerId, ownedPlanetIdentity, emptyStructureLevels
├── wallet.ts       # startWallet, walletAdd, walletSpend (guarded)
└── index.ts        # public exports
src/ui/save.ts             # SaveGameV2, MIGRATIONS[1], loadSave/saveGame, repairHomePlanetClaim
src/ui/useGameState.ts     # initialPlayer auto-claim, project() renders PlayerState, wallet/levels wired
src/ui/PlanetView.tsx / Onboarding.tsx / PlanetDisplay.tsx   # real claimed entry + reveal/celebration
tests/
├── claim.test.ts            # -B assignment determinism, salt separation, colonise, exhaustion
├── claims-deep.test.ts      # -C 100-call determinism, playerId edge cases, pool walk
├── player-save.test.ts      # -B/-C migration, stable id, synchronous tombstone, fabricated-home repair
├── player-wallet.test.ts    # -C wallet negatives, exact-balance, round-trip
├── save-migration-edge.test.ts # -C degenerate v1, repeated loads, wrong-flag corrupt, validate-before-repair
├── save.test.ts             # v2 validation matrix (mismatch/duplicates/bad wallet/levels)
├── save-corrupt.test.ts     # wrong-type + null/missing corrupt matrix, lenient additive defaults
├── savepersist.test.tsx     # -B/-C hook rehydration, first-boot auto-claim, corrupt-v2 notice
└── saveHelpers.ts           # makeSave (v2) / MemoryStorage / seedSave fixtures
```

---

## 10. Verification Results

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **25 files / 420 tests PASS** (exact, 2.75s) |
| Typecheck | `npx tsc -b` | **exit 0** |
| Build | `npm run build` | **exit 0** (892.38 kB JS, 236 ms) |
| Lint | `npm run lint` | **exit 0** (oxlint) |
| Drift gate | `node scripts/import-planets.mjs --check` | **OK (exit 0)** — `planets.ts` matches the pinned snapshot (untouched) |

## 11. Test Counts (exact, `--reporter=json`)

**25 files / 420 tests PASS** at closeout (was 420 as expected; growth +82 from the P2-T02 closeout base of 338).

| File | Tests |
|---|---|
| `tests/sim-purity.test.ts` | 46 |
| `tests/structures.test.ts` | 28 |
| `tests/savepersist-edge.test.tsx` | 26 |
| `tests/planetview-negative.test.tsx` | 24 |
| `tests/save-corrupt.test.ts` | 24 |
| `tests/save.test.ts` | 23 |
| `tests/planet-identity.test.ts` | 21 |
| `tests/planets-deep.test.ts` | 20 |
| `tests/savepersist.test.tsx` | 20 |
| `tests/import-planets-edge.test.ts` | 19 |
| `tests/structures-deep.test.ts` | 19 |
| `tests/claim.test.ts` | 17 |
| `tests/player-save.test.ts` | 17 |
| `tests/planets-edge.test.ts` | 17 |
| `tests/planets-model.test.ts` | 13 |
| `tests/format.test.ts` | 13 |
| `tests/economy.test.ts` | 10 |
| `tests/population.test.ts` | 10 |
| `tests/offline.test.ts` | 9 |
| `tests/planets.test.ts` | 9 |
| `tests/planetview.test.tsx` | 9 |
| `tests/save-migration-edge.test.ts` | 9 |
| `tests/claims-deep.test.ts` | 8 |
| `tests/player-wallet.test.ts` | 8 |
| `tests/showcase-generate.test.ts` | 1 |
| **Total** | **420** |

Growth: 338 (P2-T02 closeout) → **420**. New P2-T03 coverage: `claim.test.ts` +17, `claims-deep.test.ts` +8, `player-save.test.ts` +17, `player-wallet.test.ts` +8, `save-migration-edge.test.ts` +9, `sim-purity.test.ts` +10 (the 5 `src/sim/player/*.ts` modules joined the purity scan — 2 assertions each), expanded `save.test.ts` (+6 → 23), `save-corrupt.test.ts` (+4 → 24), `savepersist.test.tsx` (+3 → 20) = +82.

---

## 12. Codex Verdicts (per subtask)

| Subtask | Verdict |
|---|---|
| -A | **PASS** — audit scope/boundaries (auto-claim first boot, sim/player layer, hash assignment, PvP hooks, save v2 migration, D1–D8, exclusions) |
| -B | **PASS** — claim flow implementation (auto-claim, sim/player wallet, v1→v2 migration, colonise, 394 tests) |
| -C | **PASS** — negative-path + regression coverage (pool exhaustion, double-claim, corrupt-v2 matrix, migration stability, fabricated-home repair, wallet negatives) |
| -D | **PASS** — evidence + closeout |

Whole task: **P2-T03 Codex-PASSED**.

---

## 13. Findings Fixed (Codex review rounds)

| # | Finding | Resolution | Locked by |
|---|---|---|---|
| **F1** | **Migration stability** — a v1→v2 migration that minted a fresh UUID per run (or deferred the write) would re-assign the home planet on every reload before the first autosave, and a crash between migrate and write would lose the assignment | `migratePlayerIdFromV1` derives a **stable** id from the v1 content fingerprint (`"migrated-" + fnv1a(salt + fingerprint)`), and `loadSave` **writes v2 + tombstones v1 synchronously in the same call** — repeated and cross-storage loads yield identical `playerId` + home | `player-save.test.ts` (stable id; repeated v1 loads; same-call tombstone + reload), `save-migration-edge.test.ts` (repeated loads before any explicit save) |
| **F2** | **v2 validation gaps** — without deep validation a fabricated/corrupt home (wrong flags, catalogue mismatch, duplicate claims, tier/income mismatch) could pass as "ok" or trigger an inconsistent repair | `validateSave` (v2) enforces: `playerId` non-empty string; home name ∈ catalogue + entry match + tier/income/pop-cap derived from entry; `isHome`/`unconquerable` consistency; no duplicate claims (home or colony); wallet finite-non-negative; levels valid | `save.test.ts` (validation matrix), `save-corrupt.test.ts` (wrong-type + null/missing), `save-migration-edge.test.ts` (wrong-flag home is corrupt; validate-before-repair) |
| **F3** | **Fixture `??`-swallow** — `saveHelpers.makeSave` merged optional fields with `??`, so a deliberately-corrupt fixture (e.g. `homePlanet: undefined`, or a fabricated entry) could be silently swallowed into a valid default instead of exercising the corrupt path | Corrupt fixtures are built by **seeding the mutated save directly** (`seedSave`) rather than relying on `makeSave` overrides, and the corrupt-v2 matrix (wrong types, null/missing, NaN, raw NaN token, malformed legacy key) asserts `{ kind: 'corrupt' }` end-to-end | `save-corrupt.test.ts`, `save-migration-edge.test.ts`, `player-save.test.ts` (fabricated home not in catalogue → corrupt) |
| **F4** | **Corrupt-v2 coverage** — P1's corrupt matrix predated the v2 shape, so `player`-node corruption paths were untested at the UI level | v2 UI-level corrupt handling added: fresh start + notice, game stays playable | `savepersist.test.tsx` (v2 corrupt notice), `save-corrupt.test.ts` |

**Spurious findings disproven:** a Codex review round misread a **stale fixture** — it flagged that a `makeSave({ player: { homePlanet: … } })` override couldn't produce a fabricated-home fixture, attributing the corruption to a test bug. On re-audit the fixture was current: the fabricated-home cases *already* used direct `seedSave` (F3), and the disputed `??`-merge only applied to *valid* override construction, not the corrupt fixtures. The finding was disproven by reading the shipped test bodies; no code change resulted.

---

## 14. Branch / Remote State

- Branch: `staging` (no work on `main`).
- No push, no tag, no deploy — remote unchanged pending authorisation.
- Working tree clean after this closeout commit.

---

*Prepared by OpenCode (deepseek-v4-flash) for P2-T03-D. Only `docs/P2_T03_EVIDENCE.md` + ROADMAP.md changed in this subtask.*
