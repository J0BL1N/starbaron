TASK (StarBaron P6-T04, master roadmap): SCOUT MISSIONS — the mission model: launch → travel → arrival → scan → report lifecycle, mission outcomes (success/detected/destroyed), intel recording via recordIntel, mission source ids.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/fleet/movement.ts (P5-T04): planTravel, TravelLeg, isArrived.
- src/sim/fleet/routes.ts (P5-T09): planRoute, routeEta, routeLegIndex.
- src/sim/intel/scouts.ts (P6-T03): scoutProfileFor, canScout, maxIntelLevelForScouts.
- src/sim/intel/levels.ts (P6-T02): recordIntel, promoteIntel, TargetIntel, IntelLevel.
- src/sim/fleet/orders.ts (P5-T07): order lifecycle conventions.
- src/sim/planets/hash.ts: fnv1a.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/intel/missions.ts
- tests/missions.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `ScoutMissionStatus = 'launched' | 'traveling' | 'scanning' | 'reported' | 'destroyed' | 'failed'` — the lifecycle (launched = issued; traveling = en route; scanning = arrived + scan window; reported = intel recorded; destroyed = lost (detection/PvP — P7 resolves combat; this module models the state); failed = mission aborted (e.g. no scouts at launch — preflight rejection).
2. `ScoutMission = { id: string; ownerId: string; fleetId: string; targetRef: { kind: 'planet' | 'system' | 'body'; id: string }; launchAt: number; arrivalAt: number; scanCompletesAt: number; status: ScoutMissionStatus; recordedLevel: IntelLevel }` — id = fnv1a(`${ownerId}|${fleetId}|${launchAt}|${targetId}`) deterministic.
3. Pure functions:
   - `launchScoutMission(input: { ownerId: string; fleetId: string; targetRef: { kind; id }; launchAt: number; composition: FleetComposition; distancePc: number; speedPcPerSec?: number }): ScoutMission` — preflight: canScout(composition) (else throw 'failed' reason — descriptive Error); speed = fleet speed (slowest-ship — READ fleetTravelTime/movement for the fleet-speed helper and DELEGATE) or the scout speed when supplied; arrivalAt = launchAt + travelDuration(distance, speed) × 1000 (overflow-safe via movement.arrivalTime — DELEGATE); scanCompletesAt = arrivalAt + scanDurationSec × 1000 (scanDurationSec = exported const SCAN_DURATION_SEC = 30 — the scan window; document); status 'launched'; recordedLevel 'none'.
   - `missionStatusAt(mission: ScoutMission, at: number): { status: ScoutMissionStatus; progress: 'pre-launch' | 'in-flight' | 'scanning' | 'complete' | 'lost' }` — deterministic time-based projection: at < launchAt → 'launched'/'pre-launch' (validated at positive finite; at < launchAt allowed — the caller may query before launch); launchAt <= at < arrivalAt → 'traveling'; arrivalAt <= at < scanCompletesAt → 'scanning'; at >= scanCompletesAt → 'reported'/'complete'; destroyed/failed → their status regardless of time ('lost').
   - `recordMissionIntel(mission: ScoutMission, input: { gained: IntelLevel; at: number }): { mission: ScoutMission; intel: TargetIntel }` — the REPORT step: only from 'scanning'/'reported' states (scanning → 'reported'; already reported → re-record allowed? NO — idempotent-ish: a reported mission re-records only if the gained level is HIGHER (promoteIntel semantics); at within the scan window or after); returns the mission (status 'reported', recordedLevel = promoteIntel) + the TargetIntel for the caller's intel store (recordIntel semantics applied to a TargetIntel the caller supplies? — make it return the TargetIntel delta: { targetId: mission.targetRef.id, level: gained, lastUpdatedAt: at, sources: [mission.id] } — the caller merges via recordIntel; document).
   - `abortMission(mission: ScoutMission, at: number): ScoutMission` — launched/traveling/scanning → 'failed' (destroyed/reported cannot abort — throw).
4. Invariants (test): launch preflight (no scouts → throw; unknown class; bad distance/speed/at); arrival/scan math (hand-computed); id determinism; missionStatusAt windows + boundaries (exact launchAt → traveling? — define: at == launchAt → 'traveling' (departed, matches positioning convention); at == arrivalAt → 'scanning'; at == scanCompletesAt → 'reported'); recordMissionIntel state machine (scanning→reported; re-record promotion; destroy/fail paths); abort transitions; validation; immutability; determinism.

TESTS (vitest, tests/missions.test.ts, ~30-36): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/missions.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (destroyed outcome resolution deferred to P7 combat; intel store merging is the caller's contract).
