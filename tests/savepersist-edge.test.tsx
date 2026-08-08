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
} from '@testing-library/react'
import PlanetView from '../src/ui/PlanetView'
import { useGameState } from '../src/ui/useGameState'
import { baselinePassiveIncome } from '../src/sim/core/economy'
import {
  OFFLINE_SUMMARY_THRESHOLD_MS,
  SAVE_SCHEMA_VERSION,
} from '../src/ui/save'
import type { SaveGameV3 } from '../src/ui/save'
import {
  makeSave,
  MemoryStorage,
  readSave,
  seedSave,
  ThrowingStorage,
} from './saveHelpers'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const QUOTA_NOTICE = "Couldn't save progress this session."

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

describe('P1-T04-C localStorage edge cases', () => {
  it('quota failure on the debounced auto-save path is non-fatal, notices once, and play continues', () => {
    vi.useFakeTimers()
    let clock = 1_000_000
    const storage = new ThrowingStorage()
    const { result } = renderHook(() =>
      useGameState({ storage, now: () => clock }),
    )

    act(() => {
      clock += 12_000
      vi.advanceTimersByTime(12_000)
    })
    const income = baselinePassiveIncome(result.current.state.tier)
    expect(result.current.state.credits).toBeCloseTo(1_000 + income * 12, 3)
    expect(result.current.saveNotice).toBe(QUOTA_NOTICE)

    act(() => result.current.buy('housing'))
    expect(result.current.state.levels.housing).toBe(1)
    expect(result.current.state.credits).toBeCloseTo(
      1_000 + income * 12 - 300,
      3,
    )
    expect(result.current.saveNotice).toBe(QUOTA_NOTICE)
  })

  it('privacy mode: a throwing window.localStorage starts fresh in-memory, no crash, one-time notice', () => {
    vi.useFakeTimers()
    const own = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('SecurityError: access denied')
      },
    })
    try {
      const { result } = renderHook(() => useGameState())
      expect(result.current.state.credits).toBe(1_000)
      act(() => result.current.buy('housing'))
      expect(result.current.state.levels.housing).toBe(1)
      expect(result.current.state.credits).toBe(700)

      act(() => {
        vi.advanceTimersByTime(6_000)
      })
      const income = baselinePassiveIncome(result.current.state.tier)
      expect(result.current.state.credits).toBeCloseTo(700 + income * 6, 3)
      expect(result.current.saveNotice).toBe(QUOTA_NOTICE)
    } finally {
      delete (window as unknown as Record<string, unknown>).localStorage
      if (own != null) {
        Object.defineProperty(window, 'localStorage', own)
      }
    }
  })

  it('a storage that throws on read is treated as absent and starts fresh without a crash', () => {
    vi.useFakeTimers()
    let clock = 1_000_000
    const storage = new MemoryStorage()
    const originalGetItem = storage.getItem
    storage.getItem = () => {
      throw new Error('denied')
    }
    const { result } = renderHook(() =>
      useGameState({ storage, now: () => clock }),
    )
    expect(result.current.state.credits).toBe(1_000)
    act(() => result.current.buy('housing'))
    expect(result.current.state.levels.housing).toBe(1)
    storage.getItem = originalGetItem
  })

  it('two live instances sharing storage do not crash; last write wins on the next read', () => {
    vi.useFakeTimers()
    let clock = 5_000_000
    const storage = new MemoryStorage()
    const a = renderHook(() => useGameState({ storage, now: () => clock }))
    const b = renderHook(() => useGameState({ storage, now: () => clock }))

    act(() => a.result.current.buy('housing'))
    act(() => b.result.current.buy('oreMine'))

    expect(a.result.current.state.levels.housing).toBe(1)
    expect(b.result.current.state.levels.oreMine).toBe(1)
    expect(a.result.current.state.credits).toBe(700)
    expect(b.result.current.state.credits).toBe(500)

    a.unmount()
    b.unmount()

    const c = renderHook(() => useGameState({ storage, now: () => clock }))
    expect(c.result.current.state.levels.oreMine).toBe(1)
    expect(c.result.current.state.levels.housing).toBe(0)
    expect(c.result.current.state.credits).toBe(500)
  })
})

