READ-ONLY AUDIT — StarBaron P7-T02 (master roadmap): Invasion Fleet.

READ LIST:
- src/sim/combat/invasion.ts      (NEW — under audit)
- tests/invasion.test.ts          (NEW — test suite)
- src/sim/player/estimator.ts     (garrisonCapFor — the LOCKED garrison cap source, BARRACKS_GARRISON_CAP_PER_LEVEL × effectiveLevel)
- src/sim/player/types.ts         (OwnedPlanet — no structure levels; barracksLevels is a required input)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 25c35af836caae82ba29541af8a6aa55710d0b17 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p7-t02-brief.md + master roadmap P7-T02):
1. InvasionForce { attackerId, troops (positive), recruitedFrom (sums to troops), fleetSize, raisedAt, status assembling|ready|committed|destroyed }; RecruitmentResult { force, recruitmentCost {credits: 0 — launch is T01; population: min(desired, available)}, deficiencies }.
2. recruitTroops: pool = Σ min(population, garrisonCap) with garrisonCap DELEGATED to the locked estimator.garrisonCapFor(barracksLevel) (barracksLevels required input — OwnedPlanet has none, missing → 0, documented); draw available desc / name asc tie-break / min(share, remaining); deficiency single message; desired positive integer; fleetSize >= 0.
3. commitInvasion: ready→committed only (assembling/committed/destroyed throw); at validated. invasionInvariants tamper classes (troops positive, recruitedFrom sums, status valid, raisedAt positive finite).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ player/estimator + player/types + ui/validate + stdlib; banned comment tokens absent; tables deep-frozen.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Pool math via the LOCKED garrisonCapFor (hand-compute 2 planets: pop 3,000/2,000 with caps 5,000/10,000 → pool 5,000; desired 5,000 → all recruited, draw order + tie-break).
C. Deficiency (desired > available → message + recruits = available); credits 0 documented; draw determinism.
D. commitInvasion transitions; invariants tamper classes; immutability; determinism; validation.
E. Tests ~37 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
