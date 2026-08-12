import { describe, expect, it } from 'vitest'
import type { OwnedPlanet, PlayerState } from '../src/sim/player'
import { createPlayer } from '../src/sim/player'
import {
  computePlanetDerived,
  gridForPlanet,
  planetTotals,
} from '../src/sim/player/accrual'
import { COLONISATION_BASE_COST } from '../src/sim/player/colonisation'
import { fnv1a } from '../src/sim/planets/hash'
import {
  HUD_CREDIT_WARNING_THRESHOLD,
  HUD_STALE_SECONDS,
  hudAlertId,
  hudAlertsFor,
  hudStateFor,
  hudSummary,
} from '../src/sim/ui/hud'
import type {
  HudAlert,
  HudAlertInput,
  HudLocation,
  HudState,
} from '../src/sim/ui/hud'
import { buildBodyRecord } from '../src/sim/world/body'
import { buildGalaxyRecord, registerSystem } from '../src/sim/world/galaxy'
import { bodyId, systemId } from '../src/sim/world/identity'
import { buildUniverseState } from '../src/sim/world/reconstruct'
import type { UniverseState } from '../src/sim/world/reconstruct'
import { buildSystemRecord, registerBody } from '../src/sim/world/system'

const NOW = 1_700_000_000_000
const SLUG = 'hud-fixture'
const ALPHA = systemId(SLUG, 'alpha')
const BETA = systemId(SLUG, 'beta')
const ALPHA_PLANET = bodyId(ALPHA, 'planet', 0)
const ALPHA_MOON = bodyId(ALPHA, 'moon', 1)
const BETA_PLANET = bodyId(BETA, 'planet', 0)

const LOCATION: HudLocation = {
  kind: 'planet',
  id: ALPHA_PLANET,
  name: 'HD 564 b',
}

function buildFixture(): UniverseState {
  let galaxy = buildGalaxyRecord({
    slug: SLUG,
    seed: SLUG,
    name: 'Fixture Home',
    position: { x: 0, y: 0, z: 0 },
  })
  galaxy = registerSystem(galaxy, ALPHA)
  galaxy = registerSystem(galaxy, BETA)

  const alpha = registerBody(
    registerBody(
      buildSystemRecord({
        galaxy: galaxy.id,
        slug: 'alpha',
        name: 'Alpha',
        position: { x: 100, y: 0, z: 0 },
        starType: 'G2 V',
      }),
      ALPHA_MOON,
    ),
    ALPHA_PLANET,
  )
  const beta = registerBody(
    buildSystemRecord({
      galaxy: galaxy.id,
      slug: 'beta',
      name: 'Beta',
      position: { x: 0, y: 0, z: 0 },
      starType: 'K1 V',
    }),
    BETA_PLANET,
  )

  const bodies = [
    buildBodyRecord({
      system: ALPHA,
      type: 'planet',
      ordinal: 0,
      name: 'Alpha Prime',
    }),
    buildBodyRecord({
      system: ALPHA,
      type: 'moon',
      ordinal: 1,
      name: 'Alpha One',
    }),
    buildBodyRecord({
      system: BETA,
      type: 'planet',
      ordinal: 0,
      name: 'Beta World',
    }),
  ]

  return { galaxy, systems: [alpha, beta], bodies }
}

const UNIVERSE = buildFixture()

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = createPlayer('player-hud', NOW)
  return {
    ...player,
    ...overrides,
    wallet: { ...player.wallet, ...(overrides.wallet ?? {}) },
  }
}

function makeColony(): OwnedPlanet {
  const base = createPlayer('player-hud', NOW).homePlanet
  return {
    ...base,
    name: 'Colony One',
    isHome: false,
    unconquerable: false,
    claimedAt: NOW,
  }
}

function starterCap(player: PlayerState): number {
  return computePlanetDerived(
    player.homePlanet,
    gridForPlanet(player, player.homePlanet.name),
  ).populationCap
}

