TASK (StarBaron P1-T06, Codex FAIL round 1 — FIX ONLY THESE 3 FINDINGS, no broadening):

ALLOWED FILES: supabase/tests/07_world_schema.sql ONLY. Do NOT touch any other file (including 0013).

RESTRICTIONS: write-only deliverable — NO supabase commands anywhere (not even in comments). Keep the repo's psql DO-block test style.

CODEX FINDINGS (fix exactly these):

1. [supabase/tests/07_world_schema.sql:33] A comment contains `npx --no-install supabase db query --linked ...`. Remove that Run command/comment entirely (or reword to a plain note that does not contain any `supabase db ...` invocation tokens).

2. [supabase/tests/07_world_schema.sql:94-237] Missing CHECK-violation coverage: add isolated DO-block assertions expecting `check_violation` for: generation_version = 0 on world_galaxies, world_systems AND world_bodies; world_bodies radius = 0; world_bodies semi_major_axis = -1; world_bodies period = -1. Match the existing assertion style (with no-persist count checks).

3. [supabase/tests/07_world_schema.sql:148-163] Add an orphan-body insert assertion: inserting a world_bodies row whose system_id does not exist raises `foreign_key_violation` (mirror the orphan-system test).

VERIFY: careful read-back of the edited file (no execution possible — write-only). Report changed lines + which test covers which finding.
