# P3-T04-A — Band-Together Attacks Audit (join window, combined AP, winner allocation)

*Documentation-only audit — NO implementation, NO commit. Branch `staging`, HEAD `cb57342`. Scope bounded to DESIGN §5b band-together (LOCKED 2026-08-08): attacker APs COMBINE against the defender's FIXED, unchanged DP; launch window ~2h; highest-committed attacker wins; war-weariness +20%/24h **per player**. Verifies what is LIVE vs what is MISSING against the migration set 0004/0005/0006/0008/0009/0010, the live suites (02/03/04), and the client estimator.*

**LIVE resolver** = `resolve_attack()` as re-created in `0010_ap_effective_level.sql` (P3-T03-B D1 — AP applies `effectiveLevel(shipyard_tier)`). Line references are to 0010 for the resolver body, 0005 for `launch_attack`/`join_attack`, 0008 for the read RPCs / `defender_id`, 0004 for schema/RLS.

---

## 1. Band-Together Status vs DESIGN §5b

DESIGN §5b (line 133, LOCKED): *"multiple players can join an attack on one target within a launch window (e.g. 2h). Attacker APs COMBINE against the defender's FIXED, unchanged DP … War-weariness tax still applies per player per 24h … The planet goes to the attacker with the highest committed force — cooperation with one winner."*

### 1.1 Live-vs-Missing matrix

