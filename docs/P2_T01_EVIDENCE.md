# P2-T01 — Exoplanet Catalogue Import: Evidence

*Closeout evidence for **P2-T01 Catalogue import** (Phase 2 — Real Universe + Planets). Consolidates the subtask record for `-A`/`-B`/`-C`/`-D`. Per WORKFLOW.md, no HEAD SHAs are embedded in prose — SHAs appear only where the record already references them (commit subjects). The whole task is Codex-PASSED.*

---

## 1. Subtask Record

| Subtask | Scope | Status | Evidence |
|---|---|---|---|
| **-A** | Audit: NASA Exoplanet Archive export format, fields needed (name, tier, star type, distance), licensing | Complete | `docs/P2_T01_A_AUDIT.md` (committed "docs: P2-T01-A exoplanet catalogue audit (NASA TAP, 7 fields, half-open tier mapping)") |
| **-B** | Import script: fetch/parse archive → typed dataset, size check | Complete | `scripts/import-planets.mjs` + `scripts/data/ps-export-2026-08-08.csv` + `src/sim/data/planets.ts` (committed "feat: P2-T01-B exoplanet catalogue import (6321 real planets, tiered, drift-gated)") |
| **-C** | Edge cases: missing fields, duplicate names, format drift | Complete | `tests/planets.test.ts`, `tests/planets-edge.test.ts`, `tests/import-planets-edge.test.ts` (committed "test: P2-T01-C catalogue edge coverage …"), + min-row guard fix ("fix: P2-T01 min-row guard (no silent catalogue overwrite on truncated input)") |
| **-D** | Evidence + Codex PASS | Complete | This doc; committed to `staging` |

---

## 2. Catalogue Import Summary

### Source — NASA Exoplanet Archive TAP (verified live at audit)

- **Endpoint:** `https://exoplanetarchive.ipac.caltech.edu/TAP/sync`
- **Table:** `ps` (Planetary Systems), one row per confirmed planet via `default_flag = 1 AND pl_letter IS NOT NULL`
- **Exact query (pinned in `scripts/import-planets.mjs` and `PLANET_SNAPSHOT.query`):**
  ```
  SELECT pl_name,hostname,sy_snum,pl_rade,pl_bmassj,st_spectype,sy_dist
  FROM ps
  WHERE default_flag=1 AND pl_letter IS NOT NULL
  ```
- **Licensing:** US Government public-domain data (operated by Caltech/IPAC under NASA contract) — free to use, attribution recorded in the script header + generated module. No key, no rate limit.

### Field set — 7 source fields + derived tier

| Source CSV column | Output field | Type | Notes |
|---|---|---|---|
| `pl_name` | `name` | string | unique key / display name |
| `hostname` | `hostname` | string | display |
| `sy_snum` | `systemCount` | number | star-system count (multi-star flavour) |
| `pl_rade` | `radiusEarth` | number \| undefined | Earth radii; **primary tier input** |
| `pl_bmassj` | `massJup` | number \| undefined | Jupiter masses; **tier fallback** |
| `st_spectype` | `starType` | string \| undefined | e.g. `G V`, `M1 V` |
| `sy_dist` | `distancePc` | number \| undefined | parsecs; travel-time maths (P3-T02) |
| *(derived)* | `tier` | 1–5 | derived at import time — **not** an eighth selected column |

The TAP `SELECT` keeps exactly these 7 archive columns; `tier` is computed, never selected.

### Tier mapping — half-open (lower-inclusive, upper-exclusive)

Radius-first; mass fallback only when radius is absent. Boundaries mirror so both inputs split identically.

| Tier | Radius `pl_rade` (R⊕) | Mass `pl_bmassj` fallback (M♃) | Category |
|---|---|---|---|
| 1 | `< 1.0` | `< 0.003` | small rocky |
| 2 | `>= 1.0 && < 1.6` | `>= 0.003 && < 0.012` | rocky super-Earth band |
| 3 | `>= 1.6 && < 2.5` | `>= 0.012 && < 0.1` | super-Earth |
| 4 | `>= 2.5 && < 4.0` | `>= 0.1 && < 1.0` | mini-Neptune / Neptune |
| 5 | `>= 4.0` | `>= 1.0` | Neptune / gas giant / hot Jupiter |

Every shared boundary is lower-inclusive, upper-exclusive — no value is double-counted or skipped.

### Row accounting

