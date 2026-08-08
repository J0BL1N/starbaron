# P3-T01-A — Supabase Schema Audit (shared universe, real uniqueness via RLS, async PvP)

> **Historical `-A` snapshot (2026-08-09).** This document is the *planning* audit that bounded subtask `-B`: it records the target DDL, decisions D1–D12 and exclusions **as designed**. The implemented schema now lives in **`supabase/migrations/` (`0001`–`0006`, unapplied, forward-only)** — see §7 for the migration map; the working-tree migrations are the source of truth for what is built, and this audit's target DDL blocks should be read against them. Migration files remain unapplied (no provider contact); editing them is the intended `-B`/`-C` workflow.

*Subtask `-A` for **P3-T01 Supabase schema** (Phase 3 — Supabase Backend + Async PvP). Documentation-only audit at the time it was written. Nothing implemented, nothing linked to Supabase, no migrations written or applied, nothing committed, no work on `main`. Scope grounded in DESIGN.md §4b (assignment/uniqueness — "REAL uniqueness via P3 RLS"), §4a/§4c/§4d (population war currency, structure roster, economy numbers), §5/§5a (conquest math, band-together, fortification, travel, draft tunables), §5b (meta: leaderboards/seasons/notifications/revenge), §6 (anti-grief), `docs/P2_PHASE2_EVIDENCE.md` (sim state: `PlayerState`, `OwnedPlanet`, per-planet grids, shared wallet), ROADMAP.md P3-T01…P3-T06 rows, and the Supabase CLI skill (`supabase-cli-project-ops`, incl. the StarBaron environment reference), all verified at HEAD `6fa09a9` on `staging` (working tree clean).*

---

## 1. Schema Design — tables, columns, types, mapped to the sim

### 1.1 What exists today (verified at HEAD)

The sim's state shapes (all pure TS, vitest-locked, client-side) are the contract the schema must mirror:

| Sim type | Location | Shape |
|---|---|---|
| `PlayerState` | `src/sim/player/types.ts:23-30` | `playerId: string`, `homePlanet`, `colonies[]`, `wallet`, `structureLevels: Record<string, StructureGrid>`, `lastTickAt` |
| `OwnedPlanet` | `src/sim/player/types.ts:9-21` | `name`, `entry: PlanetCatalogueEntry`, `tier`, `baselineIncomePerSec`, `populationCapMultiplier`, `claimedAt`, `isHome`, `unconquerable`, `population`, `garrison`, `fleet` |
| `StructureGrid` | `src/sim/player/types.ts:23` | `Record<StructureId, number>` — **fixed 7 keys** (`src/sim/structures/data.ts:4-12`): `oreMine, tradeHub, housing, hydroponics, barracks, shipyard, defenseTurret` |
| `WalletState` | `src/sim/player/types.ts:4-7` | `{ credits, alloys }` — ONE shared empire wallet (P2-T04 decision D1) |
| `PlanetCatalogueEntry` | `src/sim/data/planets.ts:7-16` | `name, hostname, systemCount, radiusEarth?, massJup?, starType?, distancePc?, tier` — 6,321 real planets, **client-side** (`PLANETS`) |

Per-planet economy: `computePlanetDerived` (`src/sim/player/accrual.ts:61-111`) derives credits/alloys/pop/garrison/fleet/defense per planet (quirks + tier cap + `effectiveLevel` applied); `accruePlayer` (`accrual.ts:157-190`) sums all owned planets into the shared wallet, per-planet pop/garrison/fleet accrue locally. Claim is deterministic + client-only today: `claimIndexForPlayer` = `fnv1a("starbaron-claim-v1"|playerId) % PLANETS.length` (`src/sim/player/claim.ts:19-26`, `fnv1a` at `src/sim/planets/hash.ts:4-11`). **No cross-player uniqueness exists yet** — two local saves can own the same planet name. P3's whole job: make ownership real.

### 1.2 Sim → table mapping

| Sim construct | Server table | Notes |
|---|---|---|
| `PlayerState.playerId` / `WalletState` | `players` | `id` **= `auth.uid()`** (the identity); wallet (`credits`, `alloys`) lives here — it is empire-wide (§1.4) |
| `OwnedPlanet` (home + colonies) | `owned_planets` | one row per owned planet; `owner_id` FK `players`; `planet_name` globally **UNIQUE** = the P3 uniqueness promise |
| `StructureGrid` (per planet) | `owned_planets.structure_levels` | **JSONB**, §1.3 |
| `OwnedPlanet.entry.distancePc` | `owned_planets.distance_pc` | denormalised catalogue field — the server needs it for travel time (§5.2); client catalogue provides it at claim |
| `OwnedPlanet` derived fields (`baselineIncomePerSec`, `populationCapMultiplier`, `tier`) | `owned_planets` | cached at claim (sim-computed values), so the server can run resolve math without the catalogue |
| Planet quirks / visual / description | — | stay **client-side** (deterministic generator, `makePlanet(entry).generate()`). Only the two combat-relevant quirks (`massiveWorld`, `denseCore`) reach the server — as CLIENT-PROVIDED boolean **flag columns** (`massive_world`, `dense_core`) on `owned_planets` (D4 quirk trust model); the multiplier VALUES are enforced server-side from the `game_config` balance seed (§5.2 / §5.3, D4), so a spoofed flag can only mislabel a planet, never inject a value |
| Attack lifecycle (§5a) | `attacks` + `attack_members` | §5 |
| Meta (§5b) | `notifications`, `seasons`, `leaderboard_snapshots` | §5b / §1.4 |
| PvP draft tunables | `game_config` (key/value) | recommended, D9 |

### 1.3 Structure grids: **JSONB (recommended)** vs normalized rows

