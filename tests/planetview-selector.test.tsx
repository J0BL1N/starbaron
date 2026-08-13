/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from '@testing-library/react'
import PlanetView from '../src/ui/PlanetView'
import { useGameState } from '../src/ui/useGameState'
import { claimColony, claimHomePlanet } from '../src/sim/player'
import { PLANETS } from '../src/sim/data/planets'
import { eligibleHomeWorlds } from '../src/sim/player/claim'
import type { BodyId } from '../src/sim/world/identity'
import type { SaveGameV3 } from '../src/ui/save'
import type { StructureId } from '../src/sim/structures/types'
import { makeSave, MemoryStorage, readSave, seedSave } from './saveHelpers'

const NOW = 1_700_000_000_000

const ELIGIBLE = eligibleHomeWorlds(PLANETS)
const NO_TAKEN: ReadonlySet<BodyId> = new Set<BodyId>()

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

// 'fixture-player' -> home Kepler-1087 b (T1, baseline 10).
// Colony picks: Kepler-1606 b (T3, plain) and EPIC 201595106 b (T2, highGravity).
function empireSave(): SaveGameV3 {
  const home = claimHomePlanet('fixture-player', NOW, ELIGIBLE, NO_TAKEN)
  const colonyA = claimColony(
    PLANETS.find((entry) => entry.name === 'Kepler-1606 b')!,
    NOW,
  )
  const colonyB = claimColony(
    PLANETS.find((entry) => entry.name === 'EPIC 201595106 b')!,
    NOW,
  )
  return makeSave({
    player: {
      playerId: 'fixture-player',
      homePlanet: { population: 1_000 },
      colonies: [colonyA, colonyB],
      wallet: { credits: 9_000, alloys: 0 },
      structureLevels: {
        [home.name]: { housing: 1 },
        [colonyA.name]: { oreMine: 1 },
        [colonyB.name]: { tradeHub: 1 },
      },
      lastTickAt: NOW,
    },
  })
}

function renderState(storage: MemoryStorage) {
  vi.useFakeTimers()
  return renderHook(() => useGameState({ storage, now: () => NOW }))
}

describe('P2-T04-C planet selector edges (D5/D7)', () => {
  it('switching to a fresh colony immediately after load projects it without a crash', () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    seedSave(storage, empireSave())
    const { result } = renderState(storage)
    const colony = result.current.planets[1]
    expect(colony.name).toBe('Kepler-1606 b')
    act(() => result.current.selectPlanet(colony.name))
    expect(result.current.selectedPlanetName).toBe(colony.name)
    expect(result.current.selectedPlanet.name).toBe(colony.name)
    expect(result.current.state.population).toBe(0)
    expect(result.current.state.levels.oreMine).toBe(1)
    expect(result.current.state.levels.tradeHub).toBe(0)
    expect(result.current.state.credits).toBe(9_000)
  })

  it('an unknown (deleted-colony) name is a safe no-op that falls back to home', () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    seedSave(storage, empireSave())
    const { result } = renderState(storage)
    act(() => result.current.selectPlanet('Long-Lost Colony'))
    expect(result.current.selectedPlanetName).toBe(
      result.current.homePlanet.name,
    )
    expect(result.current.selectedPlanet.name).toBe(
      result.current.homePlanet.name,
    )
    expect(result.current.state.population).toBe(1_000)
    const owned = new Set(result.current.planets.map((planet) => planet.name))
    expect(owned.has(result.current.state.selectedPlanetName)).toBe(true)
    expect(owned.has(result.current.selectedPlanet.name)).toBe(true)
  })

  it('planet selection is UI-only and resets to home across a reload', () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    seedSave(storage, empireSave())
    const first = renderState(storage)
    const colony = first.result.current.planets[1]
    act(() => first.result.current.selectPlanet(colony.name))
    expect(first.result.current.selectedPlanetName).toBe(colony.name)
    first.unmount()

    const second = renderState(storage)
    expect(second.result.current.selectedPlanetName).toBe(
      second.result.current.homePlanet.name,
    )
    expect(second.result.current.state.population).toBe(1_000)
    expect(second.result.current.state.levels.housing).toBe(1)
    const saved = readSave(storage)
    expect('selectedPlanetName' in saved.player).toBe(false)
  })

  it('switching across home + 2 colonies shows each planet data while credits stay global', () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    seedSave(storage, empireSave())
    const { result } = renderState(storage)
    expect(result.current.planets).toHaveLength(3)
    const cases: Array<
      [string, number, Partial<Record<StructureId, number>>]
    > = [
      ['Kepler-1087 b', 1_000, { housing: 1, oreMine: 0, tradeHub: 0 }],
      ['Kepler-1606 b', 0, { housing: 0, oreMine: 1, tradeHub: 0 }],
      ['EPIC 201595106 b', 0, { housing: 0, oreMine: 0, tradeHub: 1 }],
    ]
    for (const [name, population, levels] of cases) {
      act(() => result.current.selectPlanet(name))
      expect(result.current.selectedPlanetName).toBe(name)
      expect(result.current.state.population).toBe(population)
      for (const [id, level] of Object.entries(levels) as Array<
        [StructureId, number]
      >) {
        expect(result.current.state.levels[id]).toBe(level)
      }
      expect(result.current.state.credits).toBe(9_000)
      expect(result.current.state.alloys).toBe(0)
    }
  })

  it('the dropdown lists every owned planet with its tier and switching works in the UI', () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    seedSave(storage, empireSave())
    render(<PlanetView options={{ storage, now: () => NOW }} />)
    const select = screen.getByRole('combobox', { name: 'Planet' })
    const options = within(select).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Kepler-1087 b (Tier 1)',
      'Kepler-1606 b (Tier 3)',
      'EPIC 201595106 b (Tier 2)',
    ])
    expect(screen.getByTestId('resource-population')).toHaveTextContent('1K')
    fireEvent.change(select, { target: { value: 'Kepler-1606 b' } })
    expect(select).toHaveValue('Kepler-1606 b')
    expect(screen.getByTestId('resource-population')).toHaveTextContent('0')
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('9K')
  })
})
