TASK (StarBaron P2 phase audit — regression alignment after the locked starter-grid contract change):

CONTEXT: The Phase 2 audit locked the starter-grid contract: STARTER_STRUCTURES = { housing: 1, others 0 } — a fresh player's home world starts with housing level 1 (roadmap T08, DESIGN §5 starter resources). This changed createPlayer's home grid from the old all-zero grid to {housing:1}. Two legacy regression test files still embed the OLD contract and now fail (they were green before the contract change — verified). Update ONLY the assertions that embed the old contract; do not weaken other coverage.

ALLOWED FILES (ONLY): tests/save.test.ts, tests/planets-economy.test.ts. Do NOT touch anything else. No production code changes.

FAILURES TO FIX (exact current failures):

1. tests/save.test.ts ~line 365 'is lenient on additive fields: missing grid keys and tutorial default safely':
   `expect(validated!.player.structureLevels[name].housing).toBe(0)` — a fresh save now has housing 1; the lenient loader preserves present keys. Update to `toBe(1)` (missing keys like oreMine still normalize to 0 — keep that assertion). Verify the save fixture path: if makeSave() builds via createPlayer, the home grid now has housing 1.

2. tests/planets-economy.test.ts — three population assertions embed the old housing-0 home:
   a. 'home tier 1 caps at 5,000 while a tier 3 colony caps at 5,000 x 1.4': home cap expected 5000 → now 6000 (5000 × 1.2 — housing level 1 gives the +20% cap bonus; VERIFY the exact housing-bonus formula in src/sim/core/population.ts / structures/effects.ts and assert the CORRECT new value from the formula, not a guessed number).
   b. 'population grows independently per planet and pins at its own tier cap': same cap assertion (5000 → new formula value).
   c. 'a fresh zero-pop colony grows at the base 2/sec from 0 (D6)': expected 1120 → 1240 — verify what changed (colony growth: confirm whether the colony grid is all-zero → base rate only, or whether the test's fixture inherits housing 1 somewhere; compute the expected value from the ACTUAL rate formulas and assert precisely; add a brief comment noting the starter-contract context).

RULE: every updated assertion must match the REAL formulas in src/sim (read population.ts + structures/effects.ts + the test fixtures) — derive the number, don't guess.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/save.test.ts tests/planets-economy.test.ts` ALL PASS (report counts); then `npx vitest run tests/claim.test.ts tests/colonisation.test.ts tests/onboarding.test.ts tests/assignment.test.ts` still pass (report).

REPORT: per-file changed lines, the exact formula used for each updated number, final pass counts.
