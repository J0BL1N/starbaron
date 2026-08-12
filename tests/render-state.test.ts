import { describe, expect, it } from 'vitest'
import {
  MAX_RENDERED_SHIPS,
  fleetLabel,
  fleetRenderState,
} from '../src/sim/fleet/render-state'
import type { FleetRenderState } from '../src/sim/fleet/render-state'
import type { Fleet, FleetComposition } from '../src/sim/fleet/fleet'
import type { PositionedFleet, FleetPosition } from '../src/sim/fleet/positioning'

const AT = 1_700_000_000_000

const FLEET_ID = '0123456789abcdef'
const ID8 = FLEET_ID.slice(0, 8)

function composition(overrides: Partial<FleetComposition> = {}): FleetComposition {
  return { scout: 0, corvette: 0, frigate: 0, cruiser: 0, battleship: 0, ...overrides }
}

function position(overrides: Partial<FleetPosition> = {}): FleetPosition {
  return {
    x: 10,
    y: -5,
    z: 3,
    phase: 'traveling',
    progress: 0.5,
    ...overrides,
  }
}

function positioned(overrides: Partial<PositionedFleet> = {}): PositionedFleet {
  return {
    fleetId: FLEET_ID,
    position: position(),
    leg: null,
    ...overrides,
  }
}

function fleet(): Fleet {
  return {
    id: FLEET_ID,
    ownerId: 'p1',
    name: 'Strike Force',
    composition: composition({ scout: 2 }),
    location: { kind: 'planet', bodyId: 'home' },
    createdAt: AT,
    status: 'idle',
  }
}

function input(
  overrides: Partial<Parameters<typeof fleetRenderState>[0]> = {},
): Parameters<typeof fleetRenderState>[0] {
  return {
    positioned: positioned(),
    composition: composition({ scout: 2 }),
    at: AT,
    ...overrides,
  }
}

function drawCounts(state: FleetRenderState): number[] {
  return state.draw.perClass.map((entry) => entry.drawCount)
}

describe('fleetLabel', () => {
  it('labels with owner prefix: "Villains Fleet 01234567"', () => {
    expect(fleetLabel(fleet(), 'Villains')).toBe(`Villains Fleet ${ID8}`)
  })

  it('labels without owner (undefined): "Fleet 01234567"', () => {
    expect(fleetLabel(fleet())).toBe(`Fleet ${ID8}`)
  })

  it('empty-string ownerName yields no prefix (spec ternary)', () => {
    expect(fleetLabel(fleet(), '')).toBe(`Fleet ${ID8}`)
  })

  it('is deterministic: same inputs → same string', () => {
    expect(fleetLabel(fleet(), 'Villains')).toBe(fleetLabel(fleet(), 'Villains'))
  })

  it('throws RangeError for an empty fleet id', () => {
    expect(() => fleetLabel({ ...fleet(), id: '' })).toThrow(RangeError)
  })
})

describe('fleetRenderState — identity and position passthrough', () => {
  it('carries fleetId and the deterministic label with ownerName', () => {
    const out = fleetRenderState(input({ ownerName: 'Villains' }))
    expect(out.fleetId).toBe(FLEET_ID)
    expect(out.label).toBe(`Villains Fleet ${ID8}`)
  })

  it('labels without ownerName', () => {
    expect(fleetRenderState(input()).label).toBe(`Fleet ${ID8}`)
  })

  it('passes position through as a fresh object (equal, never aliased)', () => {
    const pos = position({ x: 3, y: -7, z: 11, phase: 'at-origin', progress: 0 })
    const out = fleetRenderState(input({ positioned: positioned({ position: pos }) }))
    expect(out.position).toEqual(pos)
    expect(out.position).not.toBe(pos)
    expect(pos).toEqual(position({ x: 3, y: -7, z: 11, phase: 'at-origin', progress: 0 }))
  })
})