**Recommendation: `owned_planets.structure_levels JSONB`** holding `{"oreMine": 3, "tradeHub": 1, …, "defenseTurret": 0}` — the exact `Record<StructureId, number>` shape.

| Criterion | JSONB (recommended) | Normalized `planet_structures` rows (7/planet) |
|---|---|---|
| **Grid size** | Fixed **7 keys** of small integers — tiny by construction (DESIGN §4c roster is LOCKED at 7, §4d unlimited levels = just bigger integers) | 7 rows per planet, each one an integer |
| **Read pattern** | The sim consumes the whole grid atomically (`computePlanetDerived` reads all 7 effects; `gridForPlanet` returns the object) — **no relational queries on structure rows exist or are designed** (no "which planets have Ore Mine ≥ 20" anywhere in DESIGN) | Relational value unrealised in v1 |
| **Write atomicity** | JSONB update is **atomic** — matches the sim's immutable spread-copy pattern (`buildStructure` writes a fresh grid, `src/sim/player/accrual.ts:215-235`) | Multi-row UPDATE needs a transaction for the same atomicity |
| **Conquest transfer (DESIGN §5 line 129 LOCKED)** | Transfer = **one** `UPDATE … SET structure_levels = structure_levels - 'defenseTurret'` on the conqueror's new row — turret teardown is a single JSONB operator | Delete 7 + reinsert 6 rows + a join |
| **Validation** | RPC + optional CHECK (`jsonb_typeof = 'object'`, keys ⊆ the 7 ids, integer levels ≥ 0) | CHECK per column simpler, but the shape is fixed anyway |
| **TradieHubAU precedent** | **Yes — the established pattern** in the sibling repo: JSONB for structured/nested payloads validated inside SECURITY DEFINER RPCs (`040_message_attachments_foundation.sql` attachments, `071_itemised_variation_requests.sql` line items; `jsonb_typeof` checks; `REVOKE ALL … FROM PUBLIC, anon` + `GRANT EXECUTE … TO authenticated, service_role`) | — |

Normalized rows buy joins StarBaron has no query for, at the cost of a bigger conquest transfer. **JSONB is the right call for a fixed 7-key grid.** It is also exactly what the skill's guidance allows ("JSONB is fine for small grids").

### 1.4 Table definitions (target DDL — for the `-B` migration set, NOT applied here)

```sql
-- players: identity + the ONE shared wallet (P2-T04 D1). id = auth.uid().
create table public.players (
  id               uuid primary key references auth.users (id) on delete cascade,
  display_name     text not null default '',
  credits          double precision not null default 1000 check (isfinite(credits) and credits >= 0),   -- STARTER_CREDITS; NaN/±∞ rejected
  alloys           double precision not null default 0    check (isfinite(alloys) and alloys >= 0),      -- STARTER_ALLOYS; NaN/±∞ rejected
  last_seen_at     timestamptz not null default now(),
  created_at       timestamptz not null default now()                             -- new-player shield (3d) derived from this
);
-- new-player shield: computed (created_at + interval '3 days'), NO column (D10).

-- owned_planets: one row per owned planet. planet_name UNIQUE = REAL uniqueness.
-- Quirk trust model (D4): the combat-relevant quirk FLAGS (massive_world →
-- defense × massive_world_multiplier at resolve; dense_core → housing pop-cap
-- × dense_core_multiplier in the P3-T05 accrual path) are CLIENT-PROVIDED at
-- claim; the server enforces the multiplier VALUE authoritatively from
-- game_config at resolve, so a spoofed flag can only mislabel a planet.
create table public.owned_planets (
  id                          bigint generated always as identity primary key,
  owner_id                    uuid not null references public.players (id) on delete cascade,
  planet_name                 text not null,
  tier                        smallint not null check (tier between 1 and 5),
  baseline_income_per_sec     double precision not null check (isfinite(baseline_income_per_sec) and baseline_income_per_sec >= 0),   -- 10 × tier at claim (DESIGN §4d); NaN/±∞ rejected
  population_cap_multiplier   double precision not null check (isfinite(population_cap_multiplier) and population_cap_multiplier > 0),  -- tier table §4d; NaN/±∞ rejected
  distance_pc                 double precision check (distance_pc is null or (isfinite(distance_pc) and distance_pc >= 0)), -- catalogue, denormalised (travel time, §5.2); NaN/±∞ rejected
  claimed_at                  timestamptz not null default now(),
  is_home                     boolean not null default false,
  unconquerable               boolean not null default false, -- = is_home at claim (DESIGN §5 "unconquerable home")
  massive_world               boolean not null default false, -- combat quirk flag (D4): DP × massive_world_multiplier at resolve (§5.3)
  dense_core                  boolean not null default false, -- combat quirk flag (D4): housing pop-cap × dense_core_multiplier (P3-T05 accrual)
  population                  double precision not null default 0 check (isfinite(population) and population >= 0),
  garrison                    double precision not null default 0 check (isfinite(garrison) and garrison >= 0),
  fleet                       double precision not null default 0 check (isfinite(fleet) and fleet >= 0),
  structure_levels            jsonb not null check (jsonb_typeof(structure_levels) = 'object') -- Record<StructureId, number> (§1.3)
);
create unique index owned_planets_name_unique  on public.owned_planets (planet_name);
create unique index owned_planets_one_home_idx on public.owned_planets (owner_id) where is_home;
create index owned_planets_owner_idx           on public.owned_planets (owner_id);
```

The **two uniqueness indexes are the P3 RLS promise made physical**:
- `owned_planets_name_unique` — at most ONE owner per real planet, ever (conquest = `UPDATE owner_id`, never a duplicate row).
- `owned_planets_one_home_idx` — each player has at most one home planet (the unconquerable one).

