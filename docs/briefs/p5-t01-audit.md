READ-ONLY AUDIT — StarBaron P5-T01 (master roadmap): Ship Definitions.

READ LIST:
- src/sim/fleet/ships.ts     (NEW — under audit)
- tests/ships.test.ts        (NEW — test suite)
- src/sim/structures/effects.ts (SHIPYARD_* locked consts — fleet cap context)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 0ae783441ab6ed87c0c85f133f02ff3bcdc69c5a (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p5-t01-brief.md + master roadmap P5-T01):
1. ShipClassId 5-class roster; ShipClass { id, name, cost {credits, alloys}, speedPcPerSec, cargoCapacity, combatPower, scoutingPower, buildTimeSec, tier 1..5, futureTechModifierIds (empty extension points, documented) }.
2. SHIP_CLASSES deep-frozen (record + each class + nested objects/arrays); SHIP_CLASS_IDS frozen roster; shipClass() returns the frozen instance (RangeError unknown); isShipClassId guard; validateShipClass (id in roster, costs finite > 0 / alloys >= 0, speed > 0, cargo >= 0, combat > 0, scouting >= 0, buildTime > 0, tier 1..5, unique non-empty tech ids).
3. Draft stat block matches the brief's numbers EXACTLY (scout 500cr/1.5/10/100/15s T1 … battleship 100kcr/0.6/2000/5/300s T5).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Roster completeness + exact draft numbers; deep-freeze (every level); shipClass() unknown-id behavior.
C. validateShipClass tamper classes (incl. NaN, dup tech ids, tier bounds); guard.
D. Tests ~26 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
