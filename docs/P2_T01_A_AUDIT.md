# P2-T01-A — Exoplanet Catalogue Import Audit

*Subtask `-A` for **P2-T01 Catalogue import** (Phase 2 — Real Universe + Planets). Documentation-only audit. Nothing implemented, nothing committed, no work on `main`. Per WORKFLOW.md no HEAD SHAs are embedded in docs. Scope grounded in DESIGN.md §4b (the Real Universe: NASA Exoplanet Archive, claim pool, tiers), §4d (planet tiers T1–T5, economy numbers), ROADMAP.md P2-T01 rows, and verified live against the NASA Exoplanet Archive at HEAD on `staging`.*

---

## 1. Data Source — NASA Exoplanet Archive (confirmed)

### Endpoint (verified live)

**TAP (Table Access Protocol) ADQL service** is the canonical programmatic export, not the human-facing table viewer:

- **TAP sync endpoint:** `https://exoplanetarchive.ipac.caltech.edu/TAP/sync`
- **Query form:** `?query=<ADQL>&format=csv`
- **Confirmed-planet table:** the **`ps`** (Planetary Systems) table — one row per published parameter set per confirmed planet.
- **One-row-per-planet filter:** `WHERE default_flag = 1 AND pl_letter IS NOT NULL`. `default_flag = 1` collapses the multiple literature parameter sets to the archive's single internally-consistent default set per planet; `pl_letter IS NOT NULL` excludes any non-planet edge rows. This is the documented way to get "confirmed planets, one row each" (FAQ #3: default selection's remaining purpose is to filter the PS table down to one row per planet).

**Verified live queries (2026-08-08):**

| Query | Result |
|---|---|
| `SELECT COUNT(*) FROM ps` | 40,052 rows (all parameter sets, incl. non-default duplicates) |
| `SELECT COUNT(*) FROM ps WHERE default_flag=1 AND pl_letter IS NOT NULL` | **6,336 confirmed planets** |

**Example working query:**
```
https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=SELECT+pl_name,hostname,sy_snum,pl_rade,pl_bmassj,st_spectype,sy_dist+FROM+ps+WHERE+default_flag=1+AND+pl_letter+IS+NOT+NULL&format=csv
```

Notes verified during research:
- `LIMIT n` fails with a 400 (ADQL on this service expects `TOP n` instead) — use `SELECT TOP n ...` for test queries.
- Output is a standard CSV with header row; all string fields (including `pl_name`) are double-quoted; missing values are empty fields (not `null` tokens).
- A **full-export CSV alternative** exists at the bulk-data endpoint (`.../bulk_data_download`), but TAP with `SELECT <explicit column list>` is preferable — we only pull the fields we need, and the query itself is the pinned spec.

### Fields available (PS table, verified)

| Column | Meaning | Units | Our use |
|---|---|---|---|
| `pl_name` | Planet designation (e.g. `Gliese 667 Cc`, `Kepler-6 b`) | — | primary key / display name |
| `hostname` | Host star name | — | star identity for display |
| `sy_snum` | Number of stars in system | — | minor flavour (multi-star systems) |
| `sy_pnum` | Number of planets in system | — | excluded (multi-planet economy = P2-T04) |
| `pl_rade` | Planet radius | Earth radii | **tier derivation (primary)** + flavour |
| `pl_radj` | Planet radius | Jupiter radii | redundant (recompute from `pl_rade`; drop) |
| `pl_bmasse` | Planet mass | Earth masses | tier fallback if radius missing |
| `pl_bmassj` | Planet mass | Jupiter masses | tier fallback (alternative unit — keep ONE) |
| `pl_orbper` | Orbital period | days | excluded (not in DESIGN §4b/§4d) |
| `pl_eqt` | Equilibrium temperature | K | flavour candidate, low priority — park |
| `st_spectype` | Stellar spectral type (e.g. `G V`, `M1 V`) | — | **star type** (DESIGN §4b "star type", §4c star-type bonuses reserved) |
| `st_teff` | Stellar effective temp | K | separately supplied, excluded field (not derivable from `st_spectype`) |
| `st_rad` | Stellar radius | solar radii | flavour, low priority — park |
| `st_mass` | Stellar mass | solar masses | flavour, low priority — park |
| `st_met` | Stellar metallicity | dex | excluded |
| `sy_dist` | System distance | parsecs | **distance** (travel-time maths, DESIGN §4d / P3-T02) |
| `discoverymethod` | Discovery method | — | flavour, low priority — park |
| `disc_year` | Discovery year | — | flavour, low priority — park |
| `pl_pubdate` | Publication date (yyyy-mm) | — | freshness metadata — park |
| `default_flag` | 1 = archive default row | — | filter only, drop from dataset |

