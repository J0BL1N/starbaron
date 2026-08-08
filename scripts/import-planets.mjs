#!/usr/bin/env node
/**
 * P2-T01-B — exoplanet catalogue import.
 *
 * Fetches the confirmed-planet table from the NASA Exoplanet Archive TAP service,
 * parses + validates the CSV, derives a 1-5 tier (radius-first, mass fallback,
 * half-open boundaries), asserts pl_name uniqueness, drops rows with neither
 * radius nor mass, and emits a typed TS module at src/sim/data/planets.ts.
 *
 * Data is public domain (US Government). Acknowledgement: NASA Exoplanet
 * Archive is operated by California Institute of Technology (Caltech), under
 * contract with the National Aeronautics and Space Administration.
 *
 * Usage:
 *   node scripts/import-planets.mjs --fetch   # download fresh snapshot CSV + emit TS
 *   node scripts/import-planets.mjs           # re-run from the latest pinned snapshot CSV
 *   node scripts/import-planets.mjs --check   # drift gate: emit-to-memory vs committed planets.ts
 *
 * Zero dependencies. Deterministic: the pinned CSV is the single input, output
 * is sorted by name, and re-runs produce byte-identical planets.ts.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT_DIR = join(ROOT, 'scripts', 'data')
const OUT_FILE = join(ROOT, 'src', 'sim', 'data', 'planets.ts')

const SOURCE_URL =
  'https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=SELECT+pl_name,hostname,sy_snum,pl_rade,pl_bmassj,st_spectype,sy_dist+FROM+ps+WHERE+default_flag=1+AND+pl_letter+IS+NOT+NULL&format=csv'

const QUERY =
  'SELECT pl_name,hostname,sy_snum,pl_rade,pl_bmassj,st_spectype,sy_dist FROM ps WHERE default_flag=1 AND pl_letter IS NOT NULL'

const EXPECTED_HEADER = ['pl_name', 'hostname', 'sy_snum', 'pl_rade', 'pl_bmassj', 'st_spectype', 'sy_dist']

// Minimum accepted data rows. The pinned NASA snapshot is ~6336 rows; any
// header-only or truncated input below this floor is a safety failure and must
// never silently overwrite the committed planets.ts.
const MIN_PLANET_ROWS = 6000

// Half-open tier boundaries (lower-inclusive, upper-exclusive).
// Radius in Earth radii; mass fallback in Jupiter masses (mirrors radius split).
const RADIUS_TIERS = [
  { max: 1.0, tier: 1 },
  { max: 1.6, tier: 2 },
  { max: 2.5, tier: 3 },
  { max: 4.0, tier: 4 },
  { max: Infinity, tier: 5 },
]

const MASS_TIERS = [
  { max: 0.003, tier: 1 },
  { max: 0.012, tier: 2 },
  { max: 0.1, tier: 3 },
  { max: 1.0, tier: 4 },
  { max: Infinity, tier: 5 },
]

function tierForValue(value, tiers) {
  for (const { max, tier } of tiers) {
    if (value < max) return tier
  }
  throw new RangeError(`tier lookup failed for ${value}`)
}

/** Minimal RFC-4180-ish CSV parser: quoted fields, "" escapes, CRLF/CR/LF. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (!(row.length === 1 && row[0] === '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
  }
  return rows
}

function toNumber(raw, field) {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) {
    throw new Error(`non-finite ${field} value: ${JSON.stringify(raw)}`)
  }
  return value
}

function deriveTier(radius, mass) {
  if (radius !== null) return tierForValue(radius, RADIUS_TIERS)
  if (mass !== null) return tierForValue(mass, MASS_TIERS)
  return null
}

/** Fixed-field-order, compact, deterministic object literal for one row. */
function rowToLiteral(row) {
  const parts = [
    `name:${JSON.stringify(row.name)}`,
    `hostname:${JSON.stringify(row.hostname)}`,
    `systemCount:${row.systemCount}`,
  ]
  if (row.radiusEarth !== null) parts.push(`radiusEarth:${row.radiusEarth}`)
  if (row.massJup !== null) parts.push(`massJup:${row.massJup}`)
  if (row.starType !== null) parts.push(`starType:${JSON.stringify(row.starType)}`)
  if (row.distancePc !== null) parts.push(`distancePc:${row.distancePc}`)
  parts.push(`tier:${row.tier}`)
  return `  {${parts.join(',')}} as PlanetCatalogueEntry,`
}

