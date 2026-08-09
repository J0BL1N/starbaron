# P3-T01 — Supabase Schema: Evidence

*Closeout evidence for **P3-T01 Supabase schema** (Phase 3 — Supabase Backend + Async PvP). Consolidates the subtask record for `-A`/`-B`/`-C`/`-D`. Per WORKFLOW.md, no HEAD SHAs are embedded in prose — SHAs appear only where the record already references them (commit subjects). The whole task is Codex-PASSED.*

---

## 1. Subtask Record

| Subtask | Scope | Status | Evidence |
|---|---|---|---|
| **-A** | Audit: schema design — players, planets, structures, population, attack timers, RLS | Complete | `docs/P3_T01_A_AUDIT.md` — 12 decisions D1–D12 approved by Jay 2026-08-09; JSONB grids, anon auth, no server catalogue, game_config balance seed, DB-function resolve, server-authoritative scope |
| **-B** | Implement: forward-only migrations, tables + RLS + indexes | Complete | `supabase/migrations/0001_players_owned_planets.sql` … `0007_revoke_internal_execute.sql` (7 migrations); committed "feat: P3-T01-B Supabase schema — migrations 0001-0006 (RLS, claim/attack RPCs, game_config seed), Codex PASS after 6 audit rounds"; isfinite fix "fix: P3-T01-B isfinite() -> float8-safe NaN/Infinity checks (13 sites, unapplied migrations)" |
| **-C** | RLS probes: anon/authenticated/service_role behaviour | Complete | `supabase/tests/01_claim_rls.sql`, `supabase/tests/02_attack_rls.sql`, `supabase/tests/03_config.sql` + `docs/P3_T01_C_PLAN.md` (committed "test: P3-T01-C RLS probe suite + migration push plan"); security fix + signature alignment committed "fix: P3-T01-C security — 0007 revokes internal EXECUTE from authenticated + RPC signature alignment + ACL assertions"; **all 3 suites exit 0 against live** |
| **-D** | Evidence + Codex PASS | Complete | This doc; committed to `staging` |

---

## 2. Schema Summary — migrations 0001–0007 (all applied to live)

| Migration | Contents | Notes |
|---|---|---|
| `0001_players_owned_planets.sql` | `players` (id = `auth.uid()`, shared empire wallet `credits`/`alloys`, NaN/±∞ CHECKs); `owned_planets` (one row per owned planet, **JSONB `structure_levels`** = `Record<StructureId, number>`, quirk flag columns `massive_world`/`dense_core`, derived-field CHECKs) | **Two uniqueness indexes = the P3 promise made physical:** `owned_planets_name_unique` (at most one owner per planet, ever) + `owned_planets_one_home_idx` (partial unique, one unconquerable home per player). RLS + FORCE on both tables; REVOKE anon/PUBLIC; SELECT grants to authenticated. |
| `0002_meta_tables.sql` | `notifications` (v1 kinds under_attack/invasion_landed/planet_fell/attack_result/revenge), `seasons`, `leaderboard_snapshots` (schema-only; population = P4-T01, D6), **`game_config` (key/value, table + RLS here)** | `game_config` is service_role-ONLY read (resolved values reach clients via RPC responses, never the raw table). The table is created here because 0005's SQL-language function bodies are validated at creation. |
| `0003_claim_rpcs.sql` | `claim_home_planet(text, smallint, double precision, boolean, boolean)`, `claim_colony(…)` — SECURITY DEFINER + VOLATILE + `SET search_path = public, pg_temp` | Auth guard (`auth.uid()`), tier + distance validation, idempotent home re-claim, `pg_advisory_xact_lock` serialisation + `planet_taken` structured conflict (unique index = backstop), colony requires a home, derived values re-computed server-side (10×tier baseline, tier pop-cap table). EXECUTE → authenticated + service_role only. |
| `0004_attacks_members.sql` | `attacks` (uuid PK, status/outcome text+CHECK D7, travel/join-window CHECKs, due/join/target indexes), `attack_members` (band-together joins, soldiers finite+positive, shipyard_tier snapshot, PK attack_id+player_id) | **Recursion-safe RLS:** single-direction subqueries (attacks policy → attack_members membership only; attack_members policy is a pure `auth.uid() = player_id` gate). Inbound attacks visible to all authenticated (band-together coordination); no anon grants; no client write grants. |
| `0005_attack_rpcs.sql` | `game_config_value`/`game_config_number` (internal accessors), `launch_attack`, `join_attack`, `resolve_attack(uuid)` (INTERNAL), `resolve_due_attacks()` (lazy on-read, D5) | Travel time (floor 600 / cap 172800), launch cost (base + per-fleet + per-pc), new-player shield derived (D10), war-weariness at resolve-time (D11), combined AP vs fixed DP (band-together), DESIGN §5a outcome table + casualties, conquest transfer (grid − defenseTurret, §5 LOCKED), §5b notifications. Response gating: reports returned only to launcher / original target owner / member; service_role receives all. |
| `0006_game_config_seed.sql` | D9 draft tunables (travel/launch/join-window/weariness/shield/repelled) **+ D4 combat-balance constants** (turret DP 500, militia 0.15, effectiveLevel cap 10 + 0.5, quirk multipliers 1.1, tier pop-cap table, outcome_ratios_and_losses) | ON CONFLICT DO NOTHING idempotency. Missing keys RAISE in 0005 (drift is loud). Seed DATA only, no DDL. |
| `0007_revoke_internal_execute.sql` | **SECURITY FIX** — REVOKE EXECUTE on `resolve_attack(uuid)`, `game_config_value(text)`, `game_config_number(text)` from authenticated | Closes the verified authenticated-EXECUTE leak (see §4). Idempotent (REVOKE of absent privilege = no-op). Forward-only fix on top of already-applied 0005; no applied migration rewritten. |

