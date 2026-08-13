import { describe, expect, it } from 'vitest'
import {
  MISSION_PROGRESSES,
  SCAN_DURATION_SEC,
  SCOUT_MISSION_STATUSES,
  SCOUT_MISSION_TARGET_KINDS,
  abortMission,
  launchScoutMission,
  missionStatusAt,
  recordMissionIntel,
} from '../src/sim/intel/missions'
import { fnv1a } from '../src/sim/planets/hash'
import { SHIP_CLASSES } from '../src/sim/fleet/ships'
import type { FleetComposition } from '../src/sim/fleet/fleet'
import type { IntelLevel } from '../src/sim/intel/levels'
import type {
  LaunchScoutMissionInput,
  ScoutMission,
  ScoutMissionStatus,
} from '../src/sim/intel/missions'

const SCOUT_SPEED = SHIP_CLASSES.scout.speedPcPerSec
const CORVETTE_SPEED = SHIP_CLASSES.corvette.speedPcPerSec
const BATTLESHIP_SPEED = SHIP_CLASSES.battleship.speedPcPerSec

function composition(overrides: Partial<FleetComposition> = {}): FleetComposition {
  return { scout: 0, corvette: 0, frigate: 0, cruiser: 0, battleship: 0, ...overrides }
}

function input(
  overrides: Partial<LaunchScoutMissionInput> = {},
): LaunchScoutMissionInput {
  return {
    ownerId: 'jay',
    fleetId: 'fleet-alpha',
    targetRef: { kind: 'planet', id: 'body|alpha|planet|1' },
    launchAt: 100_000,
    composition: composition({ scout: 3 }),
    distancePc: 60,
    ...overrides,
  }
}

function withStatus(m: ScoutMission, status: ScoutMissionStatus): ScoutMission {
  return { ...m, status }
}

describe('P6-T04 module surface — constants and unions', () => {
  it('exposes the locked 30s scan window', () => {
    expect(SCAN_DURATION_SEC).toBe(30)
  })

  it('exposes the exact frozen status/target/progress unions', () => {
    expect(SCOUT_MISSION_STATUSES).toEqual([
      'launched',
      'traveling',
      'scanning',
      'reported',
      'destroyed',
      'failed',
    ])
    expect(Object.isFrozen(SCOUT_MISSION_STATUSES)).toBe(true)
    expect(SCOUT_MISSION_TARGET_KINDS).toEqual(['planet', 'system', 'body'])
    expect(MISSION_PROGRESSES).toEqual([
      'pre-launch',
      'in-flight',
      'scanning',
      'complete',
      'lost',
    ])
  })
})

describe('P6-T04 launchScoutMission — hand-computed arrival/scan math', () => {
  it('60pc at scout speed 1.5: arrivalAt = launchAt + 40000, scan at +70000', () => {
    const m = launchScoutMission(input())
    expect(m.launchAt).toBe(100_000)
    expect(m.arrivalAt).toBe(100_000 + (60 / SCOUT_SPEED) * 1000)
    expect(m.arrivalAt).toBe(140_000)
    expect(m.scanCompletesAt).toBe(m.arrivalAt + SCAN_DURATION_SEC * 1000)
    expect(m.scanCompletesAt).toBe(170_000)
    expect(m.status).toBe('launched')
    expect(m.recordedLevel).toBe('none')
  })

  it('travel time scales with distance: 30pc → arrivalAt = launchAt + 20000', () => {
    const m = launchScoutMission(input({ distancePc: 30 }))
    expect(m.arrivalAt).toBe(100_000 + (30 / SCOUT_SPEED) * 1000)
    expect(m.arrivalAt).toBe(120_000)
    expect(m.scanCompletesAt).toBe(150_000)
  })

  it('the scan window is exactly 30000ms and the input is never mutated', () => {
    const target = { kind: 'planet' as const, id: 'body|alpha|planet|1' }
    const req = input({ targetRef: target })
    const before = JSON.stringify(req.composition)
    const m = launchScoutMission(req)
    expect(m.scanCompletesAt - m.arrivalAt).toBe(30_000)
    expect(m.targetRef).not.toBe(target)
    expect(m.targetRef).toEqual(target)
    expect(JSON.stringify(req.composition)).toBe(before)
  })
})

