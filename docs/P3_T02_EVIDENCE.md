# P3-T02 — Attack Flow: Evidence

*Closeout evidence for **P3-T02 Attack flow** (Phase 3 — Supabase Backend + Async PvP). Consolidates the subtask record for `-A`/`-B`/`-C`/`-D`. Per WORKFLOW.md, no raw HEAD SHAs are embedded in prose — SHAs appear only via commit subjects where the record already references them. The whole task is Codex-PASSED.*

---

## 1. Subtask Record

| Subtask | Scope | Status | Evidence |
|---|---|---|---|
| **-A** | Audit: scout → commit → launch → travel (real distance) → resolve | Complete | `docs/P3_T02_A_AUDIT.md` (committed "docs: P3-T02-A attack flow audit (lifecycle map, gap analysis, B1-B8) + live shield-rejection assertion"); lifecycle map, read-RPC gap, blockers B1–B8, shield-rejection block added to `02_attack_rls.sql` |
| **-B** | Implement: full async attack lifecycle with distance-based travel timers | Complete | `supabase/migrations/0008_attack_read_rpcs.sql` + `0009_attack_report_rls.sql` (read RPCs + weariness fix + report RLS); `src/backend/supabase.ts` + `src/backend/api.ts` (supabase-js client + wrappers); `src/sim/player/estimator.ts` (scout estimator); committed "feat: P3-T02-B attack flow — read RPCs (0008) + report RLS (0009) + supabase-js client + estimator (551 tests)" |
| **-C** | Edge: travel time calc, concurrent attacks, cancellation | Complete | `supabase/tests/02_attack_rls.sql` extended (full edge suite incl. shield rejection, band-together join, 0009 report gate, foreign-conqueror + original-defender paths); `%rowtype` positional trap fixed → scalar vars (22P02); committed "fix: P3-T02-C live suite — replace %rowtype positional trap with scalar vars (22P02)"; **all 3 live suites exit 0 / HTTP 201** |
| **-D** | Evidence + Codex PASS | Complete | This doc; committed to `staging` |

---

## 2. Attack Flow — Lifecycle Map (as delivered)

| Step | Server (applied 0001–0007 + 0008/0009) | Client (P3-T02-B) | Gap status |
|---|---|---|---|
| **Scout** | `owned_planets` RLS is open to authenticated — full-info read of tier/distance/grid/pop/quirk already live; `get_galaxy()` now resolves due attacks on-read and returns each planet + inbound overlay + `my_weariness` + the resolved `game_config` PvP knobs | `estimateScout()` in `src/sim/player/estimator.ts` mirrors server DP/AP/weariness/ratio/outcome exactly | Closed (B6) |
| **Commit** | `launch_attack` / `join_attack` (0005, live): source ownership + shipyard-tier snapshot, credits deducted at launch, structured `attack_in_flight` + `join_attack_id` for band-together | `launchAttack`/`joinAttack` wrappers + `LaunchAttackResult` union (attack row OR `{launched:false, reason:'attack_in_flight', join_attack_id}`) | Closed; **B2 garrison deduction deferred to P3-T05** (estimates only) |
| **Launch** | travel `LEAST(GREATEST(round(distance×1min×60), 600), 172800)`; joins, under_attack notification | `launchCost` / `travelSeconds` mirror the 0006 seed exactly | Closed |
| **Travel** | async — nothing runs during flight; inbound open to all authenticated (coordination) | countdown/render data returned by `get_galaxy` (`inbound_attacks[]`) | Closed |
| **Resolve** | **lazy on-read wiring now live** — `get_player_state()` / `get_galaxy()` / `get_attack()` each call `resolve_due_attacks()` first (§5.3 D5; resolution always runs, reports gated); `resolve_attack` re-created for B1 (same signature, ACLs preserved from 0007) | reports/outcomes read via the gated read RPCs only | **Closed — this was the single biggest -B item** |

---

## 3. Read RPCs (0008) — the -B core

Three client-facing read RPCs, each **SECURITY DEFINER**, EXECUTE → `authenticated` + `service_role` only (0008 ACL block re-states the 0007 revoke on the internal resolver):

- **`get_player_state()`** — caller's wallet, owned planets, **MY attacks** (launcher / ORIGINAL defender via the new `attacks.defender_id` / member; inbound-to-me via owned planets), unread notifications. Response-gates attack rows to those sets — a conqueror who took a planet after a prior attack resolved is neither and never sees that prior attack.
- **`get_galaxy()`** — every owned planet (owner display_name, tier, population, garrison, fleet, turret_level, distance_pc, quirk flags, `inbound_attacks[]` overlay), the caller's CURRENT weariness (`war_weariness_multiplier_for(me)`), and the resolved `game_config` PvP knob subset the estimator mirrors (audit §2.3(a): the client never reads `game_config` directly — it arrives via the RPC response).
- **`get_attack(uuid)`** — single-attack read; visibility gate launcher / ORIGINAL defender / member / any-authenticated-while-inbound; **full detail (members + report) restricted to launcher / ORIGINAL defender / member**; the embedded `attack_report` is stripped from non-full-gated rows; `{found:false}` for unknown or out-of-gate callers.