function processRows(rawCsv, sha) {
  const rows = parseCsv(rawCsv)
  if (rows.length === 0) throw new Error('empty CSV — no header row')
  const header = rows[0]
  if (
    header.length !== EXPECTED_HEADER.length ||
    header.some((name, i) => name !== EXPECTED_HEADER[i])
  ) {
    throw new Error(
      `schema drift: expected header [${EXPECTED_HEADER.join(',')}] got [${header.join(',')}]`,
    )
  }
  const rowsTotal = rows.length - 1
  if (rowsTotal < MIN_PLANET_ROWS) {
    throw new Error(
      `insufficient data rows: got ${rowsTotal}, expected >= ${MIN_PLANET_ROWS} — refusing to emit planets.ts (truncated or header-only input?)`,
    )
  }
  const nameIdx = header.indexOf('pl_name')
  const hostIdx = header.indexOf('hostname')
  const snumIdx = header.indexOf('sy_snum')
  const radeIdx = header.indexOf('pl_rade')
  const bmassIdx = header.indexOf('pl_bmassj')
  const spectypeIdx = header.indexOf('st_spectype')
  const distIdx = header.indexOf('sy_dist')

  const entries = []
  const seen = new Set()
  let dropped = 0
  for (const cols of rows.slice(1)) {
    if (cols.length !== header.length) {
      throw new Error(`row width mismatch: expected ${header.length} got ${cols.length}`)
    }
    const name = cols[nameIdx]
    if (name === '') throw new Error('empty pl_name row')

    const radius = toNumber(cols[radeIdx], 'pl_rade')
    const mass = toNumber(cols[bmassIdx], 'pl_bmassj')
    const tier = deriveTier(radius, mass)
    if (tier === null) {
      dropped++
      continue
    }

    if (seen.has(name)) {
      throw new Error(`duplicate pl_name: ${name}`)
    }
    seen.add(name)

    const snum = toNumber(cols[snumIdx], 'sy_snum')
    const spectype = cols[spectypeIdx].trim()
    const dist = toNumber(cols[distIdx], 'sy_dist')

    entries.push({
      name,
      hostname: cols[hostIdx],
      systemCount: snum === null ? 1 : snum,
      radiusEarth: radius,
      massJup: mass,
      starType: spectype === '' ? null : spectype,
      distancePc: dist,
      tier,
    })
  }

  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  return { entries, dropped, sha, rowsTotal }
}

function renderModule(entries, meta) {
  const lines = [
    '// Generated by scripts/import-planets.mjs — do not edit by hand.',
    '// Source: NASA Exoplanet Archive (US Government public-domain data), hosted by Caltech/IPAC.',
    `// Acknowledgement: NASA Exoplanet Archive is operated by Caltech/IPAC under NASA contract.`,
    '',
    'export type PlanetTier = 1 | 2 | 3 | 4 | 5',
    '',
    'export interface PlanetCatalogueEntry {',
    '  name: string',
    '  hostname: string',
    '  systemCount: number',
    '  radiusEarth?: number',
    '  massJup?: number',
    '  starType?: string',
    '  distancePc?: number',
    '  tier: PlanetTier',
    '}',
    '',
    'export const PLANET_SNAPSHOT = {',
    `  source: ${JSON.stringify(meta.source)},`,
    `  query: ${JSON.stringify(meta.query)},`,
    `  fetchedAt: ${JSON.stringify(meta.fetchedAt)},`,
    `  rows: ${entries.length},`,
    `  sha: ${JSON.stringify(meta.sha)},`,
    '} as const',
    '',
    'export const PLANETS: PlanetCatalogueEntry[] = [',
    ...entries.map(rowToLiteral),
    ']',
    '',
  ]
  return lines.join('\n')
}