```sql
-- attacks: the async lifecycle. status/outcome as text+CHECK (D7, not enums).
create table public.attacks (
  id                  uuid primary key default gen_random_uuid(),
  target_planet_name  text not null references public.owned_planets (planet_name),
  launcher_id         uuid not null references public.players (id),
  status              text not null default 'inbound' check (status in ('inbound','resolved')),
  outcome             text check (outcome in ('decisive','pyrrhic','repelled','crushed')),
  winner_id           uuid references public.players (id),
  launched_at         timestamptz not null default now(),
  join_window_seconds int  not null default 7200             check (join_window_seconds > 0),    -- DESIGN §5 "launch window (e.g. 2h)"
  travel_seconds      int  not null                          check (travel_seconds between 600 and 172800), -- distancePc × 1 min, floor 600, cap 172800 (§5.2)
  resolves_at         timestamptz not null,
  resolved_at         timestamptz,
  attack_report       jsonb                                   -- full report: who/what/when, casualties, survivors (DESIGN §5)
);
create index attacks_target_idx   on public.attacks (target_planet_name) where status = 'inbound';
create index attacks_launcher_idx on public.attacks (launcher_id);
create index attacks_due_idx      on public.attacks (resolves_at) where status = 'inbound';  -- lazy resolve scan

-- attack_members: band-together joins (DESIGN §5 "multiple players can join … one target").
create table public.attack_members (
  attack_id          uuid not null references public.attacks (id) on delete cascade,
  player_id          uuid not null references public.players (id),
  soldiers_committed double precision not null check (isfinite(soldiers_committed) and soldiers_committed > 0),  -- permanent war cost (§4a); finite+positive (NaN/±∞/0 rejected)
  shipyard_tier      smallint not null check (shipyard_tier between 0 and 100),  -- AP = soldiers × shipyard tier (§5a) — snapshot at join
  joined_at          timestamptz not null default now(),
  primary key (attack_id, player_id)
);

-- notifications: §5b v1 kinds (under attack / invasion landed / planet fell / attack result / revenge).
create table public.notifications (
  id         bigint generated always as identity primary key,
  player_id  uuid not null references public.players (id) on delete cascade,
  kind       text not null check (kind in ('under_attack','invasion_landed','planet_fell','attack_result','revenge')),
  payload    jsonb not null default '{}'::jsonb,              -- attack_id, planet_name, actor_id, casualties…
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index notifications_player_idx on public.notifications (player_id, read_at);

-- seasons + leaderboard_snapshots: §5b meta (schema now, population mechanics = P4-T01).
create table public.seasons (
  id         bigint generated always as identity primary key,
  name       text not null,
  started_at timestamptz not null,
  ends_at    timestamptz
);
create table public.leaderboard_snapshots (
  id          bigint generated always as identity primary key,
  season_id   bigint references public.seasons (id),          -- NULL = all-time
  player_id   uuid not null references public.players (id),
  score       double precision not null,                      -- metric TBD at P4-T01 (D6)
  rank        int,
  snapshot_at timestamptz not null default now()
);

-- game_config: draft tunables as DATA not migrations (§5.2, D9).
create table public.game_config (
  key   text primary key,
  value jsonb not null
);
```

### 1.5 Numeric types — `double precision` (recommended)

The sim runs JS numbers end-to-end (fractional credits/alloys/pop from `accruePlayer`; `format.ts` rounds for display). Postgres `numeric` serialises through the Supabase JS client as **strings**, forcing a parse on every field on every read — a constant tax for a game currency with no financial precision requirement. Recommend `double precision` for wallet/rates/pop/garrison/fleet/scores, `smallint` for tier + shipyard_tier + structure levels (levels are integers; JSONB stores them as numbers). Every non-NULL `double precision` column gets an `isfinite(col) and col >= 0` / `isfinite(col) and col > 0` CHECK (NaN/±∞ pass a bare `>= 0` / `> 0` in PostgreSQL, so the finite guard is required); NULLABLE `double precision` columns keep the null-or pattern (`col is null or (isfinite(col) and col >= 0)`), matching `distance_pc` below. Guards stay where the sim asserts non-negativity (`wallet.ts`). (D6.)

---

## 2. Auth Model — anonymous sign-in for v1 (recommended)

**Recommendation: Supabase anonymous sign-in (`signInAnonymously()`), one-click, zero friction — the DESIGN onboarding hook ("claim your planet" in 10 seconds, §5c) with no email wall. Optional email/phone link arrives later without losing the user.**

| Consideration | Anonymous (recommended) | Email signup for v1 |
|---|---|---|
| Onboarding friction | None — claim hook lands immediately | Credential wall before the hook; mobile-first idle players bounce |
| `playerId` mapping | `players.id = auth.uid()` — the anonymous user **has a stable uuid from creation** | same mapping, but blocked on signup |
| Path to a real account | **Verified: the uid is preserved.** Supabase's `linkIdentity`/email-confirmation flow upgrades an anonymous user to a registered one **in place** (`internal/api/identity.go` clears `IsAnonymous` on the *same* target user; the same in `verify.go` on email/phone confirmation) — so all RLS-owned rows, planets and history follow the user | n/a |
| Data loss risk | Anonymous users can be cleaned up by platform policy if the project's anonymous retention is configured that way — the email link closes the gap, and v1 has no identity to lose (D2) | none |

