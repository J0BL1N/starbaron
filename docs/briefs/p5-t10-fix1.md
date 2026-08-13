TASK (StarBaron P5-T10, Codex FAIL round 1 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/fleet/persistence.ts, tests/persistence.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS.

CODEX FINDINGS (fix exactly these):

1. [persistence.ts:335-339,447-476] Route legs' fleetId is validated only as non-empty — never required to equal route.fleetId / snapshot.fleet.id; a snapshot with fleet-F route containing fleet-G legs passes. Fix: in snapshotInvariants (and the deserialize deep pass), require EVERY leg.fleetId === route.fleetId === snapshot.fleet.id; add a rejection test (a snapshot with mismatched leg fleetId fails).

2. [persistence.ts:9,38,48,72,204,489,951] Comments contain the banned token `any` (incl. the literal "`any`" at line 72). Reword all of them without the token (e.g. "strictly typed", "no literal `any` type" → "no untyped escapes").

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/persistence.test.ts --pool threads` all pass (report counts); grep confirms the token is gone from the file. Report changed lines + results + which test covers which finding.
