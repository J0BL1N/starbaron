TASK (StarBaron PHASE 5 phase audit round 3 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: supabase/migrations/0017_fleets.sql, supabase/tests/11_fleets.sql ONLY (write-only — never applied).

RESTRICTIONS: keep the repo SQL conventions (forward-only, text+CHECK enums, RLS patterns).

CODEX FINDINGS (fix exactly these):

1. [0017:98-100,127-129,77] The TS persistence model stores ALL simulation timestamps as millisecond numbers (createdAt, issuedAt, expiresAt, route/leg departure + arrival); the SQL columns are timestamptz with no mapper — ms-vs-timezone drift breaks the round-trip contract. Fix: store the SIMULATION timestamps as constrained `bigint` milliseconds:
   - fleet.sim_created_at → bigint not null check (sim_created_at >= 0)
   - fleet_order.issued_at, expires_at (nullable) → bigint, check (issued_at >= 0), check (expires_at is null or expires_at > issued_at)
   - fleet_route.departure_at, arrival_at → bigint, check (departure_at >= 0 and arrival_at > departure_at)
   - fleet_route.legs jsonb keeps the per-leg departure/arrival ms numbers (document: legs are opaque TS-shaped jsonb; the row-level departure/arrival are the mirrored bigint contract)
   - KEEP the DB-managed audit columns (created_at/updated_at timestamptz default now()) — document the distinction: DB audit time vs sim time (ms).
2. [0017:99-104] fleet_order.active is not constrained to agree with status — multiple status='active' rows with active=false, or active=true on non-active status, are permitted (the SQL test even sets active=true on an 'issued' order). Fix: add `constraint fleet_order_active_matches_status check (active = (status = 'active'))`; update the partial-unique-index test in 11_fleets.sql so the second-active-order probe transitions status AND flag together (order-1 completes → active=false, order-2 activates → status='active' + active=true → second active=true insert fails unique); add invalid-pair probes (active=true with status 'issued' → check violation; active=false with status 'active' → check violation).

VERIFY: static self-review ONLY (do NOT run psql; do NOT apply). Report changed lines + which probe covers which finding.
