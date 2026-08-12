TASK (StarBaron P1-T01, Codex FAIL round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/world/identity.ts, tests/identity.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — no Math.random, no `any`, strict TS, determinism, no format/signature changes, parseCanonicalId keeps returning {ok:false, reason} and never throws.

CODEX FINDING (fix exactly this):

[src/sim/world/identity.ts:153-162] An arbitrarily large digit-only ordinal is accepted by parseCanonicalId, then converted to `Infinity` (for example, `'9'.repeat(400)`), despite `ParsedBodyId.ordinal` being a `number` ordinal and factory validation requiring a non-negative integer. Reject parsed ordinals unless `Number(ordinalText)` is a finite non-negative integer, and add a malformed-input test.

EXPECTED AFTER FIX:
- parseCanonicalId returns { ok: false, reason } for digit-only ordinals that overflow to Infinity (e.g. '9'.repeat(400)), and for any ordinal where Number(ordinalText) is not a finite non-negative integer.
- Existing valid ordinals still parse (0, 1, 42, large-but-finite integers like 9999999).
- New test: body id with '9'.repeat(400) ordinal → { ok: false }; finite large ordinal still ok.

VERIFY AND REPORT: `npx tsc -b` exit 0; `npx vitest run tests/identity.test.ts` all pass (report counts); report changed lines + commands/results.