describe('fleetRenderState — draw (LOD counts)', () => {
  it('tiny fleet (10 scouts) draws ALL ships: drawCount 10, totalShips 10', () => {
    const out = fleetRenderState(input({ composition: composition({ scout: 10 }) }))
    expect(out.draw.totalShips).toBe(10)
    expect(out.draw.perClass).toEqual([
      { id: 'scout', name: 'Scout', count: 10, drawCount: 10 },
    ])
  })

  it('120 scouts → LOD cap 60: drawCount 60, full count 120 stays in the model', () => {
    const out = fleetRenderState(input({ composition: composition({ scout: 120 }) }))
    expect(out.draw.totalShips).toBe(120)
    expect(out.draw.perClass).toEqual([
      { id: 'scout', name: 'Scout', count: 120, drawCount: MAX_RENDERED_SHIPS },
    ])
  })

  it('hand-computed 2-class mix: 100 scouts + 50 corvettes → 150 total, ratio 0.4 → 40/20', () => {
    const out = fleetRenderState(
      input({ composition: composition({ scout: 100, corvette: 50 }) }),
    )
    expect(out.draw.totalShips).toBe(150)
    expect(out.draw.perClass).toEqual([
      { id: 'scout', name: 'Scout', count: 100, drawCount: 40 },
      { id: 'corvette', name: 'Corvette', count: 50, drawCount: 20 },
    ])
  })

  it('fleet exactly at the cap (60 ships) draws all (ratio 1)', () => {
    const out = fleetRenderState(
      input({ composition: composition({ scout: 30, corvette: 30 }) }),
    )
    expect(out.draw.perClass).toEqual([
      { id: 'scout', name: 'Scout', count: 30, drawCount: 30 },
      { id: 'corvette', name: 'Corvette', count: 30, drawCount: 30 },
    ])
  })

  it('0-count classes are ABSENT from perClass', () => {
    const out = fleetRenderState(input({ composition: composition({ scout: 2 }) }))
    expect(out.draw.perClass).toEqual([
      { id: 'scout', name: 'Scout', count: 2, drawCount: 2 },
    ])
  })

  it('empty composition → totalShips 0, empty perClass', () => {
    const out = fleetRenderState(input({ composition: composition() }))
    expect(out.draw.totalShips).toBe(0)
    expect(out.draw.perClass).toEqual([])
  })

  it('fractional ratios round deterministically: 100 scouts + 21 corvettes → 50/10 (sum 60)', () => {
    const out = fleetRenderState(
      input({ composition: composition({ scout: 100, corvette: 21 }) }),
    )
    expect(out.draw.totalShips).toBe(121)
    expect(out.draw.perClass.map((e) => e.drawCount)).toEqual([50, 10])
    expect(drawCounts(out).reduce((a, b) => a + b, 0)).toBe(MAX_RENDERED_SHIPS)
  })

  it('oversized fleet: sum of drawCounts never exceeds the cap', () => {
    const out = fleetRenderState(
      input({ composition: composition({ scout: 120, corvette: 30 }) }),
    )
    expect(out.draw.totalShips).toBe(150)
    expect(drawCounts(out).reduce((a, b) => a + b, 0)).toBe(MAX_RENDERED_SHIPS)
  })

  it('5-class rounding-overflow regression: 61 ships cannot draw 61 (Codex finding 1)', () => {
    const out = fleetRenderState(
      input({
        composition: composition({
          scout: 1,
          corvette: 1,
          frigate: 1,
          cruiser: 28,
          battleship: 30,
        }),
      }),
    )
    expect(out.draw.totalShips).toBe(61)
    const sum = drawCounts(out).reduce((a, b) => a + b, 0)
    expect(sum).toBeLessThanOrEqual(MAX_RENDERED_SHIPS)
    expect(sum).toBe(Math.min(MAX_RENDERED_SHIPS, out.draw.totalShips))
    expect(sum).toBe(MAX_RENDERED_SHIPS)
    expect(out.draw.perClass.map((e) => e.drawCount)).toEqual([1, 1, 1, 28, 29])
  })

  it('a non-empty class can round to drawCount 0 in an oversized fleet (pure math, documented)', () => {
    const out = fleetRenderState(
      input({ composition: composition({ scout: 1, battleship: 120 }) }),
    )
    expect(out.draw.perClass).toEqual([
      { id: 'scout', name: 'Scout', count: 1, drawCount: 0 },
      { id: 'battleship', name: 'Battleship', count: 120, drawCount: 60 },
    ])
  })
})