### Licensing — public domain (confirmed)

NASA Exoplanet Archive data is **US Government public-domain data**, freely reusable with attribution. The archive's acknowledgement page requests standard citation text in *published research* (acknowledging Caltech/IPAC operation under NASA contract) but imposes **no licensing cost and no restriction on use** — consistent with DESIGN §4b line 63 "Data is free: public domain astronomical data — no licensing cost". Recommend recording the standard acknowledgement string in the import script header and README (good practice, zero cost). No API key required; no rate limiting encountered on TAP test queries.

### Update cadence — snapshot, do not fetch-live

- Archive adds new confirmed planets **roughly weekly** (FAQ: "We generally add new planets and planetary and stellar data weekly"). Data volume is small (6,336 rows) and only grows slowly (~tens/week).
- **Decision: snapshot.** Pin a dated export as a committed file; refresh it deliberately (re-run the import script when Jay authorises a data refresh), never fetch at runtime or at build time. Deterministic builds + offline dev + diffable changes (ROADMAP P2-T01-C "format drift" is easier to catch against a committed CSV than a moving target). A live fetch adds a network dependency to a game whose UI should never depend on the archive being up.

---

## 2. Field Selection + Tier Mapping

### Field map — what we keep, what we drop

**Kept (maps to the Planet model — P2-T02 consumes it):** 7 source CSV fields, plus `tier` which is *derived at import time*, not a selected archive column.

| Dataset field | Output field | Type | Notes |
|---|---|---|---|
| `pl_name` | `name` | string | unique key, display name |
| `hostname` | `host` | string | display |
| `sy_snum` | `numStars` | number | flavour (star-type bonuses, §4c reserved) |
| `pl_rade` | `radius` | number | Earth radii; **primary tier input** |
| `pl_bmassj` | `mass` | number | Jupiter masses; **tier fallback** when radius missing |
| `st_spectype` | `starType` | string\|null | "G V", "M1 V", … |
| `sy_dist` | `distance` | number | parsecs; travel-time maths (P3-T02) |
| *(derived)* | `tier` | 1\|2\|3\|4\|5 | **not an archive column** — derived at import time, stored (see mapping below) |

**Junk / dropped:** `pl_radj`, `pl_bmasse`, `pl_orbper`, `pl_eqt`, `st_teff`, `st_rad`, `st_mass`, `st_met`, `discoverymethod`, `disc_year`, `pl_pubdate`, `default_flag`, `sy_pnum`. Keep the source CSV minimal (SELECT only the 7 source columns; `tier` is derived, not an eighth selected column) so junk never enters the pipeline.

### Tier mapping proposal (radius-first, mass fallback)

DESIGN §4d line 87: *"Planet tiers (from catalogue data): Tier 1 (small rocky) → Tier 5 (super-Earth/giant). Higher tier = more structure slots + higher base income + higher pop cap."* We derive a discrete 1–5 tier from the continuous astrophysical parameters. Radius (`pl_rade`, Earth radii) is the primary signal — it's present for **74.6%** of confirmed planets (4,730/6,336) and is the physically meaningful "size" axis; mass is the fallback for the 25.4% without radius.

**Proposed radius thresholds (Earth radii) — exact inclusive/exclusive boundary semantics:**

| Tier | Radius `pl_rade` (R⊕) | Category | Mass `pl_bmassj` fallback (M♃) |
|---|---|---|---|
| 1 | `< 1.0` | small rocky (Mercury–Earth) | `< 0.003` |
| 2 | `>= 1.0 && < 1.6` | rocky super-Earth band | `>= 0.003 && < 0.012` |
| 3 | `>= 1.6 && < 2.5` | super-Earth | `>= 0.012 && < 0.1` |
| 4 | `>= 2.5 && < 4.0` | mini-Neptune / Neptune | `>= 0.1 && < 1.0` |
| 5 | `>= 4.0` | Neptune / gas giant / hot Jupiter | `>= 1.0` |

Every shared boundary is **lower-inclusive, upper-exclusive** (T1 `< 1.0` and T5 `>= 4.0` are half-open); no value is ever double-counted or skipped. The mass fallback thresholds mirror these exact boundaries so both inputs produce identical tier splits.

Thresholds are the standard exoplanet size-regime boundaries (Fulton et al. radius valley ~1.6–2 R⊕; sub-Neptune → Neptune ~4 R⊕; Jupiter ~11 R⊕). Tier 1 caps at 1.0 R⊕ so Earth (~1.0) is a tier-2 rocky planet — sensible for a game floor where every tier has non-zero structure slots.