| # | DESIGN §5b element | LIVE? | Evidence | Verdict |
|---|---|---|---|---|
| 1 | `attack_members` table (multi-member band) | ✅ | 0004:44–51 — `attack_members(attack_id, player_id, soldiers_committed, shipyard_tier, joined_at)`, PK `(attack_id, player_id)`, finite+positive soldier CHECK, tier 0..100 CHECK, `on delete cascade` | **LIVE** |
| 2 | `join_attack()` exists and is client-callable | ✅ | 0005:278–354 — SECURITY DEFINER, EXECUTE → `authenticated` + `service_role` (0005:662) | **LIVE** |
| 3 | Combined AP in the resolver | ✅ | 0010:134–140 — `sum(soldiers_committed × effectiveLevel(shipyard_tier))` across all members | **LIVE** |
| 4 | Winner = highest-committing member | ✅ | 0010:167–176 — `order by soldiers_committed desc, joined_at asc, player_id asc` (tie-break D3, pinned 04:11–12) | **LIVE** |
| 5 | DP stays FIXED vs attacker count | ✅ | 0010:111–120 — `v_dp` computed purely from the defender's CURRENT grid (turret effectiveLevel + militia × pop × massiveWorld); **no member reference anywhere in the DP path**. **Confirmed: the Jay correction holds — dp does NOT go up because there are more attackers.** | **LIVE** (see §3) |
| 6 | Launch/join window (~2h) enforced | ⚠️ **PARTIAL** | 0005:328–331 — `join_attack` rejects once `now() > launched_at + join_window_seconds` (7200 from game_config, 0006:31). BUT (a) the window is measured from `launched_at`, independent of `resolves_at` — see §1.2 gap **G1**; (b) no extension mechanism — see §1.2 gap **G2**; (c) `launch_attack`'s `attack_in_flight` redirect (0005:184–200) returns a `join_attack_id` with **no window-state check** — a redirected player can land on a closed window | **PARTIAL — enforcement exists, semantics have gaps** |
| 7 | Notification to attackers when someone joins | ❌ | `join_attack` (0005:278–354) inserts **no notification row**. The only join-adjacent notifications are `under_attack` → defender at launch (0005:252–262) and `attack_result` → each member at resolve (0010:277–288) | **MISSING** |
| 8 | War-weariness per PLAYER (each attacker's own stack) | ❌ | 0010:126 — `war_weariness_multiplier_for(v_attack.launcher_id, p_attack_id)` — **the LAUNCHER's** prior-launch count alone inflates the whole combined-AP required DP. A joiner's own in-window launches contribute **nothing**. DESIGN "per player per 24h" is NOT implemented for band members | **MISSING — see §1.2 gap G3** |
| 9 | Minimum join commitment / cost | ❌ | `join_attack` only requires finite, positive `p_soldiers` (0005:299) — a **1-soldier, free join is valid** (no credits deducted for joiners; launch cost is launch-only). DESIGN §5b/§6 is silent on a join cost/minimum | **MISSING (DESIGN-silent) — see §7 blocker** |

### 1.2 Window / weariness gaps (the "what's missing" detail)

**G1 — the join window can outlive the attack.** `resolves_at = launched_at + travel_seconds` (0005:244) and travel floors at **600s** (0005:208; floor 10 min, §5.2). `join_window_seconds` is **7200s** from `launched_at` (0004:33 default). So an attack on a near target (travel 600s) resolves at launch+10 min but stays **join-open until launch+2h**. `join_attack` never checks `resolves_at` and never calls `resolve_due_attacks()`. Consequence: after an attack passes `resolves_at` but before the next lazy resolve fires (read RPC, 0008:380/459/562), a late joiner is **accepted**, their membership row is included by the resolver, and their soldiers change the combined AP / possibly the winner — resolution results depend on *when* the lazy resolve happened to run. For long-travel targets the window is the binding constraint (correct); for short-travel targets the effective close is timing-dependent. **Enforcement needs a decision (clamp window to `resolves_at`, or reject joins once `resolves_at <= now()`).**

**G2 — no window extension mechanism.** `join_window_seconds` is a per-attack column set at launch from `game_config` (0005:231/245). There is **no RPC to extend it** and clients hold no UPDATE grant on `attacks` (0004:76 only SELECT; 0009 revokes+re-grants SELECT columns). Only a direct postgres/service_role UPDATE could change it. DESIGN "e.g. 2h" is a draft value; the mechanics are closed.

**G3 — per-player weariness isolation is launcher-only.** The DESIGN intent ("the gang can't endlessly spam the same target") reads as each attacker facing their **own** +20%/24h stack. Today `resolve_attack` multiplies the **entire combined-AP required DP** by the launcher's `1.2^count(launcher prior launches)`; joiners with their own in-window launches (including their own simultaneous attacks elsewhere) pay **no extra** tax on their committed soldiers. The estimator's `warWearinessMultiplier` mirrors the launcher-centric model (estimator.ts:112–122; `get_galaxy.my_weariness` = `1.2^count(my launches)`, 0008:494). See §7 blocker for the interpretation options.

---

## 2. Join Semantics

### 2.1 Who can join an inbound attack (join_attack validation, 0005:278–354)

| Check | Where | Behaviour |
|---|---|---|
| Authenticated caller | 0005:295–297 | `auth.uid()` required, else `42501` |
| Soldiers finite + > 0 | 0005:299–301 | NaN/±∞/≤0 rejected |
| Source planet owned by caller + real shipyard snapshot | 0005:303–312 | `structure_levels->>'shipyard'`; invalid source rejected, never silent-0 |
| Attack exists + still `inbound` | 0005:314–325 | `FOR UPDATE`; resolved/unknown → raise |
| **Window open** | 0005:328–331 | `now() > launched_at + join_window_seconds` → `'join window closed'` |
| **Target owner excluded** | 0005:333–339 | cannot join an attack on your own planet |
| **Already-joined excluded** | 0005:341–345 | `'already a member of this attack'` (double-join; also enforced by the PK `(attack_id, player_id)`) |

**RLS for inbound visibility:** `attacks_participants_and_open` (0004:86–94) makes **inbound attacks visible to ALL authenticated** — band-together coordination *is* the mechanic. The **full member roster + report** are restricted to launcher / ORIGINAL defender / member via `get_attack` (0008:600–623); `attack_members` table rows are owner-scoped only (0004:96–99) — a client sees their own membership row, not the roster.

**Concurrency:** `join_attack` takes `FOR UPDATE` on the attack row (0005:314–318), serialising simultaneous joins; the PK dedups double-joins; `launch_attack` takes `FOR UPDATE` on the target planet row (0005:152–157) to enforce one-inbound-per-target. Join-first: a second launch at the same target is redirected to `join_attack_id` (0005:184–200). **No lost-update race found.**

### 2.2 Can the DEFENDER see who's coming? — YES

- **`get_attack(id)` full gate includes the defender while inbound.** `v_original_owner` falls back to the CURRENT owner for inbound attacks (0008:581–586; join-first blocks any handover mid-flight), so the defender is in the full-gate set (0008:603–606) and reads the **members roster** (`soldiers_committed`, `shipyard_tier`, `joined_at` — 0008:608–618) + the attack row. They do **not** see the report (null until resolved).
- **`get_galaxy()` inbound overlay shows only `attack_id, launcher_id, resolves_at`** (0008:474–485) — the galaxy map advertises *an* attack is incoming but not the roster or combined AP. The defender gets full detail through `get_attack`.
- **`get_player_state()`** surfaces inbound attacks against the defender's planets with the full row (0008:407–408) — the `attacks` array carries `attack_report: null` while inbound.

### 2.3 What stops griefing?

- **1-soldier / tier-0 join is valid and free** (0005:299, no cost deduction). A griefer can join any inbound attack with 1 soldier to (a) acquire member-gate read access to the full roster/report (0008:603) and (b) pollute the winner computation only if their commitment somehow tops the pool (impossible at 1 soldier). There is **no minimum commitment and no join cost** — DESIGN §5b/§6 is silent. Flagged as a blocker (§7).
- **Owner-join, double-join, closed-window, resolved-status, unowned-source** are all rejected (§2.1). The target-owner exclusion also means the defender cannot "counter-join".
- **Defender fortify mid-flight** is permitted and intended (D6, P3-T03 — "fortify-or-grow"; scout previews can differ from resolve).

---

## 3. The Fixed-DP Principle — Verification

Resolver DP path (0010:106–120), read top-to-bottom for any attacker dependence:

```
v_turret_per_level := game_config_number('turret_defense_power_per_level');   -- 500
v_militia_per_pop  := game_config_number('militia_defense_per_population');   -- 0.15
v_turret_level     := coalesce((v_target.structure_levels->>'defenseTurret')::int, 0);
v_eff_turret       := least(v_turret_level, eff_cap) + greatest(0, v_turret_level − eff_cap) × dim; -- effectiveLevel
v_dp               := 500 × v_eff_turret + 0.15 × v_target.population;        -- CURRENT grid, FOR UPDATE re-read
if v_target.massive_world then v_dp := v_dp × 1.1; end if;
```

- **DP is computed from the defender's CURRENT `owned_planets` state at resolution** (turret level from the grid, current population, massiveWorld flag) — re-read under `FOR UPDATE` at 0010:97–101, so mid-flight fortification counts (D6).
- **No term references `attack_members`.** The members table is read once, for combined AP (0010:134–140) and the winner/casualty loops — never for DP. `defense_power` in the report is `v_dp` (0010:243), which is identical whether 1 or 50 attackers commit.
- **Test implication (pinned in §6):** identical defender + identical total AP → identical `defense_power` and identical ratio whether the AP arrives as one 2250-AP attacker or five 450-AP attackers. DP never scales with gang size — the Jay correction ("dp wont be going up because there's more attackers") is **already true in the live resolver**.

Caveat: **required DP does scale with the LAUNCHER's weariness** (`greatest(v_dp,0) × v_weariness`, 0010:142) — that is a per-launcher tax on the *required force*, not a defender buff, and it is member-count-independent too.

---

## 4. Winner Allocation

- **Winner = highest `soldiers_committed`** (0010:167–176); equal commits → **earlier `joined_at`**; equal joined_at → **lower `player_id`** (D3 tie-break, already verified in P3-T03 and pinned live by 04 cases 11–12: t-tie1/t-tie2). Winner term runs for **decisive AND pyrrhic** (both take the planet).
- **What the winner actually gets** (0010:202–212, per DESIGN §5/§5a LOCKED + §5 line 129 "everything survives EXCEPT defenses"):
  - planet transfer: `owner_id := winner`, `is_home := false`, `unconquerable := false`, `claimed_at := now()`;
  - **turrets destroyed**: `structure_levels := structure_levels - 'defenseTurret'`;
  - **economy survives**: every other grid key (oreMine, shipyard, tradeHub, housing, hydroponics, barracks) is kept — pinned live by 04 case 1 (t-dec: oreMine 5 + shipyard 2 survive, defenseTurret gone);
  - reset `population := 0`, `garrison := 0`, `fleet := 0` (fresh settlement, P2-T04 D6).
- **Do LOSERS lose their committed soldiers?** **Reported as lost, not deducted.** Per-member casualty `losses = round(committed × outcome attacker_loss)` is computed for **every member** — winners and losers alike (0010:181–197; decisive 0.4 / pyrrhic 0.7 / repelled 0.6 / crushed 0.9). But **no server-side garrison/fleet deduction or survivor return happens anywhere** (B2, deferred to P3-T05 — documented in the 0008 header and P3-T02 evidence §5). So: losers see their casualty number in the report and the `attack_result` notification, but their fleet pool is untouched today.
- **Report/notification delivery:** `planet_fell` + `invasion_landed` → original defender (0010:261–275); `attack_result` → every member (0010:277–288); report gated via launcher / original `defender_id` / member (0008:600–623, 0009 column revoke).

---

## 5. Gap Analysis — LIVE vs TO-IMPLEMENT

### 5.1 Live (no work needed)
1. `attack_members` table + join RPC + combined AP (effectiveLevel-aligned) + highest-committer winner with tie-break.
2. Fixed DP vs attacker count (verified §3); per-member casualty report; conquest transfer with turret destruction + economy survival.
3. Join window guard (basic), target-owner exclusion, double-join exclusion, PK/concurrency safety.
4. Defender roster visibility via `get_attack` (inbound) — free to ship.
5. Client plumbing: `joinAttack` wrapper (api.ts:242–251), `attack_in_flight` union surfacing (api.ts:151–153, pinned backend-api.test.ts:138–156), `PVP_CONSTANTS.join_window_seconds = 7200` (estimator.ts:45, pinned backend-estimator.test.ts:118).

### 5.2 To implement (gaps)
| Gap | Detail | Suggested home |
|---|---|---|
| **G1 — window vs resolves_at** | Close joins at `least(launched_at + window, resolves_at)` (or reject when `resolves_at <= now()` inside `join_attack`). Currently a join can land *after* resolution and change the outcome. | 0005-altering migration (CREATE OR REPLACE `join_attack`) + 05-suite pin |
| **G2 — window extension / state surfacing** | No extension RPC (probably fine); at minimum the `attack_in_flight` redirect should report window state (`join_window_open`), and `get_galaxy` inbound overlay could carry `window_closes_at` so scouts/joiners see it without a per-attack call. | read-RPC tweak (0008 re-create) |
| **G3 — per-player weariness** | Decide semantics (§7 B1) then implement: e.g. each member's AP contribution deflated by that member's own `1.2^count(their launches)`, or a per-member personal-required-DP check. Launcher-only is a v1 simplification to confirm or change. | resolver (0010 re-create) + estimator parity |
| **Join notifications** | Add a notification to launcher + existing members when a player joins (`join_attack` writes a row). Requires extending the `notifications.kind` CHECK (0002:24 allows only the 5 §5b kinds — new kind = ALTER CHECK, e.g. `attack_joined`). | 0002-ALTER or new migration |
| **Minimum join commitment / cost** | DESIGN-silent; if Jay wants anti-grief, add a minimum-soldiers guard and/or a per-joiner cost (none exists today; launch cost is launch-only). | `join_attack` guard |
| **Combined-AP display / estimator parity** | `estimator.ts` has only single-player `attackPower` (estimator.ts:77–89) and `estimateScout`; `get_galaxy` inbound overlay carries no members/combined AP (0008:474–485). The client cannot show "gang combined AP vs fixed DP" on the galaxy map. If the UI should preview gang strength: new `combinedAttackPower(members)` + `estimateGang` functions mirroring 0010:134–140, and/or galaxy overlay gains `members`, `combined_ap`, `window_closes_at`. | estimator + 0008 read RPC |
| **Loser commitment deduction** | B2 (P3-T05) — casualties are report flavour; band-together makes loser losses visible but nothing is deducted. Carry forward. | P3-T05 |

---

## 6. Testing Approach

**Recommendation: NEW `supabase/tests/05_band_together.sql`** (extends the 04 convention; keeps 04's 23 case recipes untouched) run as `npx --no-install supabase db query --linked -f supabase/tests/05_band_together.sql` (exit 0 / RAISE `8653 ASSERTION FAILED` on failure; `BEGIN…ROLLBACK`, actors A/B/C/D/E/F + per-case targets — SIX actors: the 1v5 fixed-DP case needs 5 distinct attackers plus a distinct defender, all unique `player_id`s — integer recipes only).

| Case | Pin |
|---|---|
| **Fixed-DP: 1 vs 5 attackers → same DP** | Defender F t3 turrets/pop 0 (DP 1500). Solo: A 750×3 → ratio 1.5, `defense_power` 1500. Same target recipe fresh: 5 distinct attackers A/B/C/D/E × 150×3 (450 AP each, total 2250) vs defender F → **same `defense_power` 1500, same ratio 1.5** — DP provably attacker-count-independent. The 5 attackers (A–E) and the defender (F) are all distinct `player_id`s (PK `(attack_id, player_id)` forbids any repeat) — this case alone needs **six** actors (A/B/C/D/E/F), the suite maximum. Also assert `winner_id` = highest single committer when commits differ |
| **Window open/closed** | Backdate `launched_at` past `join_window_seconds` (or set `join_window_seconds` to a small value at launch) → join raises `'join window closed'`. In-window join succeeds. **G1 pin:** `resolves_at` in the past, status still `inbound` (no lazy resolve run yet) → document/assert current behaviour (join accepted) — the case that decides B1's clamp-vs-reject ruling |
| **Winner allocation** | 3 members, commits 900/500/200 → winner 900; post-resolve: owner = winner, `defenseTurret` key gone, economy keys survive, pop/garrison/fleet 0 |
| **Loser casualties** | Pyrrhic: winner and losers all get `round(committed × 0.7)` in the report (losers have no deduction today — B2 note); repelled: all members `round(committed × 0.6)`, defender pop × 0.7, turrets survive (B4) |
| **Per-player weariness (G3)** | Joiner C with 2 prior in-window launches joins A's attack → pin the CURRENT launcher-only report `war_weariness_multiplier` (unchanged by C's stack). This locks today's behaviour; when B1 is decided the pin flips |
| **Join rejections** | target owner joins own-planet attack → raise; double join → `'already a member'`; resolved-status join → raise; unowned source → raise; non-positive/NaN soldiers → raise |
| **Membership / PK (sequential, NOT concurrency)** | Two joiners sequentially (serial calls) → both members, no dup, second double-join rejected (`'already a member'`, PK `(attack_id, player_id)`) — this verifies membership semantics and PK dedup only; `launch_attack` during inbound → `attack_in_flight` union with the live `join_attack_id`. **True concurrency (FOR UPDATE lock serialisation / simultaneous-join race) is NOT covered here** — it needs concurrent sessions/transactions, which this single-session `BEGIN…ROLLBACK` suite cannot provide; see known limitation below |
| **Defender visibility** | Defender (while inbound) calls `get_attack` → full member roster returned; after conquest a foreign new owner gets `found:false` (regression — mirrors 02:j) |
| **Combined AP display parity** | If estimator adds `combinedAttackPower` (§5.2): hard-code the resolver-expected values in `tests/backend-estimator.test.ts` (same pattern as the P3-T03 parity block) and pin tiers 3/11/15/21 effectiveLevel on the combined sum |

**Estimator parity note:** any G3/combined-AP work must land on both sides in the same task (server resolver + `estimator.ts` + the parity test), matching the P3-T03 D1 precedent.

**Concurrency — known limitation:** `05_band_together.sql` runs as a single `db query` session (`BEGIN…ROLLBACK`); its sequential joins prove membership + PK dedup but **cannot** exercise `FOR UPDATE` lock serialisation or a genuine simultaneous-join race. Those need concurrent sessions/transactions (two connections calling `join_attack` at once), which belongs in an integration/harness check outside this pgTAP-style suite — e.g. two parallel `db query` invocations against a staged inbound attack asserting both join cleanly with no error, no dup, and one result. **Do not read this suite's sequential join case as concurrency coverage.** The `FOR UPDATE` mechanism itself is verified by code inspection (§2.1, 0005:314–318).

---

## 7. Blockers / Decisions for Jay

**Seven blockers (B1–B7)** — one per gap: B1↔G1, B7↔G2, B2↔G3; B3/B4/B5/B6 cover notifications, minimum commitment, loser deduction carry, and gang-strength preview.

1. **B1 — Join window vs travel (G1).** Window (2h) can exceed travel (floor 10 min), so joins can land after `resolves_at` and alter the outcome depending on when lazy resolve ran. **Decision:** (a) clamp the join window to `resolves_at` (`least(window, travel)`) — recommended; (b) reject joins once `resolves_at <= now()`; or (c) leave as-is (window from `launched_at`, document the race). Recommend (a) — deterministic and matches player intuition.
2. **B2 — Per-player war-weariness (G3).** DESIGN "per player per 24h" is currently launcher-only. **Decision:** (a) keep launcher-only for v1 (documented simplification — the combined gang faces the launcher's tax); (b) deflate each member's AP by that member's own `1.2^count(their launches)`; (c) per-member personal required-DP. Recommend (b) as the faithful reading — it makes a weary joiner genuinely costlier to the gang and matches §5b "can't endlessly spam".
3. **B3 — Join notifications.** DESIGN §5b lists notifications as a v1 meta layer, but who-joined is currently silent. **Decision:** add an `attack_joined` kind (ALTER the 0002 CHECK) notifying launcher + existing members, or fold it into `under_attack`-style payloads. Recommend a dedicated kind (joins are the drama surface).
4. **B4 — Minimum join commitment / cost.** Free 1-soldier joins let any authenticated player enter the member-gate (full roster/report read) at zero cost. **Decision:** add a minimum `p_soldiers` (e.g. 1% of the attack's current combined AP, or an absolute floor) and/or a per-joiner credit cost; or accept the spy-tradeoff for v1.
5. **B5 — Loser commitment deduction stays P3-T05 (B2 carry).** Losers "lose" % in the report only; no fleet deduction yet. Band-together increases the surface; P3-T05 must close it.
6. **B6 — Gang-strength preview.** `get_galaxy` shows launcher-only per inbound attack; the estimator is single-player. **Decision:** ship a combined-AP preview (new estimator function + galaxy overlay fields) in -B, or defer UI preview to when the galaxy screen is built.
7. **B7 — Window extension / state surfacing (G2).** `join_window_seconds` is set once at launch from `game_config`; no extension RPC exists and clients hold no UPDATE on `attacks` (0004:76; 0009 re-grant). **Decision:** (a) accept no-extension and only surface window state — `attack_in_flight` redirect reports `join_window_open`, `get_galaxy` inbound overlay carries `window_closes_at` so joiners/scouts see the close without a per-attack call (recommended, matches §5.2 G2); or (b) add an extension RPC (launcher-only, bounded, with a cap) as part of a future phase. Recommend (a) — closed mechanics are fine for v1; the missing piece is visibility.

---

## 8. Files Touched (this audit)

- **Created:** `docs/P3_T04_A_AUDIT.md` (this file). **Nothing else changed.** No commit. No `main` work. No remote contact.
- Evidence reviewed: DESIGN §5b/§5a/§5.2/§6 (lines 110–135, 137–159), ROADMAP P3-T04 rows, docs/P3_T03_EVIDENCE.md + P3_T02_EVIDENCE.md, `supabase/migrations/0004/0005/0006/0008/0009/0010`, `supabase/tests/02_attack_rls.sql` + `04_conquest_math.sql`, `src/sim/player/estimator.ts`, `src/backend/api.ts`, `tests/backend-api.test.ts`, `tests/backend-estimator.test.ts`.