**`playerId` → `auth.uid()`:** the sim's `generatePlayerId()` (`src/sim/player/player.ts:8-14`) is a client randomUUID used to key the local save. In P3 the authoritative id is `auth.uid()`; the client save becomes a **cache of server state keyed by uid**. Pre-P3 local saves: **do not carry to the server** (the game is pre-launch, no live audience) — either start fresh on first server connect or adopt-on-first-connect (recommended: **adopt**, client uploads its current `PlayerState` once, server validates + inserts; scoped to P3-T02, D8).

**The P2 auto-claim becomes a server RPC with uniqueness ENFORCED** (the P3 promise): the client's deterministic `fnv1a("starbaron-claim-v1"|playerId) % catalogue` already picks a stable candidate name; the client proposes that name to `claim_home_planet(planet_name)` and the **server is the arbiter** — first claim wins, others get a clean conflict and advance to the next candidate. No client trust, no duplicate ownership (§4).

`anon` vs `authenticated`: with anonymous sign-in, every real player is `authenticated` (they hold a JWT + uid). The `anon` role is only the pre-sign-in public role and is granted **nothing** in this schema (the catalogue is client-side, so there is no public read surface). `service_role` bypasses RLS and is **never** exposed to the client — no GRANT to `anon`, the service key never ships in the bundle or repo (§3, §7).

---

## 3. RLS Strategy

### 3.1 Role posture

| Role | What it is | Posture |
|---|---|---|
| `anon` | unauthenticated public | **No table grants at all** (nothing public to read; catalogue is client-side). Deny by default. |
| `authenticated` | every signed-in player (incl. anonymous-auth users) | Row-gated SELECT; **no direct INSERT/UPDATE/DELETE on state tables** — all writes go through SECURITY DEFINER RPCs (claim/colonise/launch/join/resolve/build/accrue) that enforce rules atomically |
| `service_role` | server-side only (Edge Functions / jobs) | Bypasses RLS by definition; key held server-side only, never in the client bundle, never committed. No policy relies on it |

This is the TradieHubAU grant discipline verbatim: `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION … TO authenticated, service_role;` (e.g. migration `071`).

### 3.2 Policy matrix (per table)

| Table | SELECT (authenticated) | Write |
|---|---|---|
| `players` | **own row only** (`auth.uid() = id`) | `credits`/`alloys` mutate only inside RPCs (definer) |
| `owned_planets` | **all rows** — the shared universe + DESIGN §5 full-info scouting ("attackers see the defender's defenses + estimated odds"). Galaxy map renders from this; there is no hidden planet state | INSERT/UPDATE via claim/colonise/build/conquest RPCs only |
| `attacks` | launcher OR member OR target owner: **always**. Additionally, `status='inbound'` attacks visible to all authenticated — coordination IS the band-together mechanic (people must see a forming attack to join it) | INSERT via `launch_attack`; UPDATE via `join_attack` / `resolve_due_attacks` (definer) |
| `attack_members` | **own rows only** (`auth.uid() = player_id`) — participants and the target owner are NOT exposed through the table; full member details (player_id, commitment, AP, losses) surface post-resolve in the `attack_report` payload | INSERT via `join_attack` |
| `notifications` | **own rows only** (`auth.uid() = player_id`) | INSERT from attack RPCs; UPDATE (mark `read_at`) on own rows |
| `seasons` | all authenticated | service_role/admin |
| `leaderboard_snapshots` | all authenticated (leaderboard is public) | service_role (job, P4-T01) |
| `game_config` | no client read (server-side tunables; the client needs the resolved values only via RPC responses) | service_role only |

### 3.3 The claim concurrency-safe pattern (the P3 uniqueness guarantee)

Three layers, each stronger than the last:

1. **Unique indexes as the hard guarantee** (§1.4): `owned_planets_name_unique` (one owner per planet) and `owned_planets_one_home_idx` (one home per player) — the database refuses a duplicate no matter how RPCs race.
2. **`pg_advisory_xact_lock`** keyed on `hashtextextended(planet_name, 0)` inside the claim RPC's transaction: a second claimant **waits** for the first to commit, then re-checks and sees the planet taken → clean structured conflict instead of a `23505` exception. Deterministic ordering, no spurious errors, no lost updates.
3. **`SELECT … FOR UPDATE` on the target row** in both resolve **and launch** — only one resolution/launch proceeds per attack/planet; the loser reads the committed result (§5.3).

Policy example (illustrative, lands in `-B`):

```sql
create policy "players_own_row"
  on public.players for select to authenticated
  using (auth.uid() = id);

create policy "owned_planets_shared_universe"
  on public.owned_planets for select to authenticated
  using (true);

create policy "attacks_participants_and_open"
  on public.attacks for select to authenticated
  using (
    auth.uid() = launcher_id
    or auth.uid() = (select owner_id from public.owned_planets where planet_name = attacks.target_planet_name)
    or auth.uid() in (select player_id from public.attack_members where attack_id = attacks.id)
    or status = 'inbound'
  );
```

> Skill pitfall to honour in `-B`: fully qualify outer-row refs inside policy `EXISTS`/subquery quals (`attacks.target_planet_name`, not a bare `planet_name`) — unqualified refs bind inner scope and silently drop rows.

---

## 4. Claim / Colonise RPCs — `claim_home_planet()`, `claim_colony()`

Both are `SECURITY DEFINER`, `VOLATILE`, `SET search_path = public, pg_temp`, revoke-from-PUBLIC/anon, grant EXECUTE to `authenticated`. Both enforce uniqueness in a **transaction** (§3.3). Return the claimed planet as **OwnedPlanet JSON** (snake_case keys, camelCase mirrored client-side at hydration, D8) so the client can build its local state from the server's authoritative row.

### 4.1 `claim_home_planet(p_planet_name text) returns jsonb`

