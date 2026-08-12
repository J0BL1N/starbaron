/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLANETS } from '../src/sim/data/planets'
import { baselinePassiveIncome } from '../src/sim/core/economy'
import { populationCapMultiplier } from '../src/sim/planets'
import { GENERATOR_VERSION } from '../src/sim/planets/generator'
import { STARTER_STRUCTURES } from '../src/sim/player/grid'
import { initialStructuresFor } from '../src/sim/player/onboarding'
import {
  CLAIM_SALT,
  claimColony,
  claimHomePlanet,
  claimIndexForPlayer,
  colonise,
  coloniseFirstUnclaimed,
  createPlayer,
  firstUnclaimedByIndex,
  ownedNames,
  unclaimedPlanets,
  walletAdd,
  walletSpend,
  STARTER_CREDITS,
} from '../src/sim/player'
import { canonicalBodyIdForEntry } from '../src/sim/player/claim'
import { colonise as coloniseCanonical } from '../src/sim/player/colonisation'
import type { BodyId } from '../src/sim/world/identity'

const NOW = 1_700_000_000_000

describe('P2-T03-B claim assignment — determinism', () => {
  it('claimIndexForPlayer stays in the catalogue range for any playerId', () => {
    for (const id of ['a', 'jay', 'Gliese fan', 'UUID-1234-5678', 'x'.repeat(128)]) {
      const index = claimIndexForPlayer(id)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(PLANETS.length)
    }
  })

  it('rejects an empty playerId', () => {
    expect(() => claimIndexForPlayer('')).toThrow(RangeError)
  })

  it('the same playerId always claims the same planet', () => {
    const first = claimHomePlanet('deterministic-player', NOW)
    for (let i = 0; i < 10; i += 1) {
      expect(claimHomePlanet('deterministic-player', NOW).name).toBe(first.name)
      expect(claimIndexForPlayer('deterministic-player')).toBe(
        claimIndexForPlayer('deterministic-player'),
      )
    }
  })

  it('pins the bounded collision fixture: 50 synthetic ids claim 50 distinct planets', () => {
    const names = new Set<string>()
    for (let i = 0; i < 50; i += 1) {
      const owned = claimHomePlanet(`fixture-player-${i}`, NOW)
      names.add(owned.name)
      expect(owned.name).toBe(PLANETS[claimIndexForPlayer(`fixture-player-${i}`)].name)
    }
    expect(names.size).toBe(50)
  })

  it('uses a claim-specific salt, separated from the generator seed', () => {
    expect(CLAIM_SALT).toBe('starbaron-claim-v1')
    expect(CLAIM_SALT).not.toBe(GENERATOR_VERSION)
  })
})

describe('P2-T03-B claim builds a real OwnedPlanet', () => {
  it('home planet derives stats from the claimed catalogue entry', () => {
    const owned = claimHomePlanet('derived-stats-player', NOW)
    const entry = PLANETS[claimIndexForPlayer('derived-stats-player')]
    expect(owned.name).toBe(entry.name)
    expect(owned.entry).toEqual(entry)
    expect(owned.tier).toBe(entry.tier)
    expect(owned.baselineIncomePerSec).toBe(baselinePassiveIncome(entry.tier))
    expect(owned.populationCapMultiplier).toBe(populationCapMultiplier(entry.tier))
  })

  it('marks the home planet isHome and unconquerable', () => {
    const owned = claimHomePlanet('flags-player', NOW)
    expect(owned.isHome).toBe(true)
    expect(owned.unconquerable).toBe(true)
    expect(owned.claimedAt).toBe(NOW)
  })

  it('a colony is NOT unconquerable and NOT home', () => {
    const colony = claimColony(PLANETS[0], NOW)
    expect(colony.isHome).toBe(false)
    expect(colony.unconquerable).toBe(false)
    expect(colony.name).toBe(PLANETS[0].name)
    expect(colony.claimedAt).toBe(NOW)
  })
})