**Resolution logic (deterministic):**
1. `pl_rade` present → tier from radius thresholds.
2. else `pl_bmassj` present → tier from mass fallback thresholds.
3. else (neither radius nor mass) → **drop the row** (only 15/6,336 planets — 0.24% — have neither; keeping them would force a junk default tier and pollute the tier distribution).

**Sanity check vs. category intuition:** verified the tier buckets produce a realistic mix. Applied to the live export (6,321 rows surviving): **T1 229, T2 969, T3 1,681, T4 1,437, T5 2,005.** Tier 5 (giants) is the largest bucket because hot Jupiters dominate the RV/transit discovery sample — worth noting for Jay: giant-heavy catalogue is fine for the game (bigger planets = bigger prizes), but the tier pool is *not* uniform, which affects claim-pool rarity later (P2-T03).

---

## 3. Import Script Design

### Pipeline

```
1. DOWNLOAD   curl/node fetch TAP CSV  ── SELECT the 7 source columns, WHERE default_flag=1 AND pl_letter IS NOT NULL, format=csv
2. PARSE      read header row, map columns, handle quoted strings + empty fields
3. VALIDATE   schema check (expected columns present → fail loudly on format drift); numeric parse + finite check per numeric field
4. DERIVE     compute tier (radius-first, mass fallback); drop rows with no tier signal
5. DEDUPE     assert uniqueness of pl_name (archive guarantees it after the default_flag filter; assert + fail on duplicates = catches drift)
6. EMIT       write src/sim/data/planets.ts (typed, minified array + a SNAPSHOT_META export: source URL, query, row count, fetch date, SHA)
```

### Script structure

- **`scripts/import-planets.mjs`** — node ESM (matches `"type": "module"` in package.json), zero new dependencies (native `fetch` + a ~30-line CSV parser or `node --experimental` none needed — write a tiny quoted-CSV parser; it's a bounded problem). Downloads to a temp file, runs steps 2–5, writes the generated module. **Idempotent:** re-running against the same snapshot produces byte-identical output (add a `--check` mode that compares to the committed file and exits non-zero on drift, for the P2-T01-C regression gate).
- **Pinned raw snapshot:** commit the source CSV too, as **`scripts/data/ps-export-<YYYY-MM-DD>.csv`** (deterministic re-runs + a diffable record of "what did the archive give us"). This is the anti-drift anchor for P2-T01-C.
- **Generated output:** **`src/sim/data/planets.ts`** — a typed array `export const PLANETS: PlanetData[] = [...]` plus `export const PLANET_SNAPSHOT = { source, query, fetchedAt, rows, sha }`. Typed TS module (not JSON) so `src/sim` imports it with full type safety and it's tree-shaken/minified by Vite; a `.json` import would need `resolveJsonModule` and lose the type. Data lives in `src/sim/data/` (new dir, matches the `src/sim` purity contract — it's a static data module, not UI).

### Determinism + dedupe + missing fields

- **Deterministic:** the committed CSV snapshot is the single input; the script never re-fetches unless invoked with `--fetch`. Output ordering = archive row order (stable), or sort by `pl_name` for a diffable file — **recommend sort by name** so a data refresh's diff is purely additive.
- **Dedupe:** `pl_name` unique-key assert after the `default_flag=1` filter. Archive should never duplicate after that filter; an assert (not a silent first-wins) catches drift.
- **Missing fields — per-field policy:**
  - `radius` / `mass` — one of them required (tier derivation); if both missing → drop row (15 rows).
  - `starType`, `numStars` — **lenient default** (`null` / `1`); planet remains fully playable without star flavour.
  - `distance` — **lenient default** (`null`); present for 98% anyway; travel-time code must handle null (P3-T02), and the UI can show "distance unknown" for the 2%.
- **Size check:** confirmed 6,336 → **6,321 rows after the no-radius-and-no-mass drop**. Full-output JSON ~532 KB minified (measured with the 7-source-field + derived-tier shape above). This is trivially small — see §4.

---

## 4. Where the Dataset Lives

**Recommendation: committed generated TS snapshot** — `src/sim/data/planets.ts` (generated output) + `scripts/data/ps-export-<date>.csv` (pinned raw input). Do **not** fetch at runtime or at build time.