---

## 3. LIVE Verification Evidence

- **Migration ledger — all 7 remote-applied.** `supabase_migrations.schema_migrations` on the live project (StarBaron ref **`ogsleukfykumxsyvyusz`**, org FJGroup, Sydney) records versions `0001`…`0007`. `supabase/.temp/project-ref` + `linked-project.json` confirm the local link to `ogsleukfykumxsyvyusz`/StarBaron.
- **All 3 SQL contract suites exit 0** (`npx --no-install supabase db query --linked -f supabase/tests/<file>.sql`; failures would RAISE `8653 ASSERTION FAILED` → non-zero exit):
  - `01_claim_rls.sql` — **PASS (exit 0)**: idempotent home re-claim, one-winner double-claim, colony rejection paths (no-home / NULL-name / double-colony / cross-owner), anon denied on `owned_planets` + claim RPC EXECUTE (42501), authenticated granted.
  - `02_attack_rls.sql` — **PASS (exit 0)**: launch guards (unknown target / 0 soldiers / unaffordable / unconquerable / own planet / unowned source), travel floor 600 / mid 6000 / cap 172800, join window + double-join, resolve gated on `resolves_at`, `resolve_attack` not client-callable, resolved-participants-only visibility, inbound open to all authenticated, anon denied on `attacks`, **plus the 0007 ACL belt-and-braces probe** (`has_function_privilege('authenticated', 'resolve_attack(uuid)', 'EXECUTE')` = false).
  - `03_config.sql` — **PASS (exit 0)**: exact seed values for travel/launch/join/weariness/shield/repelled + D4 combat constants + outcome-table buckets; `game_config` readable by service_role only (authenticated + anon denied).
- **`isfinite()` bug — found + fixed in unapplied migrations** (commit "fix: P3-T01-B isfinite() -> float8-safe NaN/Infinity checks (13 sites, unapplied migrations)"): the `-A` target DDL's `isfinite(col)` guards were replaced across **13 sites** in `0001`/`0003`/`0004`/`0005` with explicit float8-safe comparisons (`col <> 'NaN'::float8 and col <> 'Infinity'::float8 and col <> '-Infinity'::float8 and col >= 0`). Fix landed **before** apply (unapplied migrations edited), so the live schema never carried the bug.
- **Stale-RPC-signature fix** (commit "fix: P3-T01-C security — 0007 revokes internal EXECUTE from authenticated + **RPC signature alignment** + ACL assertions"): the contract suites' calls were aligned to the **actual** RPC signatures — explicit `::smallint` casts on `tier` args (`claim_home_planet('alpha', 2::smallint)`) so the tests exercise the real `(text, smallint, double precision, boolean, boolean)` overloads, not integer-literal coercion. Verified live.
- **authenticated-EXECUTE leak on `resolve_attack` — found by live probe, fixed forward via 0007, re-verified closed.** Live probe showed `has_function_privilege('authenticated', 'resolve_attack(uuid)', 'EXECUTE') = true`: Supabase default privileges grant EXECUTE on all new functions to authenticated at creation, and 0005 revoked the internal resolver from public + anon **only** — never from authenticated. A client could therefore resolve any inbound attack on demand, bypassing the lazy on-read gate (DESIGN §5.3 D5). Fixed forward by `0007_revoke_internal_execute.sql` (REVOKE authenticated on `resolve_attack` + the two `game_config` accessors) and re-verified closed via the in-suite ACL assertion (02 §g) + a fresh live probe (false).

---

## 4. Gates (verified at closeout)

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **33 files / 515 tests PASS** (exact; ~5.3s wall / ~10.8s test time) |
| Typecheck | `npx tsc -b` | **exit 0** |
| Lint | `npm run lint` | **exit 0** (oxlint) |
| SQL contract suites | `supabase db query --linked -f supabase/tests/01_claim_rls.sql` / `02_attack_rls.sql` / `03_config.sql` | **exit 0 × 3** against live |

