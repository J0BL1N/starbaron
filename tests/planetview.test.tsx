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
import { PLANETS } from '../src/sim/data/planets'
import { claimColony, claimHomePlanet } from '../src/sim/player'
import type { StructureId } from '../src/sim/structures/types'
import { makeSave, seedLocalStorageGap, seedSave } from './saveHelpers'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

function renderPlanet() {
  vi.useFakeTimers()
  return render(<PlanetView />)
}

describe('PlanetView — starter state', () => {
  it('renders starter resources, the claimed planet name, and all 7 structures', () => {
    renderPlanet()
    const heading = screen.getByRole('heading', { level: 1 })
    expect(PLANETS.some((planet) => planet.name === heading.textContent)).toBe(
      true,
    )
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('1K')
    expect(screen.getByTestId('resource-alloys')).toHaveTextContent('0')
    expect(screen.getByTestId('resource-population')).toHaveTextContent('1K')
    expect(screen.getByTestId('resource-fleet')).toHaveTextContent('0')
    expect(screen.getByTestId('resource-garrison')).toHaveTextContent('0')

    const grid = screen.getByRole('region', { name: 'Structures' })
    expect(within(grid).getAllByRole('article')).toHaveLength(7)
    expect(screen.getAllByRole('button', { name: /^Build / })).toHaveLength(7)
  })

  it('shows next build costs via formatNumber on every structure card', () => {
    renderPlanet()
    const grid = screen.getByRole('region', { name: 'Structures' })
    expect(within(grid).getByText('Next: 300 cr')).toBeInTheDocument()
    expect(within(grid).getByText('Next: 500 cr')).toBeInTheDocument()
    expect(within(grid).getByText('Next: 5K cr')).toBeInTheDocument()
    expect(within(grid).getByText('Next: 2K cr + 1K alloys')).toBeInTheDocument()
  })
})

describe('PlanetView — build flow', () => {
  it('buying a structure increments its level and deducts credits', () => {
    renderPlanet()
    const grid = screen.getByRole('region', { name: 'Structures' })

    fireEvent.click(screen.getByRole('button', { name: 'Build Housing' }))

    expect(screen.getByTestId('resource-credits')).toHaveTextContent('700')
    expect(
      within(grid).getByText('Housing').closest('[data-structure="housing"]'),
    ).toHaveTextContent('Lv 1')
    expect(
      within(grid).getByText('Housing').closest('[data-structure="housing"]'),
    ).toHaveTextContent('Next: 345 cr')
  })

  it('buys twice at escalating cost without double-build/double-deduct', () => {
    renderPlanet()
    const grid = screen.getByRole('region', { name: 'Structures' })

    fireEvent.click(screen.getByRole('button', { name: 'Build Housing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Build Housing' }))

    expect(screen.getByTestId('resource-credits')).toHaveTextContent('355')
    expect(
      within(grid).getByText('Housing').closest('[data-structure="housing"]'),
    ).toHaveTextContent('Lv 2')
  })

  it('disables buy buttons when unaffordable', () => {
    renderPlanet()
    expect(screen.getByRole('button', { name: 'Build Shipyard' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Build Defense Turret' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Build Housing' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Build Ore Mine' })).toBeEnabled()
  })
})

describe('PlanetView — offline summary', () => {
  it('shows the offline summary modal on mount from a real stored gap', () => {
    vi.useFakeTimers()
    seedLocalStorageGap(12 * 60 * 60 * 1_000)
    render(<PlanetView />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/While you were away/)).toBeInTheDocument()
    expect(within(dialog).getByText('8h')).toBeInTheDocument()
    expect(within(dialog).getByText('+288K')).toBeInTheDocument()
  })

  it('dismisses the offline summary modal', () => {
    vi.useFakeTimers()
    seedLocalStorageGap(12 * 60 * 60 * 1_000)
    render(<PlanetView />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Close offline summary/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('useGameState — accrual', () => {
  it('caps a single accrual window at the 8h offline cap', () => {
    vi.useFakeTimers()
    seedSave(window.localStorage, makeSave())
    const { result } = renderHook(() => useGameState())
    const base = Date.now()

    act(() => {
      vi.setSystemTime(base + 10 * 60 * 60 * 1_000)
      vi.advanceTimersByTime(1_000)
    })

    expect(result.current.state.credits).toBeCloseTo(
      1_000 + 10 * 8 * 60 * 60,
      3,
    )
    expect(result.current.state.population).toBe(5_000)
  })

  it('banks elapsed on buy actions through the same capped path', () => {
    vi.useFakeTimers()
    seedSave(window.localStorage, makeSave())
    const { result } = renderHook(() => useGameState())
    const base = Date.now()

    act(() => {
      vi.setSystemTime(base + 3 * 60 * 60 * 1_000)
      vi.advanceTimersByTime(1_000)
    })
    const afterAccrual = result.current.state.credits

    act(() => {
      result.current.buy('housing')
    })

    expect(result.current.state.credits).toBeCloseTo(afterAccrual - 300, 3)
    expect(result.current.state.levels.housing).toBe(1)
  })
})

describe('P2-T04-B planet selector', () => {
  function seededTwoPlanetSave() {
    vi.useFakeTimers()
    const clock = Date.now()
    const home = claimHomePlanet('selector-player', clock)
    const colonyEntry = PLANETS.find((entry) => entry.name !== home.name)!
    const colony = claimColony(colonyEntry, clock)
    const save = makeSave({
      player: {
        playerId: 'selector-player',
        homePlanet: home,
        colonies: [colony],
        wallet: { credits: 5_000, alloys: 100 },
        structureLevels: {
          [home.name]: { housing: 1 },
          [colony.name]: { oreMine: 2 },
        } as Record<string, Partial<Record<StructureId, number>>>,
        lastTickAt: clock,
      },
    })
    seedSave(window.localStorage, save)
    return { home, colony }
  }

  it('defaults to the home planet and switches to the colony; credits/alloys stay global', () => {
    const { home, colony } = seededTwoPlanetSave()
    render(<PlanetView />)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(home.name)
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('5K')

    const select = screen.getByLabelText('Planet')
    fireEvent.change(select, { target: { value: colony.name } })

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(colony.name)
    const grid = screen.getByRole('region', { name: 'Structures' })
    expect(
      within(grid).getByText('Ore Mine').closest('[data-structure="oreMine"]'),
    ).toHaveTextContent('Lv 2')
    expect(screen.getByTestId('resource-population')).toHaveTextContent('0')
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('5K')
    expect(screen.getByTestId('resource-alloys')).toHaveTextContent('100')
  })

  it('buys on the selected colony spend the shared wallet and touch only that colony grid', () => {
    const { home, colony } = seededTwoPlanetSave()
    render(<PlanetView />)
    const select = screen.getByLabelText('Planet')
    fireEvent.change(select, { target: { value: colony.name } })

    fireEvent.click(screen.getByRole('button', { name: 'Build Housing' }))
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('4.7K')
    const grid = () => screen.getByRole('region', { name: 'Structures' })
    expect(
      within(grid())
        .getByText('Housing')
        .closest('[data-structure="housing"]'),
    ).toHaveTextContent('Lv 1')

    fireEvent.change(select, { target: { value: home.name } })
    expect(
      within(grid())
        .getByText('Housing')
        .closest('[data-structure="housing"]'),
    ).toHaveTextContent('Lv 1')
    expect(
      within(grid())
        .getByText('Ore Mine')
        .closest('[data-structure="oreMine"]'),
    ).toHaveTextContent('Lv 0')
  })
})