describe('fleetRenderState — scaleHint', () => {
  it('1 ship → floor 1.0', () => {
    expect(fleetRenderState(input({ composition: composition({ scout: 1 }) })).scaleHint).toBe(1)
  })

  it('empty fleet (0 ships) → floor 1.0', () => {
    expect(fleetRenderState(input({ composition: composition() })).scaleHint).toBe(1)
  })

  it('100 ships → 1 + log10(100)/10 = 1.2', () => {
    const out = fleetRenderState(input({ composition: composition({ scout: 100 }) }))
    expect(out.scaleHint).toBeCloseTo(1.2, 10)
  })

  it('1,000,000 ships → 1 + 6/10 = 1.6 (formula; ceiling is at 10^10)', () => {
    const out = fleetRenderState(input({ composition: composition({ scout: 1_000_000 }) }))
    expect(out.scaleHint).toBeCloseTo(1.6, 10)
  })

  it('10^10 ships → ceiling 2.0', () => {
    const out = fleetRenderState(input({ composition: composition({ scout: 10 ** 10 }) }))
    expect(out.scaleHint).toBe(2)
  })

  it('10^15 ships → clamped at 2.0 (never above)', () => {
    const out = fleetRenderState(input({ composition: composition({ scout: 10 ** 15 }) }))
    expect(out.scaleHint).toBe(2)
  })

  it('is deterministic for the same total', () => {
    const a = fleetRenderState(input({ composition: composition({ scout: 250 }) }))
    const b = fleetRenderState(input({ composition: composition({ scout: 250 }) }))
    expect(a.scaleHint).toBe(b.scaleHint)
  })
})

describe('fleetRenderState — statusHint', () => {
  it('statusHint mirrors the position phase verbatim (draft)', () => {
    const phases = ['at-origin', 'traveling', 'at-destination'] as const
    for (const phase of phases) {
      const progress = phase === 'traveling' ? 0.5 : phase === 'at-origin' ? 0 : 1
      const out = fleetRenderState(
        input({ positioned: positioned({ position: position({ phase, progress }) }) }),
      )
      expect(out.statusHint).toBe(phase)
    }
  })
})

describe('fleetRenderState — determinism, immutability, at-input', () => {
  it('same inputs → deep-equal results with distinct object graphs', () => {
    const a = fleetRenderState(input({ ownerName: 'Villains' }))
    const b = fleetRenderState(input({ ownerName: 'Villains' }))
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.position).not.toBe(b.position)
    expect(a.draw.perClass).not.toBe(b.draw.perClass)
    expect(a.draw.perClass[0]).not.toBe(b.draw.perClass[0])
  })

  it('never mutates the positioned/composition inputs', () => {
    const comp = composition({ scout: 120, corvette: 50 })
    const pos = position()
    const pf = positioned({ position: pos })
    const beforeComp = JSON.stringify(comp)
    const beforePos = JSON.stringify(pos)
    fleetRenderState(input({ positioned: pf, composition: comp }))
    expect(JSON.stringify(comp)).toBe(beforeComp)
    expect(JSON.stringify(pos)).toBe(beforePos)
    expect(JSON.stringify(pf)).toBe(JSON.stringify(positioned({ position: pos })))
  })

  it('output is independent of `at` (validated input only, no wall clock)', () => {
    const a = fleetRenderState(input({ at: AT }))
    const b = fleetRenderState(input({ at: AT + 123_456 }))
    expect(a).toEqual(b)
  })
})

describe('fleetRenderState — validation', () => {
  it('throws RangeError for non-finite or non-positive at (assertPositiveAt)', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => fleetRenderState(input({ at: bad })), String(bad)).toThrow(RangeError)
    }
  })

  it('throws RangeError for a bad composition (negative or fractional count)', () => {
    expect(() =>
      fleetRenderState(input({ composition: composition({ scout: -1 }) })),
    ).toThrow(RangeError)
    expect(() =>
      fleetRenderState(input({ composition: composition({ scout: 1.5 }) })),
    ).toThrow(RangeError)
  })

  it('throws RangeError for non-finite position coordinates', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() =>
        fleetRenderState(
          input({ positioned: positioned({ position: position({ x: bad }) }) }),
        ),
        String(bad),
      ).toThrow(RangeError)
      expect(() =>
        fleetRenderState(
          input({ positioned: positioned({ position: position({ z: bad }) }) }),
        ),
        String(bad),
      ).toThrow(RangeError)
    }
  })

  it('throws RangeError for a bad position phase or progress', () => {
    expect(() =>
      fleetRenderState(
        input({
          positioned: positioned({
            position: position({ phase: 'combat' as FleetPosition['phase'] }),
          }),
        }),
      ),
    ).toThrow(RangeError)
    for (const bad of [-0.1, 1.5, NaN]) {
      expect(() =>
        fleetRenderState(
          input({ positioned: positioned({ position: position({ progress: bad }) }) }),
        ),
        String(bad),
      ).toThrow(RangeError)
    }
  })

  it('throws RangeError for an empty fleetId', () => {
    expect(() =>
      fleetRenderState(input({ positioned: positioned({ fleetId: '' }) })),
    ).toThrow(RangeError)
  })
})
