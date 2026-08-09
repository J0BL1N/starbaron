# P3-T02-A — Attack Flow Audit (scout → commit → launch → travel → resolve)

*Subtask `-A` for **P3-T02 Attack flow** (Phase 3 — Supabase Backend + Async PvP). Documentation-only audit: nothing implemented, no migrations written, no Supabase contacted, nothing committed, no work on `main`. Scope grounded in DESIGN.md §5 (PvP — retake allowed, full-info scouting, real-distance travel, band-together, taken-planet rule: everything survives EXCEPT defense turrets), §5a (conquest math AP/DP ratios, garrison model, PvP tunables draft: travel `distancePc×1min` floor 10m cap 48h, launch cost `200 + fleet×0.2 + distance×10`, war-weariness +20%/24h), §5b/§5c (meta, session/UI flow), `docs/P3_T01_EVIDENCE.md` + `docs/P3_T01_A_AUDIT.md` (decisions D1–D12, the live schema, the applied 0001–0007 migrations), `supabase/migrations/0004` + `0005` + `0006` (the T01 attack tables/RPCs/config seed), the SQL contract suites `supabase/tests/01-03`, and `src/sim/player/**` (P2 sim: `PlayerState`, `OwnedPlanet`, `computePlanetDerived`, `accruePlayer`, garrison/fleet model). Verified at HEAD `eac1f0d` on `staging` (working tree has uncommitted changes — this audit doc + `supabase/tests/02_attack_rls.sql` shield assertion — pending commit after Codex PASS).*

---

## 0. What T01 already shipped vs what this task must add

| Layer | Exists (T01, live) | Missing (this task) |
|---|---|---|
| **Schema** | `attacks`, `attack_members`, `notifications`, `game_config`, `players`, `owned_planets` (migrations 0001–0007 applied) | — (no DDL expected unless a gap lands, §7) |
| **RPCs (write)** | `launch_attack`, `join_attack` (0005, client-granted); internal `resolve_attack`, `resolve_due_attacks` | — |
| **RPCs (read)** | — | **get_player_state / get_galaxy_state / get_attack / get_notifications** that call `resolve_due_attacks()` on-read (§1.5) + return resolved `game_config` values the client preview needs (§3) |
| **Client wiring** | none — `package.json` has **no `@supabase/supabase-js`**; UI is localStorage-only (`src/ui/save.ts`, `useGameState.ts`) | anon auth (`signInAnonymously`, D2), adopt-on-first-connect (D2/D8), server-authoritative state sync |
| **Sim combat math** | `defensePower` (`effects.ts:73-84`), `effectiveLevel`, quirk multipliers, garrison/fleet model | **AP estimator + outcome estimator** (pure sim functions mirroring 0005 resolve) for the scout/launch preview (§2.2) |
| **Garrison commitment** | `attack_members.soldiers_committed` + `shipyard_tier` snapshot recorded | **no deduction from source garrison/fleet anywhere** — deferred to P3-T05 by design (0005 header); anti-abuse + "exposed window" (§4.2) depend on it |
| **UI** | Planet View + build/colonise only | Galaxy map / scout view, launch panel, attack list (inbound/outbound), attack report view (§2.1) |

---

## 1. Attack Lifecycle Map (each step → existing RPC/schema → gap)

### 1.1 Scout — FREE, full-info (DESIGN §5 defaults)

- **Data layer: EXISTS.** `owned_planets` RLS policy is `using (true)` for authenticated (`0001:85-88`) — the shared universe, so the client already has SELECT on every planet's `tier`, `distance_pc`, `structure_levels`, `population`, `owner_id`, quirk flags. Full-info scouting is **data-available today**.
- **Estimate layer: MISSING.** The attacker needs AP vs DP vs odds before committing ("attackers see the defender's defenses + estimated odds", §5 defaults). Client-side `defensePower` (`src/sim/structures/effects.ts:73-84`) reproduces the server DP exactly (turrets × `effectiveLevel` + 0.15×pop, ×1.1 massiveWorld) but there is **no AP or ratio/outcome function** and **no weariness/cost values readable by the client** (§3). The scout screen and its math are `-B` work.
- **No RPC needed for the raw data**; the estimate math is client-side (§2.2). A read RPC is needed only to (a) run lazy resolve and (b) surface the resolved `game_config` knobs.