`war_weariness_multiplier_for(launcher, exclude_attack_id)` is the **internal** helper (revoked from public/anon/authenticated): `1.2^count(prior launches in window)`.

## 4. B1 — War-weariness off-by-one (fixed forward in 0008)

The audit blocker B1 was a **live behaviour discrepancy**: 0005 counted the launcher's launches in the 24h window **including the attack being resolved**, so the first conquest already cost 1.2×. DESIGN §5a's "4th conquest needs 1.8×" (= 1.2³) implies the 1st must be 1.0×.

- **Fix (forward-only):** new helper `war_weariness_multiplier_for(p_launcher_id, p_exclude_attack_id)` computes `1.2^count(PRIOR launches in window)`, excluding the attack being resolved; `resolve_attack` is **re-created** (`CREATE OR REPLACE`, same signature — ACLs from 0007 preserved, re-stated belt-and-braces) to call it with the attack id. 0005 is not edited (applied).
- Read RPCs call the same helper with NULL to surface what a NEXT launch would face → `get_galaxy.my_weariness` and the estimator always agree.
- Pinned on both sides: `tests/backend-estimator.test.ts` asserts `warWearinessMultiplier(0)=1`, `(3)=1.728`; the estimator's `warWearinessMultiplier` mirrors `war_weariness_multiplier_for(launcher, NULL)`.

## 5. B2 deferred to T05 · B4 excluded · B3/B5 confirmed

- **B2 (soldier commitment deduction)** — **deferred to P3-T05** (explicit in the 0008 header). A garrison deduction would break the pinned `02_attack_rls` contract suite (launches seed garrison=0). Until then the UI renders commitment as an **estimate/plan**, and the read RPCs return garrison/fleet + the exposed-window data the client needs to render it. Known-limitation carried to the `-D` report.
- **B4 ("some turrets" on repelled)** — **explicit v1 exclusion**: "some" is unspecified in DESIGN, so turrets fully survive a repelled attack (pop × 0.7 only). 0008 makes **no turret change** on repelled; repairs/re-fortify are the defender loop.
- **B3 (survivors)** — already true in the applied 0005 resolve (commitment consumed, % losses as report flavour); confirmed by inspection, no code change.
- **B5 (garrison excluded from DP)** — already true in the applied 0005 resolve (LOCKED §5a formula); confirmed by inspection + pinned in the estimator (`defensePowerEstimate` delegates to `src/sim/structures/effects.ts`).

## 6. Client Wiring (supabase-js + wrappers + estimator)

- **`@supabase/supabase-js ^2.112.2`** added to `package.json` (+ lockfile).
- **`src/backend/supabase.ts`** — lazy `createClient`; **no real URL/anon key committed** (env placeholders `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`); degrades gracefully to the localStorage-only build when unconfigured; `signInAnonymously()` (B7/D2).
- **`src/backend/api.ts`** — typed wrappers for all three read RPCs + `launch_attack`/`join_attack`/`claim_home_planet`/`claim_colony`; arg shapes mirror the PostgREST `p_`-prefixed signatures; PostgREST errors surface as thrown `Error`s.
- **`src/sim/player/estimator.ts`** — pure scout/launch estimator: `attackPower`, `defensePowerEstimate`, `warWearinessMultiplier`, `estimateRatio`, `estimateOutcome`, `launchCost`, `travelSeconds`, `estimateScout`; `PVP_CONSTANTS` mirrors the applied `0006` seed **exactly** and is pinned by `tests/backend-estimator.test.ts` — **closing the P3-T01 open finding #2 (balance-drift)**.
- Exported from `src/sim/player/index.ts`.

## 7. The Security Saga (Codex correction rounds within -B)

1. **Round 1 — data leak + scope creep (Codex FAIL):** the original 0008 read-RPC design could hand a prior attack's row/report to a **conqueror** who took the planet *after* that attack resolved. Fixed by adding **`attacks.defender_id`** (the owner at resolution time, recorded by the re-created `resolve_attack`; `0005`'s attacker rows have no defender column) and gating `get_attack`/`get_player_state` on launcher / ORIGINAL defender / member only.
2. **Round 2 — report column leak via the table (Codex FAIL):** the 0004 SELECT policy + table-level `grant select` let the CURRENT owner of the target planet read `attack_report` directly, bypassing the RPC gate. Round 2 tried a column-level `revoke select (attack_report)` — **silent no-op**, because PostgreSQL column privileges do NOT subtract from a table-level grant.
3. **Round 3 — column-grant mechanics correction (0009):** column privileges **accumulate**, so the correct fix is `revoke select on table public.attacks from authenticated` then **re-grant column-by-column for every column EXCEPT `attack_report`**. The report column then becomes unreachable via the table for any authenticated role; it is delivered ONLY through the SECURITY DEFINER gates (owners bypass column privileges — `get_attack` unaffected). Guard asserts the END state idempotently (report column NOT selectable, `id` IS).

