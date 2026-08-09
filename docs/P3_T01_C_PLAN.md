# P3-T01-C — Push Plan: migrations 0001–0006 + contract-test run

*Subtask `-C` for **P3-T01 Supabase schema** (Phase 3). Writes the SQL contract-test suites (`supabase/tests/01-03`), this ordered push plan, and runs the TS regression suite. **No remote contact, no commit, no push in this subtask** — everything below executes only when Jay authorises.*

---

## 1. Guardrails (bind every step)

- Target project ref: **`ogsleukfykumxsyvyusz`** — never contacted, linked, or pushed without explicit authorisation.
- Branch `staging`, HEAD `3dc1572` at write time. The `-B` migration set (`0001`–`0006`) is **committed but unapplied**; `supabase_migrations.schema_migrations` on the remote is the source-of-truth ledger.
- Forward-only: never re-edit or re-run an applied migration. RLS + grants ship inside the same migration as their tables.
- Working-tree additions from this subtask are **uncommitted** (per WORKFLOW.md the loop commits after Codex PASS; this subtask makes no commit).

## 2. What this subtask added

| File | Purpose |
|---|---|
| `supabase/tests/01_claim_rls.sql` | Claim/colonise contract + anon/authenticated RLS probes |
| `supabase/tests/02_attack_rls.sql` | Attack lifecycle contract + participant-only visibility probes |
| `supabase/tests/03_config.sql` | `game_config` seed values + service_role-only readability |
| `docs/P3_T01_C_PLAN.md` | This plan |

All suites are `BEGIN … ROLLBACK` (non-persisting). Assertion failures **RAISE** with a `8653 ASSERTION FAILED:` message → non-zero exit (the CLI treats any raised exception as failure). The `8653` marker lives in the message (a 4-digit code cannot be a PostgreSQL SQLSTATE, which must be exactly 5 chars); the marker is greppable and the exit code is the machine signal.

## 3. Auth-user vs anon requirements per suite

| Suite | Seeded auth.users? | Roles exercised | Notes |
|---|---|---|---|
| `01_claim_rls.sql` | **YES** — A, B | anon, authenticated | Fake `auth.users` rows are required because `players.id` FK → `auth.users.id` and the claim RPC creates the `players` row on first claim. Per-user identity via `set local request.jwt.claims` (`sub`). |
| `02_attack_rls.sql` | **YES** — A, B, C, D | anon, authenticated, postgres (elevated seed/backdate) | Needs a defender + launcher + joiner + outsider. Backdates defender `created_at` to clear the new-player shield and funds the launcher so travel/cost math is testable. |
| `03_config.sql` | **NO** | anon, authenticated, service_role | Role probes only; reads `game_config` (no user rows needed). |

Every suite runs via the CLI (`db query`) in its elevated context so it can `insert into auth.users` and `set local role` to anon/authenticated/service_role.

## 4. Ordered push plan (execute ONLY on authorisation)

1. **Confirm state** — `git status` (clean except the 4 P3-T01-C files), branch `staging`, HEAD expected `3dc1572`.
2. **Link** the project:
   `npx --no-install supabase link --project-ref ogsleukfykumxsyvyusz`
   (requires a Supabase access token via `supabase login`; writes `supabase/.temp/` which is gitignored — never commit it.)
3. **Dry-run the push FIRST**:
   `npx --no-install supabase db push --dry-run`
   - **CONFIRM the diff applies EXACTLY `0001_players_owned_planets` … `0006_game_config_seed` and nothing else.** If it shows drift, extra objects, or destructive ops outside that set → **STOP**, reconcile, do not push.
4. **Apply**:
   `npx --no-install supabase db push`
5. **Verify the ledger** — confirm the 6 migrations are recorded:
   `select version from supabase_migrations.schema_migrations order by version;`
   → exactly the 6 version rows (`0001`…`0006`).
6. **Run the contract suites** (each exit 0 = pass):
   - `npx --no-install supabase db query --linked -f supabase/tests/01_claim_rls.sql`
   - `npx --no-install supabase db query --linked -f supabase/tests/02_attack_rls.sql`
   - `npx --no-install supabase db query --linked -f supabase/tests/03_config.sql`
   - Each file seeds its own fake `auth.users` and role-switches internally, all inside `ROLLBACK` — no residue after a pass.
7. **Link-restore note**: `supabase link` creates `supabase/.temp/` (gitignored), so the working tree stays clean. After verification, either **leave the project linked** for P3-T02+ (recommended) or restore by `npx --no-install supabase unlink` if Jay prefers the repo untouched. The remote DB carries `0001`–`0006` + the ledger either way; unlink does not touch the remote.

## 5. Contract points covered (map to audit §8)

- **Claim (`01`)**: idempotent home re-claim; two claims of one planet → single winner (`planet_taken` for the second); colony without a home raises; double-colony → `planet_taken`; NULL name rejected; anon denied on `owned_planets` and on `claim_home_planet` EXECUTE; authenticated granted.
  - **D3 note**: the server validates uniqueness, **not** catalogue membership (audit §7 tradeoff), so an unclaimed arbitrary name IS claimed; the suite asserts the rejection paths the schema actually implements and documents this.
  - **anon "0 rows" note**: the schema grants anon nothing (audit §3.1), so anon visibility is enforced as **permission-denied (42501)** rather than a 0-row result; the suite asserts the stronger 42501 contract.
- **Attack (`02`)**: valid target; soldiers > 0; affordable cost; unconquerable / own-planet / source-ownership guards; travel floor 600 / mid 6000 / cap 172800; join window + double-join rejection; resolve gated on `resolves_at`; `resolve_attack` not client-callable (42501); resolved attacks participants-only (outsider 0 rows), inbound open to all authenticated (band-together); anon denied on `attacks`.
  - **Defender note**: post-conquest the planet's `owner_id` moves to the winner, so the original defender no longer matches the attacks SELECT policy — its report is delivered through `resolve_due_attacks`' original-owner response gating (audit §3.2/§5.3), which the suite asserts.
- **Config (`03`)**: exact seed values for travel/launch/join-window/weariness/shield/repelled constants + D4 combat constants + `outcome_ratios_and_losses` buckets; `game_config` readable by `service_role` only.

## 6. Report items for this subtask

- Files changed: the 4 above (uncommitted).
- `npx vitest run` — TS regression suite result (the SQL suites are not run by vitest; `vitest.config.ts` includes only `tests/**/*.test.ts|tsx`).
- Remote/push status: **not contacted, not pushed, not committed.**
