/**
 * Ship class roster (P5-T01).
 *
 * CONTEXT — DESIGN's soldier-fleet model REMAINS the locked combat basis:
 * Attack Power = deployed soldiers (fleet) × Shipyard tier, resolved against
 * Defense Power by the ratio table in DESIGN §5a (P7 wires that locked combat
 * model). These ship classes do NOT replace it — they are the composition
 * units P5-T03 builds fleets FROM: each ship has a tier and combat/scouting
 * power, and a fleet composed of classes maps onto the soldier count that
 * feeds the locked AP model.
 *
 * The stat block here is a DRAFT — balance-harness input only. P10 owns
 * balancing; nothing downstream may treat these numbers as locked.
 *
 * futureTechModifierIds are EXTENSION POINTS: empty today, P11 techs may
 * append modifiers here (the roster is read-only at the type level; a tech
 * system would layer modifiers over these base stats, never mutate them).
 *
 * Pure module: deterministic, no time-source reads, no nondeterministic
 * APIs, no module-level mutable state. All exported tables are deep-frozen.
 */
export type ShipClassId =
  | 'scout'
  | 'corvette'
  | 'frigate'
  | 'cruiser'
  | 'battleship'

export interface ShipClass {
  id: ShipClassId
  name: string
  cost: { credits: number; alloys: number }
  speedPcPerSec: number
  cargoCapacity: number
  combatPower: number
  scoutingPower: number
  buildTimeSec: number
  tier: 1 | 2 | 3 | 4 | 5
  futureTechModifierIds: readonly string[]
}

/**
 * Roster order: smallest/cheapest class first, largest last.
 * Deep-frozen — treat as read-only.
 */
export const SHIP_CLASS_IDS: readonly ShipClassId[] = deepFreeze([
  'scout',
  'corvette',
  'frigate',
  'cruiser',
  'battleship',
])

/**
 * The full ship class table. Deep-frozen (record, each class object, each
 * cost object, each futureTechModifierIds array) — read-only by contract.
 *
 * Draft stat block (P10 balance-harness input, NOT locked):
 * - scout:      500cr/0alloy,   speed 1.5, cargo 0,   combat 10,   scouting 100, build 15s,  tier 1
 * - corvette:   2,000cr/50alloy,  speed 1.2, cargo 20,  combat 60,   scouting 40,  build 30s,  tier 2
 * - frigate:    8,000cr/200alloy, speed 1.0, cargo 60,  combat 180,  scouting 20,  build 60s,  tier 3
 * - cruiser:    30,000cr/800alloy, speed 0.8, cargo 200, combat 600,  scouting 10,  build 120s, tier 4
 * - battleship: 100,000cr/3,000alloy, speed 0.6, cargo 500, combat 2,000, scouting 5, build 300s, tier 5
 */
export const SHIP_CLASSES: Readonly<Record<ShipClassId, ShipClass>> = deepFreeze({
  scout: {
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
  },
  corvette: {
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
  },
  frigate: {
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
  },
  cruiser: {
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
  },
  battleship: {
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
  },
})

/**
 * Deep-freezes a value in place and returns it. Objects, arrays and nested
 * values become non-extensible and non-writable.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/**
 * Returns the (frozen, read-only) class for `id`. Unknown ids throw a
 * RangeError; guard callers with `isShipClassId` when the id is untrusted.
 */
export function shipClass(id: ShipClassId): ShipClass {
  if (!isShipClassId(id)) {
    throw new RangeError(`unknown ship class id, got ${String(id)}`)
  }
  return SHIP_CLASSES[id]
}

export function isShipClassId(value: unknown): value is ShipClassId {
  return (
    typeof value === 'string' &&
    (SHIP_CLASS_IDS as readonly unknown[]).includes(value)
  )
}

export interface ShipClassValidation {
  ok: boolean
  problems: string[]
}

/**
 * Validates a ShipClass record: id in roster; credits finite > 0; alloys
 * finite >= 0; speed > 0; cargo >= 0; combat > 0; scouting >= 0; buildTime > 0;
 * tier an integer in 1..5; futureTechModifierIds an array of unique non-empty
 * strings (an empty array is valid — the roster ships carry none today).
 */
export function validateShipClass(c: ShipClass): ShipClassValidation {
  const problems: string[] = []

  if (!isShipClassId(c.id)) {
    problems.push(`unknown ship class id: ${String(c.id)}`)
  }

  if (!Number.isFinite(c.cost.credits) || c.cost.credits <= 0) {
    problems.push(`cost.credits must be a finite number > 0, got ${c.cost.credits}`)
  }
  if (!Number.isFinite(c.cost.alloys) || c.cost.alloys < 0) {
    problems.push(
      `cost.alloys must be a finite number >= 0, got ${c.cost.alloys}`,
    )
  }

  if (!Number.isFinite(c.speedPcPerSec) || c.speedPcPerSec <= 0) {
    problems.push(
      `speedPcPerSec must be a finite number > 0, got ${c.speedPcPerSec}`,
    )
  }
  if (!Number.isFinite(c.cargoCapacity) || c.cargoCapacity < 0) {
    problems.push(
      `cargoCapacity must be a finite number >= 0, got ${c.cargoCapacity}`,
    )
  }
  if (!Number.isFinite(c.combatPower) || c.combatPower <= 0) {
    problems.push(`combatPower must be a finite number > 0, got ${c.combatPower}`)
  }
  if (!Number.isFinite(c.scoutingPower) || c.scoutingPower < 0) {
    problems.push(
      `scoutingPower must be a finite number >= 0, got ${c.scoutingPower}`,
    )
  }
  if (!Number.isFinite(c.buildTimeSec) || c.buildTimeSec <= 0) {
    problems.push(
      `buildTimeSec must be a finite number > 0, got ${c.buildTimeSec}`,
    )
  }

  if (!Number.isInteger(c.tier) || c.tier < 1 || c.tier > 5) {
    problems.push(`tier must be an integer in 1..5, got ${String(c.tier)}`)
  }

  if (!Array.isArray(c.futureTechModifierIds)) {
    problems.push('futureTechModifierIds must be an array')
  } else {
    for (let i = 0; i < c.futureTechModifierIds.length; i++) {
      const modifier = c.futureTechModifierIds[i]
      if (typeof modifier !== 'string' || modifier.length === 0) {
        problems.push(
          `futureTechModifierIds[${i}] must be a non-empty string, got ${String(modifier)}`,
        )
      }
    }
    const unique = new Set(c.futureTechModifierIds)
    if (unique.size !== c.futureTechModifierIds.length) {
      problems.push('futureTechModifierIds must be unique')
    }
  }

  return { ok: problems.length === 0, problems }
}
