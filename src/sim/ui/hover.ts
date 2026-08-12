/**
 * Contextual hover intelligence HUD (P4-T02).
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no wall-clock. `at` is
 * a caller-supplied INPUT (milliseconds since epoch) validated with the same
 * discipline as ./hud, but it is never echoed into the HoverInfo payload — it
 * exists so a caller can pin the tick at which a hover snapshot was taken.
 *
 * Contract scope: this module delivers the HOVER-STATE CONTRACT and UI-ready
 * projections only — React components consume them in later tasks. No
 * rendering wiring exists here.
 *
 * OWNERSHIP (P2-T04/T05 overlay pattern + P4 info-gating): ownership arrives
 * as an opt-in ReadonlyMap<bodyId, ownerId> in the P2-T05
 * ownershipOverlayPayload shape. The viewer's authorization is a REQUIRED
 * `viewerLevel` input (info.ts's InfoLevel contract); ownedBy is exposed only
 * for an 'owner'-or-above viewer — a public (or lower) viewer gets null even
 * when the overlay would name an owner, so hidden truth never reaches the
 * client. Galaxies are NOT owned in v1 (a galaxy hover reports ownedBy null
 * always). Systems DERIVE ownership from their bodies (a system hover reports
 * ownedBy null always — the overlay keys bodies only). A body hover reports
 * the owner from the overlay when present, and null when unowned or unknown.
 *
 * NUMBER FORMATTING: every numeric stat value goes through the locked
 * formatNumber (../core/format) — no environment-dependent formatting APIs,
 * so repeated calls produce byte-identical strings.
 */

import { formatNumber } from '../core/format'
import { queryBody, queryGalaxy, querySystem } from '../world/api'
import type { BodyId, BodyType, GalaxyId, SystemId } from '../world/identity'
import { parseCanonicalId } from '../world/identity'
import type { GalaxyClass } from '../world/galaxy'
import type { UniverseState } from '../world/reconstruct'
import { starSummaryFor } from './display'
import { assertInfoLevel, canViewLevel } from './info'
import type { InfoLevel } from './info'
import { assertPositiveAt } from './validate'

export type HoverTargetKind = 'galaxy' | 'system' | 'body'

export interface HoverTarget {
  kind: HoverTargetKind
  id: string
}

export interface HoverStat {
  label: string
  value: string
}

export interface HoverInfo {
  target: HoverTarget
  title: string
  subtitle: string
  stats: HoverStat[]
  ownedBy: string | null
  summary: string
}

export interface HoverInfoInput {
  target: HoverTarget
  universe: UniverseState
  ownership?: ReadonlyMap<string, string>
  viewerLevel: InfoLevel
  at: number
}

export interface HoverSwitch {
  from: HoverTarget | null
  to: HoverTarget
  at: number
  immediate: boolean
}

export const GALAXY_CLASS_LABELS: Readonly<Record<GalaxyClass, string>> =
  Object.freeze({
    spiral: 'Spiral galaxy',
    'barred-spiral': 'Barred spiral galaxy',
    elliptical: 'Elliptical galaxy',
    irregular: 'Irregular galaxy',
    dwarf: 'Dwarf galaxy',
  })

export const BODY_TYPE_LABELS: Readonly<Record<BodyType, string>> = Object.freeze(
  {
    star: 'Star',
    planet: 'Planet',
    moon: 'Moon',
    asteroid: 'Asteroid',
  },
)

function positionMagnitude(position: {
  x: number
  y: number
  z: number
}): number {
  return Math.sqrt(
    position.x * position.x + position.y * position.y + position.z * position.z,
  )
}

function galaxyInfo(
  target: HoverTarget,
  universe: UniverseState,
): HoverInfo | null {
  const galaxy = queryGalaxy(universe, target.id as GalaxyId)
  if (galaxy === null) {
    return null
  }
  const title = galaxy.name
  const subtitle = GALAXY_CLASS_LABELS[galaxy.class]
  const systems = formatNumber(galaxy.systemIds.length)
  const stats: HoverStat[] = [
    { label: 'Systems', value: systems },
    { label: 'Real data', value: galaxy.realData ? 'Yes' : 'No' },
  ]
  return {
    target: { ...target },
    title,
    subtitle,
    stats,
    ownedBy: null,
    summary: `${title} · ${subtitle} · ${systems} systems`,
  }
}

