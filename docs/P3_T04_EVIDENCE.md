# P3-T04 — Band-Together Attacks: Evidence

*Closeout evidence for **P3-T04 Band-together** (Phase 3 — Supabase Backend + Async PvP). Consolidates the subtask record for `-A`/`-B`/`-C`/`-D`. Per WORKFLOW.md, no raw HEAD SHAs are embedded in prose — SHAs appear only via commit subjects where the record already references them. The whole task is Codex-PASSED.*

---

## 1. Subtask Record

| Subtask | Scope | Status | Evidence |
|---|---|---|---|
| **-A** | Audit: multi-attacker join window, combined AP, highest-commitment wins | Complete | `docs/P3_T04_A_AUDIT.md` (committed "docs: P3-T04-A band-together audit (fixed-DP verified, G1-G4 gaps, B1-B7)"); **fixed-DP verified against the LIVE resolver** (0010 — DP computed from the defender's CURRENT grid only, no `attack_members` reference anywhere in the DP path), live-vs-missing matrix (9 DESIGN §5b elements), window/weariness gaps G1–G3, §6 05-suite plan, §7 blockers B1–B7, §8 surfaced findings |
| **-B** | Implement: joinable attacks, combined AP vs fixed DP, winner allocation | Complete | `supabase/migrations/0011_band_together.sql` (**window clamp B1/G1, per-player weariness B2/G3, join notifications B3/G4, min-join B4, window-state surfacing B2/G2**, `attack_joined` CHECK ALTER) + `src/sim/player/estimator.ts` `combinedAttackPower` + `supabase/tests/05_band_together.sql` (cases 1–7 + 9) + estimator parity pins; committed "feat: P3-T04-B band-together — window clamp, per-player weariness, join notifications, min-join, combined AP (0011, +577)" |
| **-B fix** | Live-suite JSON-null assertion | Complete | `05_band_together.sql` report-null assertion hardened (JSON `null` literal vs absent) — committed "fix: P3-T04-B live suite — JSON-null report assertion (05 exit 0)" |
| **-C** | Edge: join after launch window, simultaneous commits, tie | Complete | `05_band_together.sql` extended to **11 cases** (cases 8–11: 3-way per-player weariness pin, window-clamp boundary exacts, weariness expiry, in-flight-weariness semantics) + `tests/backend-estimator.test.ts` deep edges; committed "test: P3-T04-C band-together edges (window boundary, weariness 3-way, winner, notifications, +582) + surfaced findings" |
| **-D** | Evidence + Codex PASS | Complete | This doc; all gates re-verified live at closeout (§7) |

---

## 2. What -B Shipped (0011_band_together.sql)

`supabase/migrations/0011_band_together.sql` closes the audit gaps **G1–G4** with the Jay-authorised defaults **B1–B5/B7** (audit §7), forward-only, no schema changes — three `CREATE OR REPLACE` functions (same signatures/returns, ACLs persist) + one ALTER CHECK:

| Audit gap | Decision | 0011 implementation |
|---|---|---|
| **G1 / B1** — join window vs travel race | Clamp the window to `resolves_at` | `join_attack` accepts a join only while the attack is BOTH `inbound` AND `now() < least(launched_at + join_window_seconds, resolves_at)`. A join landing after `resolves_at` is rejected **even when the lazy resolver hasn't fired** — resolution no longer depends on when the lazy resolve happened to run. `>=` closes exactly at the boundary (previous check used `>`). |
| **G3 / B2** — per-player war-weariness | Deflate each member's AP by their OWN `1.2^count(their in-window launches)` | `resolve_attack` combined AP = `Σ soldiers × effectiveLevel(tier) / war_weariness_multiplier_for(player_id, p_attack_id)` per member. The old launcher-wide `× weariness` on required DP is GONE. Report keeps `war_weariness_multiplier` = the launcher's stack (informational, backwards-compatible) + gains per-member `weariness`; `combined_ap` now reports the DEFLATED total. **Solo equivalence:** `soldiers×tier/1.2^n ÷ DP == soldiers×tier ÷ (DP×1.2^n)`, so every applied 04 solo pin holds unchanged — the change only bites for gangs. |
| **G4 / B3** — join notifications | Dedicated `attack_joined` kind | `notifications.kind` CHECK ALTERed (0002) to admit `attack_joined`; `join_attack` inserts a row for the launcher + every existing member (not the joiner) with `attack_id / planet_name / actor_id / soldiers`. |
| **G9 / B4** — minimum join commitment | 100-soldier floor (implementation policy, tunable) | `join_attack` rejects `p_soldiers < 100` — closes the free 1-soldier member-gate read entry. |
| **G2 / B7** — window-state surfacing | No extension RPC; surface the state | `get_attack` response gains `window_closes_at` (the clamped close `least(launched_at + window, resolves_at)`) + `join_window_open` (inbound AND before the close) for every gate-passing caller. |

**Fixed-DP principle re-verified live:** `defense_power` is provably attacker-count-independent — the resolver's DP path (0010/0011) reads the defender's CURRENT grid only, never `attack_members`. Pinned by 05 case 1 (1v1, A 750×3 → AP 2250) vs case 2 (1v5, A–E 200/175/150/125/100 → total AP 2250): identical `defense_power` **1500**, identical ratio **1.5**, winner = highest single committer (A, 200). **More attackers never buffs the defender.**

**Estimator parity (same task, P3-T03 D1 precedent):** `combinedAttackPower(members, constants)` in `src/sim/player/estimator.ts` mirrors the 0011 resolver exactly — `Σ (soldiers × effectiveLevel(shipyardTier)) / 1.2^recentLaunches`, `recentLaunches` defaulting to 0. `tests/backend-estimator.test.ts` pins the same recipes (per-player weariness case-5 pin, effectiveLevel past tier 10, mixed high-tier + weariness, member validation delegation, empty gang → 0).

**Carry to P3-T05:** loser commitment DEDUCTION (audit B6/B2) stays deferred — casualties remain report flavour only; band-together increases the surface, P3-T05 must close it.

---

## 3. The -B Live-Suite Fix (JSON-null report assertion)

At -B live verification the 05 suite's inbound `get_attack` assertion falsely fired: `jsonb_build_object` emits a **PRESENT** `"report": null` key for an inbound attack (v_report is SQL NULL → JSON `null` literal), so `v_get->'report' is not null` is TRUE for a null JSON value. **Fix** (`1e6e607`): the assertion now requires `jsonb_typeof(...) = 'object'` for BOTH `->'report'` and the belt-and-braces `->'attack'->'attack_report'` — an inbound attack exposes NO report object. Suite re-verified **live exit 0**. (Mirrors the 02_attack_rls `%rowtype` and 04 weariness-pollution live-fix precedents — test-suite correctness, no resolver/migration change.)

---

## 4. The 05_band_together SQL Suite (live)

`supabase/tests/05_band_together.sql` — 11 non-persisting cases (`BEGIN…ROLLBACK`), run live against the applied 0001–0011 migration set, failures `RAISE '8653 ASSERTION FAILED'` → non-zero exit. Six distinct actors (A/B/C/D/E attackers + F defender) because the 1v5 fixed-DP case alone needs six distinct `player_id`s (PK `(attack_id, player_id)`).

| Case | Pin |
|---|---|
| 1–2 | **Fixed-DP**: 1v1 (A 750×3) vs 1v5 (A–E 200/175/150/125/100, total 2250 AP) → same `defense_power` 1500, same ratio 1.5; winner = highest single committer |
| 3 | **Window clamp (resolves_at term)**: backdate `resolves_at` past the close → join rejected while still `inbound` (lazy resolver not run); in-window join succeeds; defender roster via `get_attack`; `join_window_open`/`window_closes_at` surfaced |
| 4 | **Clamp with window < travel**: far target (distance 4000 → travel > 2h) — the window term alone fires |
| 5 | **Per-player weariness (2-way)**: A 144 (2 prior → /1.44) + B 700 fresh → combined 2400, ratio 1.6 decisive, winner B — discriminates vs the old launcher-only model (1758.3 → pyrrhic) |
| 6 | **Min-join B4**: 99 soldiers → `minimum join commitment`; 100 succeeds |
| 7 | **Repelled band + report-only losses**: A 300 + C 100 → ratio 0.8 repelled, `round(committed × 0.6)` in the report, NO fleet/garrison deduction (P3-T05 carry) |
| 8 | **3-way per-player weariness (case-5 deep)**: A 720 (3 prior → /1.2³ = 1250) + B 1000 (1 prior → 2500) + C 500 (fresh → 1500) → combined 5250, ratio 3.5 decisive, **winner B — highest COMMITTER, not launcher A**; economy survives, turrets destroyed, losers not deducted |
| 9 | **Window-clamp boundary exacts**: 1s-before-close ACCEPTED; exactly-AT-close REJECTED; resolves_at-term exact REJECTED; `join_window_seconds = 0` rejected by the schema CHECK |
| 10 | **Weariness expiry**: D with 1 prior EXPIRED (24h+1s ago) → 1.0; AP undiminished 1500 (NOT 1250) |
| 11 | **IN-FLIGHT weariness semantics**: D's second, still-inbound launch counts toward D's OWN stack → D's contribution deflated 1500 → 1250 (`weariness` 1.2), flipping the outcome to repelled — pins live behaviour, FLAGGED for Jay (see §8) |

**Concurrency — known limitation (carried from audit §6):** the suite is a single `db query` session; its sequential joins prove membership + PK dedup but cannot exercise `FOR UPDATE` lock serialisation or a genuine simultaneous-join race. `FOR UPDATE` serialisation is verified by code inspection (0005:314–318).

---

## 5. Test Counts

**35 files / 582 tests PASS** at closeout (`npx vitest run` exact; 5.69s wall). P3-T03 closeout was 570; P3-T04-B added 7 (+577 — `combinedAttackPower` estimator parity describe block), P3-T04-C added 5 (+582 — combinedAttackPower deep-edge describe block). The 05 SQL suite is the task's live coverage (§4) and does not run under vitest. No vitest count change at -D (the -B live fix was SQL-only; -D is evidence/closeout only).

## 6. Gates (verified at closeout)

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **35 files / 582 tests PASS** (exact; ~5.7s wall) |
| SQL contract suites | `supabase db query --linked -f supabase/tests/01_claim_rls.sql` / `02_attack_rls.sql` / `03_config.sql` / `04_conquest_math.sql` / `05_band_together.sql` | **exit 0 × 5 / HTTP 201** against live — 05 (P3-T04) + 02/04 (regression) + 01/03 green |
| Migration applied | 05 suite exercises the 0011 functions + `attack_joined` CHECK | 0011 live (suite passing is the proof; join clamp, per-player weariness, min-join, window surfacing all exercised) |
| Typecheck | `npx tsc -b` | exit 0 (P3-T03 closeout; no TS changes at -C/-D beyond estimator tests verified by vitest) |

## 7. Codex Verdicts (per subtask)

| Subtask | Verdict |
|---|---|
| -A | **PASS** — fixed-DP verified live, G1–G4 gap analysis, 05-suite plan, B1–B7 blockers |
| -B | **PASS** — 0011 (window clamp, per-player weariness, join notifications, min-join, window surfacing) + estimator parity + 05 suite live exit 0 (after the JSON-null assertion fix); 577 tests |
| -C | **PASS** — window-clamp exact boundaries, 3-way weariness, expiry, in-flight semantics, notifications, winner; +582 tests |
| -D | **PASS** — evidence + closeout |

Whole task: **P3-T04 Codex-PASSED**.

## 8. Decisions (audit §7, resolved)

| # | Decision | Resolution |
|---|---|---|
| **B1** (G1) | Window vs travel | **Clamp applied** — join window ends at `least(launched_at + window, resolves_at)`; joins rejected once the clamped close passes even before lazy resolve (deterministic, matches player intuition). Pinned 05 cases 3/4/9 |
| **B2** (G3) | Per-player war-weariness | **Per-member AP deflation applied** — each member's soldiers ÷ their OWN `1.2^n`. Solo math identical to launcher-only (04 solo pins hold); gangs diverge. Pinned 05 cases 5/8/10/11 |
| **B3** (G4) | Join notifications | **`attack_joined` kind added** (0002 CHECK ALTER) — launcher + existing members notified on each join |
| **B4** (G9) | Min join commitment | **100-soldier floor** (implementation policy, tunable) — closes the free 1-soldier member-gate read |
| **B5** (B6/B2 carry) | Loser commitment deduction | **Deferred to P3-T05** — casualties report-only; band-together increases the surface |
| **B6** (Gang-strength preview) | Combined-AP preview | **Estimator `combinedAttackPower` shipped** (client-side preview of gang AP vs fixed DP); galaxy-map overlay deferred to the galaxy screen build |
| **B7** (G2) | Window extension / state surfacing | **No extension RPC** (option (a)); `get_attack` surfaces `join_window_open` + `window_closes_at` |

## 9. Surfaced Findings

1. **In-flight weariness semantics — FLAGGED FOR JAY.** The live resolver counts a member's **IN-FLIGHT** (in-window, not-yet-resolved) attacks toward that member's OWN weariness stack — `war_weariness_multiplier_for` has no status filter. This deviates from a strict "resolved-only" reading of DESIGN §5b "+20%/24h per player". **Bridge decision — KEEP:** active commitment to a not-yet-resolved fight genuinely is recent war activity, and counting it needs no status filter and no resolve-race. Documented in audit §8.1 + pinned by 05 case 11 (`t-inf`). **If playtest finds the in-flight tax punishing** (e.g. two simultaneous launches both taxed 1.2×), the fix is a status filter on `war_weariness_multiplier_for` (count only `status='resolved'`) + re-pin case 11 + estimator parity.
2. **JSON-null report assertion fix** (§3) — a live-suite correctness fix, no resolver change; 05 exit 0 restored.
3. **Concurrency limitation** (§4) — single-session suite; `FOR UPDATE` verified by inspection, not live race.
4. **B4 v1 exclusion unchanged** — repelled turrets fully survive; "some turrets" stays unspecified (P3-T03 D2 carry).
5. **No raw SHAs in evidence prose** per WORKFLOW; commit subjects in §1 are the record.

## 10. Branch / Remote State

- Branch: `staging` (no work on `main`).
- **No push, no tag, no deploy** — the live project already carries 0001–0011 (0011 applied in -B) + all five live suites pass; this closeout commits evidence + ROADMAP rows to `staging`.
- Working tree clean after this closeout commit.

---

*Prepared by OpenCode (deepseek-v4-flash) for P3-T04-D. Changed in this subtask: `docs/P3_T04_EVIDENCE.md`, ROADMAP.md.*
