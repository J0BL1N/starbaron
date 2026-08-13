READ-ONLY AUDIT — StarBaron P6-T10 (master roadmap): Future Sensor Hooks.

READ LIST:
- src/sim/intel/sensors.ts     (NEW — under audit)
- tests/sensors.test.ts        (NEW — test suite)
- src/sim/intel/scouts.ts      (P6-T03: scoutProfileFor — sensor range delegation)
- src/sim/fleet/fleet.ts       (P5-T03: fleetCompositionSize)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT c6068e3288f4ee64c20a9f3c0e53576d23d71e9c (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p6-t10-brief.md + master roadmap P6-T10):
1. sensorRange (draft base 3 pc + scoutingPower/100 × 0.5 — delegated to scoutProfileFor); signatureOf ((1 + size × 0.1) × stealthFactor); stealthFactor (1.0 default hook — documented as the P7/P9 extension point).
2. detectionOutcome: range gate (distance <= range → detected; marginPc = range − distance); cloaked overrides to 'cloaked' regardless of range; all 3 reasons; boundaries (exactly at range → detected); validation (range/signature > 0, distance >= 0).
3. counterIntel: detected → full detectionChance; unspotted → 0.05 × detectionChance (the brief's parenthetical over the literal 0 — documented); effectiveRangePc placeholder unchanged.
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ intel/scouts + fleet/fleet + fleet/ships (PURE — CONTRACT CORRECTION: SHIP_CLASS_IDS is the frozen roster) + ui/validate + stdlib; banned comment tokens absent; tables frozen.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. sensorRange delegation + draft math (hand-computed); signatureOf; stealthFactor default + hook documented.
C. detectionOutcome: all reasons + boundary + cloaked override; counterIntel math (detected/unspotted).
D. Draft constants exported; determinism; validation; no mutation.
E. Tests ~74 (it.each) covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