1. `me := auth.uid()`; if NULL → raise `insufficient_privilege` (definer functions still need the auth guard).
2. **Idempotent:** if the caller already owns `is_home = true`, return that row's JSON. Re-boots/re-claims are safe, and because the client's candidate is deterministic (`fnv1a(…|playerId)`), the same player proposes the same name forever → the server's answer is stable.
3. `SELECT pg_advisory_xact_lock(hashtextextended(p_planet_name, 0))`.
4. Re-check: `SELECT 1 FROM owned_planets WHERE planet_name = p_planet_name` → found → return `{"claimed": false, "reason": "planet_taken"}` (client advances to the next catalogue index — its own `firstUnclaimedByIndex` logic (`claim.ts:83-93`) already iterates).
5. `INSERT … (owner_id = me, planet_name, tier, baseline_income_per_sec, population_cap_multiplier, distance_pc, is_home = true, unconquerable = true, population = 1000, garrison = 0, fleet = 0, structure_levels = '{"oreMine":0,…, "defenseTurret":0}')` (starters from `src/sim/player/wallet.ts:3-5`; empty grid from `src/sim/player/grid.ts`).
   - `tier`, `baselineIncomePerSec` (= `10 × tier`, DESIGN §4d), `populationCapMultiplier` (tier table §4d) and `distancePc` come from the **client-proposed catalogue entry** (`p_planet_name` looked up client-side, derived values passed as arguments or re-derived server-side from `tier` + a small constant map). The unique index + advisory lock are the integrity line, not the values' provenance (D3).
   - The one-home partial index backstops layer 2 if two homes race.
6. Return `to_jsonb` of the inserted row (shape = sim `OwnedPlanet`).

**Why client-proposed, not server-picked:** the 6,321-planet catalogue stays client-side (D3, §7). A server-picked assignment would require the catalogue (or a 6,321-row seed). The client's deterministic index is preserved as the proposal mechanism; the **server's unique index is the real uniqueness** — exactly the P3 RLS promise the P2 best-effort claim lacked.

### 4.2 `claim_colony(p_planet_name text) returns jsonb`

Same skeleton, with additional guards:
- Caller must already have a home planet (else raise) — colonise happens after the onboarding claim.
- `is_home = false`, `unconquerable = false` (DESIGN §5 "any planet except your home planet can be taken"), `population = 0` (P2-T04 D6: fresh colony = empty, grows at base rate).
- Same advisory lock + unique-index backstop; taken planets → structured conflict.
- Colony count / cost / cooldown: **no DESIGN-locked limits** (P2-T04 §5 excluded colonise cost; timeline day 1–2 is a design target, not an enforced number). No cap in v1 (D11).

---

## 5. Attack Lifecycle — tables, tunables → server checks, resolution

### 5.1 Lifecycle (async, OGame model, DESIGN §5/§5a)

`launch_attack` (forming + travelling) → `join_attack` (band-together, ≤ 2h window) → `resolve_due_attacks` (lazy, §5.3) → full report + notifications.

### 5.2 PvP draft tunables → server checks (DESIGN §5a table)

| Knob (draft value) | Where it becomes a server check |
|---|---|
| **Travel time** `distancePc × 1 min`, floor 10 min, cap 48h | At launch: `travel_seconds := LEAST(GREATEST(round(distance_pc * 60), 600), 172800)`; `resolves_at = now() + travel_seconds`. `distance_pc` read from `owned_planets.distance_pc` (§1.2) |
| **Launch cost** `200 cr + fleet × 0.2 cr + distancePc × 10 cr` | In `launch_attack`, transactionally: check + deduct `players.credits` (insufficient funds → raise). Alloy cost = 0 for launch (alloys fund defenses) |
| **War-weariness** `+20% required force per conquest within 24h`, resets daily | Derived, no column: `count(*)` of the launcher's `attacks` launched in `now() - interval '24 hours'`; threshold inflation `1.2^count` applied at **resolve-time** (the force *required* inflates; the committed force is unchanged). Enforcement location = P3-T05 detail; the schema already supports it (D11) |
| **AP = soldiers × Shipyard tier** (§5a) | Combined at resolve: `Σ(members.soldiers_committed × members.shipyard_tier)` — `shipyard_tier` is snapshotted per member at join (`attack_members`) so later upgrades can't retro-buff a committed attack |
| **DP = turrets × 500 + pop × 0.15** (+ `effectiveLevel` half-after-10, `massiveWorld` quirk) | At resolve, from the target's `owned_planets` row: `structure_levels->>'defenseTurret'` (via `effectiveLevel`) + `population × 0.15`. **Quirk wrinkle:** `massiveWorld`/`denseCore` alter DP/pop-cap — the quirk FLAGS are client-provided booleans on the row (`massive_world`, `dense_core`, D4 trust model), but the multiplier VALUES are enforced server-side from the small `game_config` balance seed (§5.3 / D4), so a spoofed flag can only mislabel a planet |
| **Band-together** "APs COMBINE against the defender's FIXED, unchanged DP" | Combined AP vs the **unchanged** DP — no per-attacker defender scaling (Jay REJECTED the +25%/attacker idea; `starbaron-environment.md`) |
| **Outcome table** (≥1.5 decisive / 1.0–1.5 pyrrhic / 0.75–1.0 repelled / <0.75 crushed) + casualty % | Resolve function applies the exact DESIGN §5a table (40%/70%/60%/90% attacker losses; defender planet+pop+turrets on decisive/pyrrhic, 30% pop on repelled) |
| **Fortification ceiling** "repel up to 10× own defended strength" | The cap emerges from the ratio math + turret alloy cost curve (P3-T05); schema stores levels, the sim does the curve. No column |
| **Anti-grief** — home safe, new-player shield (3 days), full report | `attacks.unconquerable` target → launch rejected; shield = `target.owner.created_at + 3 days` derived (D10); `attacks.attack_report` JSONB holds the who/what/when report for the loser (§6 DESIGN) |

