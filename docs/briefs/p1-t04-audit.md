READ-ONLY AUDIT — StarBaron P1-T04 (master roadmap): Canonical Celestial-Body Data Model.

READ LIST:
- src/sim/world/body.ts        (NEW — implementation under audit)
- tests/body-model.test.ts     (NEW — test suite under audit)
- src/sim/world/identity.ts    (P1-T01: BodyId/BodyType, bodyId(), parseCanonicalId(), parentOf(), idSeed())
- src/sim/world/system.ts      (P1-T03: SystemRecord pattern, registerBody)
- src/sim/world/galaxy.ts      (P1-T02: immutable record pattern)
- src/ui/planetgen3d/orbits.ts (OrbitalElements semantics reference)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT b5d285024bc07a955013a427ce0b74190a00380b (`git show b2701cb --stat` must add exactly src/sim/world/body.ts + tests/body-model.test.ts). Working tree + docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p1-t04-brief.md + master roadmap P1-T04):
1. BodyRecord { id: BodyId, system: SystemId, type: BodyType, name, seed, ordinal, radius, mass?, orbit { semiMajorAxis, eccentricity, inclination, longitudeOfAscendingNode, argumentOfPeriapsis, meanAnomaly, period }, realData, provenance, generationVersion }.
2. BODY_GENERATION_VERSION = 1; buildBodyRecord(input) — id = bodyId(system, type, ordinal) branded; orbit defaults per type via local fnv1a-based rng (stars zero orbit; planets/moons/asteroids nonzero).
3. seededBodyName deterministic per type (star 'X Prime', planet pool 16, moon 'X N' roman, asteroid 'SB-####'); describeBody summary.
4. Invariants: parseCanonicalId(body.id).kind==='body' + type/ordinal segments match; parentOf(body.id)===system; orbit fields finite, a>=0, e in [0,1); determinism (deep-equal); version const.
5. Purity: no Math.random/Date/THREE/global state (comments included); no `any`; imports ⊆ {./identity, ./system, ./galaxy, ../planets/hash, stdlib}; NO src/ui/** imports.

CHECK:
A. Purity + imports + no banned tokens in comments.
B. id construction branded; parent chain exact.
C. Orbit defaults — bounds (a>=0, e in [0,1)), finiteness, star-zero, per-type nonzero for planet/moon/asteroid; deterministic per id (same input → same orbit, distinct ids → distinct orbits).
D. seededBodyName determinism + pool membership (planet names from the 16-pool; moon names roman-numeral pattern; star 'Prime').
E. radius/mass passthrough + defaults; realData/provenance passthrough.
F. Tests ~31 covering spec incl. determinism, bounds, names, id chains, version; vitest conventions; imports resolve.
G. Strict TS; no `any`; no render dependency; no unbounded loops (pool picks bounded).

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
