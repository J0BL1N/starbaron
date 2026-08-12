/**
 * Main HUD state contract (P4-T01).
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no wall-clock.
 * `at` is a caller-supplied INPUT (milliseconds since epoch). The same
 * inputs always produce the same (deep-equal) HudState.
 *
 * Contract scope: this module delivers the HUD STATE CONTRACT and UI-ready
 * projections only — React components consume them in later tasks. No
 * rendering wiring exists here.
 *
 * Locked-aggregate discipline: resources are copied from player.wallet;
 * population comes from the LOCKED aggregates in src/sim/player/accrual.ts
 * (planetTotals for total, computePlanetDerived for the per-planet
 * populationCap). focusedBody resolves through the P1-T08 query layer
 * (queryBody). Nothing is re-derived or invented here.
 *
 * Composition: hudAlertsFor derives alerts from player state;
 * hudStateFor maps any provided alerts (e.g. the hudAlertsFor output) onto
 * deterministic ids and sorts them by at then id.
 */

import { formatNumber } from '../core/format'
import { fnv1a } from '../planets/hash'
import {
  computePlanetDerived,
  gridForPlanet,
  planetTotals,
} from '../player/accrual'
import { COLONISATION_BASE_COST } from '../player/colonisation'
import type { PlayerState } from '../player/types'
import { queryBody } from '../world/api'
import type { BodyId } from '../world/identity'
import type { UniverseState } from '../world/reconstruct'

export type HudLocationKind = 'planet' | 'moon' | 'system' | 'galaxy' | 'universe'

export interface HudLocation {
  kind: HudLocationKind
  id: string
  name: string
}

export type HudAlertSeverity = 'info' | 'warning' | 'danger'

export interface HudAlert {
  id: string
  severity: HudAlertSeverity
  message: string
  at: number
}

/** Raw alert shape as fed into hudStateFor — ids are derived, not supplied. */
export interface HudAlertInput {
  severity: HudAlertSeverity
  message: string
  at: number
}

export interface HudFocusedBody {
  id: string
  name: string
  type: string
}

export interface HudState {
  at: number
  location: HudLocation
  resources: { credits: number; alloys: number }
  population: { total: number; home: number; cap: number }
  alerts: HudAlert[]
  focusedBody: HudFocusedBody | null
}

export interface HudStateInput {
  player: PlayerState
  universe: UniverseState
  at: number
  location: HudLocation
  focusedBodyId?: string
  alerts?: readonly HudAlertInput[]
}

export const HUD_CREDIT_WARNING_THRESHOLD = 100
export const HUD_STALE_SECONDS = 24 * 3600

const LOCATION_KINDS: readonly HudLocationKind[] = [
  'planet',
  'moon',
  'system',
  'galaxy',
  'universe',
]

function assertPositiveAt(at: number): void {
  if (!Number.isFinite(at) || at <= 0) {
    throw new RangeError(
      `at must be a positive finite number (milliseconds), got ${at}`,
    )
  }
}

function assertLocation(location: HudLocation): void {
  if (!LOCATION_KINDS.includes(location.kind)) {
    throw new RangeError(
      `invalid location kind ${JSON.stringify(location.kind)}, expected one of ${LOCATION_KINDS.join(', ')}`,
    )
  }
  if (location.id === '') {
    throw new RangeError('location id must be a non-empty string')
  }
  if (location.name === '') {
    throw new RangeError('location name must be a non-empty string')
  }
}

/**
 * Deterministic alert id: fnv1a over `${message}|${at}`. The `|` separator
 * keeps a message ending in digits unambiguous against concatenation, so the
 * same (message, at) pair always yields the same id.
 */
export function hudAlertId(message: string, at: number): string {
  return String(fnv1a(`${message}|${at}`))
}

function mkAlert(
  severity: HudAlertSeverity,
  message: string,
  at: number,
): HudAlert {
  return { id: hudAlertId(message, at), severity, message, at }
}

/** Sum of the locked per-planet population caps across home + colonies. */
function populationCapFor(player: PlayerState): number {
  let cap = 0
  for (const planet of [player.homePlanet, ...player.colonies]) {
    cap += computePlanetDerived(
      planet,
      gridForPlanet(player, planet.name),
    ).populationCap
  }
  return cap
}

/**
 * Derive alerts from player state. Deterministic, fixed generation order:
 * population at cap (info) → low credits (warning) → stale tick (info) →
 * colonise suggestion (info). Every alert carries the passed `at` and a
 * deterministic id.
 */
export function hudAlertsFor(player: PlayerState, at: number): HudAlert[] {
  assertPositiveAt(at)
  const alerts: HudAlert[] = []

  const totals = planetTotals(player)
  const cap = populationCapFor(player)
  if (cap > 0 && totals.population >= cap) {
    alerts.push(mkAlert('info', 'Population is at the housing cap', at))
  }

  if (player.wallet.credits < HUD_CREDIT_WARNING_THRESHOLD) {
    alerts.push(mkAlert('warning', 'Credits are running low', at))
  }

  if (at - player.lastTickAt > HUD_STALE_SECONDS * 1000) {
    alerts.push(mkAlert('info', 'Last played over a day ago', at))
  }

  if (
    player.colonies.length === 0 &&
    player.wallet.credits >= COLONISATION_BASE_COST.credits &&
    player.wallet.alloys >= COLONISATION_BASE_COST.alloys
  ) {
    alerts.push(mkAlert('info', 'Consider colonising a new planet', at))
  }

  return alerts
}

/**
 * Build the full HUD state projection. Resources and population come from the
 * locked aggregates; focusedBody resolves through queryBody when an id is
 * given (null when absent, fabricated, or unparseable); alerts are mapped to
 * deterministic ids and sorted by at then id. Inputs are never mutated.
 */
export function hudStateFor(input: HudStateInput): HudState {
  assertPositiveAt(input.at)
  assertLocation(input.location)

  const rawAlerts = input.alerts ?? []
  for (const alert of rawAlerts) {
    if (!Number.isFinite(alert.at) || alert.at <= 0) {
      throw new RangeError(
        `alert at must be a positive finite number (milliseconds), got ${alert.at}`,
      )
    }
  }
  const alerts = rawAlerts.map((alert) =>
    mkAlert(alert.severity, alert.message, alert.at),
  )
  alerts.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  let focusedBody: HudFocusedBody | null = null
  if (input.focusedBodyId !== undefined) {
    const body = queryBody(input.universe, input.focusedBodyId as BodyId)
    if (body !== null) {
      focusedBody = { id: body.id, name: body.name, type: body.type }
    }
  }

  const totals = planetTotals(input.player)
  return {
    at: input.at,
    location: { ...input.location },
    resources: {
      credits: input.player.wallet.credits,
      alloys: input.player.wallet.alloys,
    },
    population: {
      total: totals.population,
      home: input.player.homePlanet.population,
      cap: populationCapFor(input.player),
    },
    alerts,
    focusedBody,
  }
}

/**
 * One-line deterministic HUD summary for tooltips, e.g.
 * `HD 564 b · 2.3M cr · 8.5K pop · 0 alerts`. Uses the LOCKED formatNumber —
 * no locale APIs; grouping is manual (suffix-based).
 */
export function hudSummary(state: HudState): string {
  return [
    state.location.name,
    `${formatNumber(state.resources.credits)} cr`,
    `${formatNumber(state.population.total)} pop`,
    `${state.alerts.length} alerts`,
  ].join(' · ')
}
