# P3-T03-A — Conquest Math Audit (AP/DP ratio, outcomes, casualties)

*Documentation-only audit — NO implementation, NO commit. Branch `staging`, HEAD `30991d8`. Scope bounded to §5a conquest math: does the LIVE resolver implement DESIGN §5a exactly, does AP/DP mirror the client estimator, what are the casualty/edge semantics, and how do we test it.*

**LIVE resolver** = `resolve_attack()` as created in `0005_attack_rpcs.sql` and re-created (B1 weariness fix, `defender_id`) in `0008_attack_read_rpcs.sql` — 0008's `CREATE OR REPLACE` is what runs today. All line references below are to 0008 unless noted (0005 lines given where the behaviour predates 0008).

---

## 1. Resolver-vs-Design Audit

### 1.1 DESIGN §5a (LOCKED) — the reference

| Ratio | Result | Attacker loses | Defender loses |
|---|---|---|---|
| ≥ 1.5 | Decisive win — planet taken | 40% of force | Planet + population + turrets |
| 1.0 – 1.5 | Pyrrhic win — planet taken | 70% of force | Planet + population + turrets |
| 0.75 – 1.0 | Repelled — attack fails | 60% of force | 30% population, some turrets |
| < 0.75 | Crushed — attack fails | 90% of force | Minimal |

Formula (LOCKED): **AP = deployed soldiers × Shipyard tier** · **DP = Turrets × turret strength + (population × 0.15 militia rate)** · **Ratio = AP ÷ DP**. Garrison excluded from DP (LOCKED §5a garrison model + audit B5). small ±5% random variance = balance-phase knob, **not v1**.

### 1.2 Every numeric constant in the LIVE resolver vs DESIGN

The resolver's constants fall into **five classes**: **(1) SEEDED** — game_config-sourced from the 0006 seed, missing keys RAISE loudly via `game_config_number`; **(2) IMPLEMENTATION-POLICY** — absence/behaviour assertions where DESIGN leaves a value unspecified (B4 "some turrets", "minimal", garrison-in-DP, ±5% not-v1, tie-break) so there is **no seeded value to read**; **(3) GUARD** — hardcoded sentinels and guards that are not game constants; **(4) DESIGN-LOCKED** — fixed by locked DESIGN text (§5), not a tunable; **(5) PRESENTATION** — non-math formatting.