describe('P1-T04-C offline-gap boundary regressions', () => {
  function seedGap(gapMs: number): { clock: number; storage: MemoryStorage } {
    const clock = 1_000_000
    const storage = new MemoryStorage()
    seedSave(storage, makeSave({ player: { lastTickAt: clock - gapMs } }))
    return { clock, storage }
  }

  it('banks the gap but does NOT announce when the gap is exactly at the 60s threshold', () => {
    vi.useFakeTimers()
    const { clock, storage } = seedGap(OFFLINE_SUMMARY_THRESHOLD_MS)
    const { result } = renderHook(() => useGameState({ storage, now: () => clock }))
    expect(result.current.offlineGain).toBeNull()
    expect(result.current.state.credits).toBeCloseTo(1_000 + 10 * 60, 3)
    expect(result.current.state.lastTickAt).toBe(clock)
  })

  it('announces once the gap exceeds the 60s threshold by 1ms', () => {
    vi.useFakeTimers()
    const { clock, storage } = seedGap(OFFLINE_SUMMARY_THRESHOLD_MS + 1)
    const { result } = renderHook(() => useGameState({ storage, now: () => clock }))
    expect(result.current.offlineGain).not.toBeNull()
    expect(result.current.offlineGain!.elapsedSec).toBe(60.001)
  })

  it('does not announce for a gap just under the 60s threshold', () => {
    vi.useFakeTimers()
    const { clock, storage } = seedGap(OFFLINE_SUMMARY_THRESHOLD_MS - 1_000)
    const { result } = renderHook(() => useGameState({ storage, now: () => clock }))
    expect(result.current.offlineGain).toBeNull()
    expect(result.current.state.credits).toBeCloseTo(1_000 + 10 * 59, 3)
  })

  it('banks exactly 8h for a 10-day gap and announces the capped summary', () => {
    vi.useFakeTimers()
    const { clock, storage } = seedGap(10 * DAY_MS)
    const { result } = renderHook(() => useGameState({ storage, now: () => clock }))
    expect(result.current.offlineGain).not.toBeNull()
    expect(result.current.offlineGain!.elapsedSec).toBe(8 * 60 * 60)
    expect(result.current.state.credits).toBeCloseTo(1_000 + 10 * 8 * 3_600, 3)
    expect(result.current.state.population).toBe(5_000)
  })

  it('banks exactly 8h and announces when the gap is exactly 8h', () => {
    vi.useFakeTimers()
    const { clock, storage } = seedGap(8 * HOUR_MS)
    const { result } = renderHook(() => useGameState({ storage, now: () => clock }))
    expect(result.current.offlineGain).not.toBeNull()
    expect(result.current.offlineGain!.elapsedSec).toBe(8 * 60 * 60)
    expect(result.current.state.credits).toBeCloseTo(1_000 + 10 * 8 * 3_600, 3)
  })
})

