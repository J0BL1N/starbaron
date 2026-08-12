TASK (StarBaron P2-T08, Codex FAIL round 1 — FIX ONLY THESE 3 FINDINGS, no broadening):

ALLOWED FILES: src/sim/player/onboarding.ts, tests/onboarding.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic, no banned comment tokens.

CODEX FINDINGS (fix exactly these):

1. [src/sim/player/onboarding.ts:35] Importing '../data/planets' is outside the authorised import set. Fix: make the eligible home set INJECTABLE — entryFlow input gains `eligible?: readonly BodyId[]`; when omitted, default to an empty array (the CALLER — a future orchestration layer — supplies the catalogue-derived set via eligibleHomeBodies; onboarding no longer imports catalogue data). Remove the ../data/planets import. Update tests to pass an explicit eligible set (fixture + real catalogue set where useful).

2. [src/sim/player/onboarding.ts:211-215] Camera resolution must derive the parent system regardless of body presence: validate `home` is a parseable body id (parseCanonicalId kind 'body'), derive `parentOf(home)`, call querySystem on it EVEN when the body itself is absent from the universe; return `systemId: parentOf(home)` with `position: null` only when that system is absent. (A valid-but-absent body still has a canonical parent system id.)

3. [src/sim/player/onboarding.ts:238-244] With the injectable eligible set, entryFlow can now produce 'invalid-eligible-set' (empty eligible). Add an entryFlow test asserting `{ ok: false, reason: 'invalid-eligible-set' }` with no bundle when eligible: [] is passed.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/onboarding.test.ts` all pass (report counts). Report changed lines + results + which test covers which finding.