describe('P6-T04 speed delegation — the fleet travels at its slowest ship', () => {
  it('a battleship escort slows the mission to 0.6 pc/s (60pc → 100s)', () => {
    const m = launchScoutMission(
      input({ composition: composition({ scout: 2, battleship: 1 }) }),
    )
    expect(m.arrivalAt).toBe(100_000 + (60 / BATTLESHIP_SPEED) * 1000)
    expect(m.arrivalAt).toBe(200_000)
  })

  it('speed is the minimum over classes with a positive count (corvette < scout)', () => {
    const m = launchScoutMission(
      input({ composition: composition({ scout: 1, corvette: 2 }) }),
    )
    expect(m.arrivalAt).toBe(100_000 + (60 / CORVETTE_SPEED) * 1000)
    expect(m.arrivalAt).toBe(150_000)
  })

  it('a supplied speedPcPerSec overrides the fleet speed, but scouts are still required', () => {
    const m = launchScoutMission(input({ speedPcPerSec: 3 }))
    expect(m.arrivalAt).toBe(120_000)
    expect(() =>
      launchScoutMission(input({ composition: composition(), speedPcPerSec: 1.5 })),
    ).toThrow(Error)
  })
})

describe('P6-T04 preflight rejections', () => {
  it('a fleet with no scouts throws a descriptive Error (failed reason)', () => {
    expect(() => launchScoutMission(input({ composition: composition() }))).toThrow(
      Error,
    )
    expect(() =>
      launchScoutMission(input({ composition: composition({ cruiser: 2 }) })),
    ).toThrow(/no scouts/)
  })

  it('rejects a composition carrying an unknown ship class key', () => {
    const bogus = {
      scout: 1,
      corvette: 0,
      frigate: 0,
      cruiser: 0,
      battleship: 0,
      destroyer: 2,
    } as unknown as FleetComposition
    expect(() => launchScoutMission(input({ composition: bogus }))).toThrow(
      RangeError,
    )
  })

  it('rejects malformed distancePc values', () => {
    for (const distancePc of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => launchScoutMission(input({ distancePc }))).toThrow(RangeError)
    }
  })

  it('rejects malformed speedPcPerSec override values', () => {
    for (const speedPcPerSec of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        launchScoutMission(input({ speedPcPerSec })),
      ).toThrow(RangeError)
    }
  })

  it('rejects malformed launchAt values', () => {
    for (const launchAt of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => launchScoutMission(input({ launchAt }))).toThrow(RangeError)
    }
  })

  it('rejects a bad targetRef and empty ids', () => {
    expect(() =>
      launchScoutMission(input({ targetRef: { kind: 'bogus' as 'planet', id: 'x' } })),
    ).toThrow(RangeError)
    expect(() =>
      launchScoutMission(input({ targetRef: { kind: 'planet', id: '  ' } })),
    ).toThrow(RangeError)
    expect(() => launchScoutMission(input({ ownerId: '   ' }))).toThrow(RangeError)
    expect(() => launchScoutMission(input({ fleetId: '' }))).toThrow(RangeError)
  })

  it('rejects bad composition counts', () => {
    expect(() =>
      launchScoutMission(input({ composition: composition({ scout: -1 }) })),
    ).toThrow(RangeError)
    expect(() =>
      launchScoutMission(input({ composition: composition({ scout: 1.5 }) })),
    ).toThrow(RangeError)
  })
})

describe('P6-T04 mission id determinism', () => {
  it('is the fnv1a formula and repeats for identical inputs', () => {
    const expected = fnv1a('jay|fleet-alpha|100000|body|alpha|planet|1').toString(16)
    const a = launchScoutMission(input())
    const b = launchScoutMission(input())
    expect(a.id).toBe(expected)
    expect(b.id).toBe(expected)
    expect(a).toEqual(b)
  })

  it('varies across launchAt, target, owner and fleet', () => {
    const ids = [
      launchScoutMission(input()).id,
      launchScoutMission(input({ launchAt: 200_000 })).id,
      launchScoutMission(
        input({ targetRef: { kind: 'system', id: 'sys-9' } }),
      ).id,
      launchScoutMission(input({ ownerId: 'kim' })).id,
      launchScoutMission(input({ fleetId: 'fleet-beta' })).id,
    ]
    expect(new Set(ids).size).toBe(5)
  })
})