| # | Constant | Value | Source | DESIGN §5a | Resolver use (0008 line) | Match |
|---|---|---|---|---|---|---|
| 1 | `turret_defense_power_per_level` | 500 | **SEEDED** (0006) | "Turrets × turret strength"; worked example "500 × Turret levels" | DP = `v_turret_per_level × v_eff_turret + …` (0008:177,183) | ✅ |
| 2 | `militia_defense_per_population` | 0.15 | **SEEDED** (0006) | "population × 0.15 militia rate" | DP militia term (0008:178,183) | ✅ |
| 3 | `effective_level_cap` | 10 | **SEEDED** (0006) | effectiveLevel = "levels beyond 10 count as half" (P2 whole-phase fix) | `least(v_turret_level, v_eff_cap) + greatest(0, v_turret_level − v_eff_cap) × v_diminishing` (0008:179,182) | ✅ applied **server-side** |
| 4 | `diminishing_returns_factor` | 0.5 | **SEEDED** (0006) | "count as half" | same expression (0008:180,182) | ✅ |
| 5 | `massive_world_multiplier` | 1.1 | **SEEDED** (0006) | D4 quirk table — Massive World anchors defenses +10% | DP ×1.1 when `v_target.massive_world` (0008:184–186) | ✅ |
| 6 | decisive `min_ratio` | 1.5 | **SEEDED** (0006) | "≥ 1.5" | `>=` bucket (0008:215) | ✅ boundary inclusive |
| 7 | decisive `attacker_loss` | 0.4 | **SEEDED** (0006) | "40% of force" | `v_loss_pct := 0.4` (0008:216) | ✅ |
| 8 | pyrrhic `min_ratio` | 1.0 | **SEEDED** (0006) | "1.0 – 1.5" | `>=` bucket (0008:217) | ✅ |
| 9 | pyrrhic `attacker_loss` | 0.7 | **SEEDED** (0006) | "70% of force" | (0008:218) | ✅ |
| 10 | repelled `min_ratio` | 0.75 | **SEEDED** (0006) | "0.75 – 1.0" | `>=` bucket (0008:219) | ✅ |
| 11 | repelled `attacker_loss` | 0.6 | **SEEDED** (0006) | "60% of force" | (0008:220) | ✅ |
| 12 | crushed `min_ratio` | 0.0 | **SEEDED** (0006) | "< 0.75" | `else` (0008:221–222) | ✅ |
| 13 | crushed `attacker_loss` | 0.9 | **SEEDED** (0006) | "90% of force" | (0008:222) | ✅ |
| 14 | `defender_pop_loss_repelled` | 0.3 | **SEEDED** (0006) | "30% population" | `population = population × (1 − 0.3)` (0008:273–276) | ✅ |
| 15 | repelled turret loss | — | **IMPLEMENTATION-POLICY** (absence: B4 v1 exclusion — "some turrets" not implemented) | "**some** turrets" | **NO turret change on repelled** (0008:268–277) | ⚠️ **B4 v1 exclusion** — see §7 blocker |
| 16 | crushed defender loss | — | **IMPLEMENTATION-POLICY** (interpretation of unspecified DESIGN, NOT verified) | "Minimal" | **NO defender change on crushed** (0008:268–277) | ⚠️ "minimal" → none is **our reading** of unspecified DESIGN language, not a seeded constant — see §7 |
| 17 | garrison term in DP | — | **IMPLEMENTATION-POLICY** (absence matches LOCKED formula) | LOCKED §5a formula — garrison NOT in DP (B5) | absent (0008:183) | ✅ absence matches LOCKED §5a formula |
| 18 | `war_weariness_multiplier` | 1.2 | **SEEDED** (0006) | draft tunable "+20% required force per 24h conquest" | `1.2^count(PRIOR launches in window)` via helper (0008:192) | ✅ B1-fixed (first = 1.0×) |
| 19 | `war_weariness_window_hours` | 24 | **SEEDED** (0006) | draft tunable "within 24h" | helper window (0008:82) | ✅ |
| 20 | ±5% random variance | — | **IMPLEMENTATION-POLICY** (absence: knob explicitly not v1) | "balance-phase knob, **not v1**" | **absent** | ✅ correctly absent (not-v1) |
| 21 | zero-DP sentinel | 9999 | GUARD (hardcoded) | — (guard, not in DESIGN) | `elsif v_ap > 0 then v_ratio := 9999` (0008:203–204) | ✅ guard mirrors estimator |
| 22 | zero-DP-zero-AP sentinel | 0 | GUARD (hardcoded) | — (guard) | `else v_ratio := 0` (0008:205–206) | ✅ |
| 23 | `greatest(v_dp, 0)` | — | GUARD (hardcoded) | — (division-by-zero guard) | `v_required_dp := greatest(v_dp, 0) × v_weariness` (0008:200) | ✅ |
| 24 | conquest reset values | 0 / 0 / 0 | DESIGN-LOCKED (§5) | "Planet + population + turrets" lost; §5 line 129 "everything survives EXCEPT defenses" | `population=0, garrison=0, fleet=0`, grid minus `defenseTurret`, `claimed_at=now()` (0008:257–267) | ✅ (pop reset 0 = "lost"; §5 LOCKED) |
| 25 | shipyard tier snapshot default | 0 | GUARD (hardcoded) | "AP = deployed soldiers × Shipyard tier" | `coalesce((structure_levels->>'shipyard')::smallint, 0)` at launch/join (0005:143,305) | ✅ invalid source rejected, never silent-0 |
| 26 | winner tie-break | — | **IMPLEMENTATION-POLICY** (DESIGN-silent) | "planet goes to the attacker with the highest committed force" | `order by soldiers_committed desc, joined_at asc, player_id asc` (0008:230–232) | ✅ DESIGN silent on ties → implementation choice, §7 |
| 27 | report rounding | 4/2 dp, round() | PRESENTATION (non-math) | — (presentation) | `round(ratio,4)`, `round(dp,2)`, `round(weariness,4)`, member `round(losses)` (0008:245–250, 295–298) | ✅ non-math |