describe('P4-T01 hudStateFor — locked aggregates', () => {
  it('resources mirror the player wallet exactly', () => {
    const player = makePlayer({ wallet: { credits: 1234.5, alloys: 7.25 } })
    const state = hudStateFor({
      player,
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
    })
    expect(state.resources).toEqual({ credits: 1234.5, alloys: 7.25 })
  })

  it('population.total/home/cap come from the locked aggregates across home + colonies', () => {
    const colony = makeColony()
    colony.population = 2_500
    const player = makePlayer({
      homePlanet: { ...makePlayer().homePlanet, population: 3_000 },
      colonies: [colony],
    })
    const state = hudStateFor({
      player,
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
    })
    expect(state.population.total).toBe(planetTotals(player).population)
    expect(state.population.total).toBe(5_500)
    expect(state.population.home).toBe(player.homePlanet.population)
    expect(state.population.home).toBe(3_000)
    const expectedCap = [player.homePlanet, ...player.colonies].reduce(
      (sum, planet) =>
        sum +
        computePlanetDerived(
          planet,
          gridForPlanet(player, planet.name),
        ).populationCap,
      0,
    )
    expect(state.population.cap).toBe(expectedCap)
  })

  it('passes at and location through untouched', () => {
    const state = hudStateFor({
      player: makePlayer(),
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
    })
    expect(state.at).toBe(NOW)
    expect(state.location).toEqual(LOCATION)
  })

  it('returns a cloned location isolated from the input in both directions', () => {
    const location = { ...LOCATION }
    const state = hudStateFor({
      player: makePlayer(),
      universe: UNIVERSE,
      at: NOW,
      location,
    })
    state.location.name = 'mutated'
    expect(location).toEqual(LOCATION)
    location.name = 'input mutated'
    expect(state.location.name).toBe('mutated')
  })
})

describe('P4-T01 hudStateFor — focusedBody resolution', () => {
  it('resolves id/name/type from the record when the id is present', () => {
    const state = hudStateFor({
      player: makePlayer(),
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
      focusedBodyId: ALPHA_MOON,
    })
    const record = UNIVERSE.bodies.find((body) => body.id === ALPHA_MOON)
    expect(record).toBeDefined()
    expect(state.focusedBody).toEqual({
      id: record!.id,
      name: record!.name,
      type: record!.type,
    })
    expect(state.focusedBody?.name).toBe('Alpha One')
    expect(state.focusedBody?.type).toBe('moon')
  })

  it('is null when no focusedBodyId is given', () => {
    const state = hudStateFor({
      player: makePlayer(),
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
    })
    expect(state.focusedBody).toBeNull()
  })

  it('is null for a fabricated id absent from the state', () => {
    const state = hudStateFor({
      player: makePlayer(),
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
      focusedBodyId: bodyId(ALPHA, 'planet', 99),
    })
    expect(state.focusedBody).toBeNull()
  })

  it('is null for a non-body id and for a universe with no bodies', () => {
    const state = hudStateFor({
      player: makePlayer(),
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
      focusedBodyId: 'not-a-body-id',
    })
    expect(state.focusedBody).toBeNull()

    const empty = buildUniverseState({ seed: 'hud-empty', includeCatalogue: false })
    const emptyState = hudStateFor({
      player: makePlayer(),
      universe: empty,
      at: NOW,
      location: LOCATION,
      focusedBodyId: ALPHA_PLANET,
    })
    expect(emptyState.focusedBody).toBeNull()
  })
})