describe('P6-T04 missionStatusAt — windows and boundaries', () => {
  const m = launchScoutMission(input())

  it('before launch → launched / pre-launch', () => {
    expect(missionStatusAt(m, 99_999)).toEqual({
      status: 'launched',
      progress: 'pre-launch',
    })
  })

  it('exactly at launchAt → traveling / in-flight (departed)', () => {
    expect(missionStatusAt(m, m.launchAt)).toEqual({
      status: 'traveling',
      progress: 'in-flight',
    })
  })

  it('mid-flight → traveling / in-flight', () => {
    expect(missionStatusAt(m, 120_000)).toEqual({
      status: 'traveling',
      progress: 'in-flight',
    })
  })

  it('exactly at arrivalAt → scanning / scanning', () => {
    expect(missionStatusAt(m, m.arrivalAt)).toEqual({
      status: 'scanning',
      progress: 'scanning',
    })
  })

  it('inside the scan window → scanning / scanning', () => {
    expect(missionStatusAt(m, 155_000)).toEqual({
      status: 'scanning',
      progress: 'scanning',
    })
  })

  it('exactly at scanCompletesAt and after → reported / complete', () => {
    expect(missionStatusAt(m, m.scanCompletesAt)).toEqual({
      status: 'reported',
      progress: 'complete',
    })
    expect(missionStatusAt(m, 200_000)).toEqual({
      status: 'reported',
      progress: 'complete',
    })
  })
})

describe('P6-T04 missionStatusAt — terminal states', () => {
  const m = launchScoutMission(input())

  it('destroyed stays destroyed / lost at every time', () => {
    const destroyed = withStatus(m, 'destroyed')
    expect(missionStatusAt(destroyed, 50_000)).toEqual({
      status: 'destroyed',
      progress: 'lost',
    })
    expect(missionStatusAt(destroyed, 500_000)).toEqual({
      status: 'destroyed',
      progress: 'lost',
    })
  })

  it('failed stays failed / lost at every time', () => {
    const failed = withStatus(m, 'failed')
    expect(missionStatusAt(failed, 50_000)).toEqual({
      status: 'failed',
      progress: 'lost',
    })
    expect(missionStatusAt(failed, 500_000)).toEqual({
      status: 'failed',
      progress: 'lost',
    })
  })
})

