# P3-T03 — Conquest Math: Evidence

*Closeout evidence for **P3-T03 Conquest math** (Phase 3 — Supabase Backend + Async PvP). Consolidates the subtask record for `-A`/`-B`/`-C`/`-D`. Per WORKFLOW.md, no raw HEAD SHAs are embedded in prose — SHAs appear only via commit subjects where the record already references them. The whole task is Codex-PASSED.*

---

## 1. Subtask Record

| Subtask | Scope | Status | Evidence |
|---|---|---|---|
| **-A** | Audit: AP/DP ratio, 4 outcomes, militia 15%, garrison/deploy model | Complete | `docs/P3_T03_A_AUDIT.md` (committed "docs: P3-T03-A conquest math audit (27-constant resolver-vs-design, parity, edge cases)"); **27-constant resolver-vs-DESIGN table**, 5 constant classes (seeded / implementation-policy / guard / design-locked / presentation), boundary-inclusivity reading (`>=` on all upper boundaries), AP/DP computation verification, client-estimator parity matrix, casualty semantics, 10 edge cases, §6 testing plan, §7 decisions/blockers |
| **-B** | Implement: ratio resolution, casualty tables, garrison vs deployed state | Complete | `supabase/migrations/0010_ap_effective_level.sql` (**D1: AP now applies `effectiveLevel(shipyard_tier)`, mirroring the turret DP side** — `CREATE OR REPLACE` of `resolve_attack(uuid)`, same signature/ACLs, 0007/0008 revokes persist; no schema change, snapshot column keeps the raw grid tier, effect applied at computation time); `supabase/tests/04_conquest_math.sql` created (boundary / casualty / tie-break / weariness suite — **live exit 0**); `tests/backend-estimator.test.ts` extended (resolver-expected parity describe block hard-codes the §3 matrix — **estimator parity locked**); committed "feat: P3-T03-B conquest math — AP effectiveLevel alignment (0010) + 04 boundary/casualty/tie-break suite + estimator parity (562)" |
| **-C** | Boundary ratios (1.5, 1.0, 0.75), zero-defender edge | Complete | `04_conquest_math.sql` extended to 23 cases (**inclusivity at the exact 1.5 / 1.0 / 0.75 boundaries plus one-below each, both-zero guard, massiveWorld boundary FLIP, effectiveLevel 21 DP pin, AP tiers 11/15/21 parity, round()-vs-floor casualty pins, empty-pop, weariness-window expiry/inclusive boundaries**); `tests/backend-estimator.test.ts` +152 lines (P3-T03-C estimator block); committed "test: P3-T03-C conquest math edges (boundaries, zero-guards, MW flip, weariness window, rounding, +570)" |
| **-D** | Evidence + Codex PASS | Complete | This doc; live-suite regression found at -D verification (case-13 throwaways polluting the weariness window for cases 14–22) fixed with an expiry postlude + re-verified live exit 0; committed to `staging` |

---

## 2. Resolver-vs-Design Audit — 27-Constant Summary

