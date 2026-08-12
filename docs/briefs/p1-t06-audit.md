READ-ONLY AUDIT — StarBaron P1-T06 (master roadmap): Persistence Schema (world tables).

READ LIST:
- supabase/migrations/0013_world_schema.sql   (NEW — implementation under audit)
- supabase/tests/07_world_schema.sql          (NEW — contract tests under audit)
- supabase/migrations/0001_players_owned_planets.sql, 0003_claim_rpcs.sql, 0004_*, 0012_fortification_commitment.sql (existing conventions: RLS, grants, header comments, naming)
- supabase/tests/01_claim_rls.sql, 02_attack_rls.sql (psql contract-test style)
- src/sim/world/identity.ts (canonical ID formats gal:<slug>, sys:<galaxySlug>|<systemSeed>, body:<galaxySlug>|<systemSeed>|<bodyType>|<ordinal>)
- src/sim/world/galaxy.ts, system.ts, body.ts (record shapes the tables must mirror)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT d957edd8da272dc3c093e1e8402a7f9cbd646398 (`git show 35ae8e8 --stat` must add exactly supabase/migrations/0013_world_schema.sql + supabase/tests/07_world_schema.sql). No existing file modified. CRITICAL CONSTRAINT: no supabase command may have applied/pushed/deployed anything (grep the commit diff for `supabase db push|query|migrate` invocations in commit messages or comments — none may exist; the deliverable is WRITE-ONLY SQL + tests).

TASK SPEC (docs/briefs/p1-t06-brief.md + master roadmap P1-T06):
1. world_galaxies / world_systems / world_bodies tables: PKs = canonical TEXT ids; FKs (galaxy_id, system_id) ON DELETE CASCADE; CHECK constraints (class union, type union, radius > 0, ordinal >= 0, eccentricity [0,1), semi_major_axis >= 0, period >= 0, generation_version > 0); INDEXes on galaxy_id / system_id / type; UNIQUE (galaxy_id,id), (system_id,id), (system_id,ordinal).
2. RLS enabled, no policies, anon denied (mirrors repo convention); created_at TIMESTAMPTZ DEFAULT now().
3. Idempotency guards (IF NOT EXISTS etc.); header comment documenting canonical formats + append-only migration strategy.
4. Contract tests 07_world_schema.sql in the repo's psql DO-block style: round-trips, CHECK/FK/UNIQUE violation assertions, anon permission-denied, cascade delete.

CHECK:
A. Schema mirrors the canonical record shapes (column names/types line up with world/*.ts models).
B. All required CHECKs + UNIQUEs + INDEXes present; FKs cascade correctly; PK text matches canonical ID formats (comment documents the format).
C. RLS enabled on all three; no grants to anon; no policy bodies (locked until P1-T08).
D. Idempotent constructs present (IF NOT EXISTS / guards); migration strategy documented.
E. Tests cover: round-trip, each CHECK violation, FK orphan, cascade, UNIQUE dup, anon denial — in repo's style.
F. No application/deploy commands anywhere in the deliverable; SQL is syntactically coherent (balanced statements, valid PostgreSQL).
G. No TS/JS changes; no secrets.

DO NOT: modify anything; run supabase commands; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
