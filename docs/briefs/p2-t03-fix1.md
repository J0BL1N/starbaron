TASK (StarBaron P2-T03, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: supabase/tests/08_home_world_protection.sql ONLY.

RESTRICTIONS: write-only deliverable — no supabase command invocations anywhere (not even in comments).

CODEX FINDING (fix exactly this):
[supabase/tests/08_home_world_protection.sql:24] A comment contains a Supabase CLI invocation (`npx --no-install supabase db query ...`). Remove that Run-command line (or reword to a plain note containing no `supabase db` invocation tokens).

VERIFY: careful read-back (no execution). Report the changed line.
