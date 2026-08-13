TASK (StarBaron PHASE 5 phase audit round 4 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: supabase/migrations/0017_fleets.sql, supabase/tests/11_fleets.sql ONLY (write-only — never applied).

RESTRICTIONS: keep the repo SQL conventions.

CODEX FINDING (fix exactly this):
[0017:90,118-120,151-153] bigint sim timestamps can't hold FRACTIONAL milliseconds (the TS movement contract produces them: 10pc @ 3pc/s → 3.333…ms arrival; persistence accepts finite positive numeric). Deterministic fix: change the sim timestamp columns (`sim_created_at`, `issued_at`, `expires_at`, `departure_at`, `arrival_at`) to exact `numeric` with TS-aligned CHECKs (sim_created_at > 0; issued_at > 0; expires_at is null or expires_at > issued_at; departure_at > 0 and arrival_at > departure_at). Update 11_fleets.sql: the round-trip inserts use a FRACTIONAL arrival (e.g. departure 1700000000000, distance 10, speed 3 → arrival 1700000003333.3333… — compute and pin the exact numeric) with an exact-value assertion; keep the other probes' bigint literals valid as numerics.

VERIFY: static self-review ONLY (do NOT run psql; do NOT apply). Report changed lines + the fractional round-trip probe.