## 5. Test Counts

**33 files / 515 tests PASS** at closeout (unchanged from the P3-T01 base of 515 — P3-T01 is schema/SQL work; the TS suite is the regression baseline). No TS tests were added or removed by P3-T01; the SQL contract suites (`supabase/tests/01-03`) are the task's focused coverage and are **not** run by vitest (they run against the linked project per §3).

## 6. Codex Verdicts (per subtask)

| Subtask | Verdict |
|---|---|
| -A | **PASS** — audit scope/boundaries (schema design, RLS strategy, claim concurrency, decisions D1–D12, exclusions) |
| -B | **PASS after 6 audit rounds** (committed "Codex PASS after 6 audit rounds"; 8+3+3+2+2 findings all fixed: anon sign-ins, resolve gating, RLS recursion, NaN/∞ guards, game_config ordering, FOR UPDATE, doc sync) |
| -C | **PASS** — negative-path + regression coverage (anon/authenticated/service_role probes, claim/attack/config contracts, 0007 security fix + signature alignment verified against live, all 3 suites exit 0) |
| -D | **PASS** — evidence + closeout |

Whole task: **P3-T01 Codex-PASSED**.

## 7. Decisions D1–D12 (from the -A audit, approved by Jay 2026-08-09)

1. **D1** Structure grids storage → **JSONB** on `owned_planets` (fixed 7-key grid, atomic read/write, single-operator conquest transfer, TradieHubAU precedent).
2. **D2** Auth model → **anonymous sign-in** (`signInAnonymously()`); uid preserved across anonymous→registered upgrade; pre-P3 local saves do not carry (D8 adopt-on-first-connect).
3. **D3** Planet catalogue → **client-side**; server stores claimed refs + derived fields, enforces uniqueness (not catalogue membership).
4. **D4** Server-authoritative resolve math → **small `game_config` balance seed** (~30 keys) + the SQL contract suite as the drift guard; client-reports-DP rejected.
5. **D5** Attack resolution engine → **DB function + lazy on-read** (`resolve_due_attacks`), atomic single transaction, `FOR UPDATE` race-safe.
6. **D6** Leaderboard metric + population → schema-only now; metric + rotation = P4-T01.
7. **D7** `status`/`outcome` typing → **text + CHECK** (not enums).
8. **D8** Server becomes source of truth → wallet/structures/per-planet pop server-authoritative; client save = cache; build/accrue = future RPCs (P3-T02+).
9. **D9** Draft tunables → **`game_config` table** (data not migrations; Jay audits values at playtest).
10. **D10** New-player shield (3 days) → **derived** from `players.created_at` (no column, no drift).
11. **D11** Join window = 2h from `launched_at` regardless of travel; war-weariness at resolve-time via `1.2^count(24h)`.
12. **D12** Binary quirk Option A (baseline-trait) — **no schema impact** (income-only; only `massiveWorld`/`denseCore` touch DP/pop-cap).

## 8. Known Findings (carried)

1. **Stale doc reference in applied migration 0006** — its header cites `tests/balance-drift.test.ts`, which does **not** exist in the repo; the drift guard was delivered instead as the SQL contract suite `03_config.sql` (exact seed-value assertions against live). Applied migration — not edited (forward-only); **FLAGGED FOR JAY** (cosmetic comment drift only, no functional impact).
2. **`game_config` values validated by contract suite, not by the sim constants** — the audit §8 drift test (`balance-drift.test.ts` ↔ `src/sim/**`) was not built as a TS test; parity is enforced by `03_config.sql` asserting the exact 0006 seed values live. **Open / FLAGGED FOR JAY** — a future TS drift test vs `src/sim/**` is the recommended hardening (P3-T05 or later).
3. **Catalogue-membership tradeoff (D3)** — the server enforces uniqueness only, not catalogue membership; a malicious client can register a junk planet name. Cosmetic junk, **not** exploitable for duplicate ownership (the P3 promise holds). Mitigations (allow-list seed / full catalogue seed) documented in audit §7.
4. **service_role retains default EXECUTE on the internal functions** — 0007 scoped the revoke to `authenticated`; tightening `service_role` on `resolve_attack`/`game_config_*` to 0005's literal wording can follow in a later migration if Jay approves (documented in the 0007 header).

## 9. Branch / Remote State

- Branch: `staging` (no work on `main`).
- **No push, no tag, no deploy** — the remote project carries the 7 applied migrations + the live suite passes; this closeout commits only the evidence + ROADMAP rows to `staging`.
- Working tree clean after this closeout commit.

---

*Prepared by OpenCode (deepseek-v4-flash) for P3-T01-D. Only `docs/P3_T01_EVIDENCE.md` + ROADMAP.md changed in this subtask.*