describe('P4-T01 hudStateFor — alerts mapping', () => {
  const alerts: HudAlertInput[] = [
    { severity: 'warning', message: 'B', at: NOW },
    { severity: 'info', message: 'A', at: NOW },
    { severity: 'danger', message: 'C', at: NOW - 1 },
  ]

  it('maps raw alerts to deterministic ids and preserves severity/message/at', () => {
    const state = hudStateFor({
      player: makePlayer(),
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
      alerts,
    })
    expect(state.alerts).toHaveLength(3)
    for (const raw of alerts) {
      const mapped = state.alerts.find((alert) => alert.message === raw.message)
      expect(mapped).toBeDefined()
      expect(mapped!.id).toBe(hudAlertId(raw.message, raw.at))
      expect(mapped!.id).toBe(String(fnv1a(`${raw.message}|${raw.at}`)))
      expect(mapped!.severity).toBe(raw.severity)
      expect(mapped!.at).toBe(raw.at)
    }
  })

  it('sorts alerts by at ascending, then by id', () => {
    const state = hudStateFor({
      player: makePlayer(),
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
      alerts,
    })
    expect(state.alerts[0].message).toBe('C')
    expect(state.alerts[0].at).toBe(NOW - 1)
    const sameAt = state.alerts.slice(1)
    expect(sameAt.map((a) => a.at)).toEqual([NOW, NOW])
    expect(sameAt[0].id <= sameAt[1].id).toBe(true)
  })

  it('yields an empty alert list when alerts are omitted', () => {
    const state = hudStateFor({
      player: makePlayer(),
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
    })
    expect(state.alerts).toEqual([])
  })

  it('never mutates the input alerts array', () => {
    const snapshot = [...alerts]
    hudStateFor({
      player: makePlayer(),
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
      alerts,
    })
    expect(alerts).toEqual(snapshot)
  })

  it('re-ids hudAlertsFor output consistently (composition contract)', () => {
    const player = makePlayer({
      homePlanet: { ...makePlayer().homePlanet, population: 1e9 },
      wallet: { credits: 50, alloys: 0 },
      lastTickAt: NOW - (HUD_STALE_SECONDS * 1000 + 5),
    })
    const derived = hudAlertsFor(player, NOW)
    const state = hudStateFor({
      player,
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
      alerts: derived,
    })
    expect(state.alerts).toHaveLength(derived.length)
    expect(state.alerts.map((a) => a.id).sort()).toEqual(
      derived.map((a) => a.id).sort(),
    )
    for (const alert of state.alerts) {
      expect(alert.id).toBe(hudAlertId(alert.message, alert.at))
    }
  })
})

describe('P4-T01 hudStateFor — determinism and validation', () => {
  it('is deterministic and never mutates player/universe inputs', () => {
    const player = makePlayer({
      wallet: { credits: 50, alloys: 0 },
      lastTickAt: NOW - (HUD_STALE_SECONDS * 1000 + 5),
    })
    const walletBefore = { ...player.wallet }
    const popBefore = player.homePlanet.population
    const input = {
      player,
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
      focusedBodyId: ALPHA_MOON,
      alerts: [
        { severity: 'warning' as const, message: 'Low', at: NOW },
        { severity: 'info' as const, message: 'Hi', at: NOW - 2 },
      ],
    }
    const first = hudStateFor(input)
    const second = hudStateFor(input)
    expect(second).toEqual(first)
    expect(player.wallet).toEqual(walletBefore)
    expect(player.homePlanet.population).toBe(popBefore)
  })

  it('throws RangeError on a non-positive or non-finite at', () => {
    const player = makePlayer()
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        hudStateFor({ player, universe: UNIVERSE, at: bad, location: LOCATION }),
      ).toThrow(RangeError)
    }
  })

  it('throws RangeError on a non-positive or non-finite alert at', () => {
    const player = makePlayer()
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        hudStateFor({
          player,
          universe: UNIVERSE,
          at: NOW,
          location: LOCATION,
          alerts: [{ severity: 'info' as const, message: 'Bad', at: bad }],
        }),
      ).toThrow(/alert at must be a positive finite number/)
    }
  })

  it('throws RangeError on an invalid location kind', () => {
    const player = makePlayer()
    const badKind = {
      kind: 'nebula',
      id: ALPHA_PLANET,
      name: 'X',
    } as unknown as HudLocation
    expect(() =>
      hudStateFor({ player, universe: UNIVERSE, at: NOW, location: badKind }),
    ).toThrow(/invalid location kind/)
  })

  it('throws RangeError on an empty location id or name', () => {
    const player = makePlayer()
    expect(() =>
      hudStateFor({
        player,
        universe: UNIVERSE,
        at: NOW,
        location: { ...LOCATION, id: '' },
      }),
    ).toThrow(RangeError)
    expect(() =>
      hudStateFor({
        player,
        universe: UNIVERSE,
        at: NOW,
        location: { ...LOCATION, name: '' },
      }),
    ).toThrow(RangeError)
  })
})