describe('P2-T03-B colonise from unclaimed', () => {
  it('unclaimedPlanets excludes the home planet and every colony', () => {
    const player = createPlayer('coloniser', NOW)
    const first = firstUnclaimedByIndex(player)
    expect(first).not.toBeNull()
    const { player: next, colony } = coloniseFirstUnclaimed(player, NOW)
    expect(colony.name).toBe(first!.name)

    const remaining = unclaimedPlanets(next)
    expect(remaining.some((entry) => entry.name === player.homePlanet.name)).toBe(
      false,
    )
    expect(remaining.some((entry) => entry.name === colony.name)).toBe(false)
    expect(remaining.length).toBe(PLANETS.length - 2)
  })

  it('colonise appends a validated name and picks the lowest unclaimed index', () => {
    const player = createPlayer('coloniser-two', NOW)
    const expected = PLANETS.find(
      (entry) => entry.name !== player.homePlanet.name,
    )!
    const next = colonise(player, expected.name, NOW)
    expect(next.colonies).toHaveLength(1)
    expect(next.colonies[0].name).toBe(expected.name)
    expect(ownedNames(next)).toContain(expected.name)
  })

  it('double-claim prevention: home planet and repeated colonies are rejected', () => {
    const player = createPlayer('double-claimer', NOW)
    expect(() => colonise(player, player.homePlanet.name, NOW)).toThrow(RangeError)
    const next = colonise(
      player,
      firstUnclaimedByIndex(player)!.name,
      NOW,
    )
    expect(() => colonise(next, next.colonies[0].name, NOW)).toThrow(
      /already claimed/,
    )
  })

  it('rejects an unknown / non-catalogue name', () => {
    const player = createPlayer('bogus', NOW)
    expect(() => colonise(player, 'Not A Real Planet', NOW)).toThrow(
      /unknown planet/,
    )
    expect(() => colonise(player, '', NOW)).toThrow(RangeError)
  })

  it('exhaustion edge: owning the whole catalogue leaves nothing unclaimed and further colonise throws', () => {
    const base = createPlayer('exhauster', NOW)
    const colonies = PLANETS.filter(
      (entry) => entry.name !== base.homePlanet.name,
    ).map((entry) => claimColony(entry, NOW))
    const full = { ...base, colonies }
    expect(unclaimedPlanets(full)).toEqual([])
    expect(firstUnclaimedByIndex(full)).toBeNull()
    expect(() => colonise(full, base.homePlanet.name, NOW)).toThrow(RangeError)
    expect(() => colonise(full, PLANETS[0].name, NOW)).toThrow(RangeError)
    expect(() => coloniseFirstUnclaimed(full, NOW)).toThrow(
      /no unclaimed planets/,
    )
  })
})

describe('P2 phase audit round 4 — single canonical ownership model (finding 3)', () => {
  it('claimColony/colonise duplicate rejection comes from the canonical path (same body id twice)', () => {
    const player = createPlayer('round4-canonical-dup', NOW)
    const entry = firstUnclaimedByIndex(player)!
    const body = canonicalBodyIdForEntry(entry)

    // The canonical colonise is the single dup-prevention implementation: the
    // same body id already in existingOwners yields reason 'already-owned'.
    const canonical = coloniseCanonical({
      bodyId: body,
      ownerId: player.playerId,
      wallet: player.wallet,
      requirements: { hasFleet: true, hasTravel: true },
      existingOwners: new Set<BodyId>([body]),
      at: NOW,
    })
    expect(canonical.ok).toBe(false)
    if (!canonical.ok) {
      expect(canonical.reason).toBe('already-owned')
    }

    // The legacy wrapper surfaces the identical decision: a second claim of
    // the same canonical body (the same entry) throws the mapped error.
    const next = colonise(player, entry.name, NOW)
    expect(next.colonies).toHaveLength(1)
    expect(() => colonise(next, entry.name, NOW)).toThrow(/already claimed/)
  })
})

