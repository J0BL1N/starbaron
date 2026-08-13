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

// Removes comment and string-literal content so the DOM-global scan only sees
// real code references. Prose that merely mentions a colliding word ("tick
// window", "location ref", error strings) is not a DOM-API usage. Code inside
// template-literal `${...}` interpolation is preserved so genuine references
// there are still caught.
function stripCommentsAndStrings(source: string): string {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++
    } else if (ch === '/' && next === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
    } else if (ch === "'" || ch === '"') {
      const quote = ch
      i++
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i++
        i++
      }
      if (i < n) i++
    } else if (ch === '`') {
      i++
      while (i < n && source[i] !== '`') {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          let depth = 1
          i += 2
          while (i < n && depth > 0) {
            const c = source[i]
            if (c === '`') {
              i++
              while (i < n && source[i] !== '`') {
                if (source[i] === '\\') i++
                i++
              }
              if (i < n) i++
              continue
            }
            if (c === "'" || c === '"') {
              const q = c
              i++
              while (i < n && source[i] !== q) {
                if (source[i] === '\\') i++
                i++
              }
              if (i < n) i++
              continue
            }
            if (c === '{') depth++
            else if (c === '}') depth--
            i++
          }
          continue
        }
        i++
      }
      if (i < n) i++
    } else {
      out += ch
      i++
    }
  }
  return out
}

// DOM environment globals are banned as code references. `window`, `document`,
// `localStorage`, `sessionStorage`, `navigator` and `HTMLElement` stay banned
// outright. `location` is only flagged as property access on a DOM/global
// object (`window.location` / `document.location` / `globalThis.location`):
// as a bare identifier the P3/P5 modules legitimately use it as a domain
// field/local variable (OwnedPlanet refs, fleet location refs), which a
// word-boundary match cannot distinguish from the DOM global.
const DOM_GLOBAL_RE =
  /\b(?:document|window|localStorage|sessionStorage|navigator|HTMLElement|(?:window|document|globalThis)\.location)\b/

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
    const source = stripCommentsAndStrings(readFileSync(file, 'utf8'))
    const leak = DOM_GLOBAL_RE.exec(source)
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
