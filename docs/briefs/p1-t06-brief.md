TASK (StarBaron P1-T06, master roadmap): PERSISTENCE SCHEMA — canonical world tables for the universe foundation.

IMPORTANT CONSTRAINT: You WRITE the migration + contract tests only. You MUST NOT apply, push, or deploy anything to any Supabase project (local or remote) — that is Jay-authorised only. No `supabase db push/query/migrate` commands.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/world/identity.ts: canonical ID string formats — galaxy `gal:<slug>`, system `sys:<galaxySlug>|<systemSeed>`, body `body:<galaxySlug>|<systemSeed>|<bodyType>|<ordinal>` (bodyType ∈ star|planet|moon|asteroid).
- src/sim/world/galaxy.ts (GalaxyRecord: id, seed, name, class, position x/y/z, radius, systemIds, generationVersion, realData, provenance).
- src/sim/world/system.ts (SystemRecord: id, galaxy, seed, name, position, star {name, starType, color}, bodyIds, generationVersion, realData, provenance).
- src/sim/world/body.ts (BodyRecord: id, system, type, name, seed, ordinal, radius, mass?, orbit {semiMajorAxis, eccentricity, inclination, longitudeOfAscendingNode, argumentOfPeriapsis, meanAnomaly, period}, realData, provenance, generationVersion).
- supabase/migrations/0001-0012 (existing migrations: players, owned_planets, claim RPCs, attack RPCs, game_config, band_together, fortification) — READ the conventions (naming, RLS patterns, migration header comments).
- supabase/tests/01-06 (psql contract-test convention: DO blocks with ASSERT/RAISE, run against applied migrations).

ALLOWED FILES (create ONLY):
- supabase/migrations/0013_world_schema.sql
- supabase/tests/07_world_schema.sql

RESTRICTIONS: Do NOT modify/delete any existing file. Do NOT run any supabase command that applies/pushes/deploys. No TS/JS changes. No secrets.

DESIGN SPEC (0013_world_schema.sql):
1. Three tables matching the canonical models:
   - world_galaxies: id TEXT PRIMARY KEY (canonical gal: id), seed TEXT NOT NULL, name TEXT NOT NULL, class TEXT NOT NULL CHECK (class IN ('spiral','barred-spiral','elliptical','irregular','dwarf')), position_x/position_y/position_z DOUBLE PRECISION NOT NULL DEFAULT 0, radius DOUBLE PRECISION NOT NULL DEFAULT 600 CHECK (radius > 0), generation_version INTEGER NOT NULL DEFAULT 1 CHECK (generation_version > 0), real_data BOOLEAN NOT NULL DEFAULT false, provenance TEXT NOT NULL DEFAULT 'procedural', created_at TIMESTAMPTZ NOT NULL DEFAULT now().
   - world_systems: id TEXT PRIMARY KEY, galaxy_id TEXT NOT NULL REFERENCES world_galaxies(id) ON DELETE CASCADE, seed TEXT NOT NULL, name TEXT NOT NULL, position_x/y/z DOUBLE PRECISION NOT NULL DEFAULT 0, star_name TEXT NOT NULL, star_type TEXT, star_color TEXT NOT NULL, generation_version INTEGER NOT NULL DEFAULT 1 CHECK (> 0), real_data BOOLEAN NOT NULL DEFAULT false, provenance TEXT NOT NULL DEFAULT 'procedural', created_at TIMESTAMPTZ NOT NULL DEFAULT now(); INDEX ON (galaxy_id).
   - world_bodies: id TEXT PRIMARY KEY, system_id TEXT NOT NULL REFERENCES world_systems(id) ON DELETE CASCADE, type TEXT NOT NULL CHECK (type IN ('star','planet','moon','asteroid')), name TEXT NOT NULL, seed TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK (ordinal >= 0), radius DOUBLE PRECISION NOT NULL CHECK (radius > 0), mass DOUBLE PRECISION, semi_major_axis DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (semi_major_axis >= 0), eccentricity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (eccentricity >= 0 AND eccentricity < 1), inclination DOUBLE PRECISION NOT NULL DEFAULT 0, longitude_of_ascending_node DOUBLE PRECISION NOT NULL DEFAULT 0, argument_of_periapsis DOUBLE PRECISION NOT NULL DEFAULT 0, mean_anomaly DOUBLE PRECISION NOT NULL DEFAULT 0, period DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (period >= 0), generation_version INTEGER NOT NULL DEFAULT 1 CHECK (> 0), real_data BOOLEAN NOT NULL DEFAULT false, provenance TEXT NOT NULL DEFAULT 'procedural', created_at TIMESTAMPTZ NOT NULL DEFAULT now(); INDEX ON (system_id); INDEX ON (type).
2. Unique integrity: UNIQUE (galaxy_id, id) on world_systems (belt+braces canonical ids per parent); UNIQUE (system_id, id) on world_bodies; UNIQUE (system_id, ordinal) on world_bodies (one body per ordinal per system).
3. RLS: enable RLS on all three tables with NO policies (world data is public-read later; for now locked down — mirror the repo's anon-denied convention; add a comment explaining public read policies arrive with the world API task P1-T08). Revoke all from anon per convention.
4. Header comment block: purpose, canonical ID formats, migration strategy (append-only, IF NOT EXISTS where safe), generation-version bump policy.
5. Idempotency: CREATE TABLE IF NOT EXISTS + DO-block guards where feasible, matching repo conventions.

DESIGN SPEC (07_world_schema.sql contract tests — psql DO-block style matching tests/01-06):
- world_galaxies insert/select round-trip; CHECK violations (bad class, radius <= 0) raise.
- world_systems FK enforcement (orphan insert fails); cascade delete from galaxy.
- world_bodies: type CHECK (bad type fails), ordinal >= 0 CHECK, eccentricity >= 1 fails, UNIQUE (system_id, ordinal) duplicate fails.
- anon has NO privileges on the three tables (permission-denied assertion, matching 01_claim_rls.sql style).
- idempotency: re-running 0013 does not error (IF NOT EXISTS path) — note: the test file documents this as a re-run contract; asserting it requires a fresh stack, so mark it as a documented expectation + the migration's own guards.

VERIFY AND REPORT: state exactly what you verified (SQL syntax review via careful reading; NO supabase commands run; NO application). Report changed files, the exact CHECK/constraint list, how the canonical ID formats map to the PK columns, limitations (tests execute when Jay authorises a stack; apply deferred by policy).