- **Raw confirmed planets:** 6,336
- **Dropped:** 15 (neither radius nor mass → no tier signal → 0.24%)
- **Kept:** **6,321**
- **Tier mix (verified in tests):** T1 **229** / T2 **969** / T3 **1,681** / T4 **1,437** / T5 **2,005**

### Drift gate + min-row guard

- **Drift gate:** `node scripts/import-planets.mjs --check` re-derives `planets.ts` in memory from the pinned snapshot CSV and byte-compares it to the committed file; exit 0 = `OK`, exit 1 = `DRIFT`. The snapshot's `sha256` is recorded in `PLANET_SNAPSHOT.sha` and independently recomputed by tests. Idempotent — re-runs are byte-identical (verified twice in the suite).
- **Min-row guard:** `MIN_PLANET_ROWS = 6000`. Header-only or truncated input below the floor fails loudly (`insufficient data rows: got N, expected >= 6000`) and **never** silently overwrites an existing `planets.ts` in write mode, and never reports `OK` in `--check` mode.

### `PLANET_SNAPSHOT` metadata (emitted in `src/sim/data/planets.ts`)

| Key | Value |
|---|---|
| `source` | full TAP sync URL with the pinned query |
| `query` | the exact ADQL in §2 |
| `fetchedAt` | `2026-08-08` (pinned from the snapshot filename — see finding F4) |
| `rows` | `6321` |
| `sha` | `ed039c5812f9346828e9b78417530d37526e02eef5703542d35e7d1e5d07a564` (sha256 of the pinned CSV) |

---

## 3. Files

```
scripts/import-planets.mjs      # zero-dep ESM import script (--fetch / default re-run / --check)
scripts/data/
└── ps-export-2026-08-08.csv    # pinned raw NASA snapshot (anti-drift anchor)
src/sim/data/
└── planets.ts                  # generated typed module: PLANETS + PLANET_SNAPSHOT (6,321 rows)
tests/
├── planets.test.ts             # dataset shape, tier re-derivation, tier mix, uniqueness
├── planets-edge.test.ts        # snapshot sha/metadata, field coverage, exact boundary semantics, types
└── import-planets-edge.test.ts # script negatives: drift gate, malformed rows, dedupe, min-row guard
```

---

## 4. Verification Results

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **16 files / 265 tests PASS** (exact, 2.75s) |
| Typecheck | `npx tsc -b` | **exit 0** |
| Build | `npm run build` | **exit 0** (207.45 kB JS / 6.70 kB CSS, 101 ms) |
| Lint | `npm run lint` | **exit 0** (oxlint) |
| Drift gate | `node scripts/import-planets.mjs --check` | **OK (exit 0)** — no drift against the pinned snapshot |

## 5. Test Counts (exact runtime, `--reporter=json`)

**16 files / 265 tests PASS** at closeout (was 265 as expected; growth +48 from the P1 closeout base of 217).

| File | Tests |
|---|---|
| `tests/savepersist-edge.test.tsx` | 26 |
| `tests/planetview-negative.test.tsx` | 24 |
| `tests/save-corrupt.test.ts` | 20 |
| `tests/import-planets-edge.test.ts` | 19 |
| `tests/structures-deep.test.ts` | 19 |
| `tests/planets-edge.test.ts` | 17 |
| `tests/savepersist.test.tsx` | 17 |
| `tests/save.test.ts` | 17 |
| `tests/sim-purity.test.ts` | 18 |
| `tests/format.test.ts` | 13 |
| `tests/economy.test.ts` | 10 |
| `tests/population.test.ts` | 10 |
| `tests/offline.test.ts` | 9 |
| `tests/planetview.test.tsx` | 9 |
| `tests/planets.test.ts` | 9 |
| `tests/structures.test.ts` | 28 |
| **Total** | **265** |

Growth: 217 (P1 closeout) → **265**. New P2-T01 coverage: `planets.test.ts` +9, `planets-edge.test.ts` +17, `import-planets-edge.test.ts` +19, `sim-purity.test.ts` +3 (incl. the generated `src/sim/data/planets.ts` purity guard) = +48.

---

## 6. Codex Verdicts (per subtask)

| Subtask | Verdict |
|---|---|
| -A | **PASS** — audit scope/boundaries (TAP source, field map, half-open tier mapping, snapshot-vs-live, licensing) |
| -B | **PASS** — import script + 6,321-planet typed catalogue, drift-gated, deterministic |
| -C | **PASS** — negative-path + regression coverage (import negatives, exact boundaries, drift, min-row guard) |
| -D | **PASS** — evidence + closeout |

