import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = join(ROOT, 'scripts', 'import-planets.mjs')
const SNAPSHOT_DIR = join(ROOT, 'scripts', 'data')
const COMMITTED_CSV_PATH = join(SNAPSHOT_DIR, 'ps-export-2026-08-10.csv')
const TEMP_CSV_PATH = join(SNAPSHOT_DIR, 'ps-export-2999-12-31.csv')
const COMMITTED_CSV = readFileSync(COMMITTED_CSV_PATH, 'utf8')
const OUT_FILE = join(ROOT, 'src', 'sim', 'data', 'planets.ts')
const OUT_BYTES = readFileSync(OUT_FILE, 'utf8')

function runScriptAt(
  scriptPath: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; combined: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [scriptPath, ...args],
      { cwd, timeout: 60000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          reject(new Error(`script killed: ${error.message}`))
        } else {
          resolve({
            code: error === null || typeof error.code !== 'number' ? 0 : error.code,
            combined: `${stdout}${stderr}`,
          })
        }
      },
    )
  })
}

function runScript(args: string[]): Promise<{ code: number; combined: string }> {
  return runScriptAt(SCRIPT, args, ROOT)
}

async function runScriptInSandbox(
  csvContent: string,
  existingOut?: string,
): Promise<{ code: number; combined: string; generated: string | null }> {
  const sandbox = mkdtempSync(join(tmpdir(), 'starbaron-import-'))
  try {
    const scriptDir = join(sandbox, 'scripts')
    const dataDir = join(scriptDir, 'data')
    mkdirSync(dataDir, { recursive: true })
    copyFileSync(SCRIPT, join(scriptDir, 'import-planets.mjs'))
    writeFileSync(join(dataDir, 'ps-export-2999-12-31.csv'), csvContent)
    const out = join(sandbox, 'src', 'sim', 'data', 'planets.ts')
    if (existingOut !== undefined) {
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, existingOut)
    }
    const result = await runScriptAt(join(scriptDir, 'import-planets.mjs'), [], sandbox)
    const generated = existsSync(out) ? readFileSync(out, 'utf8') : null
    return { ...result, generated }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}

async function runWithTempCsv(
  content: string,
  args: string[],
): Promise<{ code: number; combined: string }> {
  writeFileSync(TEMP_CSV_PATH, content)
  try {
    return await runScript(args)
  } finally {
    if (existsSync(TEMP_CSV_PATH)) unlinkSync(TEMP_CSV_PATH)
  }
}

beforeAll(() => {
  if (existsSync(TEMP_CSV_PATH)) unlinkSync(TEMP_CSV_PATH)
})

afterAll(() => {
  if (existsSync(TEMP_CSV_PATH)) unlinkSync(TEMP_CSV_PATH)
})