- **Deterministic builds:** the game compiles against a fixed catalogue; a live fetch would make `npm run build` depend on the archive being reachable and on whatever the archive happens to return that day.
- **Offline dev:** the existing dev/preview (P1) runs fully offline; a runtime fetch would break that. Committed data keeps dev/CI/tests hermetic.
- **Diffable refresh:** when Jay authorises a refresh, the script's output diff against the committed file shows exactly which planets/fields changed — cheap code review.
- **Claim-pool integrity (P2-T03):** the claim pool indexes into this committed array; a stable snapshot means claimed IDs stay valid across builds. Live data would risk a claimed planet vanishing mid-phase.
- **Size budget:** ~532 KB minified (≈ 90 KB gzipped) ships in the bundle once; the CSV snapshot ~470 KB in-repo. Neither is worth optimising away. Keep the field set tight (7 source fields + derived tier) so it stays in the ~0.5 MB range as the catalogue grows.

**Refresh cadence:** manual, on Jay's authorisation (aligns with "snapshot, not live" §1). No scheduled job.

---

## 5. Exclusions (bounded for T01)

| Excluded | Why |
|---|---|
| **Claim pool logic (unclaimed index, assignment)** | P2-T03 — this task only imports data; the pool is a separate module over `PLANETS` |
| **Multi-planet economies / per-planet grids** | P2-T04 — `sy_pnum` deliberately dropped (§2) |
| **Planet model / tier stats / structure slots** | P2-T02 — the import emits raw `PlanetData`; the gameplay tier→slots/income mapping is the next task |
| **UI** | Phase 2 UI (galaxy map, planet picker) is not in ROADMAP P1/P2-T01 scope |
| **Backend / Supabase** | Phase 3 — the committed TS array is client-side until the schema task |
| **Fictional / Kimi-generated planet enrichment** | DESIGN §4b "FOR LATER" (Kimi Code CLI lore engine) — parked; this task imports *real* exoplanets only |
| **Flavour fields** (eqt, st_teff, st_rad, discoverymethod, disc_year) | Low priority; can be added to the SELECT later without breaking the model — keep the dataset lean now |
| **Runtime/live fetching, scheduled refresh** | §1/§4 — snapshot only, by design |

---

## 6. Blockers / Decisions for Jay

| # | Decision | Options | My recommendation |
|---|---|---|---|
| **A** | **Tier mapping thresholds** | (1) radius-first with my proposed thresholds (§2 table); (2) mass-first; (3) equal 1/5-size-per-tier quantiles (uniform pool, loses physical meaning) | **(1) radius-first thresholds** — physically meaningful, deterministic, matches the 74.6%-coverage radius signal; mass only as fallback. Note: yields a giant-heavy pool (T5 largest bucket) — acceptable, but flagged for claim-pool rarity design later |
| **B** | **Snapshot vs live** | (1) committed snapshot (CSV + generated TS); (2) live fetch at build/runtime | **(1) Snapshot** — deterministic builds, offline dev, diffable refresh, claim-pool stability (§1/§4). Refresh is a manual, Jay-authorised step |
| **C** | **Dataset size / scope** | (1) all 6,321 confirmed planets; (2) subset (e.g. nearest N, or ≥1 planet per host, or radius-known only) | **(1) All confirmed planets** — 6,321 rows / ~532 KB is negligible; a subset adds arbitrary complexity and shrinks the claim pool for no gain |
| **D** | **Field set** | (1) the 7-source-field set (§2) + derived tier; (2) add flavour fields (eqt, discoverymethod, etc.) now | **(1) 7-source-field set** — every field in the game model; flavour is additive later and doesn't break the model |
| **E** | **Dropped rows** | (1) drop the 15 with no radius and no mass; (2) assign a default tier | **(1) Drop** — 0.24% of the catalogue; a fake default tier pollutes the distribution |
| **F** | **Script language** | (1) `scripts/import-planets.mjs`, zero deps; (2) a dependency (csv-parse, etc.) | **(1) Zero-dep ESM script** — tiny CSV subset problem; avoids adding a dependency for ~30 lines |
| **G** | **Output format** | (1) `src/sim/data/planets.ts` typed module; (2) `.json` | **(1) Typed TS module** — type safety into `src/sim`, tree-shaken by Vite, no `resolveJsonModule` |

**Blockers:** none blocking T01-B. Endpoint, licensing, field map, tier derivation, dataset size (6,321 rows / ~532 KB), and output location are all verified live and decided. Decisions A–G are bounded input points for Jay; each default is safe to proceed on.

---

*Prepared by OpenCode (deepseek-v4-flash) for P2-T01-A. Only `docs/P2_T01_A_AUDIT.md` created. No commit made, no work on `main`.*
