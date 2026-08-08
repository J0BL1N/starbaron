import { describe, expect, it } from 'vitest'
import {
  accruePlayer,
  colonise,
  computePlanetDerived,
  createPlayer,
  gridForPlanet,
  ownedPlanetByName,
  ownedPlanetIdentity,
} from '../src/sim/player'
import type { PlayerState } from '../src/sim/player'
import type { StructureId } from '../src/sim/structures/types'

const NOW = 1_700_000_000_000

// 'fixture-player' deterministically claims Kepler-1087 b (tier 1, baseline 10,
// no quirks) — a stable plain anchor so no quirk multiplier interferes.
const ANCHOR = 'fixture-player'

// '16 Cyg B b' (tier 5, baseline 50) deterministically carries binarySystem
// (systemCount 3, no mass/radius/star quirks): income x1.1 on top of the base.
const BINARY = '16 Cyg B b'
const BINARY_BASELINE = 50

function makeEmpire(playerId: string, colonyNames: string[]): PlayerState {
  let player = createPlayer(playerId, NOW)
  for (const name of colonyNames) {
    player = colonise(player, name, NOW)
  }
  return player
}

function grid(
  player: PlayerState,
  name: string,
  id: StructureId,
  level: number,
): PlayerState {
  return {
    ...player,
    structureLevels: {
      ...player.structureLevels,
      [name]: { ...gridForPlanet(player, name), [id]: level },
    },
  }
}

function ratesFor(player: PlayerState, name: string) {
  return computePlanetDerived(
    ownedPlanetByName(player, name)!,
    gridForPlanet(player, name),
  )
}

describe('P2 closeout — binarySystem lifts the income floor at Trade Hub level 0 (Option A)', () => {
  it("'fixture-player' home planet has no quirks (plain anchor)", () => {
    const player = createPlayer(ANCHOR, NOW)
    expect(ownedPlanetIdentity(player.homePlanet).quirks).toEqual([])
    expect(player.homePlanet.baselineIncomePerSec).toBe(10)
  })

  it("'16 Cyg B b' colony deterministically carries binarySystem", () => {
    const player = makeEmpire(ANCHOR, [BINARY])
    const colony = ownedPlanetByName(player, BINARY)!
    expect(colony.baselineIncomePerSec).toBe(BINARY_BASELINE)
    expect(ownedPlanetIdentity(colony).quirks.map((q) => q.id)).toEqual([
      'binarySystem',
    ])
  })

  it('a binarySystem planet earns baseline income x1.1 at Trade Hub level 0 (floor lifted)', () => {
    const player = makeEmpire(ANCHOR, [BINARY])
    const derived = ratesFor(player, BINARY)
    // Level-0 grid: tradeHub sits at 0, yet the quirk multiplies the floor.
    // DESIGN §4d + Jay 2026-08-09 Option A: binarySystem is a baseline-trait
    // exception — it lifts the income floor at ANY Trade Hub level including 0.
    expect(gridForPlanet(player, BINARY).tradeHub).toBe(0)
    expect(derived.creditsPerSec).toBeCloseTo(BINARY_BASELINE * 1.1, 10)
    expect(derived.creditsPerSec).toBeCloseTo(55, 10)
    expect(derived.creditsPerSec).not.toBe(BINARY_BASELINE)
  })

  it('a non-binary planet at Trade Hub level 0 does NOT get the x1.1 multiplier', () => {
    const player = makeEmpire(ANCHOR, [BINARY])
    const home = ratesFor(player, player.homePlanet.name)
    expect(gridForPlanet(player, player.homePlanet.name).tradeHub).toBe(0)
    expect(ownedPlanetIdentity(player.homePlanet).quirks).toEqual([])
    expect(home.creditsPerSec).toBe(10)
    expect(home.creditsPerSec).not.toBe(10 * 1.1)
  })

  it('level 0 vs level 1: the binarySystem quirk stacks with the per-level gate exactly', () => {
    const at0 = ratesFor(makeEmpire(ANCHOR, [BINARY]), BINARY)
    const at1 = ratesFor(grid(makeEmpire(ANCHOR, [BINARY]), BINARY, 'tradeHub', 1), BINARY)
    // level 0: baseline x binarySystem (floor lifted)
    // level 1: baseline x tradeHub x1.1 x binarySystem x1.1
    expect(at0.creditsPerSec).toBeCloseTo(BINARY_BASELINE * 1.1, 10)
    expect(at1.creditsPerSec).toBeCloseTo(BINARY_BASELINE * 1.1 * 1.1, 10)
    expect(at1.creditsPerSec - at0.creditsPerSec).toBeCloseTo(
      BINARY_BASELINE * 1.1 * 0.1,
      10,
    )
  })

  it('accruePlayer live path pays the x1.1 floor at Trade Hub level 0', () => {
    const player = makeEmpire(ANCHOR, [BINARY])
    const after = accruePlayer(player, 10_000)
    // home 10/sec (plain) + binary colony 55/sec (baseline x1.1) over 10 seconds
    expect(after.wallet.credits).toBeCloseTo(
      1_000 + (10 + BINARY_BASELINE * 1.1) * 10,
      6,
    )
    expect(after.wallet.credits).toBe(1_650)
  })
})