describe('P4-T01 hudAlertsFor — derived alerts', () => {
  it('emits no alerts for a fresh healthy player', () => {
    expect(hudAlertsFor(makePlayer(), NOW)).toEqual([])
  })

  it('emits an info alert when population is at the cap and none below it', () => {
    const player = makePlayer()
    const atCap = makePlayer({
      homePlanet: { ...player.homePlanet, population: starterCap(player) },
    })
    const below = makePlayer({
      homePlanet: { ...player.homePlanet, population: 0 },
    })
    expect(
      hudAlertsFor(atCap, NOW).some(
        (a) => a.severity === 'info' && a.message === 'Population is at the housing cap',
      ),
    ).toBe(true)
    expect(
      hudAlertsFor(below, NOW).some((a) => a.message === 'Population is at the housing cap'),
    ).toBe(false)
  })

  it('emits a warning below the credit threshold and none at or above it', () => {
    const low = makePlayer({
      wallet: {
        credits: HUD_CREDIT_WARNING_THRESHOLD - 1,
        alloys: 0,
      },
    })
    const atThreshold = makePlayer({
      wallet: {
        credits: HUD_CREDIT_WARNING_THRESHOLD,
        alloys: 0,
      },
    })
    expect(
      hudAlertsFor(low, NOW).some(
        (a) => a.severity === 'warning' && a.message === 'Credits are running low',
      ),
    ).toBe(true)
    expect(
      hudAlertsFor(atThreshold, NOW).some((a) => a.message === 'Credits are running low'),
    ).toBe(false)
  })

  it('emits an info offline alert when lastTickAt is more than 24h stale, but not at exactly 24h', () => {
    const stale = makePlayer({
      lastTickAt: NOW - (HUD_STALE_SECONDS * 1000 + 1),
    })
    const boundary = makePlayer({ lastTickAt: NOW - HUD_STALE_SECONDS * 1000 })
    expect(
      hudAlertsFor(stale, NOW).some((a) => a.message === 'Last played over a day ago'),
    ).toBe(true)
    expect(
      hudAlertsFor(boundary, NOW).some((a) => a.message === 'Last played over a day ago'),
    ).toBe(false)
  })

  it('emits an info colonise suggestion when no colonies and the base cost is affordable', () => {
    const affordable = makePlayer({
      wallet: {
        credits: COLONISATION_BASE_COST.credits,
        alloys: COLONISATION_BASE_COST.alloys,
      },
    })
    expect(
      hudAlertsFor(affordable, NOW).some(
        (a) => a.message === 'Consider colonising a new planet',
      ),
    ).toBe(true)
  })

  it('omits the colonise suggestion when credits or alloys fall short of the base cost', () => {
    const shortCredits = makePlayer({
      wallet: {
        credits: COLONISATION_BASE_COST.credits - 1,
        alloys: COLONISATION_BASE_COST.alloys,
      },
    })
    const shortAlloys = makePlayer({
      wallet: {
        credits: COLONISATION_BASE_COST.credits,
        alloys: COLONISATION_BASE_COST.alloys - 1,
      },
    })
    for (const player of [shortCredits, shortAlloys]) {
      expect(
        hudAlertsFor(player, NOW).some(
          (a) => a.message === 'Consider colonising a new planet',
        ),
      ).toBe(false)
    }
  })

  it('omits the colonise suggestion when a colony already exists', () => {
    const withColony = makePlayer({
      colonies: [makeColony()],
      wallet: { credits: 1_000, alloys: 1_000 },
    })
    expect(
      hudAlertsFor(withColony, NOW).some(
        (a) => a.message === 'Consider colonising a new planet',
      ),
    ).toBe(false)
  })

  it('emits derived alerts in fixed generation order with deterministic ids and at', () => {
    const player = makePlayer({
      homePlanet: { ...makePlayer().homePlanet, population: 1e9 },
      wallet: { credits: 50, alloys: 0 },
      lastTickAt: NOW - (HUD_STALE_SECONDS * 1000 + 5),
    })
    const alerts = hudAlertsFor(player, NOW)
    expect(alerts.map((a) => a.message)).toEqual([
      'Population is at the housing cap',
      'Credits are running low',
      'Last played over a day ago',
    ])
    for (const alert of alerts) {
      expect(alert.at).toBe(NOW)
      expect(alert.id).toBe(hudAlertId(alert.message, NOW))
    }
    expect(hudAlertsFor(player, NOW)).toEqual(alerts)
  })

  it('throws RangeError on a non-positive or non-finite at', () => {
    for (const bad of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => hudAlertsFor(makePlayer(), bad)).toThrow(RangeError)
    }
  })
})

