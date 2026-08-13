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
import { COLONISE_COST_CREDITS, useGameState } from '../src/ui/useGameState'
import { PLANETS } from '../src/sim/data/planets'
import {
  claimColony,
  claimHomePlanet,
  createPlayer,
  firstUnclaimedByIndex,
} from '../src/sim/player'
import { eligibleHomeWorlds } from '../src/sim/player/claim'
import type { BodyId } from '../src/sim/world/identity'
import { makeSave, MemoryStorage, readSave, seedSave } from './saveHelpers'

const NOW = 1_700_000_000_000

const ELIGIBLE = eligibleHomeWorlds(PLANETS)
const NO_TAKEN: ReadonlySet<BodyId> = new Set<BodyId>()

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

function singlePlanetSave(credits = 1_000): MemoryStorage {
  vi.useFakeTimers()
  const storage = new MemoryStorage()
  seedSave(
    storage,
    makeSave({
      player: {
        playerId: 'fixture-player',
        wallet: { credits, alloys: 200 },
        lastTickAt: NOW,
      },
    }),
  )
  return storage
}

function exhaustedSave(): MemoryStorage {
  vi.useFakeTimers()
  const home = claimHomePlanet('fixture-player', NOW, ELIGIBLE, NO_TAKEN)
  const colonies = PLANETS.filter((entry) => entry.name !== home.name).map(
    (entry) => claimColony(entry, NOW),
  )
  const storage = new MemoryStorage()
  seedSave(
    storage,
    makeSave({
      player: {
        playerId: 'fixture-player',
        homePlanet: home,
        colonies,
        wallet: { credits: 100_000, alloys: 0 },
        lastTickAt: NOW,
      },
    }),
  )
  return storage
}

function renderPlanet(storage: MemoryStorage) {
  return render(<PlanetView options={{ storage, now: () => NOW }} />)
}

describe('P2-T04-C colonise button', () => {
  it('renders a Colonise button with its cost while there is capacity to expand', () => {
    vi.useFakeTimers()
    renderPlanet(singlePlanetSave())
    const button = screen.getByRole('button', { name: 'Colonise' })
    expect(button).toBeInTheDocument()
    expect(button).toBeEnabled()
    const panel = screen.getByRole('region', { name: 'Colonise' })
    expect(within(panel).getByText('1K cr')).toBeInTheDocument()
  })

  it('shows a note instead of the action button once every planet is claimed', () => {
    vi.useFakeTimers()
    renderPlanet(exhaustedSave())
    expect(
      screen.queryByRole('button', { name: 'Colonise' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/every planet in the catalogue is claimed/i),
    ).toBeInTheDocument()
  })
})

describe('P2-T04-C colonise flow', () => {
  it('adds the first unclaimed planet to the selector and debits the wallet', () => {
    vi.useFakeTimers()
    const storage = singlePlanetSave()
    const expectedColony = firstUnclaimedByIndex(
      PLANETS,
      createPlayer('fixture-player', NOW, ELIGIBLE, NO_TAKEN),
    )!.name
    renderPlanet(storage)

    const select = screen.getByRole('combobox', { name: 'Planet' })
    expect(within(select).getAllByRole('option')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Colonise' }))

    const options = within(select).getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[1]).toHaveTextContent(expectedColony)
    expect(select).toHaveValue(expectedColony)
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('0')

    const saved = readSave(storage)
    expect(saved.player.colonies).toHaveLength(1)
    expect(saved.player.colonies[0].name).toBe(expectedColony)
    expect(saved.player.wallet.credits).toBe(0)
  })

  it('a second rapid click while one colonisation is in flight does not double-colonise', () => {
    vi.useFakeTimers()
    const storage = singlePlanetSave(2 * COLONISE_COST_CREDITS)
    renderPlanet(storage)
    const button = screen.getByRole('button', { name: 'Colonise' })

    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })

    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('COLONISING')

    const saved = readSave(storage)
    expect(saved.player.colonies).toHaveLength(1)
    expect(saved.player.wallet.credits).toBe(COLONISE_COST_CREDITS)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(button).toBeEnabled()
  })
})

describe('P2-T04-C colonise error paths', () => {
  it('shows an insufficient-credits message and adds no colony', () => {
    vi.useFakeTimers()
    const storage = singlePlanetSave(500)
    renderPlanet(storage)
    const select = screen.getByRole('combobox', { name: 'Planet' })
    expect(within(select).getAllByRole('option')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Colonise' }))

    expect(
      screen.getByText(/insufficient credits to colonise/i),
    ).toBeInTheDocument()
    expect(within(select).getAllByRole('option')).toHaveLength(1)
    const saved = readSave(storage)
    expect(saved.player.colonies).toHaveLength(0)
    expect(saved.player.wallet.credits).toBe(500)
  })

  it('reports no unclaimed planets when the whole catalogue is owned', () => {
    vi.useFakeTimers()
    const storage = exhaustedSave()
    const { result } = renderHook(() =>
      useGameState({ storage, now: () => NOW }),
    )
    expect(result.current.canColonise).toBe(false)

    act(() => result.current.colonise())

    expect(result.current.coloniseError).toMatch(/no unclaimed planets/i)
    expect(result.current.planets).toHaveLength(PLANETS.length)
  })
})

describe('P2-T04-C colonise persistence', () => {
  it('persists the colony and the wallet debit across unmount and remount', () => {
    vi.useFakeTimers()
    const storage = singlePlanetSave()
    const first = renderHook(() => useGameState({ storage, now: () => NOW }))
    expect(first.result.current.planets).toHaveLength(1)

    act(() => first.result.current.colonise())

    expect(first.result.current.planets).toHaveLength(2)
    expect(first.result.current.state.credits).toBe(0)
    expect(first.result.current.coloniseError).toBeNull()
    first.unmount()

    const second = renderHook(() => useGameState({ storage, now: () => NOW }))
    expect(second.result.current.planets).toHaveLength(2)
    expect(second.result.current.state.credits).toBe(0)
    expect(second.result.current.canColonise).toBe(true)
  })
})
