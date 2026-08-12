TASK (StarBaron P2-T02, Codex FAIL round 4 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/player/assignment.ts, tests/assignment.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic.

CODEX FINDING (fix exactly this):
[src/sim/player/assignment.ts:16-18, 119-120] The documentation falsely guarantees that same-base players ALWAYS diverge onto distinct fallbacks at non-power-of-two eligible sizes — the implementation only hashes independently; distinct modulo-n outcomes are NOT mathematically guaranteed for every player pair/taken set (the test verifies one odd fixture only). Fix: reword the JSDoc to state this as an OBSERVED/POSSIBLE divergence for the tested fixture, not a universal property; retain the power-of-two explanation as a conditional property of equal base hash state (convergence when base hashes collide at 2^k sizes). Update the corresponding test comments in tests/assignment.test.ts to match (no assertion changes needed unless a comment overclaims).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/assignment.test.ts` all pass (report counts). Report changed lines + results.
