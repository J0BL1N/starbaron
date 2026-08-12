/**
 * Empire overview contract (P4-T06): the pure UI-state view of a player's
 * whole empire — the per-planet row list (home + colonies), the empire totals
 * (planets, systems, population, credits/alloys per second, defense), the top
 * planet, and the all-planets sort/filter projections.
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no wall-clock. `at` is
 * a caller-supplied INPUT (milliseconds since epoch) validated with the same
 * discipline as ./planet-panel; it is never echoed into the payload — it
 * exists so a caller can pin the tick at which a snapshot was taken. The same
 * inputs always produce the same (deep-equal) EmpireOverview.
 *
 * Contract scope: this module delivers the EMPIRE-OVERVIEW CONTRACT and its
 * projections only — React components consume them in later tasks. No
 * rendering wiring exists here.
 *
 * Locked-aggregate discipline — every number delegates to the LOCKED modules
 * (nothing is re-derived or invented here):
 *   - totals     → empireOverviewFor reads the LOCKED empireRates
 *                  (credits/alloys per second) and planetTotals (population)
 *                  directly; planets/systems/defense come from the rows. The
 *                  filter path re-sums rows over the visible set — the exact
 *                  per-planet values computePlanetDerived / defensePower
 *                  produce, so the two paths always reconcile (asserted in
 *                  tests/empire-overview.test.ts).
 *   - income     → computePlanetDerived per planet over its gridForPlanet
 *                  grid — the EXACT per-planet composition empireRates sums,
 *                  so the row incomes reconcile with the locked empireRates
 *                  (productionSummaryFor totals exclude the baseline passive
 *                  income and would NOT reconcile).
 *   - defense    → the LOCKED defensePower(turretLevels, population), the
 *                  same call ./planet-panel makes.
 *   - systems    → distinct system ids over home + colonies. OwnedPlanet has
 *                  NO systemId field (verified by reading player/types.ts at
 *                  P4-T06), so a row's system id is DERIVED from the planet's
 *                  pinned catalogue hostname via the LOCKED
 *                  systemId(CATALOGUE_SLUG, hostname) identity function — the
 *                  exact derivation buildCatalogueMapping / claim.ts /
 *                  assignment.ts use, so the ids match the world graph.
 *   - empireName → the founding world's name. PlayerState carries no empire
 *                  name (the profile's empireName lives outside this
 *                  contract's input), so the overview names the empire after
 *                  its home world — deterministic and derived from the input.
 *
 * SORT ORDER (documented): 'population' sorts population DESCENDING, 'income'
 * sorts creditsPerSec DESCENDING (the primary income stream), 'name' sorts
 * name ASCENDING. Every primary-key tie breaks by name ascending, then by
 * systemId ascending — fully deterministic, no environment-dependent
 * comparison.
 *
 * TOP PLANET (documented): the row with the maximum population; population
 * ties break by name ascending, then systemId ascending.
 *
 * FILTER + TOTALS (documented): filterEmpire RE-RUNS the totals over the
 * visible rows, so `totals` always reflect the VISIBLE SET — a 'colonies'
 * filter reports the colonies' totals, not the whole empire's. topPlanet is
 * likewise re-derived from the visible rows. empireOverviewFor defaults to
 * sortedBy 'population' and filter 'all'.
 *
 * Validation: `at` must be a positive finite number or a RangeError is thrown.
 */

import { CATALOGUE_SLUG } from '../player/assignment'
import { computePlanetDerived, empireRates, gridForPlanet, planetTotals } from '../player/accrual'
import type { OwnedPlanet, PlayerState } from '../player/types'
import { defensePower } from '../structures/effects'
import { systemId } from '../world/identity'
import { assertPositiveAt } from './validate'

export interface EmpireRow {
  name: string
  tier: number
  isHome: boolean
  population: number
  income: { creditsPerSec: number; alloysPerSec: number }
  defense: number
  systemId: string
}

export type EmpireSortKey = 'population' | 'income' | 'name'

export type EmpireFilter = 'all' | 'home' | 'colonies'

export interface EmpireOverview {
  playerId: string
  empireName: string
  totals: {
    planets: number
    systems: number
    population: number
    creditsPerSec: number
    alloysPerSec: number
    defense: number
  }
  rows: EmpireRow[]
  topPlanet: EmpireRow | null
  sortedBy: EmpireSortKey
  filter: EmpireFilter
}

/** Deep-copy a row so a returned overview fully owns its data. */
function cloneRow(row: EmpireRow): EmpireRow {
  return { ...row, income: { ...row.income } }
}

/**
 * The locked per-planet row projection. Income is the LOCKED
 * computePlanetDerived credits/alloys for the planet's grid (the same
 * composition empireRates sums); defense is the LOCKED
 * defensePower(turretLevels, population); systemId is the LOCKED
 * systemId(CATALOGUE_SLUG, hostname) for the planet's catalogue host.
 */
function rowFor(player: PlayerState, planet: OwnedPlanet): EmpireRow {
  const grid = gridForPlanet(player, planet.name)
  const derived = computePlanetDerived(planet, grid)
  return {
    name: planet.name,
    tier: planet.tier,
    isHome: planet.isHome,
    population: planet.population,
    income: {
      creditsPerSec: derived.creditsPerSec,
      alloysPerSec: derived.alloysPerSec,
    },
    defense: defensePower(grid.defenseTurret, planet.population),
    systemId: systemId(CATALOGUE_SLUG, planet.entry.hostname),
  }
}

