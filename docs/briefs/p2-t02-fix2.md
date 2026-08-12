TASK (StarBaron P2-T02, Codex FAIL round 2 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/player/assignment.ts, tests/assignment.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic. Keep the documented attempt budget (max attempts = 3 × eligible.length — attempts may NOT exceed it).

CODEX FINDINGS (fix exactly these):

1. [src/sim/player/assignment.ts:129] The linear fallback pushes the probe count past the 3 × n budget (up to 4 × n). Fix: REMOVE the extra fallback scan. Instead make the probe sequence itself a complete-coverage deterministic rotation: probe k = (base + k) % n for k = 0..n-1 (i.e. a full rotation of the eligible set starting at the player-hash base index; no re-hashing offsets, no second scan). This guarantees every index is visited within n attempts (complete coverage — the round-1 'coverage-probe' case resolves) AND the total work stays within the documented 3 × n budget (only n attempts are ever needed). After the rotation finds nothing free, return { ok:false, reason:'exhausted', attempt: n }. Keep determinism: same inputs → same sequence. Update the round-1 regression test (player 'coverage-probe', 19 eligible, all-but-12 taken → ok with id 12 — it must now pass via the rotation, and attempt must be <= 19).

2. [tests/assignment.test.ts:48] The comment overclaims: divergence is not impossible for ALL even sizes — only same-base CONVERGENCE is guaranteed for power-of-two sizes. Fix: reword the comment to say 'power-of-two sizes', and add an explicit power-of-two same-base collision test: two players sharing a base index over a 2^k-sized eligible set, with the base taken → both selections deep-equal (same fallback id).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/assignment.test.ts` all pass (report counts). Report changed lines + results + which test covers which finding.