## 8. The `%rowtype` live-suite bug (-C)

The extended `02_attack_rls.sql` report-gate block originally loaded a full attack row into a `%rowtype` record. PostgreSQL assigns `SELECT INTO` to a record **by column position**, so with the `attack_report` column revoked the 12th positional value landed in the 12th field (`attack_report` jsonb) — a `22P02 invalid input syntax` live failure. Fixed by replacing the record with **scalar vars, each explicitly typed** (the 12th value `defender_id` coerces to uuid correctly), and re-verified live. Comment in the suite documents the trap.

## 9. LIVE Verification Evidence

- **Migrations 0008 + 0009 applied to live** (project ref `ogsleukfykumxsyvyusz`, StarBaron, Sydney — same project as P3-T01's applied 0001–0007). Applied during -B; `defender_id` column + re-created `resolve_attack` + three read RPCs + the 0009 grant swap all live.
- **All 3 SQL contract suites exit 0 / HTTP 201** against the linked project:
  - `01_claim_rls.sql` — PASS (exit 0): claim/colony RLS contract.
  - `02_attack_rls.sql` — PASS (exit 0): shield rejection (delta-colony, owner NOT backdated → `new-player shield`), travel floor 600 / mid 6000 / cap 172800, main launch + band-together join + double-join, resolve gated on `resolves_at`, `resolve_attack` not client-callable + ACL probe, RLS visibility matrix, **0009 report-column gate** (launcher + foreign conqueror see the row but not the report; `get_attack` hides it from the conqueror, `found:false`; ORIGINAL defender reads the report via `get_player_state` → `get_attack`).
  - `03_config.sql` — PASS (exit 0): game_config seed values + service_role-only read.
- Failures would RAISE `8653 ASSERTION FAILED` → non-zero exit; the `02` suite's live failure during -C (the `%rowtype` 22P02) was fixed forward in the committed suite and re-verified.

## 10. Gates (verified at closeout)

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **35 files / 551 tests PASS** (exact; ~5.6s wall / ~11.1s test time) |
| Typecheck | `npx tsc -b` | **exit 0** |
| Lint | `npm run lint` | **exit 0** (oxlint) |
| Build | `npm run build` | **exit 0** (dist built; chunk-size warning only) |
| SQL contract suites | `supabase db query --linked -f supabase/tests/01_claim_rls.sql` / `02_attack_rls.sql` / `03_config.sql` | **exit 0 × 3 / HTTP 201** against live |

## 11. Test Counts

**35 files / 551 tests PASS** at closeout (vitest run exact). P3-T01 closeout was 33 files / 515 tests; P3-T02-B added 2 test files (`tests/backend-api.test.ts`, `tests/backend-estimator.test.ts`) → 551. -C touched only the SQL suite (`02_attack_rls.sql` — not run by vitest), so the vitest count stays 551. The SQL contract suites are the task's live coverage and run against the linked project per §9.

## 12. Codex Verdicts (per subtask)

| Subtask | Verdict |
|---|---|
| -A | **PASS after 1 correction round** — two accuracy findings (zero-AP attack IS constructible; shield guard code-evidenced but rejection path NOT yet live-verified) reworded + a live-testable shield-rejection block added to `02_attack_rls.sql` |
| -B | **PASS after 3 correction rounds** — the security saga (§7): defender_id gating + 0009 column-grant mechanics fix (round 2's column-level REVOKE disproved; round 3's revoke-and-re-grant verified); 551 tests |
| -C | **PASS** — edge suite extended + live `%rowtype` 22P02 fixed → scalar vars; suites 01/02/03 exit 0 / HTTP 201 re-verified |
| -D | **PASS** — evidence + closeout |

Whole task: **P3-T02 Codex-PASSED**.

## 13. Branch / Remote State

- Branch: `staging` (no work on `main`).
- **No push, no tag, no deploy** — the live project already carries 0001–0009 (applied in prior subtasks) + the live suite passes; this closeout commits only the evidence + ROADMAP rows to `staging`.
- Working tree clean after this closeout commit.

---

*Prepared by OpenCode (deepseek-v4-flash) for P3-T02-D. Only `docs/P3_T02_EVIDENCE.md` + ROADMAP.md changed in this subtask.*
