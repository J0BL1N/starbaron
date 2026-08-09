# P3-T05-B — Fortification + War-Weariness + Soldier Commitment (EVIDENCE)

*Date: 2026-08-09 · Branch: staging · Baseline HEAD: `6b77016` (P3-T05-A audit) · Working tree was CLEAN.*

## Summary

Closed the P3-T05-A audit's §5.2 implementation surface with the Jay-authorised decisions B1–B7. The soldier-commitment model is now server-authoritative: garrison is deducted at launch/join, deployed into fleet, survivors return (uniform, clamped) at resolve, and the fortify loop can actually write grids server-side via the new `build_structure` RPC.

## Decisions applied (LOCKED by Jay, from P3_T05_A_AUDIT §7)

| # | Decision | Applied |
|---|---|---|
| B1 | Server build RPC chain (Jay-approved 'build RPC') | ✅ `build_structure(text,text)` + barracks garrison conversion |
| B2 | Option 1 — garrison OUT of DP (LOCKED §5a formula) | ✅ DP path untouched (resolver/effects/estimator) |
| B3 | Emergent 10× ceiling, no new mechanic | ✅ No code change |
| B4 | UNIFORM casualties (winner + losers both return survivors) | ✅ resolver survivor loop |
| B5 | Clamp to garrison cap + unconditional return to source planet | ✅ `least(garrison+survivors, cap)`; source may have changed owner |
| B6 | Alloy FLAT 1,000/level (no escalation) | ✅ documented in `structure_alloy_costs` seed |
| B7 | Weariness UI surface + per-member roster weariness | ✅ `WarWearinessPanel` + `get_attack` roster `weariness` |

## Files changed

| File | What |
|---|---|
| `supabase/migrations/0012_fortification_commitment.sql` (NEW) | Column `attack_members.source_planet_name`; game_config seeds (`structure_cost_growth_per_level`, `structure_base_costs`, `structure_alloy_costs`); `build_structure` RPC; CREATE OR REPLACE `launch_attack`/`join_attack` (source FOR UPDATE + garrison/fleet guards + deduction + source planet stored); CREATE OR REPLACE `resolve_attack` (uniform survivor return + fleet drain, clamped); CREATE OR REPLACE `get_attack` (per-member weariness); ACL hygiene (build_structure → authenticated; resolve_attack + config accessors re-revoked) |
| `supabase/tests/02_attack_rls.sql` | Re-seeded source garrison (alpha 2000, gamma 1000, delta 2000) + post-launch deployment-state assertions (garrison/fleet deltas) |
| `supabase/tests/04_conquest_math.sql` | Re-seeded garrison + barracks (a3 20000/b5, a1/c3 2000/b1, singles 1000); zero-AP recipes (t-zap, t-zero0) direct-seeded as attack rows (tier-0 shipyard fleetCap = 0 blocks launch — pinned resolver numbers unchanged) |
| `supabase/tests/05_band_together.sql` | Re-seeded garrison + barracks (a3/b3 10000/b2, a1 2000/b1, c3/d3 5000/b1, e3 1000); assertions rewritten as baseline-delta (fleet −= committed, garrison += survivors) because in-flight history makes absolutes history-dependent; fixture comment corrected per Codex re-audit |
| `supabase/tests/06_fortification.sql` (NEW) | 7 sections: fortress-scale ratio boundaries (t30→eff20→DP 10,000; exact 1.5/1.0/0.75 + 0.749 crushed), build_structure pins, garrison deduction at launch, uniform survivor return, loser deduction, source_planet_name integrity + mid-flight source-loss edge, get_attack roster weariness |
| `src/sim/player/estimator.ts` | `garrisonCapFor`, `fleetCapFor`, `canDeploy` (mirror of server guards), `attackSurvivors` (round not floor), `wearinessLaunchCount` (log₁.₂ inverse) |
| `src/ui/components/WarWearinessPanel.tsx` (NEW) | Presentational weariness surface (my weariness + roster); defaults to fresh stack (1.0×) — client is local-first |
| `src/ui/PlanetView.tsx` | Mounted `WarWearinessPanel` |
| `tests/backend-estimator.test.ts` | 9 new parity pins mapped to 06 cases (canDeploy, attackSurvivors, caps, weariness count, turret cost curve) |

## Verification (pre-apply — 0012 not yet applied to live)

| Gate | Result |
|---|---|
| `npm test` | **591 passed / 35 files** (baseline 582 → +9) |
| `npx tsc -b` | exit 0 |
| `npm run build` | exit 0 |
| `npm run lint` | 0 warnings / 0 errors |
| Live suites 01–05 + new 06 | **PENDING — require 0012 applied to live** (Hermes + Jay authorisation step, not yet run) |

## Codex audit

- **Round 1: PASS** (1 MINOR + 1 NIT). MINOR: 05 a3/b3 seeded garrison 10,000 with barracks 1 (cap 5,000) → first resolve silently clamps to 5,000, contradicting fixture comment. NIT: bridge read-list omitted 0002/0003/0007 and named wrong 0001 file (bridge error, no repo change).
- **Correction round:** a3/b3 → `barracks:2` (cap 10,000 = seeded garrison; clamp never bites). a1/c3/d3/e3 untouched.
- **Re-audit (scoped): PASS** (1 comment MINOR — fixture comment stale for a3/b3).
- **Comment correction:** fixture comment updated (comment-only).
- **Final state:** all suites green, working tree = only the P3-T05-B change set.

## Limitations / follow-ups

1. **0012 not applied to live** — application + live-suite re-run is the next authorised step (migrations apply = Hermes + Jay authorisation only, per WORKFLOW.md).
2. `build_structure` barracks conversion is a one-tick bridge (10×effLevel per build) — a full server-side accrual loop is the remaining follow-up so garrison grows at the client-sim rate (audit §3.0 B1 note).
3. `resolve_attack` source-lock ordering: sources locked after target via fresh FOR UPDATE; two cross-resolving attackers could in principle deadlock (Postgres aborts one with 40P01; attack stays inbound, retries on next lazy resolve). Consistent per-loop ordering reduces but does not eliminate this — not blocking for v1.
4. B6 alloy flat documented; if Jay later wants the ×1.15 alloy curve it's a `structure_alloy_costs` + client data change.
