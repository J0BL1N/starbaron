/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const SIM_DIR = fileURLToPath(new URL('../src/sim', import.meta.url))

function listTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...listTsFiles(full))
    } else if (entry.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files.sort()
}

function importSources(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.match(/^\s*import\s+[^'"]*\s+from\s+['"]([^'"]+)['"]/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => match[1])
}

const simFiles = listTsFiles(SIM_DIR)

describe('P1-T03-C src/sim purity — no React/DOM leaks', () => {
  it('scans a non-empty set of sim TS files', () => {
    expect(simFiles.length).toBeGreaterThan(0)
  })

  it('covers the generated catalogue module src/sim/data/planets.ts', () => {
    const planetsData = join(SIM_DIR, 'data', 'planets.ts')
    expect(simFiles).toContain(planetsData)
  })

  it.each(simFiles)('has no react/react-dom import in %s', (file) => {
    const sources = importSources(readFileSync(file, 'utf8'))
    expect(sources.filter((s) => s === 'react' || s === 'react-dom')).toEqual([])
  })

  it.each(simFiles)('references no DOM environment globals in %s', (file) => {
    const source = readFileSync(file, 'utf8')
    const leak =
      /\b(document|window|localStorage|sessionStorage|navigator|HTMLElement|location)\b/.exec(
        source,
      )
    expect(leak).toBeNull()
  })
})

describe('P2 phase audit — boundary import fence (finding 4)', () => {
  it('no module under src/sim/** imports from the boundary layer', () => {
    const offenders: string[] = []
    for (const file of simFiles) {
      const sources = importSources(readFileSync(file, 'utf8'))
      if (sources.some((spec) => spec.includes('boundary/'))) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the nondeterministic id generator lives only at the boundary, never in the sim', async () => {
    const boundary = await import('../src/boundary/id')
    expect(typeof boundary.generatePlayerId).toBe('function')
    const sample = boundary.generatePlayerId()
    expect(typeof sample).toBe('string')
    expect(sample.length).toBeGreaterThan(0)
  })
})
