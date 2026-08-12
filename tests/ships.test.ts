import { describe, expect, it } from 'vitest'
import {
  SHIP_CLASSES,
  SHIP_CLASS_IDS,
  isShipClassId,
  shipClass,
  validateShipClass,
} from '../src/sim/fleet/ships'
import type { ShipClass, ShipClassId } from '../src/sim/fleet/ships'

function tampered(overrides: Partial<Record<keyof ShipClass, unknown>>): ShipClass {
  const base = SHIP_CLASSES.scout
  return {
    ...base,
    cost: { ...base.cost },
    futureTechModifierIds: [...base.futureTechModifierIds],
    ...overrides,
  } as unknown as ShipClass
}

describe('P5-T01 roster completeness', () => {
  it('defines exactly the 5 audited ship classes', () => {
    expect(SHIP_CLASS_IDS).toHaveLength(5)
    expect(Object.keys(SHIP_CLASSES)).toHaveLength(5)
  })

  it('SHIP_CLASS_IDS is the roster in order and matches the record keys', () => {
    expect([...SHIP_CLASS_IDS]).toEqual([
      'scout',
      'corvette',
      'frigate',
      'cruiser',
      'battleship',
    ])
    expect([...SHIP_CLASS_IDS].sort()).toEqual(Object.keys(SHIP_CLASSES).sort())
  })

  it('every class id matches its record key', () => {
    for (const id of SHIP_CLASS_IDS) {
      expect(SHIP_CLASSES[id].id).toBe(id)
    }
  })
})

describe('P5-T01 draft stat blocks match the brief exactly', () => {
  it('scout: 500cr/0alloy, speed 1.5, cargo 0, combat 10, scouting 100, 15s, tier 1', () => {
    expect(SHIP_CLASSES.scout).toEqual({
      id: 'scout',
      name: 'Scout',
      cost: { credits: 500, alloys: 0 },
      speedPcPerSec: 1.5,
      cargoCapacity: 0,
      combatPower: 10,
      scoutingPower: 100,
      buildTimeSec: 15,
      tier: 1,
      futureTechModifierIds: [],
    })
  })

  it('corvette: 2,000cr/50alloy, speed 1.2, cargo 20, combat 60, scouting 40, 30s, tier 2', () => {
    expect(SHIP_CLASSES.corvette).toEqual({
      id: 'corvette',
      name: 'Corvette',
      cost: { credits: 2_000, alloys: 50 },
      speedPcPerSec: 1.2,
      cargoCapacity: 20,
      combatPower: 60,
      scoutingPower: 40,
      buildTimeSec: 30,
      tier: 2,
      futureTechModifierIds: [],
    })
  })

  it('frigate: 8,000cr/200alloy, speed 1.0, cargo 60, combat 180, scouting 20, 60s, tier 3', () => {
    expect(SHIP_CLASSES.frigate).toEqual({
      id: 'frigate',
      name: 'Frigate',
      cost: { credits: 8_000, alloys: 200 },
      speedPcPerSec: 1.0,
      cargoCapacity: 60,
      combatPower: 180,
      scoutingPower: 20,
      buildTimeSec: 60,
      tier: 3,
      futureTechModifierIds: [],
    })
  })

  it('cruiser: 30,000cr/800alloy, speed 0.8, cargo 200, combat 600, scouting 10, 120s, tier 4', () => {
    expect(SHIP_CLASSES.cruiser).toEqual({
      id: 'cruiser',
      name: 'Cruiser',
      cost: { credits: 30_000, alloys: 800 },
      speedPcPerSec: 0.8,
      cargoCapacity: 200,
      combatPower: 600,
      scoutingPower: 10,
      buildTimeSec: 120,
      tier: 4,
      futureTechModifierIds: [],
    })
  })

  it('battleship: 100,000cr/3,000alloy, speed 0.6, cargo 500, combat 2,000, scouting 5, 300s, tier 5', () => {
    expect(SHIP_CLASSES.battleship).toEqual({
      id: 'battleship',
      name: 'Battleship',
      cost: { credits: 100_000, alloys: 3_000 },
      speedPcPerSec: 0.6,
      cargoCapacity: 500,
      combatPower: 2_000,
      scoutingPower: 5,
      buildTimeSec: 300,
      tier: 5,
      futureTechModifierIds: [],
    })
  })
})

describe('P5-T01 tables are deep-frozen', () => {
  it('the SHIP_CLASSES record and SHIP_CLASS_IDS array are frozen', () => {
    expect(Object.isFrozen(SHIP_CLASSES)).toBe(true)
    expect(Object.isFrozen(SHIP_CLASS_IDS)).toBe(true)
  })

  it('every class object, cost object and futureTechModifierIds array is frozen', () => {
    for (const id of SHIP_CLASS_IDS) {
      const c = SHIP_CLASSES[id]
      expect(Object.isFrozen(c), `${id}`).toBe(true)
      expect(Object.isFrozen(c.cost), `${id}.cost`).toBe(true)
      expect(Object.isFrozen(c.futureTechModifierIds), `${id}.futureTechModifierIds`).toBe(true)
    }
  })

  it('mutating a class object throws TypeError (read-only guarantee)', () => {
    expect(() => {
      ;(SHIP_CLASSES.scout as { combatPower: number }).combatPower = 999
    }).toThrow(TypeError)
  })
})