const SNAPSHOT_NAME = /^ps-export-(\d{4}-\d{2}-\d{2})\.csv$/

function latestSnapshot() {
  if (!existsSync(SNAPSHOT_DIR)) return null
  const files = readdirSync(SNAPSHOT_DIR)
    .filter((f) => SNAPSHOT_NAME.test(f))
    .map((f) => join(SNAPSHOT_DIR, f))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return files.length > 0 ? files[files.length - 1] : null
}

/** Derive the pinned date from the snapshot filename (ps-export-<date>.csv). */
function snapshotFetchedAt(path) {
  const match = basename(path).match(SNAPSHOT_NAME)
  if (!match) throw new Error(`snapshot filename does not carry a date: ${path}`)
  return match[1]
}

async function fetchSnapshot() {
  const response = await fetch(SOURCE_URL)
  if (!response.ok) {
    throw new Error(`TAP fetch failed: ${response.status} ${response.statusText}`)
  }
  const csv = await response.text()
  if (csv.trim() === '' || !csv.trimStart().startsWith('pl_name')) {
    throw new Error('TAP response did not look like a CSV export (missing pl_name header)')
  }
  const today = new Date().toISOString().slice(0, 10)
  const path = join(SNAPSHOT_DIR, `ps-export-${today}.csv`)
  mkdirSync(SNAPSHOT_DIR, { recursive: true })
  writeFileSync(path, csv)
  return { csv, path, fetchedAt: today }
}

async function main() {
  const args = process.argv.slice(2)
  const doFetch = args.includes('--fetch')
  const doCheck = args.includes('--check')

  let csv
  let path
  let fetchedAt
  if (doFetch) {
    const snapshot = await fetchSnapshot()
    csv = snapshot.csv
    path = snapshot.path
    fetchedAt = snapshot.fetchedAt
  } else {
    const snapshotPath = latestSnapshot()
    if (!snapshotPath) {
      throw new Error('no pinned snapshot found — run with --fetch first')
    }
    path = snapshotPath
    fetchedAt = snapshotFetchedAt(snapshotPath)
    csv = readFileSync(snapshotPath, 'utf8')
  }

  const sha = createHash('sha256').update(csv).digest('hex')
  const { entries, dropped, rowsTotal } = processRows(csv, sha)

  const tierCounts = [0, 0, 0, 0, 0]
  for (const entry of entries) tierCounts[entry.tier - 1]++

  const rendered = renderModule(entries, { source: SOURCE_URL, query: QUERY, fetchedAt, sha })

  const committed = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : null
  if (doCheck) {
    if (committed === null || committed !== rendered) {
      console.error('DRIFT: src/sim/data/planets.ts does not match the pinned snapshot.')
      process.exitCode = 1
    } else {
      console.log('OK: src/sim/data/planets.ts matches the pinned snapshot (no drift).')
    }
    return
  }

  mkdirSync(dirname(OUT_FILE), { recursive: true })
  writeFileSync(OUT_FILE, rendered)

  const csvBytes = statSync(path).size
  const tsBytes = Buffer.byteLength(rendered, 'utf8')
  const tierSummary = tierCounts.map((c, i) => `T${i + 1}=${c}`).join(' ')

  console.log(`source:     ${SOURCE_URL}`)
  console.log(`snapshot:   ${path} (${(csvBytes / 1024).toFixed(1)} KB)`)
  console.log(`rows total: ${rowsTotal}`)
  console.log(`kept:       ${entries.length} (${(tsBytes / 1024).toFixed(1)} KB TS)`)
  console.log(`dropped:    ${dropped} (neither radius nor mass)`)
  console.log(`tiers:      ${tierSummary}`)
  console.log(`sha256:     ${sha}`)
  if (committed !== null && committed !== rendered) {
    console.log('note: output differs from the previously committed planets.ts')
  }
}

main().catch((err) => {
  console.error(`import-planets failed: ${err.message}`)
  process.exit(1)
})
