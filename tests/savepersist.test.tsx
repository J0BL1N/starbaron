/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { StrictMode } from 'react'
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
import { SAVE_KEY, SAVE_V3_KEY } from '../src/ui/save'
import { claimHomePlanet } from '../src/sim/player'
import {
  GAP_12H,
  makeSave,
  MemoryStorage,
  readSave,
  seedLocalStorageGap,
  seedSave,
  ThrowingStorage,
} from './saveHelpers'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

describe('P1-T04 save persistence — hook round-trip', () => {
  it('persists a buy across unmount and remount', () => {
    vi.useFakeTimers()
    let clock = 5_000_000
    const storage = new MemoryStorage()
    const first = renderHook(() => useGameState({ storage, now: () => clock }))
    act(() => {
      first.result.current.buy('housing')
    })
    expect(first.result.current.state.levels.housing).toBe(1)
    expect(first.result.current.state.credits).toBe(700)
    first.unmount()

    const second = renderHook(() => useGameState({ storage, now: () => clock }))
    expect(second.result.current.state.levels.housing).toBe(1)
    expect(second.result.current.state.credits).toBe(700)
  })

  it('auto-saves on a debounce as ticks accrue and restores that state', () => {
    vi.useFakeTimers()
    let clock = 1_000_000
    const storage = new MemoryStorage()
    const first = renderHook(() => useGameState({ storage, now: () => clock }))

    act(() => {
      clock += 12_000
      vi.advanceTimersByTime(12_000)
    })
    const saved = readSave(storage)
    expect(saved.player.wallet.credits).toBeGreaterThan(1_000)

    first.unmount()
    const second = renderHook(() => useGameState({ storage, now: () => clock }))
    expect(second.result.current.state.credits).toBeCloseTo(
      saved.player.wallet.credits,
      6,
    )
    expect(second.result.current.state.levels).toEqual(
      saved.player.structureLevels[saved.player.homePlanet.name],
    )
  })
})

describe('P1-T04 real offline gap', () => {
  it('banks a real gap on load at the 8h cap and shows the clamped summary', () => {
    vi.useFakeTimers()
    localStorage.clear()
    seedLocalStorageGap(GAP_12H)
    render(<PlanetView />)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('8h')).toBeInTheDocument()
    expect(within(dialog).getByText('+288K')).toBeInTheDocument()
    expect(within(dialog).getByText('+4K')).toBeInTheDocument()
    expect(within(dialog).queryByText('+57.6K')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(6_000)
    })
    const save = readSave(window.localStorage)
    expect(save.player.wallet.credits).toBeGreaterThanOrEqual(
      1_000 + 10 * 8 * 3_600,
    )
  })

  it('announced offline gains equal what the wallet banks on a real load', () => {
    vi.useFakeTimers()
    let clock = 1_000_000
    const storage = new MemoryStorage()
    seedSave(
      storage,
      makeSave({ player: { lastTickAt: clock - GAP_12H } }),
    )
    const { result } = renderHook(() => useGameState({ storage, now: () => clock }))
    const gain = result.current.offlineGain
    expect(gain).not.toBeNull()
    expect(gain!.elapsedSec).toBe(8 * 60 * 60)
    expect(result.current.state.credits).toBeCloseTo(1_000 + 10 * 8 * 3_600, 3)
    expect(result.current.state.population).toBe(5_000)
    expect(gain!.credits).toBeCloseTo(10 * 8 * 3_600, 3)
    expect(gain!.population).toBe(4_000)
    expect(gain!.garrison).toBe(0)
  })

  it('checkpoints lastTickAt synchronously when the offline gap is banked', () => {
    vi.useFakeTimers()
    const clock = 1_000_000
    const storage = new MemoryStorage()
    seedSave(
      storage,
      makeSave({ player: { lastTickAt: clock - GAP_12H } }),
    )
    renderHook(() => useGameState({ storage, now: () => clock }))
    expect(readSave(storage).player.lastTickAt).toBe(clock)
  })

  it('dismissing the summary persists the seen flag and saves', () => {
    vi.useFakeTimers()
    localStorage.clear()
    seedLocalStorageGap(GAP_12H)
    render(<PlanetView />)
    fireEvent.click(
      screen.getByRole('button', { name: /Close offline summary/ }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readSave(window.localStorage).offlineSummarySeen).toBe(true)
  })

  it('a new real gap clears a persisted seen flag and re-shows once, then stays hidden on a no-gap remount', () => {
    vi.useFakeTimers()
    localStorage.clear()
    seedLocalStorageGap(GAP_12H, { offlineSummarySeen: true })
    const first = render(<PlanetView />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: /Close offline summary/ }),
    )
    first.unmount()

    render(<PlanetView />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('fires the modal exactly once under StrictMode double-mount and banks once', () => {
    vi.useFakeTimers()
    localStorage.clear()
    seedLocalStorageGap(GAP_12H)
    render(
      <StrictMode>
        <PlanetView />
      </StrictMode>,
    )
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(6_000)
    })
    expect(readSave(window.localStorage).player.wallet.credits).toBeGreaterThanOrEqual(
      1_000 + 10 * 8 * 3_600,
    )
  })
})

