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
import { STRUCTURE_IDS } from '../src/sim/structures/data'
import { seedLocalStorageGap } from './saveHelpers'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

function renderPlanet() {
  vi.useFakeTimers()
  return render(<PlanetView />)
}

function renderState() {
  vi.useFakeTimers()
  let clock = 1_000_000_000
  const api = renderHook(() =>
    useGameState({ now: () => clock }),
  )
  return {
    result: api.result,
    rerender: api.rerender,
    unmount: api.unmount,
    advanceMs: (ms: number) => {
      clock += ms
    },
  }
}

describe('P1-T03-C buy-flow negative paths', () => {
  it('buys successfully when credits are exactly equal to the cost', () => {
    const { result, advanceMs } = renderState()

    act(() => result.current.buy('hydroponics'))
    expect(result.current.state.credits).toBe(200)
    expect(result.current.state.levels.hydroponics).toBe(1)

    advanceMs(10_000)
    act(() => result.current.buy('housing'))
    expect(result.current.state.credits).toBe(0)
    expect(result.current.state.levels.housing).toBe(1)
  })

  it('disables unaffordable buy buttons and makes buys a no-op', () => {
    renderPlanet()
    expect(screen.getByRole('button', { name: 'Build Shipyard' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Build Defense Turret' }),
    ).toBeDisabled()

    const { result } = renderState()
    act(() => {
      result.current.buy('shipyard')
      result.current.buy('defenseTurret')
    })
    expect(result.current.state.credits).toBe(1_000)
    expect(result.current.state.alloys).toBe(0)
    for (const id of ['shipyard', 'defenseTurret'] as const) {
      expect(result.current.state.levels[id]).toBe(0)
    }
  })

  it('rejects a buy just below the cost without deducting', () => {
    const { result } = renderState()
    act(() => result.current.buy('hydroponics'))
    const before = result.current.state.credits

    act(() => {
      result.current.buy('barracks')
      result.current.buy('housing')
    })
    expect(result.current.state.credits).toBe(before)
    expect(result.current.state.levels.barracks).toBe(0)
    expect(result.current.state.levels.housing).toBe(0)
  })

  it('two rapid buys before a re-render charge escalating costs exactly once each', () => {
    const { result } = renderState()
    act(() => {
      result.current.buy('housing')
      result.current.buy('housing')
    })
    expect(result.current.state.levels.housing).toBe(2)
    expect(result.current.state.credits).toBeCloseTo(1_000 - 300 - 345, 3)
  })

  it('double-click before re-render does not double-deduct at the UI level', () => {
    renderPlanet()
    const button = screen.getByRole('button', { name: 'Build Housing' })
    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('355')
    const grid = screen.getByRole('region', { name: 'Structures' })
    const housing = within(grid).getByText('Housing').closest('[data-structure="housing"]')
    expect(housing).toHaveTextContent('Lv 2')
  })

  it('snap-accrues elapsed time between rapid clicks before charging', () => {
    const { result, advanceMs } = renderState()
    act(() => result.current.buy('housing'))
    advanceMs(5_000)
    act(() => result.current.buy('housing'))
    expect(result.current.state.levels.housing).toBe(2)
    expect(result.current.state.credits).toBeCloseTo(1_000 - 300 + 50 - 345, 3)
  })

  it('buys all 7 structures to level 1', () => {
    const { result, advanceMs } = renderState()

    advanceMs(2_000_000)
    act(() => result.current.buy('housing'))
    act(() => result.current.buy('oreMine'))
    act(() => result.current.buy('hydroponics'))
    act(() => result.current.buy('barracks'))
    act(() => result.current.buy('tradeHub'))
    act(() => result.current.buy('shipyard'))

    advanceMs(14_400_000)
    act(() => result.current.buy('defenseTurret'))

    for (const id of STRUCTURE_IDS) {
      expect(result.current.state.levels[id], id).toBe(1)
    }
    expect(result.current.state.credits).toBeGreaterThan(100_000)
    expect(result.current.state.alloys).toBeGreaterThan(100)
  })
})

describe('P1-T03-C accrual regressions', () => {
  it('population never exceeds populationCap over long elapsed windows', () => {
    const { result, advanceMs } = renderState()

    advanceMs(20 * 60 * 60 * 1_000)
    act(() => result.current.bankElapsed())
    expect(result.current.state.population).toBe(result.current.derived.populationCap)
    expect(result.current.state.population).toBe(5_000)

    advanceMs(3 * 24 * 60 * 60 * 1_000)
    act(() => result.current.bankElapsed())
    expect(result.current.state.population).toBe(result.current.derived.populationCap)
    expect(result.current.state.population).toBe(5_000)
  })

  it('garrison never exceeds garrisonCap over long elapsed windows', () => {
    const { result, advanceMs } = renderState()
    advanceMs(60_000)
    act(() => result.current.buy('barracks'))
    expect(result.current.state.levels.barracks).toBe(1)

    advanceMs(4 * 60 * 60 * 1_000)
    act(() => result.current.bankElapsed())
    expect(result.current.state.garrison).toBe(5_000)
    expect(result.current.state.garrison).toBe(result.current.derived.garrisonCap)

    advanceMs(60 * 60 * 1_000)
    act(() => result.current.bankElapsed())
    expect(result.current.state.garrison).toBe(5_000)
  })

  it('credits grow without a cap across multiple bank windows', () => {
    const { result, advanceMs } = renderState()
    for (let i = 0; i < 5; i += 1) {
      advanceMs(8 * 60 * 60 * 1_000)
      act(() => result.current.bankElapsed())
    }
    expect(result.current.state.credits).toBeCloseTo(
      1_000 + 5 * 8 * 3_600 * 10,
      3,
    )
  })

  it('interval path banks exactly 8h worth when elapsed exceeds the cap', () => {
    vi.useFakeTimers()
    const base = Date.now()
    const { result } = renderHook(() => useGameState())

    act(() => {
      vi.setSystemTime(base + 12 * 60 * 60 * 1_000)
      vi.advanceTimersByTime(1_000)
    })

    expect(result.current.state.credits).toBeCloseTo(1_000 + 10 * 8 * 60 * 60, 3)
    expect(result.current.state.credits).toBeLessThan(1_000 + 10 * 12 * 60 * 60)
  })

  it('bankElapsed with zero elapsed time produces no gain', () => {
    const { result } = renderState()
    const before = result.current.state.credits
    let banked = -1
    act(() => {
      banked = result.current.bankElapsed()
      banked = result.current.bankElapsed()
    })
    expect(banked).toBe(0)
    expect(result.current.state.credits).toBe(before)
    expect(result.current.state.population).toBe(1_000)
  })
})

describe('P1-T03-C trade hub multiplier', () => {
  it('income rate reflects 1 + 0.10 x level as trade hubs are built', () => {
    const { result, advanceMs } = renderState()
    expect(result.current.derived.creditsPerSec).toBe(10)

    advanceMs(2_100_000)
    act(() => result.current.buy('tradeHub'))
    expect(result.current.derived.creditsPerSec).toBeCloseTo(11, 10)

    act(() => result.current.buy('tradeHub'))
    expect(result.current.derived.creditsPerSec).toBeCloseTo(12, 10)
  })

  it('credits accrue faster after a trade hub level', () => {
    const { result, advanceMs } = renderState()

    advanceMs(100_000)
    act(() => result.current.bankElapsed())
    const gainedPlain = result.current.state.credits - 1_000

    act(() => result.current.buy('tradeHub'))
    advanceMs(100_000)
    act(() => result.current.bankElapsed())
    const gainedHub = result.current.state.credits

    expect(gainedPlain).toBeCloseTo(1_000, 3)
    expect(gainedHub).toBeCloseTo(1_100, 3)
    expect(gainedHub).toBeGreaterThan(gainedPlain)
  })
})

describe('P1-T03-C offline summary', () => {
  it('appears exactly once on mount and stays a single modal across re-renders', () => {
    vi.useFakeTimers()
    seedLocalStorageGap(12 * 60 * 60 * 1_000)
    const { rerender } = render(<PlanetView />)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    rerender(<PlanetView />)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('content shows the 8h-capped amounts', () => {
    vi.useFakeTimers()
    seedLocalStorageGap(12 * 60 * 60 * 1_000)
    render(<PlanetView />)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('8h')).toBeInTheDocument()
    expect(within(dialog).getByText('+288K')).toBeInTheDocument()
    expect(within(dialog).getByText('+4K')).toBeInTheDocument()
    expect(within(dialog).queryByText('+57.6K')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/alloys/i)).not.toBeInTheDocument()
  })

  it('announced population/garrison gains equal what the wallet banks', () => {
    vi.useFakeTimers()
    seedLocalStorageGap(12 * 60 * 60 * 1_000)
    const { result } = renderHook(() => useGameState())
    const gain = result.current.offlineGain
    expect(gain).not.toBeNull()
    expect(gain!.elapsedSec).toBe(8 * 60 * 60)
    expect(result.current.state.population).toBe(5_000)
    expect(gain!.population).toBe(4_000)
    expect(gain!.population).toBeLessThan(57_600)
    expect(result.current.state.garrison).toBe(0)
    expect(gain!.garrison).toBe(0)
  })

  it('close button dismisses the summary', () => {
    vi.useFakeTimers()
    seedLocalStorageGap(12 * 60 * 60 * 1_000)
    render(<PlanetView />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: /Close offline summary/ }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not reappear after close for the session', () => {
    vi.useFakeTimers()
    const base = Date.now()
    seedLocalStorageGap(12 * 60 * 60 * 1_000)
    render(<PlanetView />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: /Close offline summary/ }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => {
      vi.setSystemTime(base + 10 * 60 * 1_000)
      vi.advanceTimersByTime(3_000)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Build Housing' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