### 1.2 Commit — choose fleet + soldiers

- **Exists (partially).** `launch_attack(p_target, p_soldiers, p_source_planet_name)` (`0005:104-268`) and `join_attack(p_attack_id, p_soldiers, p_source_planet_name)` (`0005:278-354`) both: validate the source planet is owned by the caller, snapshot the REAL `shipyard` tier from its grid (AP = soldiers × shipyard tier, §5a — snapshot stops later upgrades retro-buffing a committed attack), record `soldiers_committed` into `attack_members`, and require finite positive soldiers.
- **Gap (P3-T05, bounded here):** committed soldiers are **never deducted from the source planet's garrison/fleet**. `p_soldiers` is bounded only by the player's **credits** (launch cost) and the finite-positive CHECK — not by their actual troop pool. The 0005 header is explicit: *"Garrison validation/deployment is DEFERRED to P3-T05."* Any P3-T02 UI must therefore render commitment as an **estimate/plan**, not a deduction, and §4.2 flags the abuse window this leaves open until P3-T05.

### 1.3 Launch — `launch_attack` RPC (EXISTS, live, tested)

Transactional sequence in `0005:104-268`:
1. Auth guard (`auth.uid()`, 42501 if absent); soldiers finite+positive.
2. **Source ownership** + shipyard-tier snapshot (`structure_levels->>'shipyard'`, no silent tier-0 fallback).
3. `SELECT … FOR UPDATE` on the **target** row (§3.3 serialisation).
4. Anti-grief: `unconquerable` → raise; `owner_id = me` → raise (§5/§6).
5. **New-player shield**: derived `players.created_at + new_player_shield_days` (`0006` = 3) → raise when shielded (D10 — no column, no drift).
6. **Join-first**: if an inbound attack already exists on the target → returns structured `{launched:false, reason:'attack_in_flight', join_attack_id}` (**not** a raise) — band-together is the mechanic (§5).
7. **Travel**: `travel_seconds = LEAST(GREATEST(round(distance_pc × travel_minutes_per_pc × 60), floor), cap)` with `distance_pc` coalesced to 0; floor 600 / cap 172800 from `game_config` (`0006:28-30`).
8. **Cost**: `base + soldiers×per_fleet + distance_pc×per_pc` from `game_config`; **credits deducted at launch** (`FOR UPDATE` on the player row, insufficient → raise).
9. Insert `attacks` (`status='inbound'`, `travel_seconds`, `resolves_at = now()+travel`, `join_window_seconds`) + the launcher's `attack_members` row; notify target owner `under_attack`.

**Gaps:** none functional — this is the T01 core. Test gap: the `attack_in_flight` join-first branch has **no direct assertion** in `02_attack_rls.sql` (§6).

### 1.4 Travel — `resolves_at = launched_at + travel_seconds`

- **Exists.** `travel_seconds` CHECK `between 600 and 172800` (`0004:34`), `resolves_at` set at insert. The inbound-due index `attacks_due_idx` (`0004:41`) powers the lazy scan.
- Nothing happens during travel (async, no timers — §3 DESIGN). The galaxy map shows an inbound attack + countdown to **all** authenticated (inbound attacks are open per RLS `0004:86-94`) — coordination data is present; the countdown UI is `-B`.

### 1.5 Lazy resolve — `resolve_due_attacks()` on read (EXISTS as engine, MISSING the wiring)

- **Engine: EXISTS and live** (`0005:603-655`): `FOR UPDATE` scan of inbound past-`resolves_at`, calls internal `resolve_attack` per row, resolves **all** due attacks regardless of caller (side-effects never skipped), but **response-gates** each report to launcher / ORIGINAL target owner / attack member / service_role (audit-finding fix; `0007` closed the authenticated-EXECUTE leak on `resolve_attack`).
- **Wiring: MISSING.** §5.3/D5 design intent is "invoked lazily at the top of read RPCs / login sync". **No read RPC calls `resolve_due_attacks()` yet** — the P3-T01 evidence explicitly flags this ("the lazy on-read gate is design intent, not yet established"). This is the single biggest `-B` item: a `get_player_state` / `get_galaxy_state` / `get_attack` / `get_notifications` RPC set that (a) calls `resolve_due_attacks()` first, then (b) returns the gated rows.

