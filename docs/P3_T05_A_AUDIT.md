# P3-T05-A — Fortification + War-Weariness + Soldier Commitment Audit

*Documentation-only audit — NO implementation, NO commit. Branch `staging`, HEAD `d4d0eb2`. Scope bounded to DESIGN §5/§5a/§5b/§4c/§4d: fortification (10× ceiling, alloy-heavy escalating turret costs), war-weariness (+20%/24h per player), and the B2 soldier-commitment model (garrison deduction at launch, exposed window, survivor return at resolve). Verifies what is LIVE vs what is MISSING against the migration set 0001–0011, the live suites (01–05), and the client sim/estimator.*

**LIVE resolver** = `resolve_attack()` as re-created in `0011_band_together.sql` (P3-T04-B — per-player weariness, combined-AP deflation). Line references: 0011 for the resolver/join/get_attack, 0010 for the AP/DP history, 0005 for launch/resolve origin, 0008 for the read RPCs / `war_weariness_multiplier_for`, 0004 for schema, 0003 for claim, 0001 for columns, 0006 for game_config seed, src/sim/** for the client sim.

---

## 1. Fortification Status vs DESIGN

### 1.1 What the DESIGN locks

- **§4c/§4d (lines 78, 94–104):** Defense Turret = `2,000 cr + 1,000 alloys`, `+500 DP`, build time 3 min; cost curve = `base × 1.15^level`.
- **§4d (line 112):** DP = `500 × Turret levels + 0.15 × current population` (worked example: 8 turrets + 40k pop = **10,000 DP** → 15k AP decisive).
- **§5 (line 135, fortification ceiling, LOCKED):** a player CAN build enough defenses to make a planet repel **up to 10× its own defended strength** — "AP needed to take it = up to 10× the planet's own DP" — because "turret costs are alloy-heavy and escalate fast, so maxed fortification drains the planet's economy". *Balance triangle: small players coordinate (band) · big players fortify · investment is the trade-off.*
- **§5a (lines 139–149):** AP = deployed soldiers × Shipyard tier; **DP = Turrets × turret strength + (population × 0.15 militia rate)**; ratio = AP ÷ DP; outcome buckets ≥1.5 / ≥1.0 / ≥0.75 / <0.75. Garrison model (line 149): "every planet has its own soldiers (garrison)… They defend automatically. **Attack = deploying soldiers off-planet → your own DP drops while they're gone**… Militia fights only if the garrison is overwhelmed — formula-only, not tracked."

### 1.2 What exists in code

| DESIGN element | LIVE? | Evidence |
|---|---|---|
| Turret cost = base × 1.15^level (credits) | ✅ | `src/sim/core/economy.ts:4,13–20` — `COST_GROWTH_PER_LEVEL = 1.15`, `structureCost = base × 1.15^level`; turret base `2_000` in `src/sim/structures/data.ts:63–70` |
| Turret alloy cost | ⚠️ **flat, not escalating** | `data.ts:68` `alloyCost: 1_000`; `src/sim/player/accrual.ts:226` spends `STRUCTURES[id].alloyCost` as a **constant** per level — the 1.15 escalation applies to credits **only**. DESIGN §5 "alloy-heavy **and escalate fast**" is half-implemented (see §5). |
| DP formula | ✅ | `src/sim/structures/effects.ts:18–19,73–84` (500 / 0.15); resolver 0011:282–291 reads `game_config` `turret_defense_power_per_level`(500) + `militia_defense_per_population`(0.15) + `effectiveLevel` half-after-10 + ×1.1 `massive_world`; estimator `defensePowerEstimate` (estimator.ts:95–104) delegates to effects.ts |
| Any fortification **multiplier / state** beyond "build more turrets" | ❌ | No fortress flag, no fortify RPC, no DP cap, no per-planet turret cap anywhere. DP is purely `500×eff(turrets) + 0.15×pop` — **fortification is turret-count-driven and nothing else** |
| Per-planet turret cap | ❌ (by design) | Structure slots UNLIMITED (§4d line 88). `effectiveLevel` (levels.ts:6–14) halves the marginal DP past 10 (500 → 250/level) but never stops growth — DP is unbounded, so "maxed" is economic, not structural |
| Server can actually ADD turrets post-claim | ❌ **CRITICAL** | **There is NO server build/upgrade RPC.** `structure_levels` is set only at claim/colonise (0003:128,221); the only server writes to a grid are the resolver's `- 'defenseTurret'` on conquest (0011:386). The "fortify-or-grow" loop (P3-T03 D6) and defender fortify-mid-flight exist **client-side only** (`buildStructure`, accrual.ts:215–234). Today a turret bought in the client never reaches `owned_planets` server-side — the resolver sees the claim-time turret level only. |
| Server garrison/fleet state actually changes | ❌ | `garrison`/`fleet` columns exist (0001:49–50) and are returned by `get_galaxy` (0008:468–469), but the **only server writes are the conquest reset to 0** (0011:388–389). There is **no server-side accrual** — population/garrison/fleet are client-sim state (`src/sim/player/accrual.ts`) that the server never advances. Server garrison is permanently the claim-time value (0003:126–127 → **0**) until P3-T05 adds accrual/update RPCs. |

### 1.3 The "10× ceiling" — verified against the resolver

- **How the resolver handles a heavily-fortified target:** DP is re-read from the CURRENT grid under `FOR UPDATE` at resolve (0011:286–291); ratio = combined AP ÷ `greatest(DP, 0)` (0011:317–324). A high-DP fortress simply demands high AP — **decisive = 1.5× its DP, pyrrhic = 1.0×, repelled ≥ 0.75×**. There is no 10× anywhere in the math.
- **The parenthetical is not mechanically true.** "AP needed to take it = up to 10× the planet's own DP" contradicts the LOCKED ratio table (a decisive attacker at 1.5× DP always takes it, regardless of fortification depth). The 10× figure is **emergent narrative**: a whale's fortress has very high DP, so attackers must commit very large forces; and because turret costs escalate while a planet's DP is unbounded, the *ratio of attacker investment to defender investment* can reach very high multiples.
- **Recommendation: purely turret-driven for v1.** The ceiling emerges from the cost curve + DP formula; no new fortification state/multiplier is needed to satisfy DESIGN's *mechanical* intent (band-together demands coordination precisely because DP is high and fixed). **Flag for Jay (§8, B2):** if he wants a *literal* "repels up to 10× its own DP" guarantee (e.g., an attacker-side AP>10×DP penalty, or a soft fortress multiplier), that is a **new mechanic + DESIGN amendment** — not present, not recommended for v1.

---

## 2. War-Weariness Audit (the counter is LIVE)

### 2.1 Where it lives and how it works

| Aspect | LIVE behaviour | Evidence |
|---|---|---|
| Counter | `war_weariness_multiplier_for(player_id, exclude_attack_id)` = `power(1.2, count)` — counts the player's launches in the **sliding** 24h window, excluding the attack being resolved (B1 fix: first conquest = 1.0×, 4th = 1.2³) | 0008:68–91; game_config `war_weariness_multiplier` 1.2 / `war_weariness_window_hours` 24 (0006:35–36) |
| Where it's applied | **At RESOLVE only, per-member AP-numerator deflation**: each member's `soldiers × effectiveLevel(tier) / their_own_1.2^n` (0011:302–309). Required DP is the plain fixed DP (`greatest(v_dp,0)`, 0011:317). | 0011:302–324 |
| NOT applied at launch | Launch cost is credits-only (`200 + soldiers×0.2 + pc×10`, 0005:210–228); weariness never gates launch and never adds to launch cost | 0005:210–228 |
| 1.2^count semantics | count = launches with `launched_at >= now() − 24h`, **ANY status** — **in-flight attacks count toward the player's own stack** (no status filter). This is the T04-flagged semantics, KEEP-authorised (P3_T04_EVIDENCE §8.1) | 0008:83–88 |
| Reset | **Sliding window, not fixed daily reset.** An attack ages out when `launched_at` passes 24h ago (pinned live by 05 case 10: D's expired prior → 1.0). DESIGN §5b "resets daily" is ambiguous; the implementation is rolling | 0008:88; 05:1 case 10 |
| Estimator parity | **Exact for solo** (`estimateRatio` = AP ÷ (DP × weariness) ≡ AP/1.2^n ÷ DP); **exact for gangs** via `combinedAttackPower` (Σ per-member AP ÷ own 1.2^n, estimator.ts:139–156). `get_galaxy.my_weariness` = `war_weariness_multiplier_for(me)` = what a next launch faces, and `warWearinessMultiplier(n)` mirrors it 1:1 | estimator.ts:112–122,139–156; 0008:494,521 |
| Report surface | report `war_weariness_multiplier` = the **launcher's** stack (informational, backward-compatible); `members[].weariness` = each attacker's own stack; `combined_ap` is the deflated total | 0011:423,372–374 |

### 2.2 What's missing

1. **No UI surface for the player's own weariness.** `get_galaxy` returns `my_weariness` (0008:521) but no client component renders it; a player cannot see "your 3rd conquest this window costs 1.728×" before scouting. (The estimator/scout already *applies* it — `estimateScout` takes `recentLaunches`.)
2. **Gang members' weariness stacks aren't visible pre-resolve.** `get_attack`'s roster (0011:565–571) exposes `soldiers_committed / shipyard_tier / joined_at` only — no per-member weariness or launch count. A joiner can't preview how a weary gang-mate drags the combined AP down (`combinedAttackPower` needs each member's `recentLaunches`, which only the member themselves knows via `get_galaxy`).
3. Minor: no client count is surfaced directly — `my_weariness = 1.2^n` implies n = log₁.₂(weariness); fine for display, but a raw count would be cleaner for the gang preview.

---

## 3. B2 — SOLDIER COMMITMENT: the real model (the deferred big one)

### 3.0 The prerequisite nobody can skip

Before any of §3 a–d is implementable, **the server needs state that only exists client-side today**: no server build/upgrade RPC (structure grids frozen at claim) and **no server accrual** (garrison/population/fleet never advance server-side; garrison is 0 for every fresh claim, 0003:126–127). If launch/join gain a garrison guard but the server never grows garrison, **no launch can ever succeed** once the guard ships. **P3-T05-B must therefore ship a server-side accrual (or a build/upgrade RPC chain) alongside the deduction** — otherwise the whole model is dead on arrival. This is elevated to a blocker (§8, B1).

### 3.a At launch: soldiers leave the source planet's garrison

- **Today:** `launch_attack`/`join_attack` validate source ownership + snapshot the real shipyard tier (0005:141–150, 0011:122–130) and **deduct nothing**. `soldiers_committed` exists only on `attack_members`.
- **Design (recommended):** on launch/join — `source.garrison -= p_soldiers; source.fleet += p_soldiers` (fleet = the deployed pool, per §4a "Invasion fleet… burned when you attack" and §4d "Deploying soldiers → fleet"). `fleet` is capped by `1,000 × shipyard levels` (§4d line 104), so add **two guards**: `p_soldiers <= source.garrison` ("insufficient garrison") and `fleet + p_soldiers <= fleetCap` ("fleet cap exceeded"). Both fire inside the existing `FOR UPDATE` on the source... note 0005 locks the **target**, not the source — the source update needs its own lock/consistency handling (the source row is only SELECTed today, 0005:143–150).
- **Why fleet isn't the deduction source:** DESIGN treats garrison as home defenders and fleet as deployed; modelling deployment as `garrison → fleet` at launch and `fleet → (garrison on survivor return | gone)` at resolve is the cleanest bookkeeping and matches the Fleet View (§5c line 171 "Garrison vs deployed — the who's exposed screen").
- **Regression surface (real):** **02_attack_rls / 04_conquest_math / 05_band_together all seed `garrison = 0`** and launch hundreds/thousands of soldiers (0008:38–43 header admits "a garrison deduction would break the pinned 02_attack_rls contract suite (launches seed garrison=0)"; 05:164 seeds only shipyard, not garrison). A garrison guard makes every launch in those suites fail. **P3-T05-B must seed garrison on the source planets in all three suites** (or the guard is opt-in). The pinned AP/DP/weariness numbers are unaffected — only the seeding changes.

### 3.b The exposed window — garrison vs DP (the DESIGN tension)

- **Today DP does NOT use garrison at all** (B5, LOCKED §5a formula; pinned in resolver 0011:282–291, effects.ts:73–84, estimator:91–94). Militia is `0.15 × population`; garrison contributes nothing. So **deploying has exactly zero effect on a planet's DP today — the "exposed window" is pure flavour** (§5a line 149's "your own DP drops while they're gone" is *not* implemented).
- **The tension:** §5a's DP formula (turret + militia, LOCKED) vs §5a's garrison model ("they defend automatically… DP drops while they're gone"). DESIGN itself resolves it half-way with "Militia fights only if the garrison is overwhelmed — formula-only, not tracked" — i.e. garrison is narrative, the defense math is turret+militia.
- **Two options for Jay:**
  - **Option 1 — garrison stays OUT of DP (recommended).** DP formula unchanged (LOCKED); the exposed window is delivered as **flavour + UI** (Fleet View shows garrison vs deployed; galaxy map can badge a planet with troops away). Real, non-DP exposure still exists: a depleted garrison means you **cannot launch further attacks** (3.a guard) — the army that left can't defend at home, narratively and via the launch gate. **Cost: ~zero** — no resolver/estimator/effects change, no pin churn, no DESIGN amendment.
  - **Option 2 — garrison adds to DP when present (real exposure).** DP += `garrison × k` (k tunable). Deploying genuinely drops the source planet's repulsion power. **Cost: large change surface** — the DP path in resolver 0011, effects.ts `defensePower`, estimator `defensePowerEstimate`, a new `game_config` key, every 04/05 pin + `backend-estimator.test.ts` parity, the P3-T03 27-constant resolver audit re-run, and **an explicit amendment of the LOCKED §5a DP formula**. Also creates a weird incentive: garrison becomes the cheap defense currency, dwarfing the alloy-heavy turret economy the fortification ceiling depends on.
- **RECOMMENDATION: Option 1 for v1**, with the §5a "DP drops" sentence re-framed as flavour in DESIGN (or left as the known tension). Flagged to Jay (§8, B2) as the primary decision of this task.

### 3.c At resolution: survivors return, losses are deducted

- **Today:** casualties are **report-only** — per-member `losses = round(committed × loss_pct)` is computed (0011:359–376) but **no garrison/fleet is deducted and nothing returns** (B6 carry, P3-T04). Pinned by 05 case 7 (repelled: losses 180/60 reported, source fleets stay 0).
- **Design (recommended — DESIGN-consistent uniform reading):** the §5a casualty table (40/70/60/90% attacker loss) applies to **every member, winner and losers alike** (the resolver already applies one `v_loss_pct` to the whole attacker side). Per member at resolve:
  - `losses = round(committed × loss_pct)` (unchanged — keep the report field as-is);
  - `survivors = committed − losses` **return to the member's source planet garrison** (`source.garrison += survivors`);
  - `fleet` decrements by the full `committed` (deployed pool drains: lost + returned).
- **Ambiguity to flag (§8):** the task prompt's "winner's survivors return… losers lose their committed force" could be read as winner-keeps-all. **That is NOT §5a-consistent** (the table gives no special winner rate) and would flip the tradeoff (winner also took the planet — a pyrrhic 70% loss on the winner is the interesting outcome DESIGN wants). **Recommend the uniform reading; flag for Jay** if he wants winner-favoured survival instead (that WOULD need a DESIGN amendment).
- **Edge — conquest transfer vs survivor return ordering:** the resolver resets the *target* planet's `garrison/fleet/population = 0` on a take (0011:388–389). Survivor returns go to the attacker's *source* planets, not the target, so no conflict — but order matters (return must use the pre-reset source state / a fresh `FOR UPDATE`).
- **Edge — garrison cap on return:** barracks garrison cap (`5,000 × effLevel`) is enforced by *conversion* (accrual.ts:129–136), not by a clamp. A survivor return could push `garrison` over cap. **Decide: clamp to cap (recommended) or allow over-cap** (simplest, self-corrects as accrual never converts beyond cap). Flag §8.
- **Edge — source planet lost mid-flight:** async PvP means the attacker's source planet can be conquered while their attack is in flight. **Decide: return survivors to the source planet regardless of current owner (recommended — simple, garrison column survives on the row) or only if the member still owns it (survivors otherwise lost).** Flag §8.

### 3.d `attack_members` needs `source_planet_name`

- **Schema today:** `attack_members(attack_id, player_id, soldiers_committed, shipyard_tier, joined_at)` — PK `(attack_id, player_id)` (0004:44–51). **No source planet anywhere.** `launch_attack`/`join_attack` receive `p_source_planet_name`, validate it, snapshot the tier — and **discard the name**.
- **Verified:** to return survivors (3.c) the resolver needs each member's source planet. **Migration 0012 required:**
  - `alter table public.attack_members add column source_planet_name text references public.owned_planets (planet_name);`
  - backfill NOT NULL is impossible (0004 applied, rows may exist without it) → add as nullable, set NOT NULL forward via a `CREATE OR REPLACE` of `launch_attack`/`join_attack` (they already have the value in `p_source_planet_name` — 0011:88–197 re-creates `join_attack` ONLY; `launch_attack` remains defined at 0005:104–276, so **0012 must `CREATE OR REPLACE` BOTH `launch_attack` AND `join_attack`**; store it in the INSERT at 0011:173–174 (join) and 0005:249–250 (launch)).
  - The resolver's survivor-return loop then joins each member row to its `source_planet_name` (`owned_planets.planet_name` is UNIQUE, 0001:55, so the FK is sound; the planet_name stays the same row through conquest transfers).
  - RLS: `attack_members` keeps owner-scoped rows (0004:96–99) — adding a column does not widen visibility; the resolver is SECURITY DEFINER so the update path is unaffected.
- Note: `get_attack`'s roster JSON (0011:565–571) may optionally gain `source_planet_name` for display ("who's exposed from where").

---

## 4. Fortification Economy

- **Cost curve verified:** credits = `2000 × 1.15^level` (economy.ts:20); level 0→1 = 2,000, level 10 ≈ 8,091, level 20 ≈ 32,733, level 30 ≈ 132,290. Alloy = **flat 1,000/level** (`data.ts:68` used as a constant at `accrual.ts:226`). **Only the credits escalate.**
- **Alloy supply is thin:** Ore Mine = `5 alloys/min` (effects.ts:12; game_config `ore_alloys_per_min` 5), starter alloys 0 (0006:74). **Turrets are the ONLY alloy consumer in the v1 roster** (no other structure carries `alloyCost`, data.ts:20–70) — so "fortification drains the planet's economy" is real only in that alloy is slow; there is **no competing alloy sink**, which weakens the "drains the economy / slows growth elsewhere" tension (§5 line 135). Flag §8.
- **Cap on turrets per planet:** none (unlimited slots). `effectiveLevel` halves the marginal DP past 10 but DP growth never stops — the "maxed fortress" is an *economic* ceiling, not a structural one. Emergent 10× is consistent with this (§1.3).
- **Biggest economy blocker:** already covered in §1.2/§3.0 — no server build RPC, no server accrual → the alloy-spend loop (buy turret → grid updates → DP rises) is **client-only today** and never reaches the resolver.

---

## 5. Gap Analysis — LIVE vs TO-IMPLEMENT (P3-T05-B/C)

### 5.1 Live (no work needed)
1. Turret cost curve (credits ×1.15^level) + flat alloy, DP formula 500×eff + 0.15×pop (+1.1 massiveWorld), unbounded DP, ratio-based resolution of heavily-fortified targets.
2. War-weariness counter (sliding 24h, per-player, 1.2^n, exclude-self), applied at resolve via per-member AP deflation; estimator parity exact (solo + gang).
3. Report fields (`losses`, per-member `weariness`, deflated `combined_ap`) already expose what the deduction model needs to compute.

### 5.2 To implement (the P3-T05-B surface)
| Gap | Design (from §1–§4) | Suggested home |
|---|---|---|
| **Server accrual / build-update RPC** | Prerequisite for everything (§3.0): server must advance population/garrison/fleet (or accept build/upgrade writes) so garrison exists to deduct and the fortify loop is real | New migration 0012 (+ possibly a `sync_planet` / `build_structure` RPC) — **blocker B1** |
| **Garrison deduction at launch/join** | `garrison -= soldiers`, `fleet += soldiers` under a source `FOR UPDATE`; guards `soldiers <= garrison` and `fleet+soldiers <= fleetCap` (shipyard×1000) | 0012 (CREATE OR REPLACE `launch_attack`/`join_attack`) + suite re-seeding |
| **`attack_members.source_planet_name`** | Migration + store in launch/join INSERT (§3.d) | 0012 + resolver read |
| **Survivor return + loser deduction at resolve** | Per member: `losses = round(committed × loss_pct)` (kept), `survivors = committed − losses → source.garrison`, `fleet -= committed`; ordering vs conquest reset; cap clamp; mid-flight-loss edge | 0012 (CREATE OR REPLACE `resolve_attack`) |
| **Estimator parity** | New client guards mirroring launch validation (`canDeploy(garrison, fleet, fleetCap, soldiers)`), survivor math, and (only if Option 2 chosen) a garrison term in `defensePowerEstimate` | `src/sim/player/estimator.ts` + `tests/backend-estimator.test.ts` |
| **UI weariness surface (audit §2.2)** | Render `my_weariness` from `get_galaxy` in the scout/launch panel; optionally expose per-member weariness in `get_attack` roster | Client + tiny 0012 `get_attack` tweak |
| **Conquest reset** | Unchanged: taken planet `garrison/fleet/pop = 0` (0011:388–389) — already correct for the model | none |

---

## 6. Testing Approach (recommendation for -B/-C)

**New `supabase/tests/06_fortification.sql`** (extends the 05 convention — `BEGIN…ROLLBACK`, actors, `RAISE '8653 ASSERTION FAILED'`, `npx --no-install supabase db query --linked -f …`, exit 0 / HTTP 201), run against the applied 0001–0012 set:

| Case | Pin |
|---|---|
| **Fortified-target ratio math** | High turret levels (e.g. t30 → eff 20 → DP 10,000) vs large AP → exact 1.5 decisive / 1.0 pyrrhic / 0.75 repelled boundaries at fortress scale; verify resolver handles large DP with no precision surprise (numeric rounding as in 04) |
| **Turret cost curve pins** (client-side) | `structureCost(2000, level)` at levels 0/1/10/20 (2,000 / 2,300 / ≈8,091 / ≈32,733); alloy flat 1,000 at every level (documenting current behaviour — flips if Jay orders alloy escalation, §8) |
| **Garrison deduction at launch** | Seed source garrison 1,000: launch 400 → source `garrison 600, fleet 400`; launch 700 (over garrison) → rejected; launch over `fleetCap` → rejected |
| **Survivor return** | Decisive (0.4 loss): source garrison +0.6×committed, fleet → 0; pyrrhic (0.7): +0.3×; winner AND losers both return survivors (uniform reading pin) |
| **Loser deduction** | Repelled (0.6): +0.4× returned; crushed (0.9): +0.1×; report `losses` unchanged from today |
| **Exposed-window DP — ONLY if Option 2** | DP with garrison vs garrison deployed (DP drops); skipped under Option 1 |
| **`source_planet_name` integrity** | member rows carry the real source; survivor returns land on the correct planet; mid-flight source-loss edge (if authorised) |
| **Regression** | 02/04/05 suites re-run **with garrison seeded** on source planets (their launch recipes otherwise fail the new guard) — all 6 suites exit 0 |

**Estimator updates + parity pins** in `tests/backend-estimator.test.ts`: `canDeploy` guard (garrison/fleet-cap), survivor math mirror (`survivors = committed − round(committed×loss_pct)`), and — only under Option 2 — `defensePowerEstimate` gaining the garrison term with parity pins against 06.

**Regression risk to call out:** adding the garrison guard + deduction touches every launch in 02/04/05 (all seed garrison 0). The pinned AP/DP/outcome/loss numbers do NOT change — only the seeding and the post-launch garrison/fleet state assertions. -B must update those suites in the same change or they break live.

---

## 7. Blockers / Decisions for Jay

1. **B1 — Server accrual/build prerequisite (critical).** The soldier-commitment model needs server-side garrison/fleet/population state (and a way for the fortify loop to change grids) that today exist only client-side. Without a server accrual (or build/upgrade RPC) in 0012, launch-garrison guards make every launch fail. **Decision:** ship server accrual (recommended — matches async PvP), or an explicit build/upgrade RPC chain, or declare garrison a client-seeded value (anti-fraud risk). This is the gating decision for the whole task.
2. **B2 — Garrison-DP tension (the design decision).** Option 1 (garrison OUT of DP — LOCKED formula preserved; exposed window = flavour + UI; ~zero cost) vs Option 2 (garrison IN DP — real exposure; resolver/estimator/effects/game_config/pins/27-constant-audit + a §5a formula amendment, and it undercuts the alloy-heavy turret economy). **RECOMMEND Option 1.** §5a's "DP drops while they're gone" sentence becomes flavour.
3. **B3 — The "10× ceiling" meaning.** Mechanical parenthetical ("AP needed up to 10× DP") is false under the LOCKED ratio table. **RECOMMEND emergent/turret-driven** (no code change); if Jay wants a literal 10× repel guarantee, it's a new mechanic + DESIGN amendment.
4. **B4 — Uniform vs winner-favoured casualty reading.** Uniform per-member `loss_pct` (survivors return for everyone, winner included — §5a-consistent; recommended) vs winner-keeps-all (needs a DESIGN change). Flag: the task prompt's wording hints winner-keeps-all.
5. **B5 — Survivor return edge cases.** Garrison-cap clamp on return (recommend clamp) · source-planet-lost-mid-flight (recommend unconditional return to the planet, else survivors lost). Both need a Jay call or an explicit default.
6. **B6 — Alloy cost escalation.** DESIGN "alloy-heavy and escalate fast" vs code = flat 1,000/level (credits escalate only), and turrets are the ONLY alloy sink. **Decision:** keep flat for v1 (recommended — simplest, matches §4c table) or mirror the ×1.15 curve on alloy too (more faithful to §5's "drains the economy" but heavier). Also consider a second alloy consumer later to make the drain meaningful.
7. **B7 — Weariness UI + gang transparency.** Ship a `my_weariness` UI surface (recommended — it's data already returned) and decide whether `get_attack` roster gains per-member weariness for gang previews. Low cost, real strategy value.
8. **Carried from T04 (no change):** in-flight weariness counting KEEP-authorised (§2.1); sliding-24h vs "resets daily" wording noted as a doc nit.

---

## 8. Surfaced Findings (new)

1. **No server build/upgrade RPC and no server accrual** — the fortify loop and the garrison economy are client-sim only today. This is the single largest blocker for B2 (elevated to B1).
2. **`source_planet_name` is discarded at launch/join** — the resolver has no way to return survivors without the 0012 column (§3.d).
3. **Alloy cost is flat while DESIGN says "escalate fast"** — and alloys have no competitor use in v1 (B6).
4. **The 10× ceiling is narrative, not mechanical** (§1.3) — the ratio table always lets a 1.5× decisive attacker take a fortress.
5. **Deploying troops has zero mechanical effect on the source planet today** (§3.b) — the "exposed window" is flavour until B2 decides.

---

## 9. Files Touched (this audit)

- **Created:** `docs/P3_T05_A_AUDIT.md` (this file). **Nothing else changed.** No commit. No `main` work. No remote contact.
- Evidence reviewed: DESIGN §4c/§4d/§5/§5a/§5b/§5c, ROADMAP P3-T04/T05 rows, docs/P3_T04_EVIDENCE.md + P3_T02_EVIDENCE.md + P3_T04_A_AUDIT.md, supabase/migrations/0001–0011, supabase/tests/02_attack_rls.sql + 04_conquest_math.sql + 05_band_together.sql, src/sim/structures/data.ts + effects.ts, src/sim/core/economy.ts, src/sim/planets/levels.ts, src/sim/player/estimator.ts + accrual.ts + wallet.ts + types.ts, src/ui/components/ResourceBar.tsx + useGameState.ts, tests/backend-estimator.test.ts.