describe('P1-T04 failure paths', () => {
  it('starts fresh with a notice when the save is corrupt, and the game stays playable', () => {
    vi.useFakeTimers()
    localStorage.clear()
    localStorage.setItem(SAVE_KEY, 'this is not json{')
    render(<PlanetView />)
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't be read/i)
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('1K')

    fireEvent.click(screen.getByRole('button', { name: 'Build Housing' }))
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('700')
  })

  it('starts fresh with a notice when the v3 save is corrupt, and the game stays playable', () => {
    vi.useFakeTimers()
    localStorage.clear()
    localStorage.setItem(SAVE_V3_KEY, 'this is not json{')
    render(<PlanetView />)
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't be read/i)
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('1K')

    fireEvent.click(screen.getByRole('button', { name: 'Build Housing' }))
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('700')
  })

  it('starts fresh with a notice when the save is from a future version', () => {
    vi.useFakeTimers()
    localStorage.clear()
    seedSave(window.localStorage, {
      ...makeSave(),
      schemaVersion: 4,
    } as unknown as ReturnType<typeof makeSave>)
    render(<PlanetView />)
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't be read/i)
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('1K')
  })

  it('degrades gracefully when storage writes fail: in-memory play continues', () => {
    vi.useFakeTimers()
    let clock = 1_000_000
    const storage = new ThrowingStorage()
    const { result } = renderHook(() =>
      useGameState({ storage, now: () => clock }),
    )
    expect(result.current.state.credits).toBe(1_000)
    act(() => {
      result.current.buy('housing')
    })
    expect(result.current.state.levels.housing).toBe(1)
    expect(result.current.state.credits).toBe(700)
    expect(result.current.saveNotice).toBe(
      "Couldn't save progress this session.",
    )
  })
})

describe('P1-T04 onboarding', () => {
  it('walks claim intro → build housing → build ore mine → offline reveal', () => {
    vi.useFakeTimers()
    localStorage.clear()
    render(<PlanetView />)
    expect(
      screen.getByRole('region', { name: 'Tutorial' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/You now own/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText(/Grow your population/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Build Housing' }))
    expect(screen.getByText(/Mine the ore/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Build Ore Mine' }))
    expect(screen.getByText(/Offline earnings/)).toBeInTheDocument()
  })

  it('advances through the housing step without re-buying when housing was bought before Claim', () => {
    vi.useFakeTimers()
    localStorage.clear()
    render(<PlanetView />)
    expect(screen.getByText(/You now own/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Build Housing' }))
    expect(screen.getByText(/You now own/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText(/Mine the ore/)).toBeInTheDocument()
  })

  it('cascades through both build steps when housing and ore mine were bought before Claim', () => {
    vi.useFakeTimers()
    localStorage.clear()
    render(<PlanetView />)
    fireEvent.click(screen.getByRole('button', { name: 'Build Housing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Build Ore Mine' }))
    expect(screen.getByText(/You now own/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText(/Offline earnings/)).toBeInTheDocument()
  })

  it('marks onboarding done when the offline reveal is dismissed', () => {
    vi.useFakeTimers()
    localStorage.clear()
    seedLocalStorageGap(GAP_12H, {
      tutorial: { step: 3, done: false, skipped: false },
    })
    render(<PlanetView />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Offline earnings/)).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: /Close offline summary/ }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Tutorial' }),
    ).not.toBeInTheDocument()
    expect(readSave(window.localStorage).tutorial.done).toBe(true)
  })

  it('skip hides the tutorial permanently and persists the flag', () => {
    vi.useFakeTimers()
    localStorage.clear()
    const first = render(<PlanetView />)
    expect(
      screen.getByRole('region', { name: 'Tutorial' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Skip tutorial' }))
    expect(
      screen.queryByRole('region', { name: 'Tutorial' }),
    ).not.toBeInTheDocument()
    expect(readSave(window.localStorage).tutorial.skipped).toBe(true)

    first.unmount()
    render(<PlanetView />)
    expect(
      screen.queryByRole('region', { name: 'Tutorial' }),
    ).not.toBeInTheDocument()
  })

  it('resumes a mid-flow tutorial from the persisted step', () => {
    vi.useFakeTimers()
    localStorage.clear()
    seedSave(window.localStorage, makeSave({
      tutorial: { step: 1, done: false, skipped: false },
    }))
    render(<PlanetView />)
    expect(screen.getByText(/Grow your population/)).toBeInTheDocument()
  })
})

describe('P2-T03-B automatic first-boot claim', () => {
  it('claims on first load with no UI action, persists the claim, and remounts the same planet', () => {
    vi.useFakeTimers()
    localStorage.clear()
    const first = render(<PlanetView />)
    act(() => {
      vi.advanceTimersByTime(6_000)
    })
    const saved = readSave(window.localStorage)
    expect(saved.schemaVersion).toBe(3)
    expect(saved.player.playerId).toBeTruthy()
    expect(saved.player.homePlanet.isHome).toBe(true)
    expect(saved.player.homePlanet.unconquerable).toBe(true)
    expect(saved.player.colonies).toEqual([])
    expect(saved.player.wallet.credits).toBeGreaterThanOrEqual(1_000)

    const playerId = saved.player.playerId
    const homeName = saved.player.homePlanet.name
    first.unmount()

    render(<PlanetView />)
    act(() => {
      vi.advanceTimersByTime(6_000)
    })
    const reloaded = readSave(window.localStorage)
    expect(reloaded.player.playerId).toBe(playerId)
    expect(reloaded.player.homePlanet.name).toBe(homeName)
  })

  it('rehydrates the claimed home planet from a seeded v2 save', () => {
    vi.useFakeTimers()
    const clock = 1_000_000
    const storage = new MemoryStorage()
    seedSave(storage, makeSave({ player: { playerId: 'fixture-player' } }))
    const { result } = renderHook(() =>
      useGameState({ storage, now: () => clock }),
    )
    expect(result.current.playerId).toBe('fixture-player')
    expect(result.current.homePlanet.name).toBe(
      claimHomePlanet('fixture-player', clock).name,
    )
    expect(result.current.homePlanet.isHome).toBe(true)
    expect(result.current.homePlanet.unconquerable).toBe(true)
    expect(result.current.state.credits).toBe(1_000)
  })
})