### 5.3 Resolution: **DB function + lazy on-read** (recommended), not Edge Function, not cron

**Recommendation:** a `SECURITY DEFINER` `resolve_due_attacks()` (and an internal `resolve_attack(attack_id)`) — a pure Postgres function, intended to be invoked lazily at the top of read RPCs (`get_galaxy_state`, `get_attack`, login sync — those read RPCs are **not part of this migration set** and their lazy-invoke wiring is pending `-C` contract/integration verification) — the idle-genre standard. **As implemented in `0005`:** `resolve_due_attacks` resolves every due attack regardless of the caller (side-effects are never skipped), but response-gates each report to the attack's launcher / original target owner / an attack member; `service_role` receives the full report list — an authenticated caller can never read another player's resolve report through the lazy-resolve path.

| Criterion | DB function (recommended) | Edge Function | `pg_cron` |
|---|---|---|---|
| **Atomicity** | One transaction: outcome → casualties → planet transfer (`UPDATE owner_id` + grid minus `defenseTurret`) → notifications → report → `status='resolved'`. No partial states possible | Edge cold start + separate DB txn; two-step (HTTP → DB) widens the partial-state window | Same DB atomicity, but on a timer |
| **Cold start / latency** | None — runs inside the request | Cold starts on every resolve scan (free tier) | n/a |
| **Free-tier friendliness** | No background worker guarantee needed — work happens only when a client asks | Fine but unnecessary | `pg_cron` exists on Supabase but adds a timer to babysit for zero v1 need |
| **Concurrency** | `SELECT … FOR UPDATE` on the due `attacks` rows inside the function — two clients racing the same resolve: one wins, the other re-reads `resolved` and applies no changes | Two functions racing = must re-enter DB with the same lock discipline anyway | Single scheduler is safe but reintroduces the worker question |
| **Idle-genre fit** | **Intended — results consistent with what's displayed** (pending `-C` contract/integration verification: the resolve functions ship in this migration set, but no read RPC that invokes `resolve_due_attacks` on-read is implemented here, so "always consistent with what is displayed" is design intent, not yet established); once a read RPC invokes `resolve_due_attacks()` on-read, the client will see the outcome in the same round trip; no "pending until a cron fires" state | Displays can be stale until an async job lands | Displays can be stale; server ticks are the wrong tool for a "check in when you log in" genre |

The lazy-on-read pattern also matches the skill's operational reality: the CLI/MCP can prove correctness with contract tests (begin→invoke→assert→rollback), and no external scheduler is a dependency to keep alive.

**Conquest transfer (DESIGN §5, §5a):** decisive/pyrrhic → target row's `owner_id := winner`, `is_home := false`, `unconquerable := false`, `structure_levels := structure_levels - 'defenseTurret'` (Turrets destroyed in the fall — the LOCKED rule), population replaced by the conqueror's fresh-settlement defaults (P2-T04 D6), `claimed_at := now()`. Loser keeps home + any other planets (§5). The planet_name stays the SAME row — the unique index is untouched, so the "one owner per planet" guarantee holds across conquests. Winner = the highest-committing member (§5 band-together); `winner_id` recorded; retake allowed (DESIGN §5 defaults) because nothing marks a taken planet special.

---

## 6. Exclusions (bounded for P3-T01 / Phase 3 v1)

| Excluded | Why |
|---|---|
| **Payments / IAP / premium currency** | Phase 4 (P4-T03). No Stripe, no purchase columns |
| **Real-time websockets / Realtime presence** | DESIGN §3 PvP is **async** — "NO real-time servers". `Realtime` not used |
| **Galaxy-map rendering** | Client-side (canvas/DOM). Server only stores the shared state the map renders |
| **Chat / diplomacy / alliances** | DESIGN §5b "Later (v1.1+)". No message tables |
| **The 6,321-planet catalogue as a server table** | D3: catalogue stays client-side; server stores claimed refs + derived fields only |
| **Offline-first sync engine / conflict resolution / queue** | D8: v1 = write-through RPCs; the client save is a cache. A full offline queue is post-v1 |
| **Adoption of pre-P3 local saves** | D2: the game is pre-launch; no audience to migrate. Either fresh start or adopt-on-first-connect (P3-T02) |
| **Leaderboard mechanics / season rotation logic** | Schema-only here; population + rotation = P4-T01 (D6) |
| **Notifications delivery (push/FCM)** | P4-T02. Schema + in-app row insertion now; delivery later |
| **Structure-build RPC, offline-accrual RPC, shield purchase** | Implied by the schema (wallet + grid + derived timestamps) but implemented in P3-T02/T03/T05/T06 |
| **Balance tuning** | Draft tunables go into `game_config` as data; Jay audits values at playtest (D9) |

---

## 7. Migrations Plan — forward-only, numbered, no catalogue seed

Per the skill: `supabase init` + `supabase link --project-ref ogsleukfykumxsyvyusz` inside the repo happens **only at `-B` after Jay authorises** (this audit touches nothing). Forward-only, never edit an applied migration, `db push --dry-run` first, `supabase_migrations.schema_migrations` is the source-of-truth ledger, header comment on every file (purpose · idempotent? · date · scope), RLS + grants **in the same migration as the table they protect**.