describe('P4-T01 hudSummary and hudAlertId', () => {
  it('builds a one-line deterministic summary with formatNumber values', () => {
    const player = makePlayer({
      homePlanet: { ...makePlayer().homePlanet, population: 8_500 },
      wallet: { credits: 2_300_000, alloys: 0 },
    })
    const state: HudState = hudStateFor({
      player,
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
      alerts: [
        { severity: 'warning', message: 'Low', at: NOW },
        { severity: 'info', message: 'Hi', at: NOW },
      ],
    })
    expect(hudSummary(state)).toBe('HD 564 b · 2.3M cr · 8.5K pop · 2 alerts')
  })

  it('reflects a zero alert count', () => {
    const state = hudStateFor({
      player: makePlayer(),
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
    })
    expect(hudSummary(state)).toBe('HD 564 b · 1K cr · 1K pop · 0 alerts')
  })

  it('is deterministic across repeated calls', () => {
    const state = hudStateFor({
      player: makePlayer({ wallet: { credits: 500, alloys: 100 } }),
      universe: UNIVERSE,
      at: NOW,
      location: LOCATION,
    })
    expect(hudSummary(state)).toBe(hudSummary(state))
  })

  it('hudAlertId equals fnv1a over message|at and differs across inputs', () => {
    expect(hudAlertId('hi', NOW)).toBe(String(fnv1a(`hi|${NOW}`)))
    expect(hudAlertId('hi', NOW)).not.toBe(hudAlertId('ho', NOW))
    expect(hudAlertId('hi', NOW)).not.toBe(hudAlertId('hi', NOW + 1))
    expect(hudAlertId('x', NOW)).toBe(hudAlertId('x', NOW))
  })

  it('hudAlertsFor outputs are HudAlert-shaped with ids on every entry', () => {
    const player = makePlayer({
      wallet: { credits: 50, alloys: 0 },
      lastTickAt: NOW - (HUD_STALE_SECONDS * 1000 + 5),
    })
    const alerts: HudAlert[] = hudAlertsFor(player, NOW)
    expect(alerts.length).toBeGreaterThan(0)
    for (const alert of alerts) {
      expect(typeof alert.id).toBe('string')
      expect(alert.id.length).toBeGreaterThan(0)
      expect(['info', 'warning', 'danger']).toContain(alert.severity)
    }
  })
})
