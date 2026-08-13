import { describe, expect, it } from 'vitest'
import {
  flooredAgeLabel,
  highestVisibleTier,
  infoLevelRank,
} from '../src/sim/intel/intel-ui'
import { flooredAgeLabel as stalenessFlooredAgeLabel } from '../src/sim/intel/staleness'
import type { InfoLevel } from '../src/sim/ui/info'

const TIERS: readonly InfoLevel[] = ['public', 'alliance', 'intel', 'owner']

describe('P6 intel-ui infoLevelRank — the info-tier rank', () => {
  it('assigns the documented rank to each tier: public 0, alliance 1, intel 2, owner 3', () => {
    expect(infoLevelRank('public')).toBe(0)
    expect(infoLevelRank('alliance')).toBe(1)
    expect(infoLevelRank('intel')).toBe(2)
    expect(infoLevelRank('owner')).toBe(3)
  })

  it('ascends public < alliance < intel < owner and is deterministic', () => {
    expect(infoLevelRank('public')).toBeLessThan(infoLevelRank('alliance'))
    expect(infoLevelRank('alliance')).toBeLessThan(infoLevelRank('intel'))
    expect(infoLevelRank('intel')).toBeLessThan(infoLevelRank('owner'))
    for (const tier of TIERS) {
      expect(infoLevelRank(tier)).toBe(infoLevelRank(tier))
    }
  })
})

describe('P6 intel-ui highestVisibleTier — the relationship tier of a level list', () => {
  it('a single level resolves to itself', () => {
    for (const tier of TIERS) {
      expect(highestVisibleTier([tier])).toBe(tier)
    }
  })

  it('an empty list reads as public', () => {
    expect(highestVisibleTier([])).toBe('public')
  })

  it('an owner entry beats every other tier', () => {
    expect(highestVisibleTier(['public', 'alliance', 'intel', 'owner'])).toBe('owner')
    expect(highestVisibleTier(['owner', 'public'])).toBe('owner')
  })

  it('an intel entry beats public and alliance entries, and alliance beats public', () => {
    expect(highestVisibleTier(['public', 'alliance', 'intel'])).toBe('intel')
    expect(highestVisibleTier(['public', 'alliance'])).toBe('alliance')
  })

  it('ties resolve to the tied tier', () => {
    expect(highestVisibleTier(['intel', 'intel'])).toBe('intel')
    expect(highestVisibleTier(['public', 'public', 'public'])).toBe('public')
  })

  it('resolves to the same tier regardless of input order', () => {
    expect(highestVisibleTier(['owner', 'public', 'intel', 'alliance'])).toBe('owner')
    expect(highestVisibleTier(['intel', 'public', 'owner'])).toBe('owner')
    expect(highestVisibleTier(['alliance', 'intel', 'public'])).toBe('intel')
  })

  it('never mutates the caller-provided list', () => {
    const list: InfoLevel[] = ['public', 'owner', 'intel']
    const snapshot = [...list]
    highestVisibleTier(list)
    expect(list).toEqual(snapshot)
  })
})

describe('P6 intel-ui flooredAgeLabel — the s/m/h/d floored age label', () => {
  it('a negative age clamps to 0s', () => {
    expect(flooredAgeLabel(-1)).toBe('0s')
    expect(flooredAgeLabel(-0.01)).toBe('0s')
  })

  it('floors sub-minute ages down to whole seconds', () => {
    expect(flooredAgeLabel(0)).toBe('0s')
    expect(flooredAgeLabel(0.4)).toBe('0s')
    expect(flooredAgeLabel(1.9)).toBe('1s')
    expect(flooredAgeLabel(59.999)).toBe('59s')
  })

  it('crosses the minute boundary at exactly 60s', () => {
    expect(flooredAgeLabel(60)).toBe('1m')
    expect(flooredAgeLabel(61)).toBe('1m')
    expect(flooredAgeLabel(119)).toBe('1m')
  })

  it('floors sub-hour ages down to whole minutes', () => {
    expect(flooredAgeLabel(120)).toBe('2m')
    expect(flooredAgeLabel(3_599)).toBe('59m')
  })

  it('crosses the hour boundary at exactly 3600s', () => {
    expect(flooredAgeLabel(3_600)).toBe('1h')
    expect(flooredAgeLabel(3_661)).toBe('1h')
  })

  it('floors sub-day ages down to whole hours', () => {
    expect(flooredAgeLabel(23 * 3_600)).toBe('23h')
    expect(flooredAgeLabel(23 * 3_600 + 59)).toBe('23h')
  })

  it('crosses the day boundary at exactly 24h', () => {
    expect(flooredAgeLabel(24 * 3_600 - 1)).toBe('23h')
    expect(flooredAgeLabel(24 * 3_600)).toBe('1d')
    expect(flooredAgeLabel(24 * 3_600 + 1)).toBe('1d')
  })

  it('floors multi-day ages down to whole days', () => {
    expect(flooredAgeLabel(2 * 24 * 3_600)).toBe('2d')
    expect(flooredAgeLabel(1.9 * 24 * 3_600)).toBe('1d')
    expect(flooredAgeLabel(100 * 24 * 3_600)).toBe('100d')
  })
})

describe('P6 intel-ui staleness backward-compat re-export', () => {
  it('staleness re-exports the same floored age label for its public surface', () => {
    expect(stalenessFlooredAgeLabel).toBe(flooredAgeLabel)
    expect(stalenessFlooredAgeLabel(48 * 3_600)).toBe('2d')
  })
})