**Resolve semantics (internal `resolve_attack`, `0005:362-593`), matching §5a:**
- **DP** = `turret_defense_power_per_level`×`effectiveLevel(turrets)` + `militia_defense_per_population`×`population`, ×`massive_world_multiplier` if flag (`0006`: 500 / 0.15 / 1.1).
- **AP** = Σ(`soldiers_committed × shipyard_tier`) over members — combined vs the defender's FIXED, unchanged DP (§5 band-together).
- **War-weariness** = `1.2^count(launcher's launches in last 24h)` — applied to required DP at resolve (D11). ⚠️ count includes the attack being resolved — see §7 blocker B1.
- **Ratio** = AP / (max(DP,0)×weariness); buckets from `outcome_ratios_and_losses` (`0006:77-78`): ≥1.5 decisive (40%), ≥1.0 pyrrhic (70%), ≥0.75 repelled (60%), else crushed (90%). Zero-DP edge → AP>0 ⇒ ratio 9999 ⇒ decisive.
- **Winner** = highest `soldiers_committed` (tie: earliest join, then lowest uid) — decisive/pyrrhic only (§5 "cooperation with one winner").
- **Conquest transfer** (§5 line 129 LOCKED): `owner_id := winner`, `is_home := false`, `unconquerable := false`, `structure_levels := structure_levels - 'defenseTurret'` (**single JSONB operator — turrets destroyed, economy/military structures survive**), `population := 0`, `garrison := 0`, `fleet := 0`, `claimed_at := now()`. Planet name keeps the same row → the one-owner uniqueness index survives conquest (retake allowed — nothing marks a taken planet special).
- **Repelled** (only): defender `population := population × (1 − defender_pop_loss_repelled)` (0.3). "some turrets" (§5a) is NOT implemented — turrets survive repelled (§7 blocker B4).
- **Notifications**: `invasion_landed` (defender), `planet_fell` (defender, if taken), `attack_result` (each member). `attack_report` jsonb on the `attacks` row = full who/what/when + casualties + survivors (§5b "full attack report").
- **Idempotent**: already-`resolved` → null no-op; racing resolvers serialize on the `FOR UPDATE`.

---

## 2. The Client Side — what the UI needs, what the sim feeds it

### 2.1 UI surface (all `-B`, none exists)

| Screen | Needs | Feeds from (existing sim) | New (gap) |
|---|---|---|---|
| **Galaxy map / scout view** | list of all planets (`owned_planets` SELECT is live), distance, DP estimate, odds, inbound-attack overlay | `defensePower` (`effects.ts:73`), `computePlanetDerived` (`accrual.ts:61`) | AP/ratio/outcome estimator (§2.2); travel/cost/weariness constants via a read RPC (§3) |
| **Launch panel** | source planet picker, soldier slider (capped by garrison/fleet cap + launch cost), live AP-vs-DP odds, cost + travel readout, calls `launch_attack` | `gridForPlanet` (shipyard tier), `computePlanetDerived.fleetCap/garrisonCap`, `wallet` | attack-commit **estimate** (no deduction until P3-T05); `attack_in_flight` response handler (switch to join panel) |
| **Attack list** | own inbound + outbound, joinable attacks (inbound is visible to all via RLS), countdowns | — | read RPC + lazy resolve invocation (§1.5) |
| **Attack report view** | outcome, casualties both sides, what survived, who got the planet, revenge hook (§5b) | `attack_report` jsonb (server-populated) | read RPC gated to launcher/original-owner/member (§1.5) |

### 2.2 Client computes estimates; server is authoritative (D8)

**Recommendation (unchanged from D4/D8):** the **server** owns resolve (`resolve_attack` — already implemented, §1.5). The **client** shows the same numbers as an **estimate** using sim math, so the scout/launch preview and the server outcome always agree.