describe('P2-T03-B createPlayer', () => {
  it('starts a fresh player with a claimed home planet and starter wallet', () => {
    const player = createPlayer('fresh-player', NOW)
    expect(player.playerId).toBe('fresh-player')
    expect(player.homePlanet.isHome).toBe(true)
    expect(player.homePlanet.unconquerable).toBe(true)
    expect(player.homePlanet.population).toBe(1_000)
    expect(player.colonies).toEqual([])
    expect(player.wallet.credits).toBe(STARTER_CREDITS)
    expect(player.lastTickAt).toBe(NOW)
    const grid = player.structureLevels[player.homePlanet.name]
    expect(grid).toEqual(STARTER_STRUCTURES)
    expect(grid.housing).toBe(1)
  })

  it('grants the home planet the shared STARTER_STRUCTURES grid (finding 2 contract)', () => {
    const player = createPlayer('starter-grid-player', NOW)
    expect(player.structureLevels[player.homePlanet.name]).toEqual(
      STARTER_STRUCTURES,
    )
    expect(player.structureLevels[player.homePlanet.name].housing).toBe(1)
    expect(player.structureLevels[player.homePlanet.name].oreMine).toBe(0)
  })

  it('createPlayer, initialStructuresFor and STARTER_STRUCTURES are one identical grid (finding 2)', () => {
    const player = createPlayer('three-paths-player', NOW)
    expect(player.structureLevels[player.homePlanet.name]).toEqual(
      initialStructuresFor(),
    )
    expect(initialStructuresFor()).toEqual(STARTER_STRUCTURES)
  })
})

describe('P2-T03-B wallet operations', () => {
  it('walletAdd applies positive deltas to credits and alloys', () => {
    const player = createPlayer('wallet-player', NOW)
    const next = walletAdd(player.wallet, {
      credits: 500,
      alloys: 100,
    })
    expect(next.credits).toBe(1_500)
    expect(next.alloys).toBe(100)
  })

  it('walletSpend deducts credits and alloys', () => {
    const player = createPlayer('wallet-player-two', NOW)
    const next = walletSpend(player.wallet, 300, 0)
    expect(next.credits).toBe(700)
    expect(next.alloys).toBe(0)
  })

  it('walletSpend throws RangeError on insufficient funds (consistent with core)', () => {
    const player = createPlayer('wallet-player-three', NOW)
    expect(() => walletSpend(player.wallet, 2_000, 0)).toThrow(RangeError)
    expect(() => walletSpend(player.wallet, 0, 5)).toThrow(/insufficient funds/)
    expect(() => walletSpend(player.wallet, -1, 0)).toThrow(RangeError)
  })
})

const SIM_DIR = fileURLToPath(new URL('../src/sim', import.meta.url))

function listSimTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...listSimTsFiles(full))
    } else if (entry.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files.sort()
}

function importSpecifiers(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.match(/^\s*(?:import|export)\s+[^'"]*\s+from\s+['"]([^'"]+)['"]/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => match[1])
}

describe('P2 phase audit — id boundary module (finding 4)', () => {
  it('boundary/id.ts exports generatePlayerId producing a non-empty string id', async () => {
    const boundary = await import('../src/boundary/id')
    expect(typeof boundary.generatePlayerId).toBe('function')
    const sample = boundary.generatePlayerId()
    expect(typeof sample).toBe('string')
    expect(sample.length).toBeGreaterThan(0)
  })

  it('no sim module imports boundary/id or the deleted player/id module', () => {
    const offenders: string[] = []
    for (const file of listSimTsFiles(SIM_DIR)) {
      const imports = importSpecifiers(readFileSync(file, 'utf8'))
      if (
        imports.some(
          (spec) => spec.includes('boundary/id') || spec.includes('player/id'),
        )
      ) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the platform-RNG code tokens appear in no sim module at all', () => {
    const offenders: string[] = []
    for (const file of listSimTsFiles(SIM_DIR)) {
      if (/\b(randomUUID|Math\.random|Date\.now)\b/.test(readFileSync(file, 'utf8'))) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
