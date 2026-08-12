-- =====================================================================
-- 0013_world_schema (P1-T06-B)
-- Purpose   : Canonical world tables for the universe foundation — the
--             persistence layer for the deterministic galaxy/system/body
--             models (src/sim/world/galaxy.ts, system.ts, body.ts). Three
--             tables, one per canonical record type, keyed by the canonical
--             ID strings. RLS is enabled with NO policies: world data is
--             read publicly LATER (the P1-T08 world-API task adds the read
--             policies); for now everything is locked down — mirror of the
--             repo's anon-denied convention (0001/0002), hardened to the
--             game_config variant (0002:78) so no client role touches the
--             rows until the P1-T08 policies arrive.
-- Canonical IDs (src/sim/world/identity.ts) — the PK of each table IS the
--   canonical id:
--     galaxy : 'gal:<slug>'                          -> world_galaxies.id
--     system : 'sys:<galaxySlug>|<systemSeed>'       -> world_systems.id
--     body   : 'body:<galaxySlug>|<systemSeed>|<bodyType>|<ordinal>'
--              (bodyType in star|planet|moon|asteroid) -> world_bodies.id
--   The parent's slug/seed are EMBEDDED in the child id, and the DB ENFORCES
--   that the embedded slug/seed match the parent columns via CHECK
--   constraints (deterministic, no PL/pgSQL):
--     * world_galaxies.id must match the full canonical grammar
--       '^gal:[^|]+$' (a single non-empty slug segment, no extra '|').
--     * world_systems.id must match '^sys:[^|]+\|[^|]+$' (galaxy slug + seed,
--       no extra segments) AND the embedded seed segment
--       (split_part(id, '|', 2)) must equal the seed column AND the id must
--       start with 'sys:' || (galaxy slug inside galaxy_id, i.e. galaxy_id
--       minus the 'gal:' prefix) || '|' — a system can never live under a
--       galaxy its id does not encode, and its embedded seed can never drift
--       from its seed column.
--     * world_bodies.id must match
--       '^body:[^|]+\|[^|]+\|(star|planet|moon|asteroid)\|(0|[1-9][0-9]*)$'
--       (exactly four segments, canonical ordinal — '0' or no leading zeros,
--       no extra segments) AND the embedded
--       type segment (split_part(id, '|', 3)) must equal the type column AND
--       the embedded ordinal (split_part(id, '|', 4)::bigint) must equal the
--       ordinal column AND the id must start with
--       'body:' || (galaxySlug|systemSeed inside system_id, i.e. system_id
--       minus the 'sys:' prefix) || '|' — a body can never attach to a system
--       its id does not encode, and its embedded type/ordinal can never drift
--       from its type/ordinal columns.
--     * all three tables enforce the real-data flag/provenance consistency at
--       rest: real_data true requires a catalogue provenance
--       (provenance LIKE 'nasa-exoplanet-archive-%') and real_data false
--       requires provenance = 'procedural' — mirror of the real-data labelling
--       boundary in src/sim/world/catalogue.ts (the factories build procedural
--       records only; catalogue.ts relabels the whole mapping at one
--       post-construction spread).
--   The FK columns (world_systems.galaxy_id, world_bodies.system_id) hold the
--   parent's canonical id, and the composite UNIQUEs ((galaxy_id, id) /
--   (system_id, id)) are KEPT as documented belt-and-braces (id is already the
--   PK, so they can never fire — the CHECKs are the real reparent guard).
--   world_bodies.ordinal duplicates the id's ordinal segment as a real
--   column; UNIQUE (system_id, type, ordinal) is the "one body per type per
--   ordinal per system" promise — type is part of body identity, so planet|0
--   and moon|0 coexist in one system while a second same-type same-ordinal
--   body is rejected (BodyRecord.ordinal, body.ts:41).
--   world_bodies.ordinal CHECK mirrors the model-side bound ORDINAL_MAX
--   (src/sim/world/identity.ts, 2^31 - 1 = PostgreSQL int4 max) — the
--   column type is INTEGER and the CHECK adds the parity guard explicitly.
--   Ordinal text grammar mirrors the model: '0' alone, or a non-empty digit
--   string with no leading zeros — the id-grammar regexp
--   '(0|[1-9][0-9]*)' rejects '01' outright, exactly like identity.ts
--   ORDINAL_PATTERN, so a leading-zero id can never persist as a distinct
--   identity. The ordinal column is INTEGER and split_part(id, '|', 4)::bigint
--   normalizes the id's text before comparing to it; both gates agree.
--   Model-side normalization (parseCanonicalId/bodyId, identity.ts) remains
--   the primary gate; the SQL grammar CHECK is the belt-and-braces parity,
--   now matching the model's no-leading-zero rule.
-- Persistence-only metadata (NOT part of the canonical record contract in
--   src/sim/world/{galaxy,system,body}.ts): the created_at columns are
--   DB-filled (default now()) for operational tracing only and are excluded
--   from GalaxyRecord/SystemRecord/BodyRecord — the deterministic models carry
--   no timestamps.
-- Registry ordering (P1-T05/T07/T08 contract — see identity.ts 'Canonical
--   registry order'): registries are DERIVED + ordered, never stored. There
--   are NO registry columns — the child FKs preserve membership only, not
--   order. At query time the world API derives GalaxyRecord.systemIds as
--     select id from world_systems where galaxy_id = :galaxy order by id;
--   and SystemRecord.bodyIds as
--     select id from world_bodies where system_id = :system
--     order by ordinal, id;
--   That derived order is the canonical order the TS validators enforce
--   (catalogue.ts validateCatalogue, reconstruct.ts collectUniverseProblems)
--   and the TS producers emit — an exact deterministic round trip.
-- Migration strategy: append-only, forward-only. 0001-0012 are applied and
--   never rewritten; 0013 only ADDS new objects. Generation-version bump
--   policy: generation_version defaults to 1 and must stay > 0. Bump it (in
--   a forward migration) ONLY when a change to the deterministic generator
--   inputs (src/sim/world/**) would change derived world data for the same
--   seeds — bumped rows are regenerated wholesale by the world API, never
--   patched in place. Column-shape changes are NEW migrations, not edits
--   here.
-- Idempotent: YES — CREATE TABLE/INDEX IF NOT EXISTS; ALTER (RLS enable/
--   force) and REVOKE are no-ops on re-run. Re-applying the file on a fresh
--   stack is safe; a second application against an existing stack simply
--   no-ops (a re-run contract, see tests/07).
-- Date      : 2026-08-12
-- Scope     : 3 new tables + indexes + UNIQUE constraints + RLS enables +
--             revokes. No seed data (seeding + read policies = P1-T08). No
--             changes to existing objects. No RPCs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. world_galaxies — canonical galaxy records (GalaxyRecord).
--    class CHECK mirrors GalaxyClass (galaxy.ts:16-21); radius DEFAULT 600
--    = DEFAULT_GALAXY_RADIUS (galaxy.ts:40); position defaults 0 (galaxy
--    universe-space position is generated, not stored at rest).
-- ---------------------------------------------------------------------
create table if not exists public.world_galaxies (
  id                 text primary key,    -- 'gal:<slug>'
  seed               text not null,
  name               text not null,
  class              text not null check (class in ('spiral','barred-spiral','elliptical','irregular','dwarf')),
  position_x         double precision not null default 0,
  position_y         double precision not null default 0,
  position_z         double precision not null default 0,
  radius             double precision not null default 600 check (radius > 0),
  generation_version integer not null default 1 check (generation_version > 0),
  real_data          boolean not null default false,
  provenance         text not null default 'procedural',
  -- DB-filled persistence metadata, excluded from the canonical record contract.
  created_at         timestamptz not null default now(),
  -- Full canonical id grammar: a single non-empty slug segment, no extra '|'.
  check (id ~ '^gal:[^|]+$'),
  -- Real-data flag/provenance consistency at rest (mirror of the real-data
  -- labelling boundary in src/sim/world/catalogue.ts).
  check (not real_data or provenance like 'nasa-exoplanet-archive-%'),
  check (real_data or provenance = 'procedural')
);

-- ---------------------------------------------------------------------
-- 2. world_systems — canonical solar-system records (SystemRecord).
--    star_name/star_type/star_color mirror StarMetadata (system.ts:40-44);
--    star_type is nullable (starType: string | undefined). galaxy_id FK
--    cascades. CHECK ties id to galaxy_id: a system id must encode the same
--    galaxy slug as galaxy_id (id like 'sys:' || substr(galaxy_id, 5) || '|%').
--    UNIQUE (galaxy_id, id) is kept as belt-and-braces (see header); the
--    plain galaxy_id index serves "list systems by galaxy".
-- ---------------------------------------------------------------------
create table if not exists public.world_systems (
  id                 text primary key,    -- 'sys:<galaxySlug>|<systemSeed>'
  galaxy_id          text not null references public.world_galaxies (id) on delete cascade,
  seed               text not null,
  name               text not null,
  position_x         double precision not null default 0,
  position_y         double precision not null default 0,
  position_z         double precision not null default 0,
  star_name          text not null,
  star_type          text,
  star_color         text not null,
  generation_version integer not null default 1 check (generation_version > 0),
  real_data          boolean not null default false,
  provenance         text not null default 'procedural',
  -- DB-filled persistence metadata, excluded from the canonical record contract.
  created_at         timestamptz not null default now(),
  unique (galaxy_id, id),
  -- Full canonical id grammar + embedded parent slug + embedded seed column.
  check (id ~ '^sys:[^|]+\|[^|]+$' and split_part(id, '|', 2) = seed),
  check (id like 'sys:' || substr(galaxy_id, 5) || '|%'),
  -- Real-data flag/provenance consistency at rest (mirror of the real-data
  -- labelling boundary in src/sim/world/catalogue.ts).
  check (not real_data or provenance like 'nasa-exoplanet-archive-%'),
  check (real_data or provenance = 'procedural')
);
create index if not exists world_systems_galaxy_id_idx on public.world_systems (galaxy_id);

-- ---------------------------------------------------------------------
-- 3. world_bodies — canonical celestial-body records (BodyRecord). The
--    orbit elements mirror BodyOrbit (body.ts:24-32); mass is nullable
--    (BodyRecord.mass?, body.ts:43); radius > 0 (body generators always
--    emit positive radii); ordinal >= 0 (identity.ts assertOrdinal);
--    eccentricity in [0,1) (body.ts:234). Star vs non-star orbits:
--    validateOrbit (body.ts:229) is the documented source — a star keeps the
--    ALL-ZERO orbit and a non-star must carry a positive period (the model
--    always emits a positive semi-major axis too: moon >= 1, planet/asteroid
--    >= 8, defaultOrbit body.ts:191). The CHECKs below enforce that split at
--    rest: non-stars need period > 0 and semi_major_axis > 0; stars need every
--    orbit element at 0. system_id FK cascades. CHECKs tie id to system_id: a
--    body id must encode the same galaxySlug|systemSeed as system_id (id like
--    'body:' || substr(system_id, 5) || '|%'), and the id's type segment
--    (split_part(id,'|',3)) must equal the type column. UNIQUEs:
--    (system_id, id) belt-and-braces reparent guard (see header),
--    (system_id, type, ordinal) the one-body-per-type-per-ordinal promise.
--    Plain indexes serve system listing + type filtering.
-- ---------------------------------------------------------------------
create table if not exists public.world_bodies (
  id                           text primary key,   -- 'body:<galaxySlug>|<systemSeed>|<type>|<ordinal>'
  system_id                    text not null references public.world_systems (id) on delete cascade,
  type                         text not null check (type in ('star','planet','moon','asteroid')),
  name                         text not null,
  seed                         text not null,
  ordinal                      integer not null check (ordinal >= 0 and ordinal <= 2147483647),
  radius                       double precision not null check (radius > 0),
  mass                         double precision,
  semi_major_axis              double precision not null default 0 check (semi_major_axis >= 0),
  eccentricity                 double precision not null default 0 check (eccentricity >= 0 and eccentricity < 1),
  inclination                  double precision not null default 0,
  longitude_of_ascending_node  double precision not null default 0,
  argument_of_periapsis        double precision not null default 0,
  mean_anomaly                 double precision not null default 0,
  period                       double precision not null default 0 check (period >= 0),
  generation_version           integer not null default 1 check (generation_version > 0),
  real_data                    boolean not null default false,
  provenance                   text not null default 'procedural',
  -- DB-filled persistence metadata, excluded from the canonical record contract.
  created_at                   timestamptz not null default now(),
  unique (system_id, id),
  unique (system_id, type, ordinal),
  -- Star zero-orbit vs non-star positive orbit (validateOrbit, body.ts:229):
  -- a star keeps every orbit element at 0; a non-star must carry a positive
  -- period and a positive semi-major axis — the model never emits a
  -- zero-period or zero-semi-major-axis non-star (defaultOrbit body.ts:191).
  check (type = 'star' or semi_major_axis > 0),
  check (type = 'star' or period > 0),
  check (
    type <> 'star'
    or (
      semi_major_axis = 0
      and period = 0
      and eccentricity = 0
      and inclination = 0
      and longitude_of_ascending_node = 0
      and argument_of_periapsis = 0
      and mean_anomaly = 0
    )
  ),
  -- Full canonical id grammar (four segments, canonical ordinal — '0' alone or
  -- no leading zeros — no extra segments) + embedded type/ordinal columns +
  -- embedded parent system. The ordinal regexp '(0|[1-9][0-9]*)' rejects a
  -- leading-zero ordinal ('01') outright, mirroring identity.ts
  -- ORDINAL_PATTERN; split_part(id,'|',4)::bigint still ties the id's ordinal
  -- to the ordinal column as the belt-and-braces parity gate.
  check (
    id ~ '^body:[^|]+\|[^|]+\|(star|planet|moon|asteroid)\|(0|[1-9][0-9]*)$'
    and split_part(id, '|', 3) = type
    and split_part(id, '|', 4)::bigint = ordinal
  ),
  check (id like 'body:' || substr(system_id, 5) || '|%'),
  check (type = split_part(id, '|', 3)),
  -- Real-data flag/provenance consistency at rest (mirror of the real-data
  -- labelling boundary in src/sim/world/catalogue.ts).
  check (not real_data or provenance like 'nasa-exoplanet-archive-%'),
  check (real_data or provenance = 'procedural')
);
create index if not exists world_bodies_system_id_idx on public.world_bodies (system_id);
create index if not exists world_bodies_type_idx     on public.world_bodies (type);

-- =====================================================================
-- RLS + grants. NO policies on any of the three tables — world data is
-- public-read LATER (P1-T08 world-API task adds the read policies). For
-- now: locked down. Enable + FORCE (0001/0002 belt-and-braces: the table
-- owner stays subject to RLS) and REVOKE from public, anon AND
-- authenticated — the strongest variant of the repo convention (game_config
-- pattern, 0002:78) — so no client role can read or write world rows until
-- the P1-T08 policies arrive. service_role bypasses RLS (BYPASSRLS) but is
-- not granted table privileges here either; explicit read grants
-- (service_role first, then the public-read policies) ship WITH P1-T08.
-- =====================================================================
alter table public.world_galaxies enable row level security;
alter table public.world_galaxies force row level security;
alter table public.world_systems  enable row level security;
alter table public.world_systems  force row level security;
alter table public.world_bodies   enable row level security;
alter table public.world_bodies   force row level security;

revoke all on table public.world_galaxies from public, anon, authenticated;
revoke all on table public.world_systems  from public, anon, authenticated;
revoke all on table public.world_bodies   from public, anon, authenticated;