/**
 * Totals over a VISIBLE row set (the filterEmpire recompute path): planets =
 * visible count, systems = distinct system ids in the set,
 * population/income/defense = row sums. Because each row's values are the
 * locked computePlanetDerived / defensePower outputs, the full-set call
 * reconciles exactly with the locked empireRates / planetTotals aggregates.
 */
function totalsForRows(rows: readonly EmpireRow[]): EmpireOverview['totals'] {
  let population = 0
  let creditsPerSec = 0
  let alloysPerSec = 0
  let defense = 0
  const systems = new Set<string>()
  for (const row of rows) {
    population += row.population
    creditsPerSec += row.income.creditsPerSec
    alloysPerSec += row.income.alloysPerSec
    defense += row.defense
    systems.add(row.systemId)
  }
  return {
    planets: rows.length,
    systems: systems.size,
    population,
    creditsPerSec,
    alloysPerSec,
    defense,
  }
}

/** Deterministic name-ascending, then systemId-ascending comparison. */
function compareByNameThenId(a: EmpireRow, b: EmpireRow): number {
  if (a.name !== b.name) {
    return a.name < b.name ? -1 : 1
  }
  return a.systemId < b.systemId ? -1 : a.systemId > b.systemId ? 1 : 0
}

/**
 * Deterministic sort comparison: primary key DESCENDING (population, or
 * creditsPerSec for 'income'; 'name' has no primary key and falls through),
 * then name ascending, then systemId ascending.
 */
function compareBySortKey(by: EmpireSortKey, a: EmpireRow, b: EmpireRow): number {
  if (by === 'population') {
    if (a.population !== b.population) {
      return b.population - a.population
    }
  } else if (by === 'income') {
    if (a.income.creditsPerSec !== b.income.creditsPerSec) {
      return b.income.creditsPerSec - a.income.creditsPerSec
    }
  }
  return compareByNameThenId(a, b)
}

/** New, fully-owned, deterministically sorted copy of a row set. */
function sortedRows(rows: readonly EmpireRow[], by: EmpireSortKey): EmpireRow[] {
  return rows.map(cloneRow).sort((a, b) => compareBySortKey(by, a, b))
}

/** The row with the maximum population (ties: name asc, then systemId asc). */
function pickTopPlanet(rows: readonly EmpireRow[]): EmpireRow | null {
  let top: EmpireRow | null = null
  for (const row of rows) {
    if (top === null || compareBySortKey('population', row, top) < 0) {
      top = row
    }
  }
  return top
}

/**
 * Build the deterministic empire-overview projection: one row per owned planet
 * (home first, then colonies in roster order), rows default-sorted by
 * population descending with the default 'all' filter, top planet by
 * population, and totals reading the LOCKED empireRates + planetTotals
 * directly for credits/alloys/population (planets/systems/defense from rows).
 */
export function empireOverviewFor(input: { player: PlayerState; at: number }): EmpireOverview {
  assertPositiveAt(input.at)
  const { player } = input
  const rows = sortedRows(
    [player.homePlanet, ...player.colonies].map((planet) => rowFor(player, planet)),
    'population',
  )
  const rates = empireRates(player)
  const totals = planetTotals(player)
  const systems = new Set<string>()
  let defense = 0
  for (const row of rows) {
    systems.add(row.systemId)
    defense += row.defense
  }
  return {
    playerId: player.playerId,
    empireName: player.homePlanet.name,
    totals: {
      planets: rows.length,
      systems: systems.size,
      population: totals.population,
      creditsPerSec: rates.creditsPerSec,
      alloysPerSec: rates.alloysPerSec,
      defense,
    },
    rows,
    topPlanet: pickTopPlanet(rows),
    sortedBy: 'population',
    filter: 'all',
  }
}

/**
 * Immutable re-sort: return a new overview with the rows ordered by `by`
 * (population desc, income/credits desc, or name asc; ties by name then id),
 * leaving the input untouched. The top planet is re-derived from the (copied)
 * rows so it is always a member of the returned row set.
 */
export function sortEmpire(overview: EmpireOverview, by: EmpireSortKey): EmpireOverview {
  const rows = sortedRows(overview.rows, by)
  return {
    ...overview,
    rows,
    topPlanet: pickTopPlanet(rows),
    sortedBy: by,
  }
}

/**
 * Immutable filter: return a new overview restricted to 'all' / 'home' /
 * 'colonies' rows. TOTALS ARE RECOMPUTED over the visible rows — the returned
 * totals reflect the VISIBLE SET (documented contract). The top planet is
 * likewise re-derived from the visible rows. The input is never mutated.
 */
export function filterEmpire(overview: EmpireOverview, filter: EmpireFilter): EmpireOverview {
  const visible = overview.rows.filter((row) => {
    if (filter === 'home') {
      return row.isHome
    }
    if (filter === 'colonies') {
      return !row.isHome
    }
    return true
  })
  const rows = visible.map(cloneRow)
  return {
    ...overview,
    rows,
    totals: totalsForRows(rows),
    topPlanet: pickTopPlanet(rows),
    filter,
  }
}