**No mismatches against §5a except the deliberate B4 v1 exclusion (#15, "some turrets" on repelled)** and the DESIGN-silent tie-break (#26). **Seeded rows (#1–#14, #18, #19)** are 0006 `game_config` keys — a deleted seed key RAISES (`game_config_number`), so drift is loud, unlike the B1 weariness case in P3-T02 (which was a hardcoded off-by-one, now fixed via the helper at 0008:68–91). **The rest are NOT seeded values**: #15–#17, #20 and #26 are implementation-policy observations (absence/behaviour assertions with no key to read), and #16's "minimal → none" is our interpretation of unspecified DESIGN language, not a verified constant.

### 1.3 Boundary-inclusivity reading

DESIGN writes "≥ 1.5", "1.0 – 1.5", "0.75 – 1.0", "< 0.75". The **only** self-consistent reading is `≥` on all three upper boundaries (1.5 decisive, 1.0 pyrrhic, 0.75 repelled, else crushed), because "≥ 1.5" forces the ≥1.5→decisive direction and "1.0 – 1.5" then forces ≥1.0→pyrrhic, etc. The resolver and the client estimator both use `>=` — **consistent, no drift**. (Already pinned in `tests/backend-estimator.test.ts:16–43`.)

---

## 2. AP/DP Computation — Verification

### AP (attacker power)
- **Formula:** `sum(soldiers_committed × shipyard_tier)` over attack members — 0008:195–198. Band-together combines member APs against the defender's **FIXED, unchanged** DP (§5 LOCKED).
- **`shipyard_tier` source:** snapshotted at launch/join from the **source planet's `structure_levels` jsonb** (`->>'shipyard'::smallint`) — 0005:143–150 (launch), 0005:305–312 (join). It is a **launch-time snapshot**, not re-read at resolve; an upgrade mid-flight does not raise AP. CHECK on `attack_members.shipyard_tier` is `between 0 and 100` (0004:48).
- **Raw tier, not effectiveLevel:** AP uses the RAW shipyard tier (`smallint` from the grid), matching DESIGN's literal "× Shipyard tier". The resolver does **not** apply `effectiveLevel` to the shipyard the way it does to turret DP. DESIGN §5a's formula is literal; effectiveLevel is defined for *structure effects* (§4, P2) and the shipyard's fleet cap already caps the deployable pool. → decision note for Jay (§7).
- **`soldiers_committed`:** `double precision > 0` (0004:47); launch/join reject NaN/±∞/≤0 (0005:137, 299).

### DP (defense power)
- **Formula:** `500 × effectiveLevel(turrets) + 0.15 × population`, then `× 1.1` when `massive_world` — 0008:177–186.
- **effectiveLevel server-side — CONFIRMED present (P2 whole-phase fix honored):** 0008:182 computes `least(level,10) + greatest(0, level−10) × 0.5` from the 0006 seed (`effective_level_cap=10`, `diminishing_returns_factor=0.5`). This is **exactly** `effectiveLevel()` in `src/sim/planets/levels.ts:6–14` (`min(level,10) + max(0,level−10)×0.5`). A level-21 turret defends as `15.5` effective levels (DP 7,750) on both sides. **No bypass** — unlike the P2 whole-phase finding, the live server path reads the effective level.
- **Garrison excluded (B5):** no garrison term in the DP expression (0008:183). LOCKED §5a formula + garrison model ("soldiers defend automatically" is handled by garrison → soldier counts only, not DP).
- **Turret level source:** `structure_levels->>'defenseTurret'::int`, coalesced to 0 — same read `get_galaxy` uses for its `turret_level` (0008:470), so the scout preview and resolve see the same value.

---

## 3. Client Estimator Parity (`src/sim/player/estimator.ts`)

| Function | Estimator | Resolver | Parity |
|---|---|---|---|
| `attackPower` (73–85) | `soldiers × shipyardTier`; tier int 0..100, soldiers > 0 | `sum(committed × snapshot_tier)`; CHECK 0..100, > 0 | ✅ same formula + guard range |
| `defensePowerEstimate` (91–100) | delegates to `defensePower` (effects.ts:73–84) = `500 × effectiveLevel + 0.15 × pop`, ×`massive_world_multiplier` | 0008:177–186 | ✅ identical, shared sim helper |
| `warWearinessMultiplier` (108–118) | `1.2^recentLaunches` | `war_weariness_multiplier_for(launcher, NULL)` = `1.2^count(current launches)` | ✅ `get_galaxy.my_weariness` == estimator |
| `estimateRatio` (122–137) | `max(DP,0) × weariness`; `>0 → ap/required`, `ap>0 → 9999`, else `0` | 0008:200–207 | ✅ exact mirror |
| `estimateOutcome` (145–161) | `>=` buckets, same 0006 table | 0008:215–223 | ✅ exact mirror |
| `estimateScout` (227–246) | end-to-end AP/DP/weariness/ratio/outcome/lossPct/losses | resolve report | ✅ |

**Every constant in `PVP_CONSTANTS` (estimator.ts:40–63) matches the 0006 seed value-by-value** and is pinned by `tests/backend-estimator.test.ts:94–138` (the P3-T01 balance-drift guard). No drift found.

### Parity test matrix (resolver expected value == estimator expected value)

All values computed with weariness 1.0 (first conquest). DP = `500×eff(t) + 0.15×pop`, `eff(t)=min(t,10)+max(0,t−10)×0.5`.

| # | Scenario | Setup | DP | AP | Ratio | Outcome | Attacker losses |
|---|---|---|---|---|---|---|---|
| 1 | Boundary decisive (exactly 1.5) | t3 turrets, pop 0; soldiers 750 × tier 3 | 1,500 | 2,250 | 1.5 | decisive | `round(750×0.4)=300` |
| 2 | Boundary pyrrhic (exactly 1.0) | t3 turrets, pop 0; soldiers 500 × tier 3 | 1,500 | 1,500 | 1.0 | pyrrhic | `round(500×0.7)=350` |
| 3 | Boundary repelled (exactly 0.75) | t3 turrets, pop 0; soldiers 375 × tier 3 | 1,500 | 1,125 | 0.75 | repelled | `round(375×0.6)=225` |
| 4 | Just below 0.75 | t3 turrets, pop 0; soldiers 374 × tier 3 | 1,500 | 1,122 | 0.748 | crushed | `round(374×0.9)=337` |
| 5 | Zero-defender (DP=0) | t0 turrets, pop 0, not massiveWorld; soldiers 100 × tier 1 | 0 | 100 | 9999 | decisive | `round(100×0.4)=40` |
| 6 | Zero-AP (shipyard tier 0, reachable per T02 finding) | t1 turret, pop 0; soldiers 100 × tier **0** | 500 | 0 | 0 | crushed | `round(100×0.9)=90` |
| 7 | massiveWorld (DP pin) | t2 turrets, pop 1,000, massiveWorld | 1,265 | — | — | — | `(1000+150)×1.1` |
| 8 | effectiveLevel (P2 fix, DP pin) | t11 turrets, pop 0 | 5,250 | — | — | — | `eff=10.5` |
| 9 | Populated colony (DP pin) | t0 turrets, pop 1,000 | 150 | — | — | — | militia only |
| 10 | Weariness stack | as #1 but launcher has 3 prior launches in window | 1,500 | 2,250 | 2,250/(1,500×1.728) ≈ 0.868 | repelled | `round(750×0.6)=450` |
| 11 | Repelled 30% pop (pin) | t2 turrets, pop 1,000; soldiers 300 × tier 3 | 1,150 | 900 | 0.783 | repelled | `round(300×0.6)=180`; defender pop 1,000 → **700** |

Note: boundary rows (#1–#4) use pop 0 + turret-only DP so DP and AP are **exact integers** — the quotient lands exactly on 1.5 / 1.0 / 0.75. The draft originally claimed `333.33 × tier 3 = 1,000 AP`; in fact `333.33 × 3 = 999.99` (and `333.3333 × 3 = 999.9999`) is **below** 1,000, so the ratio is 0.9999… < 1.0 and the inclusive `>=` bucket (0008:217) selects **repelled, not pyrrhic** — a silent boundary-regression risk. Never derive a boundary from a repeating decimal; integer recipes only. The militia term shifts DP (see #11), so a pop-carrying repelled case must recompute soldiers. §6.1 lists the exact recipes the SQL suite will use.

---

## 4. Casualty Semantics (verified in the resolver)

- **Attacker losses:** per-member `losses = round(soldiers_committed × attacker_loss_pct)` — **report flavour only** (0008:237–252). The resolver performs **no server-side garrison/fleet deduction and no survivor return**: source planets are never touched by `resolve_attack`. Surplus = `committed − round(committed × loss_pct)` (e.g. pyrrhic at 70%: committed 500 → 350 lost, ~150 "survive"). Those survivors are **not written back** anywhere — the whole commitment-deduction/survivor model is **B2, deferred to P3-T05** (documented in the 0008 header and P3-T02 evidence §5). Until then the UI treats commitment as an estimate/plan.
- **Defender pop loss:**
  - decisive/pyrrhic → **population = 0** (fresh-settlement, P2-T04 D6) — 0008:263.
  - repelled → **population × (1 − 0.3)** — 0008:273–276.
  - crushed → **no change** (DESIGN "minimal" → none).
- **Conquest transfer (decisive/pyrrhic):** owner := winner, `is_home=false`, `unconquerable=false`, grid **minus `defenseTurret`** (turrets destroyed — §5 line 129 LOCKED), `population=0`, `garrison=0`, `fleet=0`, `claimed_at=now()` — 0008:257–267. Every structure **except** defenseTurret survives (Ore Mine, Trade Hub, Housing, Hydroponics, Barracks, Shipyard kept).
- **Winner:** highest-committing member (`soldiers desc, joined_at asc, player_id asc` tie-break) — 0008:226–234. Loser attackers get no planet; casualties applied to their report rows only.
- **Notifications:** `invasion_landed` to the previous owner, `planet_fell` to them on a take, `attack_result` to every member — 0008:316–343.

---

## 5. Edge Cases

| # | Edge | Resolver behaviour (verified) | Verdict |
|---|---|---|---|
| 1 | Ratio exactly 1.5 / 1.0 / 0.75 | `>=` → 1.5 decisive, 1.0 pyrrhic, 0.75 repelled (0008:215–223) | ✅ inclusive, DESIGN-consistent |
| 2 | DP = 0 (division-by-zero guard) | `v_required_dp := greatest(v_dp,0) × weariness`; `>0 → ap/req`, `ap>0 → 9999`, else `0` (0008:200–207) | ✅ no division by zero; 9999 → decisive |
| 3 | Attackers win with 0 survivors | e.g. pyrrhic 70% on small commits rounds to full loss (`round(1×0.7)=1`). Resolver makes no survivor bookkeeping either way (B2) | ✅ report-correct; nothing further happens |
| 4 | Defender population 0 | militia term 0; DP comes from turrets only. pop 0 + t0 → DP 0 → edge #2 | ✅ |
| 5 | Zero-AP (shipyard tier 0 source) | AP = 0; with DP > 0 → ratio 0 → **crushed 90%** (constructible per T02 finding: soldiers>0 from a tier-0 shipyard passes launch) | ✅ matches estimator |
| 6 | All-DP-with-no-AP band | 0 AP vs any DP > 0 → crushed; vs DP 0 → ratio 0 → crushed | ✅ |
| 7 | `v_target` row missing | `FOR UPDATE` select `not found` is not guarded (0008:163–167) — planets are never deleted, so unreachable today | ✅ (note for T05 if deletion ever lands) |
| 8 | Repelled report rounding vs stored pop | stored `population × 0.7` unrounded; report `population_after` uses `round(prev × 0.7)` (0008:285) → can differ by <0.5 | ⚠️ cosmetic, §7 |
| 9 | Massive world + effectiveLevel together | both compose: `(500×eff + 0.15×pop) × 1.1` | ✅ |
| 10 | Defender upgrades turrets mid-flight | DP computed from the **current** grid at resolve (FOR UPDATE re-read) — preview can differ from resolve outcome; DESIGN "fortify-or-grow" implies this is intended | ✅ note only |

---

## 6. Testing Approach (for -C / -B)

### 6.1 SQL contract suite — NEW `supabase/tests/04_conquest_math.sql` (does not exist yet; created in -B/-C)

Pinned by `resolve_due_attacks()` reports + post-resolve `owned_planets` reads. Existing `02_attack_rls.sql` only asserts owner transfer + winner + resolve gating — **no outcome/casualty/turret pins** live today, so this suite is the first exact-math coverage. Exact-integer boundary recipes (DP from turrets only, pop 0):

| Bucket | Exact recipe | Expected report |
|---|---|---|
| decisive (≥1.5) | t3 turrets (DP 1,500), soldiers 750 × tier 3 → AP 2,250 | ratio 1.5, outcome `decisive`, loss 0.4 |
| pyrrhic (1.0) | t3 turrets (DP 1,500), soldiers 500 × tier 3 → AP 1,500 | ratio 1.0, outcome `pyrrhic`, loss 0.7 |
| repelled (0.75) | t3 turrets (DP 1,500), soldiers 375 × tier 3 → AP 1,125 | ratio 0.75, outcome `repelled`, loss 0.6 |
| repelled 30% pop pin | t2 turrets + pop 1,000 (DP 1,150), soldiers 300 × tier 3 → AP 900 | ratio 0.783, outcome `repelled`, defender pop 1,000 → **700** (turret key survives) |
| crushed (<0.75) | t3 turrets (DP 1,500), soldiers 374 × tier 3 → AP 1,122 | ratio 0.748, outcome `crushed`, loss 0.9 |
| zero-DP | t0 turrets, pop 0 | ratio 9999, outcome `decisive` (AP>0) |
| zero-AP | tier-0 shipyard source, soldiers 100 | ratio 0, outcome `crushed` (DP>0) |

Why all-integer recipes: DP = 500 × 3 turret levels = **1,500**, AP = soldiers × tier 3 — both exactly representable, so the quotient is exactly 1.5 / 1.0 / 0.75 in double precision. The draft's `333.3333 × 3` pyrrhic recipe produced 999.9999 < 1,000 → ratio 0.9999… < 1.0, which the inclusive `>=` check at 0008:217 would route to **repelled instead of pyrrhic**, silently breaking the boundary pin. Assertions below therefore hard-code the integer recipes above.

Assertions per bucket:
- **casualty pins:** `report.members[].losses == round(committed × loss_pct)` for each member (incl. band-together — two members, verify per-member and the winner tie-break).
- **transfer + turret destruction on win:** owner_id = winner; `structure_levels` has **no** `defenseTurret` key; population/garrison/fleet = 0; `is_home`/`unconquerable` = false; economy keys survive.
- **repelled 30% pop:** population × 0.7; turrets **unchanged** (B4 pin — assert defenseTurret key still present).
- **crushed:** population + turrets unchanged.
- **zero-DP guard:** report ratio 9999, no division error.
- **massiveWorld:** report `defense_power` == `(500×eff + 0.15×pop) × 1.1`.
- **effectiveLevel server-side:** turrets 11 → `defense_power` 5,250 (+ militia); turrets 21 → 7,750 (+ militia). This is the P2 whole-phase server pin.
- **weariness:** 2nd launch in window → `war_weariness_multiplier` 1.2 in report (first = 1.0). B1 already covered in 02; assert the multiplier only.

Run as `npx --no-install supabase db query --linked -f supabase/tests/04_conquest_math.sql`; failures RAISE `8653 ASSERTION FAILED` → non-zero exit, matching 01/02/03 conventions.

### 6.2 Client parity tests (`tests/backend-estimator.test.ts`)

Extend with a **resolver-expected parity** describe block that hard-codes the §3 matrix expected values (documented as "the values the SQL suite pins server-side"), so a drift on either side fails the same case in both suites: exact-boundary `estimateOutcome`/`estimateRatio`/`estimateScout` cases at 1.5 / 1.0 / 0.75 and just-below, zero-DP (9999), zero-AP (0), massiveWorld, effectiveLevel (t11/t21), repelled 30% pop end-to-end, weariness stack.

### 6.3 Gates (unchanged from P2/P3-T02)
`npx vitest run` · `npx tsc -b` (exit 0) · `npm run lint` (exit 0) · `npm run build` (exit 0) · 01/02/03/**04** SQL suites exit 0.

---

## 7. Blockers / Decisions for Jay

1. **B4 — "some turrets" on repelled is NOT implemented (v1 exclusion).** DESIGN §5a row 3 says the defender loses "30% population, **some turrets**"; the resolver applies pop × 0.7 only (0008:268–277, unchanged from 0005) because "some" is unspecified. **Decision:** keep the v1 exclusion (recommended — matches P3-T02 B4 ruling) or quantify "some" (e.g. `defender_turret_loss_repelled` %) for a later knob.
2. **Shipyard tier in AP is RAW, not effectiveLevel.** Resolver + estimator use the raw tier snapshot (0005:143/305; estimator.ts:73–85), while turret DP applies effectiveLevel server-side (0008:182). DESIGN §5a is literal ("× Shipyard tier") but the P2 whole-phase convention applied half-after-10 to defense structures. **Decision:** keep raw (recommended — §5a formula is LOCKED, fleet cap already limits the pool) or apply effectiveLevel to AP.
3. **Winner tie-break when highest commits are equal.** DESIGN says "highest committed force" but is silent on ties; resolver picks `soldiers desc, joined_at asc, player_id asc` (0008:230–232) — first-joiner wins. **Decision:** accept the implementation default or specify (e.g. split-pool / random).
4. **Survivor/commitment bookkeeping is deferred (B2, P3-T05).** Attacker casualties are report flavour only; no garrison/fleet deduction, no survivor return. The audit confirms this is the current state — P3-T05 must decide return-to-garrison vs lost.
5. **Repelled report rounding vs stored pop (cosmetic).** `population_after` is `round(prev × 0.7)` in the report while the stored value is unrounded — a <0.5 discrepancy window. **Decision:** align (round the stored update too) or leave.
6. **Resolve-time DP snapshot.** Defenders may upgrade turrets/planet during flight; resolve uses the current grid. Confirmed as intended ("fortify-or-grow") but worth a DESIGN note that scout previews can differ from resolve reality.

---

## 8. Files touched (this audit)

- **Created:** `docs/P3_T03_A_AUDIT.md` (this file). **Nothing else changed.** No commit. No `main` work. No remote contact.
- Evidence reviewed: DESIGN §5a/§5 (§137–159), 0005/0008/0006/0004 migrations, `src/sim/player/estimator.ts`, `src/sim/structures/effects.ts`, `src/sim/planets/levels.ts`, `src/sim/planets/quirks.ts`, `docs/P3_T02_EVIDENCE.md`, `tests/backend-estimator.test.ts`, `supabase/tests/02_attack_rls.sql`.
