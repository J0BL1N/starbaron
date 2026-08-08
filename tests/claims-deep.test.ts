/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { PLANETS } from '../src/sim/data/planets'
import {
  claimHomePlanet,
  claimIndexForPlayer,
  colonise,
  coloniseFirstUnclaimed,
  createPlayer,
  firstUnclaimedByIndex,
} from '../src/sim/player'

const NOW = 1_700_000_000_000

describe('P2-T03-C claim determinism — deep', () => {
  it('the same playerId maps to the same home planet across 100 repeated calls', () => {
    const id = 'determinism-deep-100'
    const name = claimHomePlanet(id, NOW).name
    for (let i = 0; i < 100; i += 1) {
      expect(claimHomePlanet(id, NOW + i).name).toBe(name)
      expect(claimIndexForPlayer(id)).toBe(claimIndexForPlayer(id))
    }
  })

  it('playerId edge cases never crash and stay in the catalogue range', () => {
    const edgeIds = [
      ' ',
      'a',
      'A',
      'aaaaaaaa',
      'aaaaaaab',
      '0',
      '1',
      '1.0',
      '01',
      '👾🪐',
      'β-Centauri',
      'Глизе 667 Cc',
      '火星',
      'Gliese 667 Cc',
      'Gliese 667 Cc ',
      'é\u0301',
      'וְאַהַבְתָּ',
      '\u0000',
      '\t\n',
      'x'.repeat(1_024),
      'y'.repeat(1_000_000),
      'same-prefix',
      'same-prefix-1',
      'same-prefix-2',
      'CaseSensitive',
      'casesensitive',
    ]
    for (const id of edgeIds) {
      const index = claimIndexForPlayer(id)
      expect(index, id).toBeGreaterThanOrEqual(0)
      expect(index, id).toBeLessThan(PLANETS.length)
      expect(claimIndexForPlayer(id), id).toBe(index)
      expect(claimHomePlanet(id, NOW).name, id).toBe(
        PLANETS[claimIndexForPlayer(id)].name,
      )
    }
  })

  it('rejects empty and non-string playerIds with a RangeError, never crashing', () => {
    for (const bad of ['', null, undefined, 42, {}, [], NaN]) {
      expect(
        () => claimIndexForPlayer(bad as unknown as string),
        String(bad),
      ).toThrow(RangeError)
    }
    expect(() => claimIndexForPlayer('')).toThrow(/non-empty/)
  })

  it('pins the bounded fixture spread as a stable set, not a uniqueness guarantee', () => {
    const fixture = (): string[] => {
      const names: string[] = []
      for (let i = 0; i < 50; i += 1) {
        names.push(claimHomePlanet(`fixture-deep-${i}`, NOW).name)
      }
      return names.sort()
    }
    const first = fixture()
    const second = fixture()
    expect(new Set(first).size).toBe(50)
    expect(second).toEqual(first)
  })
})

describe('P2-T03-C claim idempotency', () => {
  it('claimHomePlanet never re-assigns: repeated createPlayer/claim calls keep the same home', () => {
    const a = createPlayer('idem-player', NOW)
    const b = createPlayer('idem-player', NOW + 10_000)
    expect(b.homePlanet.name).toBe(a.homePlanet.name)
    expect(b.homePlanet.entry).toEqual(a.homePlanet.entry)
    expect(b.colonies).toEqual([])

    const re = claimHomePlanet('idem-player', NOW + 99_999)
    expect(re.name).toBe(a.homePlanet.name)
    expect(re.tier).toBe(a.homePlanet.tier)
    expect(re.claimedAt).toBe(NOW + 99_999)
  })

  it('claimColony double-claim prevention: same entry rejected and the state stays unchanged', () => {
    const player = createPlayer('double-colony-deep', NOW)
    const target = firstUnclaimedByIndex(player)!
    const next = colonise(player, target.name, NOW)
    expect(next.colonies).toHaveLength(1)

    expect(() => colonise(next, target.name, NOW)).toThrow(/already claimed/)
    expect(() => colonise(next, player.homePlanet.name, NOW)).toThrow(
      /already claimed/,
    )
    expect(() => colonise(player, player.homePlanet.name, NOW)).toThrow(
      /already claimed/,
    )
    expect(next.colonies).toHaveLength(1)
  })
})

describe('P2-T03-C home safety flags', () => {
  it('home is unconquerable, every colony is conquerable, and isHome stays consistent', () => {
    const player = createPlayer('home-safety-deep', NOW)
    let current = player
    for (let i = 0; i < 3; i += 1) {
      current = coloniseFirstUnclaimed(current, NOW).player
    }

    expect(current.homePlanet.isHome).toBe(true)
    expect(current.homePlanet.unconquerable).toBe(true)
    expect(current.homePlanet.unconquerable).toBe(current.homePlanet.isHome)
    expect(current.colonies).toHaveLength(3)

    const owned = [current.homePlanet, ...current.colonies]
    expect(owned.filter((p) => p.isHome)).toHaveLength(1)
    for (const colony of current.colonies) {
      expect(colony.isHome).toBe(false)
      expect(colony.unconquerable).toBe(false)
      expect(colony.unconquerable).toBe(colony.isHome)
      expect(colony.name).not.toBe(current.homePlanet.name)
    }
  })
})

const PLAYER_DIR = fileURLToPath(new URL('../src/sim/player', import.meta.url))

function importPaths(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.match(/^\s*import\s+[^'"]*\s+from\s+['"]([^'"]+)['"]/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => match[1])
}

describe('P2-T03-C src/sim/player purity — covered by the recursive scan', () => {
  it('every player/*.ts leaks no React/DOM and is importable in node', () => {
    const files = readdirSync(PLAYER_DIR)
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => join(PLAYER_DIR, entry))
      .sort()
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const imports = importPaths(source)
      expect(
        imports.filter((s) => s === 'react' || s === 'react-dom'),
        file,
      ).toEqual([])
      expect(
        /\b(document|window|localStorage|sessionStorage|navigator|HTMLElement|location)\b/.exec(
          source,
        ),
        file,
      ).toBeNull()
    }
  })
})