| Migration | Contents | RLS/grant carried |
|---|---|---|
| `0001_players_owned_planets.sql` | `players`, `owned_planets`, both uniqueness indexes, derived-field CHECKs | RLS on both; SELECT policies; REVOKE anon/PUBLIC; GRANT SELECT to authenticated. |
| `0002_meta_tables.sql` | `notifications`, `seasons`, `leaderboard_snapshots` (needed by later RPCs) **and `game_config` (table + RLS)** — the table is created HERE so 0005's SQL-language attack RPCs (bodies validated at creation) can reference it; the seed data lives in 0006 | RLS + grants per §3.2; `game_config` service_role-only read |
| `0003_claim_rpcs.sql` | `claim_home_planet`, `claim_colony` (SECURITY DEFINER, advisory lock, OwnedPlanet JSON) | REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated |
| `0004_attacks_members.sql` | `attacks`, `attack_members`, due/join indexes, CHECKs | RLS per §3.2 |
| `0005_attack_rpcs.sql` | `launch_attack`, `join_attack`, `resolve_due_attacks` (travel/cost/weariness checks, planet transfer, notifications) | EXECUTE grants |
| `0006_game_config_seed.sql` | seed of the draft tunables **and the small combat-balance constants** (structure base effects, turret/DP coefficients, `effectiveLevel` half-after-10, `massiveWorld`/`denseCore` multipliers) — the server-authoritative resolve math (D4). **Seed DATA only, no DDL** — the `game_config` table + RLS live in 0002 (0005's SQL-language functions are validated at creation and need the table to pre-exist) | — (grants carried by 0002) |

**Seed data decision — catalogue NOT replicated (recommended for v1):** the 6,321-row catalogue stays in `src/sim/data/planets.ts` (client). The server stores only claimed refs (`owned_planets.planet_name` + derived fields) and a **~10-row balance seed**, avoiding a 6,321-row migration and a second source of truth for the catalogue.

- **Tradeoff (flag for Jay):** the server cannot validate that a claimed `planet_name` is a *real* catalogue planet — it can only enforce *uniqueness*. A malicious client could register a junk name. Impact: cosmetic junk planets, not duplicate ownership (the P3 promise holds). Mitigations, in ascending cost: (a) accept for v1; (b) a `game_config`-style allow-list seed of "reserved" names; (c) full catalogue seed later (`0007_planets_catalogue.sql`) if server-side validation or server-driven assignment is ever wanted.
- **Drift guard (recommended):** a build-time test (`tests/balance-drift.test.ts`) asserts the `game_config` seed matches the sim constants in `src/sim/**` (turret DP coefficient, `effectiveLevel`, quirk multipliers, tier pop-cap table) so client resolve previews and server resolve always agree (D4).

**`supabase/` now exists** (since `-B`): the implemented migration set lives at `supabase/migrations/0001_players_owned_planets.sql` … `0006_game_config_seed.sql`, plus `supabase/config.toml`. No migration is applied in this subtask (or any — the set is unapplied, forward-only, no provider contact); this `-A` snapshot's "no `supabase/` directory" statement was true at writing (HEAD `6fa09a9`) but is superseded by the `-B` implementation. The `-B`/`-C` workflow edits these unapplied migration files directly — that is correct, the Supabase migration ledger is untouched.

---

## 8. Testing Approach (P3-T01-C/-D, after Jay authorises linking)

Run via the CLI against the **linked** project (`npx --no-install supabase db query --linked -f <file>.sql`) per the skill: exit 0 is the success signal (NOTICEs are **not** relayed by the Management API), failed assertions = `RAISE EXCEPTION` inside `DO $$ … $$` blocks → non-zero exit, non-persisting probes wrapped in `BEGIN … ROLLBACK`, row counts verified before/after, and **counts run as separate single-statement queries** (the CLI keeps only the LAST result set of a multi-statement query).

| Suite | File | What it proves |
|---|---|---|
| Schema contract | `tests/sql/0001_schema_contract.sql` | `to_regclass` for every table; column/type checks via `information_schema.columns`; both uniqueness indexes present (`pg_indexes`); RLS on + forced per `pg_class`; `REVOKE` for anon/PUBLIC |
| Claim contract | `tests/sql/0002_claim_contract.sql` | `claim_home_planet`: idempotent re-claim returns the same planet; second distinct user claiming the same name gets the structured conflict (or `23505`) and **zero duplicate rows**; returned JSON has the OwnedPlanet key set; colony = `is_home false, unconquerable false, population 0`; colony-with-no-home raises |
| RLS probes | `tests/sql/0003_rls_probes.sql` | Role × table matrix (`BEGIN; SET ROLE anon|authenticated|service_role; …; SET ROLE postgres; ROLLBACK;`): `anon` SELECT on every table → `insufficient_privilege` (assert via caught exception) or 0 rows; `authenticated` sees own `players`/`notifications` only, **all** `owned_planets`, participant-scoped `attacks` + inbound-to-all; `service_role` sees all. `has_table_privilege` assertions mirror the skill's read-only verification query |
| Claim concurrency | `tests/sql/0005_claim_concurrency.sql` | Deterministic (advisory lock serialises, then re-check): claim A commits → claim B (same name, different uid) returns conflict; `SELECT count(*)` for the name = **1**. For a true parallel stress: two `db query` invocations racing the same name; assert final count = 1 and exactly one `claimed:true`. The unique index is the backstop assertion (any residual duplicate → `23505` → suite red) |
| Attack lifecycle contract | `tests/sql/0004_attack_lifecycle_contract.sql` | Seeded 2–3 fake users + planets (via the claim RPCs), `BEGIN … ROLLBACK`: launch computes `travel_seconds` from `distance_pc` (floor 600 / cap 172800); insufficient credits raises; joining after the 2h window raises; resolve produces the correct outcome bucket + casualty % + `winner_id` = highest commitment; conquered planet transfers with `defenseTurret` removed from the grid; notifications inserted for all parties; repelled keeps the defender's planet |
| Balance drift (TS) | `tests/balance-drift.test.ts` | `game_config` seed ↔ `src/sim/**` constants equality (D4) |

The RLS probe for "service_role never exposed": assert **no** `GRANT … TO anon` exists on any function (`information_schema.role_function_grants`) and that anon cannot invoke `claim_home_planet` — proving the client's public anon key can never touch service-level code paths.

---

## 9. Blockers / Decisions for Jay

| # | Decision | Options | My recommendation |
|---|---|---|---|
| **D1** | Structure grids storage | (1) **JSONB** on `owned_planets` (7-key grid, §1.3); (2) normalized `planet_structures` rows | **(1)** — tiny fixed grid, atomic read/write matches the sim, conquest transfer is a single JSONB operator, and it is the TradieHubAU-established pattern for validated structured payloads |
| **D2** | Auth model for v1 | (1) **anonymous sign-in**, email/phone link later (uid preserved — verified); (2) email signup now | **(1)** — the claim hook lands in 10s with zero friction; the uid survives the anonymous→registered upgrade, so planets/history follow the player. **Decision needed:** accept that pre-P3 local saves don't carry to the server (or adopt-on-first-connect, P3-T02). Also confirm the anonymous-user retention caveat is acceptable pre-launch |
| **D3** | Planet catalogue on the server | (1) **NO** — catalogue client-side, server stores claimed refs + derived fields (~0 seed rows); (2) 6,321-row seed | **(1)** for v1 — no second source of truth for 6,321 rows. **Tradeoff flagged:** the server validates *uniqueness* only, not catalogue membership (junk names possible; cosmetic, not exploitable for duplication). Revisit as `0007` if server-side assignment/validation is ever wanted |
| **D4** | Server-authoritative resolve math needs quirks + constants | (1) **small `game_config` balance seed** (~10 rows) + TS drift test vs `src/sim/**`; (2) client-reports DP at resolve (reject — cheat surface); (3) ignore quirks in resolve (accept drift) | **(1)** — resolve must run server-side (D5) and must produce the same numbers the client previews; a tiny seed keeps the 6,321 catalogue off the server while locking DP accuracy (`effectiveLevel`, `massiveWorld`, `denseCore`, turret coefficient) |
| **D5** | Attack resolution engine | (1) **DB function + lazy on-read**; (2) Edge Function; (3) `pg_cron` | **(1)** — atomic single transaction, no cold starts, idle-genre standard (results intended to be consistent with what's displayed — pending `-C` contract/integration verification, per §5.3), no background worker to babysit on free tier. `FOR UPDATE` handles the resolve race |
| **D6** | Leaderboard metric + population | Schema only now; metric (planet count? all-time AP? empire income?) and rotation = P4-T01 | Schema locks the tables; the `score` semantics are P4's call. Do not build snapshot jobs in P3 |
| **D7** | `status`/`outcome` typing | (1) **text + CHECK**; (2) Postgres `enum` | **(1)** — CHECKs are trivially extended by forward migration; enums require `ALTER TYPE` churn for every new status |
| **D8** | Server becomes source of truth for sim state | (1) **yes** — wallet/structures/per-planet pop move server-authoritative; client save = cache; build/accrue become RPCs; (2) keep sim fully client-side, post deltas | **(1)** — resolve math, offline earnings, and anti-cheat all need authoritative wallet/grid/pop. **The biggest Phase-3 architecture decision**; bounds what P3-T02-T06 implement. Recommend adopting local state on first connect |
| **D9** | Draft tunables as data | (1) **`game_config` table**; (2) hard-coded SQL constants | **(1)** — travel/launch/weariness/DP values change at playtest without a migration; the draft values (DESIGN §5a "Jay audits at playtest") stay Jay-editable |
| **D10** | New-player shield (3 days) storage | (1) **derived** from `players.created_at`; (2) `shield_until` column | **(1)** — no column, no expiry drift; the shield is a fixed rule, not player data |
| **D11** | Launch-window / war-weariness mechanics detail | Join window = 2h from `launched_at` regardless of travel (my model); weariness enforced at resolve-time via `1.2^count(24h)` (my model) | Both are faithful to DESIGN §5; confirm the 2h-window-vs-travel interaction and the resolve-time inflation, and whether colonists/colony caps need any v1 limit (DESIGN has none) |
| **D12** | Carry: binary quirk Option A/B (P2 §7/§8) | **RESOLVED 2026-08-09 — Option A chosen by Jay** (baseline-trait: binarySystem lifts the income floor ×1.1 at any Trade Hub level incl. 0; pinned by `tests/binarysystem-level0.test.ts`, DESIGN §4d updated). Verified against the working tree | Confirmed: affects **income** only (binarySystem), **not** combat resolve (only `massiveWorld`/`denseCore` touch DP/pop-cap) — no impact on this schema, the resolve math, or the §5.3 balance seed |

**Blockers:** none engineering-blocking for this audit. Everything above is a design decision; `-B` (schema + RLS + claim/colonise + attack lifecycle migrations) proceeds on the recommended defaults if Jay pre-approves D1–D12, with **D2** (auth), **D3** (catalogue), **D4** (balance seed) and **D8** (server-authority scope) as the load-bearing choices. Per WORKFLOW.md, **no Supabase link, no `db push`, no migration apply, no deploy** happens without explicit Jay authorisation — this subtask created documentation only.

---

*Prepared by OpenCode (deepseek-v4-flash) for P3-T01-A. **At the time of writing** only `docs/P3_T01_A_AUDIT.md` was created. No commit made, no work on `main`, no Supabase CLI invocation. Since then `-B` added the unapplied `supabase/migrations/` set (see header note).*