describe('P6-T04 missionStatusAt — validation', () => {
  it('rejects non-positive / non-finite at and malformed mission shape', () => {
    const m = launchScoutMission(input())
    expect(() => missionStatusAt(m, 0)).toThrow(RangeError)
    expect(() => missionStatusAt(m, -5)).toThrow(RangeError)
    expect(() => missionStatusAt(m, Number.NaN)).toThrow(RangeError)
    expect(() => missionStatusAt(m, Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() =>
      missionStatusAt({ ...m, scanCompletesAt: m.launchAt }, 150_000),
    ).toThrow(RangeError)
  })
})

describe('P6-T04 recordMissionIntel — the report step', () => {
  const m = launchScoutMission(input())

  it('scanning → reported with the gained level and the intel delta', () => {
    const result = recordMissionIntel(m, { gained: 'scanned', at: 150_000 })
    expect(result.mission.status).toBe('reported')
    expect(result.mission.recordedLevel).toBe('scanned')
    expect(result.mission.id).toBe(m.id)
    expect(result.mission.arrivalAt).toBe(m.arrivalAt)
    expect(result.intel).toEqual({
      targetId: 'body|alpha|planet|1',
      level: 'scanned',
      lastUpdatedAt: 150_000,
      sources: [m.id],
    })
  })

  it('records at exactly scanCompletesAt and after the window', () => {
    expect(
      recordMissionIntel(m, { gained: 'scouted', at: m.scanCompletesAt }).mission
        .status,
    ).toBe('reported')
    expect(
      recordMissionIntel(m, { gained: 'scouted', at: 200_000 }).mission.status,
    ).toBe('reported')
  })

  it('rejects recording before arrival (traveling and pre-launch)', () => {
    expect(() =>
      recordMissionIntel(m, { gained: 'scanned', at: 120_000 }),
    ).toThrow(Error)
    expect(() =>
      recordMissionIntel(m, { gained: 'scanned', at: 50_000 }),
    ).toThrow(Error)
  })

  it('rejects recording on a destroyed or failed mission', () => {
    expect(() =>
      recordMissionIntel(withStatus(m, 'destroyed'), {
        gained: 'scanned',
        at: 150_000,
      }),
    ).toThrow(Error)
    expect(() =>
      recordMissionIntel(withStatus(m, 'failed'), {
        gained: 'scanned',
        at: 150_000,
      }),
    ).toThrow(Error)
  })

  it('re-recording promotes: a strictly higher gained level still records', () => {
    const first = recordMissionIntel(m, { gained: 'scanned', at: 150_000 })
    const promoted = recordMissionIntel(first.mission, {
      gained: 'scouted',
      at: 200_000,
    })
    expect(promoted.mission.status).toBe('reported')
    expect(promoted.mission.recordedLevel).toBe('scouted')
    expect(promoted.intel.level).toBe('scouted')
    expect(promoted.intel.sources).toEqual([m.id])
  })

  it('rejects re-recording with an equal or lower gained level', () => {
    const first = recordMissionIntel(m, { gained: 'scanned', at: 150_000 })
    expect(() =>
      recordMissionIntel(first.mission, { gained: 'scanned', at: 200_000 }),
    ).toThrow(/re-record/)
    expect(() =>
      recordMissionIntel(first.mission, { gained: 'observed', at: 250_000 }),
    ).toThrow(/re-record/)
  })

  it('never mutates the input and returns fresh objects', () => {
    const before = JSON.stringify(m)
    const result = recordMissionIntel(m, { gained: 'scanned', at: 150_000 })
    expect(JSON.stringify(m)).toBe(before)
    expect(m.status).toBe('launched')
    expect(result.mission).not.toBe(m)
    expect(result.intel.sources).not.toBe(m.targetRef)
  })
})

describe('P6-T04 recordMissionIntel — validation', () => {
  it('rejects an unknown gained level and a bad at', () => {
    const m = launchScoutMission(input())
    expect(() =>
      recordMissionIntel(m, { gained: 'bogus' as IntelLevel, at: 150_000 }),
    ).toThrow(RangeError)
    expect(() =>
      recordMissionIntel(m, { gained: 'scanned', at: 0 }),
    ).toThrow(RangeError)
    expect(() =>
      recordMissionIntel(m, { gained: 'scanned', at: Number.NaN }),
    ).toThrow(RangeError)
  })
})

describe('P6-T04 abortMission', () => {
  it('aborts launched, traveling and scanning missions to failed', () => {
    const m = launchScoutMission(input())
    const aborted = abortMission(m, 100_000)
    expect(aborted.status).toBe('failed')
    expect(aborted.id).toBe(m.id)
    expect(m.status).toBe('launched')
    expect(abortMission(withStatus(m, 'traveling'), 100_000).status).toBe('failed')
    expect(abortMission(withStatus(m, 'scanning'), 100_000).status).toBe('failed')
  })

  it('rejects aborting terminal missions, validates at, and stays immutable', () => {
    const m = launchScoutMission(input())
    expect(() => abortMission(withStatus(m, 'reported'), 100_000)).toThrow(Error)
    expect(() => abortMission(withStatus(m, 'destroyed'), 100_000)).toThrow(Error)
    expect(() => abortMission(withStatus(m, 'failed'), 100_000)).toThrow(Error)
    expect(() => abortMission(m, 0)).toThrow(RangeError)
    expect(() => abortMission(m, Number.NaN)).toThrow(RangeError)
    expect(JSON.stringify(m)).toBe(JSON.stringify(launchScoutMission(input())))
  })
})

describe('P6-T04 determinism', () => {
  it('identical inputs produce deep-equal results across the lifecycle', () => {
    const a = launchScoutMission(input())
    const b = launchScoutMission(input())
    expect(a).toEqual(b)
    expect(missionStatusAt(a, 150_000)).toEqual(missionStatusAt(b, 150_000))
    expect(recordMissionIntel(a, { gained: 'scanned', at: 150_000 })).toEqual(
      recordMissionIntel(b, { gained: 'scanned', at: 150_000 }),
    )
    expect(abortMission(a, 100_000)).toEqual(abortMission(b, 100_000))
  })
})
