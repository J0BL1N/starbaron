import { BASE_POPULATION_CAP, populationCap, populationGrowthPerSec } from '../core/population'
import { populationCapMultiplier } from '../planets/levels'
import { applyQuirk } from '../planets/quirks'
import type { PlanetQuirk } from '../planets/types'
import { STRUCTURES } from '../structures/data'
import { defensePower, nextBuildCost, structureEffect } from '../structures/effects'
import type { StructureEffect, StructureId } from '../structures/types'
import { ownedNames } from './claim'
import { emptyStructureLevels } from './grid'
import { ownedPlanetIdentity } from './player'
import { walletSpend } from './wallet'
import type { OwnedPlanet, PlayerState, StructureGrid } from './types'

export interface PlanetDerivedRates {
  planetName: string
  tier: number
  creditsPerSec: number
  alloysPerSec: number
  populationPerSec: number
  garrisonPerSec: number
  populationCap: number
  garrisonCap: number
  fleetCap: number
  defensePower: number
}

export interface EmpireRates {
  creditsPerSec: number
  alloysPerSec: number
}

export interface PlanetTotals {
  population: number
  garrison: number
  fleet: number
}

export function gridForPlanet(
  player: PlayerState,
  name: string,
): StructureGrid {
  return player.structureLevels[name] ?? emptyStructureLevels()
}

function applyQuirks(
  quirks: readonly PlanetQuirk[],
  effect: StructureEffect,
): StructureEffect {
  let result = effect
  for (const quirk of quirks) {
    result = applyQuirk(quirk, result)
  }
  return result
}

export function computePlanetDerived(
  owned: OwnedPlanet,
  levels: StructureGrid,
): PlanetDerivedRates {
  const quirks = ownedPlanetIdentity(owned).quirks

  const oreMine = applyQuirks(quirks, structureEffect('oreMine', levels.oreMine))
  const tradeHub = applyQuirks(quirks, structureEffect('tradeHub', levels.tradeHub))
  const shipyard = applyQuirks(quirks, structureEffect('shipyard', levels.shipyard))
  const barracks = applyQuirks(quirks, structureEffect('barracks', levels.barracks))
  const hydroponics = applyQuirks(
    quirks,
    structureEffect('hydroponics', levels.hydroponics),
  )

  const tradeHubEffect = tradeHub.kind === 'incomeMultiplier' ? tradeHub : null
  const shipyardEffect = shipyard.kind === 'shipyard' ? shipyard : null
  const oreMineEffect = oreMine.kind === 'alloys' ? oreMine : null
  const barracksEffect = barracks.kind === 'barracks' ? barracks : null
  const growthMultEffect =
    hydroponics.kind === 'growthMultiplier' ? hydroponics : null

  const denseCore = quirks.find((quirk) => quirk.id === 'denseCore')
  const massiveWorld = quirks.find((quirk) => quirk.id === 'massiveWorld')

  const baseCap = populationCap(levels.housing)
  const baseBonus = baseCap - BASE_POPULATION_CAP
  const populationCapValue =
    (BASE_POPULATION_CAP + baseBonus * (denseCore?.multiplier ?? 1)) *
    populationCapMultiplier(owned.tier)

  return {
    planetName: owned.name,
    tier: owned.tier,
    creditsPerSec:
      owned.baselineIncomePerSec * (tradeHubEffect?.multiplier ?? 1) +
      (shipyardEffect?.shipbuildingIncomePerSec ?? 0),
    alloysPerSec: oreMineEffect?.alloysPerSec ?? 0,
    populationPerSec:
      populationGrowthPerSec(levels.housing, 0) *
      (growthMultEffect?.multiplier ?? 1),
    garrisonPerSec: barracksEffect?.soldierConversionPerSec ?? 0,
    populationCap: populationCapValue,
    garrisonCap: barracksEffect?.garrisonCap ?? 0,
    fleetCap: shipyardEffect?.fleetCap ?? 0,
    defensePower:
      defensePower(levels.defenseTurret, owned.population) *
      (massiveWorld?.multiplier ?? 1),
  }
}

function accruePlanet(
  planet: OwnedPlanet,
  derived: PlanetDerivedRates,
  wholeSeconds: number,
  remainder: number,
): { population: number; garrison: number } {
  let population = planet.population
  let garrison = planet.garrison

  for (let i = 0; i < wholeSeconds; i += 1) {
    if (population < derived.populationCap) {
      population = Math.min(
        population + derived.populationPerSec,
        derived.populationCap,
      )
    }
    const converted = Math.min(
      derived.garrisonPerSec,
      Math.max(0, derived.garrisonCap - garrison),
      population,
    )
    population -= converted
    garrison += converted
  }

  if (remainder > 0) {
    if (population < derived.populationCap) {
      population = Math.min(
        population + derived.populationPerSec * remainder,
        derived.populationCap,
      )
    }
    const converted = Math.min(
      derived.garrisonPerSec * remainder,
      Math.max(0, derived.garrisonCap - garrison),
      population,
    )
    population -= converted
    garrison += converted
  }

  return { population, garrison }
}

export function accruePlayer(player: PlayerState, elapsedMs: number): PlayerState {
  const dt = elapsedMs / 1_000
  const wholeSeconds = Math.floor(dt)
  const remainder = dt - wholeSeconds

  let credits = player.wallet.credits
  let alloys = player.wallet.alloys

  const homePlanet = { ...player.homePlanet }
  const colonies = player.colonies.map((planet) => ({ ...planet }))
  const planets = [homePlanet, ...colonies]

  for (const planet of planets) {
    const derived = computePlanetDerived(planet, gridForPlanet(player, planet.name))
    credits += derived.creditsPerSec * dt
    alloys += derived.alloysPerSec * dt
    const { population, garrison } = accruePlanet(
      planet,
      derived,
      wholeSeconds,
      remainder,
    )
    planet.population = population
    planet.garrison = garrison
    planet.fleet = Math.min(planet.fleet, derived.fleetCap)
  }

  return {
    ...player,
    homePlanet,
    colonies,
    wallet: { credits, alloys },
  }
}

export function empireRates(player: PlayerState): EmpireRates {
  let creditsPerSec = 0
  let alloysPerSec = 0
  for (const planet of [player.homePlanet, ...player.colonies]) {
    const derived = computePlanetDerived(planet, gridForPlanet(player, planet.name))
    creditsPerSec += derived.creditsPerSec
    alloysPerSec += derived.alloysPerSec
  }
  return { creditsPerSec, alloysPerSec }
}

export function planetTotals(player: PlayerState): PlanetTotals {
  let population = 0
  let garrison = 0
  let fleet = 0
  for (const planet of [player.homePlanet, ...player.colonies]) {
    population += planet.population
    garrison += planet.garrison
    fleet += planet.fleet
  }
  return { population, garrison, fleet }
}

export function buildStructure(
  player: PlayerState,
  planetName: string,
  id: StructureId,
): PlayerState {
  if (!ownedNames(player).has(planetName)) {
    throw new RangeError(`unknown owned planet, got ${planetName}`)
  }
  const grid = gridForPlanet(player, planetName)
  const level = grid[id]
  const cost = nextBuildCost(id, level)
  const alloyCost = STRUCTURES[id].alloyCost ?? 0
  return {
    ...player,
    wallet: walletSpend(player.wallet, cost, alloyCost),
    structureLevels: {
      ...player.structureLevels,
      [planetName]: { ...grid, [id]: level + 1 },
    },
  }
}