- What the client can already mirror exactly: DP (`defensePower`), effectiveLevel, quirk multipliers, AP = soldiers×shipyard tier (trivial), outcome bucket + casualty % (fixed table).
- **Missing sim functions** (`-B`, pure + vitest-tested): `attackPower(soldiers, shipyardTier)`, `estimateOutcome({ap, dp, weariness}) → {ratio, outcome, attackerLossPct}` and a `launchCost(soldiers, distancePc, {base, perFleet, perPc})` + `travelSeconds(distancePc, {perMin, floor, cap})` mirroring `0006` exactly.
- **Parity guard:** T01 left a known open finding (P3-T01 evidence §8 finding 2) — the planned `tests/balance-drift.test.ts` (0006 seed ↔ `src/sim/**`) was **not** built; parity is only enforced live by `03_config.sql`. P3-T02 should close it with the estimate tests (§6.2), else the client preview can drift from server resolve silently.

### 2.3 Client/server split — what stays where

| Concern | Owner | Notes |
|---|---|---|
| Resolve math, outcome, conquest transfer, casualties | **Server** (0005) | D8 — anti-cheat |
| Estimate preview, galaxy rendering, structure/buy simulation | **Client** (sim) | needs read-RPC constants for parity |
| Travel/cost/weariness/shield **values** | **Server** (`game_config`, service_role-only) | resolved values must be exposed via RPC response (§3) — client must NOT read the table |
| Notifications, reports | **Server** writes; **client** renders | read via gated read RPC |

---

## 3. Travel / Cost / Weariness — tunables verification (DESIGN §5a draft vs `game_config`)

`0006_game_config_seed.sql` + live `03_config.sql` (all exit 0) verify the seed matches the §5a draft **exactly**:

| §5a draft knob | `game_config` key (0006) | Seed | Verdict |
|---|---|---|---|
| Travel `distancePc × 1 min`, floor 10 min, cap 48h | `travel_minutes_per_pc` / `travel_floor_seconds` / `travel_cap_seconds` | 1 / 600 / 172800 | ✅ exact |
| Launch cost `200 + fleet×0.2 + distance×10` | `launch_cost_base_credits` / `launch_cost_per_fleet_credits` / `launch_cost_per_pc_credits` | 200 / 0.2 / 10 | ✅ exact |
| War-weariness `+20%/24h`, stacks | `war_weariness_multiplier` / `war_weariness_window_hours` | 1.2 / 24 | ✅ values exact (⚠️ counting semantics — §7 B1) |
| Join window 2h (§5, not §5a) | `join_window_seconds` | 7200 | ✅ |
| New-player shield 3 days (§6) | `new_player_shield_days` | 3 | ✅ |
| Repelled defender loss 30% (§5a) | `defender_pop_loss_repelled` | 0.3 | ✅ |