function systemInfo(
  target: HoverTarget,
  universe: UniverseState,
): HoverInfo | null {
  const system = querySystem(universe, target.id as SystemId)
  if (system === null) {
    return null
  }
  const title = system.name
  const subtitle = starSummaryFor(system.star.starType)
  const bodies = formatNumber(system.bodyIds.length)
  const magnitude = Math.round(positionMagnitude(system.position))
  const stats: HoverStat[] = [
    { label: 'Bodies', value: bodies },
    { label: 'Position', value: formatNumber(magnitude) },
  ]
  return {
    target: { ...target },
    title,
    subtitle,
    stats,
    ownedBy: null,
    summary: `${title} · ${subtitle} · ${bodies} bodies`,
  }
}

function bodyInfo(
  target: HoverTarget,
  universe: UniverseState,
  ownership: ReadonlyMap<string, string> | undefined,
  viewerLevel: InfoLevel,
): HoverInfo | null {
  const body = queryBody(universe, target.id as BodyId)
  if (body === null) {
    return null
  }
  const title = body.name
  const subtitle = BODY_TYPE_LABELS[body.type]
  const radius = formatNumber(body.radius)
  const stats: HoverStat[] = [
    { label: 'Radius', value: radius },
    { label: 'Type', value: body.type },
    {
      label: 'Orbit period',
      value: `${formatNumber(Math.round(body.orbit.period))}s`,
    },
  ]
  const canSeeOwner = canViewLevel(viewerLevel, 'owner')
  return {
    target: { ...target },
    title,
    subtitle,
    stats,
    ownedBy:
      canSeeOwner && ownership !== undefined
        ? (ownership.get(body.id) ?? null)
        : null,
    summary: `${title} · ${subtitle} · R ${radius}`,
  }
}

/**
 * Build the hover projection for a target, or null when the target does not
 * resolve against the universe (a query miss or an id that fails canonical
 * parsing). The UI hides the tooltip when null is returned. The viewer's
 * authorization (`viewerLevel`, REQUIRED) gates ownership fields via info.ts's
 * contract — ownedBy is only ever non-null for an owner-or-above viewer.
 */
export function hoverInfoFor(input: HoverInfoInput): HoverInfo | null {
  assertPositiveAt(input.at)
  assertInfoLevel(input.viewerLevel)
  switch (input.target.kind) {
    case 'galaxy':
      return galaxyInfo(input.target, input.universe)
    case 'system':
      return systemInfo(input.target, input.universe)
    case 'body':
      return bodyInfo(input.target, input.universe, input.ownership, input.viewerLevel)
  }
}

/**
 * Map a raw canonical id string to a HoverTarget, or null when it does not
 * parse. Kind is derived from parseCanonicalId ('galaxy'/'system'/'body').
 */
export function resolveHoverTarget(raw: string): HoverTarget | null {
  const parsed = parseCanonicalId(raw)
  if (!parsed.ok) {
    return null
  }
  switch (parsed.kind) {
    case 'galaxy':
      return { kind: 'galaxy', id: parsed.id }
    case 'system':
      return { kind: 'system', id: parsed.id }
    case 'body':
      return { kind: 'body', id: parsed.id }
  }
}

/**
 * The SMOOTH TARGET SWITCHING contract: records the transition data between
 * the previously hovered target and the newly hovered target. A switch is
 * IMMEDIATE when there was no previous target or when the kinds differ
 * (cross-kind switches are instant); same-kind switches are SMOOTH — the
 * animation timing itself is the UI's concern, this function only classifies
 * and records the transition. Deterministic and input-isolated.
 */
export function smoothSwitch(
  from: HoverTarget | null,
  to: HoverTarget,
  at: number,
): HoverSwitch {
  assertPositiveAt(at)
  return {
    from: from === null ? null : { ...from },
    to: { ...to },
    at,
    immediate: from === null || from.kind !== to.kind,
  }
}