describe('P2-T01-C import drift gate (--check)', () => {
  it('passes on the committed snapshot (idempotent, twice)', async () => {
    const first = await runScript(['--check'])
    const second = await runScript(['--check'])
    expect(first.code).toBe(0)
    expect(second.code).toBe(0)
    expect(first.combined).toContain('OK:')
    expect(second.combined).toContain('OK:')
  })

  it('fails with DRIFT when a temp copy of the CSV has a modified row', async () => {
    const altered = COMMITTED_CSV.replace('14.61653600', '1.50000000')
    expect(altered).not.toBe(COMMITTED_CSV)
    const result = await runWithTempCsv(altered, ['--check'])
    expect(result.code).toBe(1)
    expect(result.combined).toContain('DRIFT')
  })

  it('does not touch the committed planets.ts during a failing check', async () => {
    const altered = COMMITTED_CSV.replace('14.61653600', '1.50000000')
    await runWithTempCsv(altered, ['--check'])
    expect(readFileSync(OUT_FILE, 'utf8')).toBe(OUT_BYTES)
  })

  it('drop logic: appended row with neither radius nor mass is dropped, not emitted', async () => {
    const withNoSignalRow = `${COMMITTED_CSV}\n"Test Drop Planet","TestHost",1,,,"G2 V",1.5,,`
    const result = await runScriptInSandbox(withNoSignalRow)
    expect(result.code).toBe(0)
    expect(result.combined).toContain('rows total: 6337')
    expect(result.combined).toContain('kept:       6321')
    expect(result.combined).toContain('dropped:    1')
    expect(result.generated).not.toContain('Test Drop Planet')
    expect(result.generated).toContain('rows: 6321')
  })

  it('control: an appended row WITH a radius does change the emitted output', async () => {
    const withTierRow = `${COMMITTED_CSV}\n"Test Keep Planet","TestHost",1,1.2,,"G2 V",1.5,,`
    const result = await runScriptInSandbox(withTierRow)
    expect(result.code).toBe(0)
    expect(result.combined).toContain('kept:       6322')
    expect(result.generated).toContain('Test Keep Planet')
    expect(result.generated).not.toContain('Test Drop Planet')
  })

  it('gate is byte-strict: a benign blank line still drifts on sha, but parses without error', async () => {
    const withBlankLine = COMMITTED_CSV.replace('\n"Kepler-491 b"', '\n\n"Kepler-491 b"')
    expect(withBlankLine).not.toBe(COMMITTED_CSV)
    const result = await runWithTempCsv(withBlankLine, ['--check'])
    expect(result.code).toBe(1)
    expect(result.combined).toContain('DRIFT')
    expect(result.combined).not.toContain('row width mismatch')
    expect(result.combined).not.toContain('schema drift')
  })
})

describe('P2-T01-C import script negative paths', () => {
  it('rejects a malformed row with missing columns', async () => {
    const short = COMMITTED_CSV.replace(
      '"Kepler-6 b","Kepler-6",1,14.61653600,0.66800000,,587.03900000',
      '"Kepler-6 b","Kepler-6",1,14.61653600',
    )
    const result = await runWithTempCsv(short, ['--check'])
    expect(result.code).toBe(1)
    expect(result.combined).toContain('row width mismatch')
  })

  it('rejects a row with a stray extra comma (width mismatch)', async () => {
    const extraComma = COMMITTED_CSV.replace(
      '"Kepler-6 b","Kepler-6",1,14.61653600,0.66800000,,587.03900000',
      '"Kepler-6 b","Kepler-6",1,14.61653600,0.66800000,,587.03900000,',
    )
    const result = await runWithTempCsv(extraComma, ['--check'])
    expect(result.code).toBe(1)
    expect(result.combined).toContain('row width mismatch')
  })

  it('parses a quoted field containing a comma as one column (DRIFT, not width error)', async () => {
    const quotedComma = COMMITTED_CSV.replace('"Kepler-6",1', '"Kepler, 6",1')
    const result = await runWithTempCsv(quotedComma, ['--check'])
    expect(result.code).toBe(1)
    expect(result.combined).toContain('DRIFT')
    expect(result.combined).not.toContain('row width mismatch')
  })

  it('rejects duplicate pl_name with the dedupe assert', async () => {
    const duplicated = COMMITTED_CSV.replace('"Kepler-491 b","Kepler-491"', '"Kepler-6 b","Kepler-491"')
    const result = await runWithTempCsv(duplicated, ['--check'])
    expect(result.code).toBe(1)
    expect(result.combined).toContain('duplicate pl_name: Kepler-6 b')
  })

  it('rejects an empty file (no header row)', async () => {
    const result = await runWithTempCsv('', ['--check'])
    expect(result.code).toBe(1)
    expect(result.combined).toContain('empty CSV — no header row')
  })

  it('rejects a header-only file via the minimum-row guard (not OK, no crash)', async () => {
    const headerOnly = 'pl_name,hostname,sy_snum,pl_rade,pl_bmassj,st_spectype,sy_dist,ra,dec\n'
    const result = await runWithTempCsv(headerOnly, ['--check'])
    expect(result.code).toBe(1)
    expect(result.combined).toContain('insufficient data rows')
    expect(result.combined).not.toContain('OK:')
  })

  it('rejects a drifted header with the schema check', async () => {
    const driftedHeader = COMMITTED_CSV.replace(
      'pl_name,hostname,sy_snum,pl_rade,pl_bmassj,st_spectype,sy_dist,ra,dec',
      'pl_name,hostname,sy_snum,pl_rade,pl_bmassj,st_spectype,sy_zzz,ra,dec',
    )
    const result = await runWithTempCsv(driftedHeader, ['--check'])
    expect(result.code).toBe(1)
    expect(result.combined).toContain('schema drift')
  })

  it('mass fallback path executes: removing radius from a both-fields row stays a valid row', async () => {
    const radiusDropped = COMMITTED_CSV.replace(
      '"Kepler-6 b","Kepler-6",1,14.61653600,0.66800000,,587.03900000',
      '"Kepler-6 b","Kepler-6",1,,0.66800000,,587.03900000',
    )
    const result = await runWithTempCsv(radiusDropped, ['--check'])
    expect(result.code).toBe(1)
    expect(result.combined).toContain('DRIFT')
    expect(result.combined).not.toContain('row width mismatch')
    expect(result.combined).not.toContain('empty pl_name')
  })

  it('whitespace-only line is treated as a data row and fails (documents parser edge)', async () => {
    const spaceLine = COMMITTED_CSV.replace('\n"Kepler-491 b"', '\n   \n"Kepler-491 b"')
    const result = await runWithTempCsv(spaceLine, ['--check'])
    expect(result.code).toBe(1)
    expect(result.combined).toContain('row width mismatch')
  })
})