**Where the client reads them:** it **can't today**. `game_config` is `service_role`-only (0002 RLS + `03_config` §4 asserts authenticated + anon are denied). The client currently has **no** travel/cost/weariness constants anywhere in `src/sim/**`. For the launch panel / scout preview the client must either:
- **(a) recommended** — a read RPC returns the resolved knob subset (e.g. `get_pvp_constants()` or fold them into `get_galaxy_state`), server-authoritative, no drift; or
- **(b)** mirror the constants client-side and pin them with the balance-drift test (increases drift risk on Jay's playtest retunes).

The **server** always reads them from `game_config` via `game_config_number` (missing key RAISES loudly — drift is loud by design).

---

## 4. Anti-Abuse

### 4.1 Launch cost — who pays, when
**Paid at launch, by the launcher, transactionally** (`0005:217-228`): credits checked (`FOR UPDATE`) and deducted before the `attacks`/`attack_members` inserts; insufficient → raise. Fuel cost is sunk on launch — a crushed/repelled attack still spent it. Alloy cost = 0 (alloys fund defenses, §5.2). This is correct and abuse-tight: you cannot launch without funds, and concurrent launches can't double-spend (player-row `FOR UPDATE`).

### 4.2 Soldier commitment semantics — the open anti-abuse window
- Recorded: `soldiers_committed` (+ shipyard-tier snapshot) per member; finite+positive CHECK; permanent per §4a ("5,000 troops are gone whether you win or lose").
- **NOT enforced:** nothing validates `p_soldiers ≤` the source planet's garrison/fleet, and **nothing deducts it**. Until P3-T05:
  - A player can launch unlimited simultaneous attacks committing the *same* virtual soldiers — the only gate is credits.
  - The §5a garrison model's **"exposed window"** ("Attack = deploying soldiers off-planet → your own DP drops while they're gone → galaxy map shows you exposed") **cannot render** — garrison never decreases, so the attacker's DP never drops.
  - **Recommendation (decision for Jay, §7 B2):** P3-T05 (or fold the deduction into P3-T02-B) must (1) validate soldiers ≤ source garrison/fleet, (2) deduct committed soldiers from the source garrison at launch/join, (3) deduct the casualty % on resolve, and (4) decide whether survivors return (see B3). The 0005 schema already stores `garrison`/`fleet` per planet — the columns exist; only the enforcement is deferred.

### 4.3 Duplicate / in-flight guard
- Launch takes `FOR UPDATE` on the target row → serialised; after the lock an existing inbound attack returns `attack_in_flight` + `join_attack_id` (join-first, §5 band-together) instead of raising — the client must handle this structured response by routing to the join panel.
- `join_attack`: window (2h from `launched_at` regardless of travel, D11), status must be `inbound`, no double-join (PK `attack_id+player_id`), target owner cannot join. 
- No dedicated test asserts the `attack_in_flight` branch yet (§6.1) — the existing `02` suite only proves the join path on the launcher's main attack.

---

## 5. Edge Cases (each → verified behaviour in the live schema)

| Edge | Status | Where |
|---|---|---|
| **Attack on own planet** | ✅ raises `cannot attack your own planet` | `0005:166-168`, asserted `02` §d |
| **Attack on unconquerable home** | ✅ raises `target planet is unconquerable` | `0005:163-165`, asserted `02` §d |
| **Target already has inbound attack** | ✅ join-first → `{launched:false, reason:'attack_in_flight', join_attack_id}` (band-together) | `0005:184-200` — ⚠️ no direct suite assertion (§6.1) |
| **Colonised-but-empty-pop planet** | ✅ launchable; DP = turrets only (`0.15×0`); fresh colony owner is still the same shielded `players.created_at` → shield covers the whole empire, not just the home | `0003` colony sets `population=0`; DP in `0005:427` |
| **Resolve with zero AP (0-fleet-equivalent)** | ⚠️ **constructible** — `soldiers>0` passes while the source planet has no `shipyard` in its grid (tier `coalesce(...,0)` at `0005:143-150`, snapshot stored at `0005:249-250`), producing AP = 0; `resolve_attack`'s defensive `v_ap=0` branch (`0005:444-456`) is therefore reachable ⇒ ratio 0 ⇒ crushed. Not covered by `02` | `0005:137-139`, `0005:143-150`, `0005:249-250`, `0005:444-456` |
| **Max distance travel (48h cap)** | ✅ 4000 pc → 172800s asserted; `distance_pc` NULL → coalesce 0 → floor 600 | `0005:204-208`, `02` §e |
| **New-player shield (3-day)** | ✅ **implemented** — derived from `players.created_at + new_player_shield_days` (D10), checked in `launch_attack` (`0005:172-180`); NOT re-checked in `join_attack` (redundant — no attack can exist on a shielded target, and `created_at` is immutable so a target can't become shielded mid-flight). ⚠️ **rejection path not yet live-verified**: the existing `02` suite backdates the defender/joiner accounts specifically to bypass the shield (`02:61-64`) and had **no assertion that a shielded target is rejected** — the guard was code-evidenced only. A shield-rejection block is now added to `02` (this correction); it must be run against live post-audit | `0005:172-180`, `02` §header + shield block |
| **Resolve before `resolves_at`** | ✅ lazy resolve no-op; stays inbound | `02` §g |
| **Resolve twice / racing resolvers** | ✅ idempotent no-op; `FOR UPDATE` serialises | `0005:403-405` |
| **Garrison's defensive role** | ⚠️ garrison is **excluded** from defender DP (locked §5a formula = turrets + 0.15×pop only); its narrative role ("defend automatically", attacker-exposure) is unimplemented → decision for Jay (§7 B5) | `0005:421-430` |
| **Paid shields 12/24/48h (§6, §8)** | ⚠️ **not in schema** — no column/table; the only shield is the derived new-player one. IAP shields are T06/P4-T03 work | — |
| **Catalogue distance 4–5,000 pc** | ✅ 5000 pc → round(300000) → cap 172800; all in-cap | `0005:208` |

---

## 6. Testing Approach

### 6.1 Extend the SQL contract suite — `supabase/tests/04_attack_flow.sql` (BEGIN…ROLLBACK, `-C`)
Focused on the **full lifecycle end-to-end** (T01's `02` proves pieces; `04` proves the loop):
1. Seed 2–3 actors + claims (via the claim RPCs, `request.jwt.claims`), backdate defender shield, fund launcher, set deterministic grids/pop (so DP is hand-computable, as in `02` §f).
2. **Launch** → assert travel (floor 600 / mid 6000 / cap 172800), credit deduction (pre/post), `attack_members` row (launcher + snapshot tier), `under_attack` notification, `status='inbound'`.
3. **In-flight guard** → second launch at the same target returns `launched:false, reason:'attack_in_flight', join_attack_id` (new assertion — covers §5 row 3).
4. **Join** → C joins within window; assert combined-AP record + tier snapshot + window-close raise + double-join raise.
5. **Make due** → `resolve_due_attacks()` as authenticated → assert outcome bucket, casualty % per member (`attack_report.members[].losses`), `winner_id` = highest commitment, **conquest transfer with `defenseTurret` removed from the grid** (JSONB operator check), fresh `population=0`, notifications for all parties (under_attack → invasion_landed / planet_fell / attack_result).
6. **Repelled path** → craft a high-DP target, resolve → defender keeps planet, `population × 0.7`.
7. **Idempotency** → resolve the same attack again → no-op; not-due stays inbound.
8. **RLS post-resolve** → outsider sees 0 resolved; launcher/member see 1; defender loses the table window but received its reports via original-owner gating (mirrors `02` §h).
9. **Weariness math** → backdate a controlled set of the launcher's launches and assert the exact `1.2^count` applied to required DP — this pins B1 either way.

### 6.2 Client sim tests — estimate math parity (vitest)
- New pure functions (§2.2) with fixed-constant tests asserting **the exact 0006 seed values** (travel floor/cap, cost coefficients, weariness multiplier, outcome buckets, turret 500 / militia 0.15 / massiveWorld 1.1, effectiveLevel cap 10 / 0.5) — closing the T01 open finding #2 (balance-drift).
- Property tests: estimate ⇒ same bucket boundary semantics as §5a (1.5 / 1.0 / 0.75); soldier/cost/travel monotonicity; NaN/±∞/0 guards mirroring the RPC CHECKs.
- `attack_in_flight` handler logic (launch response → join-panel routing) as a UI-state test.

### 6.3 Integration (full loop)
- Full client→server loop needs the `-B` Supabase wiring (supabase-js anon client, adopt-on-first-connect) which does **not** exist yet — so the **end-to-end loop is `04_attack_flow.sql` against the linked project** (the established T01 pattern: exit 0, `BEGIN…ROLLBACK`, `8653`-marked raises). A TS integration test that hits live RPCs is a follow-on once the client library lands; recommend it not gate P3-T02 `-D`.
- Regression gates stay: `npx vitest run`, `npx tsc -b`, `npm run lint`, `npm run build`.

---

## 7. Blockers / Decisions for Jay

| # | Decision | Options | My recommendation |
|---|---|---|---|
| **B1** | **War-weariness off-by-one.** `0005:436-441` counts the launcher's launches in the 24h window **including the attack being resolved**, then applies `1.2^count` ⇒ the FIRST conquest today already costs 1.2×. DESIGN §5a says "the **4th** conquest in a day needs **1.8×**" (= 1.2³), implying 1st = 1.0× | (1) count only earlier launches (`1.2^(count−1)`, floor 1.0); (2) keep 1.2^count as the draft and update §5a wording; (3) 1.2^max(count−1,0) via `greatest` | **(1)** — matches the §5a "4th = 1.8×" draft intent; either way the SQL suite §6.1 item 9 should pin the chosen semantics |
| **B2** | **Soldier commitment not enforced** (no garrison/fleet deduction; `soldiers ≤ cap` unchecked) — abuse window + "exposed window" unrenderable until P3-T05 | (1) defer fully to P3-T05 (current plan — UI shows estimates only); (2) pull the deduction into P3-T02-B | **(2)** if P3-T02-B can stay bounded — the launch-panel odds are meaningless without it; **else (1) explicitly scoped**, with a known-limitation note in the UI and the `-D` report |
| **B3** | **Survivor semantics.** §4a "5,000 troops are gone whether you win or lose" vs §5a casualty table (40/70/60/90% losses → implies survivors). Server computes per-member `losses` in the report but neither deducts nor refunds anyone | (1) committed soldiers permanently consumed (only % losses shown); (2) survivors return to the source garrison; (3) permanent, survivors unrecoverable (go to an "empire reserve") | **(1)** — matches the "wars leave scars / lives are the real price" thesis and the §4a text; keep the % as report flavour |
| **B4** | **Repelled "some turrets"** (§5a) is not implemented — turrets fully survive a repelled attack (only pop ×0.7) | (1) keep turrets intact for v1; (2) destroy a fixed % (e.g. tier-based) | **(1)** — "some" is unspecified in DESIGN; simplest, and repairs (re-fortify) are the desired defender loop. Note as an explicit v1 exclusion |
| **B5** | **Garrison's defensive role.** Locked §5a DP formula excludes garrison ("Militia fights only if the garrison is overwhelmed — formula-only"); garrison currently has zero resolve effect, its narrative purpose is attacker-exposure | (1) confirm garrison is exposure/placeholder-only in v1; (2) add garrison to defender DP | **(1)** — respects the LOCKED formula; revisit at playtest. Server resolve already matches (1) |
| **B6** | **Read-RPC scope for `-B`** — §1.5 wiring (`get_player_state` / `get_galaxy_state` / `get_attack` / `get_notifications`, each invoking `resolve_due_attacks()` on-read + returning resolved `game_config` knobs) | (1) a minimal single `get_player_state` + `get_galaxy_state` pair now; (2) full set; (3) defer read RPCs to T04/T05 | **(1)** — enough to run the loop (lazy resolve + scout + launch); notifications list can ride `get_player_state` |
| **B7** | **Client auth/adoption** (D2/D8) — no `@supabase/supabase-js`, no anon sign-in, no adopt-on-first-connect; nothing is server-connected today | (1) wire anon auth + adopt-on-first-connect in P3-T02-B; (2) defer to a dedicated task | **(1)** — the attack flow is meaningless against localStorage |
| **B8** | **Paid shields (12/24/48h, §6/§8)** absent from schema — only the derived new-player shield exists | (1) defer to P3-T06/P4-T03 as designed (no column); (2) add a `shield_until` column now | **(1)** — no v1 payer; note in T06 scope. No schema drift needed until monetisation |

**Blockers:** none engineering-blocking. B1 is a **live behaviour discrepancy** worth fixing (or explicitly accepting) before `-B`. B2 sets the boundary between T02 and T05. Everything else is a scoping decision.

---

*Prepared by OpenCode (deepseek-v4-flash) for P3-T02-A. **Documentation-only subtask:** created `docs/P3_T02_A_AUDIT.md`; no implementation, no commit, no `main` changes, no Supabase CLI invocation or remote contact. Verified HEAD `eac1f0d` on `staging`; working tree intentionally dirty with this audit doc + `supabase/tests/02_attack_rls.sql` shield assertion, pending commit after Codex PASS.*

***Correction round (Codex FAIL, two accuracy findings — NOT committed):** line 150 reworded — a zero-AP attack IS constructible (positive soldiers + shipyard tier 0 → AP=0, resolver defensive branch reachable); line 152 reworded — the shield guard is code-evidenced (`0005:172-180`) but the rejection path was NOT live-verified (existing `02` backdates defender/joiner shields to bypass it, `02:61-64`). Added a live-testable shield-rejection block to `supabase/tests/02_attack_rls.sql` (D's non-backdated `delta-colony` must raise `new-player shield`); backdated bypass tests kept intact. **The updated `02` suite must be run against live post-audit.** Tree is intentionally dirty with these uncommitted corrections.*