describe('P5-T01 shipClass accessor', () => {
  it('returns the frozen roster instance itself, stable across calls', () => {
    for (const id of SHIP_CLASS_IDS) {
      expect(shipClass(id), `${id} instance`).toBe(SHIP_CLASSES[id])
      expect(shipClass(id), `${id} stability`).toBe(shipClass(id))
    }
  })

  it('throws RangeError for an unknown id', () => {
    expect(() => shipClass('dreadnought' as unknown as ShipClassId)).toThrow(
      RangeError,
    )
  })
})

describe('P5-T01 isShipClassId guard', () => {
  it('accepts all 5 roster ids', () => {
    for (const id of SHIP_CLASS_IDS) {
      expect(isShipClassId(id), id).toBe(true)
    }
  })

  it('rejects unknown, malformed and non-string values', () => {
    expect(isShipClassId('dreadnought')).toBe(false)
    expect(isShipClassId('Cruiser')).toBe(false)
    expect(isShipClassId('scout ')).toBe(false)
    expect(isShipClassId('')).toBe(false)
    expect(isShipClassId('toString')).toBe(false)
    expect(isShipClassId(42)).toBe(false)
    expect(isShipClassId(undefined)).toBe(false)
    expect(isShipClassId(null)).toBe(false)
    expect(isShipClassId({})).toBe(false)
  })
})

describe('P5-T01 validateShipClass', () => {
  it('passes all 5 roster classes with empty problems', () => {
    for (const id of SHIP_CLASS_IDS) {
      const result = validateShipClass(SHIP_CLASSES[id])
      expect(result.ok, id).toBe(true)
      expect(result.problems, id).toEqual([])
    }
  })

  it('rejects negative credits', () => {
    const result = validateShipClass(
      tampered({ cost: { ...SHIP_CLASSES.scout.cost, credits: -1 } }),
    )
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(
      expect.arrayContaining([expect.stringContaining('credits')]),
    )
  })

  it('rejects negative alloys (alloys must be >= 0)', () => {
    const result = validateShipClass(
      tampered({ cost: { ...SHIP_CLASSES.scout.cost, alloys: -1 } }),
    )
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(
      expect.arrayContaining([expect.stringContaining('alloys')]),
    )
  })

  it('rejects zero speed', () => {
    const result = validateShipClass(tampered({ speedPcPerSec: 0 }))
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(
      expect.arrayContaining([expect.stringContaining('speedPcPerSec')]),
    )
  })

  it('rejects negative cargo capacity', () => {
    const result = validateShipClass(tampered({ cargoCapacity: -5 }))
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(
      expect.arrayContaining([expect.stringContaining('cargoCapacity')]),
    )
  })

  it('rejects tier values outside 1..5', () => {
    expect(validateShipClass(tampered({ tier: 0 })).ok).toBe(false)
    expect(validateShipClass(tampered({ tier: 6 })).ok).toBe(false)
    expect(validateShipClass(tampered({ tier: 2.5 })).ok).toBe(false)
  })

  it('rejects duplicate future tech modifier ids', () => {
    const result = validateShipClass(
      tampered({ futureTechModifierIds: ['tech-a', 'tech-a'] }),
    )
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(
      expect.arrayContaining([expect.stringContaining('futureTechModifierIds')]),
    )
  })

  it('rejects an empty-string future tech modifier id', () => {
    expect(validateShipClass(tampered({ futureTechModifierIds: [''] })).ok).toBe(
      false,
    )
  })

  it('rejects non-finite costs', () => {
    const result = validateShipClass(
      tampered({
        cost: { ...SHIP_CLASSES.scout.cost, credits: Number.NaN },
      }),
    )
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown class id', () => {
    const result = validateShipClass(tampered({ id: 'dreadnought' }))
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(
      expect.arrayContaining([expect.stringContaining('unknown ship class id')]),
    )
  })
})

describe('P5-T01 determinism', () => {
  it('shipClass and validateShipClass are deterministic and non-mutating', () => {
    const snapshot = () =>
      SHIP_CLASS_IDS.map((id) => ({
        id,
        ship: shipClass(id),
        validation: validateShipClass(shipClass(id)),
      }))
    expect(snapshot()).toEqual(snapshot())

    for (const id of SHIP_CLASS_IDS) {
      const before = JSON.stringify(SHIP_CLASSES[id])
      validateShipClass(SHIP_CLASSES[id])
      expect(JSON.stringify(SHIP_CLASSES[id]), id).toBe(before)
    }
  })
})