Whole task: **P2-T01 Codex-PASSED**.

---

## 7. Bounded Decisions (A–G from the audit — all resolved)

| # | Decision | Choice taken |
|---|---|---|
| **A** | Tier mapping thresholds | **Radius-first, half-open** (§2) — physically meaningful, deterministic; mass as fallback. Giant-heavy pool (T5 largest) flagged for claim-pool rarity design (P2-T03) |
| **B** | Snapshot vs live | **Committed snapshot** (pinned CSV + generated TS) — deterministic builds, offline dev, diffable refresh, claim-pool stability |
| **C** | Dataset size / scope | **All confirmed planets** (6,321 rows / ~532 KB) — negligible size, full claim pool |
| **D** | Field set | **7 source fields + derived tier** — every field is in the game model; flavour is additive later |
| **E** | Dropped rows | **Drop the 15** with no radius and no mass — a fake default tier would pollute the distribution |
| **F** | Script language | **Zero-dep ESM** (`scripts/import-planets.mjs`) — tiny CSV subset problem, no dependency |
| **G** | Output format | **Typed TS module** (`src/sim/data/planets.ts`) — type safety into `src/sim`, tree-shaken by Vite, no `resolveJsonModule` |

---

## 8. Findings Fixed (Codex review rounds)

| # | Finding | Resolution | Locked by |
|---|---|---|---|
| **F1** | **8-field count vs "7 source fields"** — the emitted row literal has 8 keys (`name, hostname, systemCount, radiusEarth, massJup, starType, distancePc, tier`) which reads as a mismatch against the audit's "7 source fields" | Reconciled: the TAP `SELECT` keeps exactly **7 archive columns** (pinned `EXPECTED_HEADER`); `tier` is **derived at import time**, never an eighth selected column | Header/schema-drift check + schema-drift test reject any header change; type-shape tests lock the 8-key shape |
| **F2** | **Boundary semantics** — tier thresholds must be explicitly half-open (lower-inclusive, upper-exclusive) so no radius/mass value is double-counted or skipped | Semantics pinned in the script and mirrored in tests; every stored row is re-derived against script-extracted thresholds | Exact-boundary tests (`0.999→T1`, `1.0→T2`, `1.6→T3`, `2.5→T4`, `4.0→T5`; mass `0.003/0.012/0.1/1.0` mirrors) + full-catalogue re-derivation |
| **F3** | **`st_teff` claim** — audit was internally inconsistent (excluded field in the field table vs "park" flavour candidate in the exclusions table) | Tightened: `st_teff` is **excluded from the SELECT** — it is a separately-published stellar temperature with no tier role; star-type info for the game model comes from `st_spectype` (DESIGN §4b). Dropped-list and field-table now agree; it never enters the pipeline | Pinned 7-column `EXPECTED_HEADER` + schema-drift test |
| **F4** | **`fetchedAt` midnight drift** — a fetch-timestamp (`new Date()`) makes output depend on wall-clock time, so identical data fetched on different days (or re-run after midnight) would byte-drift the generated module | `fetchedAt` is **pinned to the snapshot identity** — derived from the `ps-export-<date>.csv` filename (`snapshotFetchedAt`), so re-runs against the same snapshot are byte-identical whenever they run | `--check` idempotency (runs twice in the suite) + tests locking `fetchedAt === "2026-08-08"` and its match to the pinned filename |
| **F5** | **Min-row guard missing** — a truncated or header-only CSV passed the header/schema checks and could silently overwrite the committed catalogue with an empty or short `planets.ts` | Added `MIN_PLANET_ROWS = 6000`: below-floor input fails loudly and **never touches an existing `planets.ts`** in write mode, and never reports `OK` in `--check` mode | `tests/import-planets-edge.test.ts` — header-only + truncated write-mode sentinel tests + `--check` FAIL test |

---

## 9. Branch / Remote State

- Branch: `staging` (no work on `main`).
- No push, no tag, no deploy — remote unchanged pending authorisation.
- Working tree clean after this closeout commit.

---

*Prepared by OpenCode (deepseek-v4-flash) for P2-T01-D. Only `docs/P2_T01_EVIDENCE.md` + ROADMAP.md changed in this subtask.*