describe('P2-T01-C minimum-row guard', () => {
  const HEADER_ONLY = 'pl_name,hostname,sy_snum,pl_rade,pl_bmassj,st_spectype,sy_dist,ra,dec\n'
  const SENTINEL_OUT = '// pre-existing committed catalogue (must survive a failed import)'
  const truncatedCsv = () =>
    `${HEADER_ONLY}${COMMITTED_CSV.split('\n').slice(1, 5).join('\n')}`

  it('fails loudly on header-only input in write mode without touching an existing planets.ts', async () => {
    const result = await runScriptInSandbox(HEADER_ONLY, SENTINEL_OUT)
    expect(result.code).toBe(1)
    expect(result.combined).toContain('insufficient data rows')
    expect(result.combined).toContain('expected >= 6000')
    expect(result.generated).toBe(SENTINEL_OUT)
  })

  it('fails loudly on truncated input in write mode without touching an existing planets.ts', async () => {
    const result = await runScriptInSandbox(truncatedCsv(), SENTINEL_OUT)
    expect(result.code).toBe(1)
    expect(result.combined).toContain('insufficient data rows')
    expect(result.combined).toContain('expected >= 6000')
    expect(result.generated).toBe(SENTINEL_OUT)
  })

  it('--check on truncated input reports FAIL, never OK', async () => {
    const result = await runWithTempCsv(truncatedCsv(), ['--check'])
    expect(result.code).toBe(1)
    expect(result.combined).toContain('insufficient data rows')
    expect(result.combined).not.toContain('OK:')
  })
})

describe('P2-T01-C repo hygiene after runs', () => {
  it('leaves no temp snapshots behind and planets.ts is byte-identical', async () => {
    expect(existsSync(TEMP_CSV_PATH)).toBe(false)
    const snapshots = readdirSync(SNAPSHOT_DIR).filter((f) => f.startsWith('ps-export-'))
    expect(snapshots).toEqual(['ps-export-2026-08-10.csv'])
    expect(readFileSync(OUT_FILE, 'utf8')).toBe(OUT_BYTES)
    const final = await runScript(['--check'])
    expect(final.code).toBe(0)
  })
})