`docs/P3_T03_A_AUDIT.md` §1.2 audits **every numeric constant in the LIVE resolver** (0008's `resolve_attack`, the applied re-creation that runs today) against DESIGN §5a, in five classes:

| Class | Count | Meaning | Drift |
|---|---|---|---|
| **SEEDED** | 14 | `game_config`-sourced (0006 seed): `turret_defense_power_per_level` 500, `militia_defense_per_population` 0.15, `effective_level_cap` 10, `diminishing_returns_factor` 0.5, `massive_world_multiplier` 1.1, decisive/pyrrhic/repelled/crushed `min_ratio` + `attacker_loss` (1.5/0.4, 1.0/0.7, 0.75/0.6, 0.0/0.9), `defender_pop_loss_repelled` 0.3, `war_weariness_multiplier` 1.2, `war_weariness_window_hours` 24 | **✅ all match** — a deleted seed key RAISES (`game_config_number`), so drift is loud, not silent |
| **IMPLEMENTATION-POLICY** | 5 | Non-seeded behaviour assertions: B4 "some turrets" on repelled = v1 exclusion (no turret change); crushed "minimal" → none (our reading of unspecified DESIGN); garrison excluded from DP (matches LOCKED formula); ±5% variance correctly ABSENT (knob not v1); winner tie-break | **✅/⚠️** — the only DESIGN divergence is the deliberate B4 v1 exclusion (#15); tie-break is DESIGN-silent → implementation choice |
| **GUARD** | 4 | Hardcoded sentinels: zero-DP 9999, zero-DP-zero-AP 0, `greatest(v_dp,0)`, shipyard-tier snapshot default 0 (invalid sources rejected, never silent-0) | **✅** guards mirror the client estimator exactly |
| **DESIGN-LOCKED** | 1 | Conquest reset (population/garrison/fleet = 0, grid minus `defenseTurret`, `claimed_at = now()`) | **✅** §5 LOCKED |
| **PRESENTATION** | 1 | Report rounding (ratio 4dp, DP 2dp, weariness 4dp, losses round) | **✅** non-math |

**Boundary-inclusivity** (§1.3): DESIGN's "≥ 1.5 / 1.0 – 1.5 / 0.75 – 1.0 / < 0.75" is only self-consistent with `>=` on all three upper boundaries. Resolver and client estimator both use `>=` — **consistent, no drift** (pinned in both suites).

**No mismatches against §5a except** the deliberate B4 v1 exclusion ("some turrets" on repelled, D2) and the DESIGN-silent tie-break (D3).

---

## 3. D1 — AP effectiveLevel alignment (0010) — the -B core

The audit found the ratio **silently inflated past level 10**: DP applied `effectiveLevel(turret)` server-side (half-after-10), but AP used the **raw** shipyard-tier snapshot — a tier-15 shipyard contributed ×15 to AP while a level-15 turret only defended as 12.5 effective levels. **D1 ruling (authorised default, applied in `0010_ap_effective_level.sql`):**

```
AP = sum(soldiers_committed × effectiveLevel(shipyard_tier))
   = sum(soldiers_committed × (least(tier, 10) + greatest(0, tier − 10) × 0.5))
```

- Same `effectiveLevel` the turret DP already reads, from the **same** `game_config` keys (`effective_level_cap`, `diminishing_returns_factor`) — a missing key still RAISES.
- Applied at **computation time** inside `resolve_attack` (combined AP + each per-member report `ap`); the snapshot column keeps the raw grid tier, the launch/join guards and table CHECK are untouched. `CREATE OR REPLACE` → `resolve_due_attacks()` (invokes by name as function owner) is untouched, ACLs persist, 0007/0008 revokes re-stated.
- **Estimator parity locked in the same task** — `attackPower()` mirrors it, and `tests/backend-estimator.test.ts` pins tiers 11/15/21 (×10.5 / ×12.5 / ×15.5) on both `attackPower` and `estimateScout`.
- Pinned **server-side** by the 04 suite: `t-effap` (tier 15 → ×12.5, ratio 1.5 decisive; raw ×15 would give ratio 1.8), `t-ap11`, `t-ap21`.

---

## 4. The 04_conquest_math SQL Suite (live)

`supabase/tests/04_conquest_math.sql` — 23 non-persisting cases (`BEGIN…ROLLBACK`), run live against the applied 0001–0010 migration set, failures `RAISE '8653 ASSERTION FAILED'` → non-zero exit.

```
npx --no-install supabase db query --linked -f supabase/tests/04_conquest_math.sql
```

**Exact-integer boundary recipes** (DP from turrets only, pop 0 — the audit §6.1 rule: never derive a boundary from a repeating decimal; the draft's `333.3333 × 3` pyrrhic recipe produced 999.9999 < 1,000 → ratio < 1.0 → wrong bucket):

| Case | Pin |
|---|---|
| 1–4 | **Boundaries**: decisive exactly 1.5 (750×t3 vs t3) / pyrrhic exactly 1.0 / repelled exactly 0.75 / crushed 0.748 just-below, each with `round(committed × loss_pct)` casualty pins (300/350/225/337) + transfer/turret-destruction/economy-survival/owner-reset on a win, and defender-unchanged on crushed |
| 5–6 | **Zero guards**: zero-DP (AP>0 → ratio 9999, decisive, losses 40) and zero-AP tier-0 shipyard (ratio 0, crushed, losses 90) |
| 7–8 | massiveWorld DP pin (500×2 + 0.15×1000) × 1.1 = 1265; effectiveLevel turret pin t11 → 500×10.5 = 5250 |
| 9 | **D1 AP pin**: tier-15 shipyard → AP 120×12.5 = 1500, ratio exactly 1.5 decisive (regression guard for 0010) |
| 10 | repelled 30% pop: 1000 → 700 stored + report, turrets FULLY survive (B4) |
| 11–12 | **Band-together + tie-break**: 2 members, per-member AP + casualties, highest committer wins; equal-commit → earlier joiner wins; equal joined_at → lower player_id wins |
| 13 | weariness stack: 2 prior in-window launches → 1.2² = 1.44, ratio 1.0417 pyrrhic, losses 525 |
| 14–16 | **-C**: just-below 1.5 (1.498 → pyrrhic, not decisive) and just-below 1.0 (0.998 → repelled); **both-zero** (DP 0 AND AP 0 → defined crushed, no crash) |
| 17 | **massiveWorld flip**: identical stats — control pyrrhic 1.05 vs MW repelled 0.9545 (×1.1 flips the bucket) |
| 18–19 | effectiveLevel 21 DP pin (500×15.5 = 7750); AP tiers 11/21 parity (1050 / 1550) |
| 20 | **rounding is round(), not floor**: 12 soldiers decisive → round(4.8) = 5 (floor would be 4); 501 → 200 |
| 21 | repelled with odd pop 1001: report `population_after` round(700.7) = 701 vs **stored unrounded** ≈700.7 (D5 pinned) |
| 22 | empty-pop (pop 0): DP turrets-only, militia 0.15×0 contributes nothing |
| 23 | **weariness window**: prior exactly 24h+1s ago → EXPIRED → 1.0; prior exactly 24h ago → INCLUSIVE → 1.2; 3 prior → 1.2³ = 1.728 (§5a "4th conquest needs 1.8×") |

**Live result at -D: `exit 0`** — after the regression fix in §7.

---

## 5. Estimator Parity (locked)

`tests/backend-estimator.test.ts` mirrors every resolver constant and recipe:
- `PVP_CONSTANTS` (estimator.ts:40–63) value-by-value vs the 0006 seed, pinned by the P3-T01 balance-drift guard.
- **P3-T03-B resolver-expected parity** describe block hard-codes the §3 matrix expected values (the SQL suite pins the same values server-side) — a drift on either side fails the same case in both suites: exact boundaries 1.5/1.0/0.75 + just-below, zero-AP, massiveWorld, effectiveLevel DP t11/t21, **effectiveLevel AP D1 (tier 15 → ×12.5)**, repelled 30% pop end-to-end, weariness 1.44 stack.
- **P3-T03-C estimator** block: one-epsilon-below boundary fall-through, both-zero edge, MW flip (control vs massive), AP tiers 11/15/21 parity, DP t11/t21/100 parity, round-vs-floor discrimination.

The resolver's `estimateRatio`/`estimateOutcome`/`estimateScout` are an **exact mirror** of 0008:200–223 (`max(DP,0)×weariness`, `>0 → ap/required`, `ap>0 → 9999`, else 0; `>=` buckets).

---

## 6. Test Counts

**35 files / 570 tests PASS** at closeout (`npx vitest run` exact). P3-T02 closeout was 35 files / 551 tests; P3-T03-B added 11 (`tests/backend-estimator.test.ts` parity block; +562), P3-T03-C added 8 (+570). The 04 SQL suite is the task's live coverage (§4) and does not run under vitest. No vitest count change at -D (the fix in §7 is SQL-only).

## 7. Gates (verified at closeout)

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **35 files / 570 tests PASS** (exact; ~6.2s wall / ~12.2s test time) |
| Typecheck | `npx tsc -b` | **exit 0** |
| Lint | `npm run lint` | **exit 0** (oxlint) |
| Build | `npm run build` | **exit 0** (dist built; chunk-size warning only) |
| SQL contract suites | `supabase db query --linked -f supabase/tests/01_claim_rls.sql` / `02_attack_rls.sql` / `03_config.sql` / `04_conquest_math.sql` | **exit 0 × 4 / HTTP 201** against live |

## 8. Codex Verdicts (per subtask)

| Subtask | Verdict |
|---|---|
| -A | **PASS** — 27-constant resolver-vs-design audit, parity matrix, edge cases, decisions/blockers |
| -B | **PASS** — 0010 AP effectiveLevel alignment (D1) + 04 boundary/casualty/tie-break suite live exit 0 + estimator parity locked; 562 tests |
| -C | **PASS** — boundaries, zero-guards, MW flip, rounding, weariness window; +570 tests. *Note: the appended weariness cases carried a live-suite ordering regression (see §9) caught and fixed at -D* |
| -D | **PASS** — evidence + closeout |

Whole task: **P3-T03 Codex-PASSED**.

## 9. Known Findings / Decisions

### Decisions D1–D6 (audit §7, resolved)

| # | Decision | Resolution |
|---|---|---|
| **D1** | **Shipyard tier in AP: raw vs effectiveLevel** | **APPLIED in 0010** — AP = `soldiers × effectiveLevel(tier)`, matching the turret DP side so the ratio stops inflating past level 10 (audit's "keep raw" recommendation rejected in favour of parity; authorised default). Pinned by t-effap/t-ap11/t-ap21 + estimator parity |
| **D2** | **B4 — "some turrets" on repelled** | **v1 exclusion kept** — "some" is unspecified in DESIGN, so turrets fully survive a repelled attack (pop × 0.7 only); matches the P3-T02 B4 ruling. Pinned by t-rep30/t-repodd turret-survival assertions. Revisit as a `defender_turret_loss_repelled` knob if playtest demands |
| **D3** | **Winner tie-break when highest commits are equal** | **Implementation default accepted** — `soldiers_committed desc, joined_at asc, player_id asc` (first-joiner wins; equal joined_at → lower player_id). Pinned by t-tie1/t-tie2 |
| **D4** | **B2 — survivor/commitment bookkeeping** | **Deferred to P3-T05** — attacker casualties are report-flavour only; no garrison/fleet deduction, no survivor return. UI treats commitment as an estimate/plan |
| **D5** | **Repelled report rounding vs stored pop** | **Accepted cosmetic discrepancy** — report `population_after` is `round(prev × 0.7)` while the stored value is unrounded (<0.5 window). Pinned by t-repodd (report 701 vs stored ≈700.7) |
| **D6** | **Resolve-time DP snapshot** | **Confirmed as intended** — defenders may fortify mid-flight; resolve uses the current grid ("fortify-or-grow"). Worth a DESIGN note that scout previews can differ from resolve reality |

### Findings resolved at -D

1. **Live-suite regression (weariness window pollution) — found + fixed at -D.** The -C appends (cases 14–23) were added **after** the case-13 weariness stack, whose throwaways (`t-wear1`/`t-wear2`) stay inbound at `launched_at = now()` and whose resolved pin also sits at `now()` — all three polluted the 24h window for every subsequent case, so cases 14–22 resolved against weariness 1.728 instead of 1.0. First observed live at -D verification: `t-below15 expected ratio 1.498, got 0.8669` (= 2247 / (1500 × 1.728)). **Fix:** an expiry postlude immediately after case 13 (`set launched_at = now() − 2 days where launcher_id = A and launched_at >= now() − 24h`, identical WHERE shape to the case-23 prelude) plus the case-13 header comment corrected ("Run LAST" was no longer true). Suite re-verified **live exit 0**; all four suites exit 0. No resolver/migration change — test-suite ordering only. (Mirrors the P3-T02-C `%rowtype` live-fix precedent.)
2. **Boundary-inclusivity** — the only self-consistent reading of §5a is `>=` on all three upper boundaries; both sides agree and both suites pin it. No drift.
3. **B4/D2 v1 exclusion** — "some turrets" on repelled remains the one deliberate DESIGN divergence, documented for Jay.
4. **The `333.3333 × 3` pyrrhic trap** (audit §6.1) — never derive a boundary from a repeating decimal; all suite recipes are integer.

## 10. Branch / Remote State

- Branch: `staging` (no work on `main`).
- **No push, no tag, no deploy** — the live project already carries 0001–0010 (0010 applied in -B) + all four live suites pass; this closeout commits the suite fix + evidence + ROADMAP rows to `staging`.
- Working tree clean after this closeout commit.

---

*Prepared by OpenCode (deepseek-v4-flash) for P3-T03-D. Changed in this subtask: `supabase/tests/04_conquest_math.sql` (regression fix), `docs/P3_T03_EVIDENCE.md`, ROADMAP.md.*