describe('P1-T04-C corrupt saves at the UI level', () => {
  it('unknown structure id in levels starts fresh with a notice (strict rejection)', () => {
    vi.useFakeTimers()
    localStorage.clear()
    seedSave(
      window.localStorage,
      makeSave({
        player: {
          structureLevels: { wormhole: 1 } as unknown as Record<string, never>,
        },
      }),
    )
    render(<PlanetView />)
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't be read/i)
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('1K')

    fireEvent.click(screen.getByRole('button', { name: 'Build Housing' }))
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('700')
  })

  it('a string wallet type starts fresh with a notice', () => {
    vi.useFakeTimers()
    localStorage.clear()
    seedSave(
      window.localStorage,
      makeSave({ player: { wallet: { credits: '9999' as unknown as number } } }),
    )
    render(<PlanetView />)
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't be read/i)
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('1K')
  })

  it('a null wallet value (NaN serialized) starts fresh with a notice', () => {
    vi.useFakeTimers()
    localStorage.clear()
    const save = makeSave()
    save.player.wallet.credits = null as unknown as number
    seedSave(window.localStorage, save as unknown as SaveGameV3)
    render(<PlanetView />)
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't be read/i)
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('1K')
  })

  it('a missing savedAt and tutorial (additive defaults) loads without a notice', () => {
    vi.useFakeTimers()
    localStorage.clear()
    const save = makeSave()
    const raw = { ...save, tutorial: undefined, savedAt: undefined }
    seedSave(window.localStorage, raw as unknown as SaveGameV3)
    render(<PlanetView />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Tutorial' })).toBeInTheDocument()
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('1K')
  })
})

describe('P1-T04-C onboarding deepen', () => {
  it.each([0, 1, 2, 3])(
    'persists skip from a save at tutorial step %s and does not re-show',
    (step) => {
      vi.useFakeTimers()
      localStorage.clear()
      seedSave(
        window.localStorage,
        makeSave({ tutorial: { step, done: false, skipped: false } }),
      )
      const first = render(<PlanetView />)
      expect(screen.getByRole('region', { name: 'Tutorial' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Skip tutorial' }))
      expect(readSave(window.localStorage).tutorial.skipped).toBe(true)
      first.unmount()

      render(<PlanetView />)
      expect(
        screen.queryByRole('region', { name: 'Tutorial' }),
      ).not.toBeInTheDocument()
    },
  )

  it('a completed save (tutorial.done) never re-shows the tutorial', () => {
    vi.useFakeTimers()
    localStorage.clear()
    seedSave(
      window.localStorage,
      makeSave({ tutorial: { step: 3, done: true, skipped: false } }),
    )
    render(<PlanetView />)
    expect(
      screen.queryByRole('region', { name: 'Tutorial' }),
    ).not.toBeInTheDocument()
  })

  const RESUME_STEPS: Array<[number, RegExp]> = [
    [0, /You now own/],
    [1, /Grow your population/],
    [2, /Mine the ore/],
    [3, /Offline earnings/],
  ]

  it.each(RESUME_STEPS)(
    'resumes a save at tutorial step %s',
    (step, text) => {
      vi.useFakeTimers()
      localStorage.clear()
      seedSave(
        window.localStorage,
        makeSave({ tutorial: { step, done: false, skipped: false } }),
      )
      render(<PlanetView />)
      expect(screen.getByRole('region', { name: 'Tutorial' })).toBeInTheDocument()
      expect(screen.getByText(text)).toBeInTheDocument()
    },
  )
})

describe('P1-T04-C save round-trip integrity', () => {
  it('round-trips a multi-build session to exact state equality (levels, wallet)', () => {
    vi.useFakeTimers()
    const clock = 5_000_000
    const storage = new MemoryStorage()
    const first = renderHook(() => useGameState({ storage, now: () => clock }))

    act(() => {
      first.result.current.buy('housing')
      first.result.current.buy('oreMine')
    })
    const before = { ...first.result.current.state }
    expect(before.levels.housing).toBe(1)
    expect(before.levels.oreMine).toBe(1)
    expect(before.credits).toBe(200)
    first.unmount()

    const second = renderHook(() => useGameState({ storage, now: () => clock }))
    expect(second.result.current.state).toEqual(before)
    expect(second.result.current.state.levels).toEqual(before.levels)
  })

  it('preserves lastTickAt across a reload with no gap', () => {
    vi.useFakeTimers()
    let clock = 1_000_000
    const storage = new MemoryStorage()
    const first = renderHook(() => useGameState({ storage, now: () => clock }))

    act(() => {
      clock += 30_000
      first.result.current.buy('housing')
    })
    const savedLastTick = first.result.current.state.lastTickAt
    expect(savedLastTick).toBe(clock)
    first.unmount()

    const second = renderHook(() => useGameState({ storage, now: () => clock }))
    expect(second.result.current.state.lastTickAt).toBe(savedLastTick)
    expect(second.result.current.state.levels.housing).toBe(1)
  })

  it('writes schemaVersion to the persisted save', () => {
    vi.useFakeTimers()
    const clock = 1_000_000
    const storage = new MemoryStorage()
    const { result } = renderHook(() => useGameState({ storage, now: () => clock }))

    act(() => result.current.buy('housing'))
    expect(readSave(storage).schemaVersion).toBe(SAVE_SCHEMA_VERSION)
  })

  it('a full save round-trip preserves wallet fields and the tutorial state', () => {
    vi.useFakeTimers()
    const clock = 1_000_000
    const storage = new MemoryStorage()
    const first = renderHook(() => useGameState({ storage, now: () => clock }))

    act(() => {
      first.result.current.buy('housing')
      first.result.current.buy('oreMine')
    })
    const before = { ...first.result.current.state }
    expect(first.result.current.tutorial.step).toBe(0)
    first.unmount()

    const second = renderHook(() => useGameState({ storage, now: () => clock }))
    expect(second.result.current.state).toEqual(before)
    expect(second.result.current.tutorial).toEqual({
      step: 0,
      done: false,
      skipped: false,
    })
    const saved = readSave(storage)
    expect({
      tier: saved.player.homePlanet.tier,
      credits: saved.player.wallet.credits,
      alloys: saved.player.wallet.alloys,
      population: saved.player.homePlanet.population,
      garrison: saved.player.homePlanet.garrison,
      fleet: saved.player.homePlanet.fleet,
      levels: saved.player.structureLevels[saved.player.homePlanet.name],
      lastTickAt: saved.player.lastTickAt,
      selectedPlanetName: saved.player.homePlanet.name,
    }).toEqual(second.result.current.state)
    expect(saved.offlineSummarySeen).toBe(false)
  })
})
