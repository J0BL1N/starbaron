# P1-T01-A — Scaffold Audit Map

*Subtask `-A` for **P1-T01 Scaffold** (Phase 1 — Core Idle Engine + Web Preview). Documentation-only audit. Nothing scaffolded, nothing committed. Per WORKFLOW.md no HEAD SHAs are embedded in docs (stable wording only).*

---

## 1. Toolchain Inventory (verified 2026-08-08)

| Tool | Version | How verified |
|---|---|---|
| Node.js | **v24.13.0** | `node --version` |
| npm | **11.6.2** | `npm --version` |
| git | **2.52.0.windows.1** | `git version` |
| Host OS | **Windows** (MINGW64_NT-10.0-22631, Msys) | `uname -a` |
| Shell | **git-bash** (`/usr/bin/bash.exe`, bash 3.6.5 Msys) | `$SHELL` |
| create-vite | **9.1.2** (latest, verified) | `npm view create-vite version` |
| vitest | **4.1.10** — peer `vite ^6 || ^7 || ^8` OK | `npm view vitest@4.1.10 peerDependencies` |
| @vitejs/plugin-react | **6.0.5** — peer `vite ^8` OK | `npm view @vitejs/plugin-react@6.0.5 peerDependencies` |
| @testing-library/react | **16.3.2** — peer `react ^18 || ^19` OK | `npm view @testing-library/react@16.3.2 peerDependencies` |

**Repo state at audit:** branch `staging`, local branches `main` + `staging`. Tracked tree is clean; the only untracked content is the new `docs/` folder containing this audit (consistent with the docs-only working-tree state). No scaffold exists yet.

---

## 2. Proposed Project Layout (TradieHubAU pattern: React 19 + Vite + TS + vitest)

Flat single-package layout at repo root (no monorepo — excluded, §5). Docs stay where AGENTS.md references them (repo root).

```
StarBaron/
├── docs/                     # this audit + future task docs
├── src/
│   ├── sim/                  # PURE TS engine — zero DOM imports, fully unit-testable
│   │   ├── core/             # P1-T02: generators, cost curves, offline calc, number formatting
│   │   └── structures/       # P1-T03: the 7 structure definitions + per-level effects
│   └── ui/                   # React components (P1-T05)
│       ├── components/       # PlanetView, BuildMenu, ResourceBar, OfflineSummary, modals
│       ├── hooks/            # game tick hook, save/load hook (P1-T06)
│       └── App.tsx           # app shell (moved from template default)
├── tests/                    # vitest suites — mirrors src/sim + src/ui
│   ├── sim/
│   └── ui/
├── public/                   # static assets (favicon etc.)
├── index.html
├── package.json
├── vite.config.ts            # dev server + build
├── vitest.config.ts          # test runner (separate from vite config)
├── tsconfig.json             # solution-style root (references app + node)
├── tsconfig.app.json         # src/ + tests/ typecheck
├── tsconfig.node.json        # vite.config.ts / vitest.config.ts
├── eslint.config.js          # template default (kept)
└── .gitignore                # template default (node_modules, dist)
```

**Engine rule:** `src/sim` never imports React/DOM — it is the vitest-tested pure logic (DESIGN §3 "Simulation: pure TS engine + vitest-tested"). `src/ui` imports `src/sim`, never the reverse.

---

## 3. Exact Scaffold Command Plan (for P1-T01-B)

> **Critical constraint:** `npm create vite@latest .` inside the repo root would hit create-vite's *non-empty directory* interactive prompt (Remove / Ignore / Cancel) — unsafe and non-deterministic for an `--auto` run, and it risks clobbering docs + `.git`. The deterministic path is **scaffold into an empty temp dir → move files into repo root**.

```bash
# All commands from repo root: F:\VSC Projects\StarBaron  (branch: staging)

# 1) Scaffold react-ts template into an empty temp dir (create-vite PINNED to 9.1.2)
TMP=$(mktemp -d)
cd "$TMP"
npm create vite@9.1.2 starbaron-scaffold -- --template react-ts
cd starbaron-scaffold

# 2) Move generated files into repo root (create-vite does NOT git init)
REPO_ROOT="F:/VSC Projects/StarBaron"
mv package.json vite.config.ts tsconfig.json tsconfig.app.json \
   tsconfig.node.json eslint.config.js index.html .gitignore src public \
   "$REPO_ROOT"/
rm -rf "$TMP"

# 3) Install template base deps, then reconcile to the pinned §4 ranges so a
#    future registry change cannot alter the dependency graph
cd "$REPO_ROOT"
npm install
npm install react@^19.2.8 react-dom@^19.2.8
npm install -D vite@^8.2.1 @vitejs/plugin-react@^6.0.5 typescript@^7.0.2

# 4) Add vitest toolchain + TS type defs as dev deps (PINNED — matches §4 verified versions)
npm install -D vitest@^4.1.10 jsdom@^30.0.1 @testing-library/react@^16.3.2 \
                  @testing-library/jest-dom@^7.0.0 @testing-library/user-event@^14.6.3
#    Reconcile @types to the §4 ranges explicitly (do not trust the template's bundled versions):
npm install -D @types/react@^19.2.18 @types/react-dom@^19.2.4

# 5) Restructure into src/sim + src/ui + tests
mkdir -p src/sim src/ui tests
mv src/App.tsx src/App.css src/index.css src/ui/
#    src/main.tsx imports must be updated (old paths no longer resolve):
#      import './index.css'           ->  import './ui/index.css'
#      import App from './App.tsx'    ->  import App from './ui/App.tsx'
#    src/ui/App.tsx's own `import './App.css'` stays relative (co-located) — no change
#    create src/sim/core/ + src/sim/structures/ with .gitkeep (empty at -B)

# 6) vitest.config.ts (separate file, §2) + scripts
#    default environment: node (fast, pure-TS sim suites)
#    UI tests opt into jsdom via per-file docblock:  /* @vitest-environment jsdom */
npm pkg set scripts.test="vitest run" scripts.test:watch="vitest"

# 7) Smoke checks (P1-T01-C scope, run at -B end)
npx vitest run     # trivial sim test passes
npm run dev        # dev server starts (web preview)
npm run build      # tsc -b && vite build — exit 0
```

**Branches/git at -B end:** `package-lock.json` (generated by the first `npm install`) is committed with the scaffold so the dependency graph is frozen. After PASS, `-D` commits to `staging` with explicit `git add` paths (never `-A`). `main` untouched. No push without Jay.

---

## 4. Package.json Dependency List for P1 (each justified)

**dependencies**

| Package | Version (verified) | Justification |
|---|---|---|
| `react` | ^19.2.8 | UI runtime (React 19 — locked platform pattern) |
| `react-dom` | ^19.2.8 | DOM rendering for the web preview |

**devDependencies**

| Package | Version (verified) | Justification |
|---|---|---|
| `vite` | ^8.2.1 | Dev server + build tool (TradieHubAU pattern) |
| `@vitejs/plugin-react` | ^6.0.5 | JSX transform + React Fast Refresh (peer `vite ^8` verified) |
| `typescript` | ^7.0.2 (latest, `npm view typescript version`) | Typecheck via `tsc -b` (AGENTS verification gate) |
| `vitest` | ^4.1.10 | Test runner for the pure-TS sim + UI (peer `vite ^6||^7||^8` verified) |
| `jsdom` | ^30.0.1 | DOM environment for React component tests (P1-T05) |
| `@testing-library/react` | ^16.3.2 | Render/assert React components (peer `react ^19` verified) |
| `@testing-library/jest-dom` | ^7.0.0 | DOM matchers (`toBeInTheDocument`, etc.) |
| `@testing-library/user-event` | ^14.6.3 | Simulate clicks/typing for build-menu + rapid-click tests |
| `@types/react` | ^19.2.18 (latest, `npm view @types/react version`) | TS type definitions (ships with react-ts template) |
| `@types/react-dom` | ^19.2.4 (latest, `npm view @types/react-dom version`) | TS type definitions (ships with react-ts template) |

**RTL needed at -B?** UI tests land in P1-T05, but installing the testing-library set at -B avoids re-tooling mid-phase. Justified as one-time setup.

**Versions note:** latest-major policy (React 19 / Vite 8 / vitest 4) — peer ranges cross-checked today and all compatible. The command plan (§3) pins `create-vite@9.1.2` and every package to the §4 `^` ranges, which fixes the known-good versions but still permits newer compatible releases within each range. The true determinism guarantee is a **committed lockfile**: `package-lock.json` is created by the first `npm install` and must be committed in `-B` so the dependency graph is frozen and future registry changes cannot alter it. If the ecosystem bites mid-phase, fallback is pinning to the template's bundled versions; see blockers.

---

## 5. Exclusions (bounded for P1 / web preview)

| Excluded | Why |
|---|---|
| **Capacitor** | DESIGN §2/§3 — web preview FIRST; mobile wrapper is post-MVP (later phase) |
| **Supabase / backend** | Phase 3 — P1 is local-only; pure TS sim + localStorage save (P1-T06) |
| **PvP / async attacks** | Phase 3 — conquest math, band-together, fortification all later |
| **Monorepo** | Single flat package at repo root |
| **NASA exoplanet catalogue** | Phase 2 — planets in P1 are a single placeholder home planet |
| **`uv`/Python tooling** | ROADMAP P1-T01-A scope mentions `uv` — not in DESIGN's locked TS-everywhere stack; skipped (see blockers C) |
| **ESLint customisation** | Keep template default; AGENTS verification gates are `tsc -b` + `npm run build` + tests, not lint |

---

## 6. Blockers / Decisions for Jay

| # | Decision | Options | My recommendation |
|---|---|---|---|
| **A** | **Layout: flat root vs `web/` subfolder** | (1) Scaffold at repo root alongside docs (this audit assumes it); (2) isolate web code under `web/` for a cleaner Capacitor wrap later | **Flat root** — monorepo excluded, docs stay at AGENTS-referenced root, Capacitor adds `ios/`+`android/` at root fine later. Choose this unless Jay wants isolation now |
| **B** | **Version policy** | (1) Latest majors (React 19, Vite 8, vitest 4 — peers verified compatible today); (2) conservative pins (React 18 / Vite 5) for battle-tested stability | **Latest majors** — verified peer compatibility, and P1 is greenfield so upgrade cost is zero now, real later |
| **C** | **`uv` in ROADMAP P1-T01-A scope** | Keep the `uv` version check (some other repo's copy-paste?) or drop it | **Drop** — TS-everywhere stack has no Python; node/npm/git verified above. Confirm so ROADMAP wording can be cleaned at closeout |
| **D** | **Test location** | ROADMAP P1-T01-B scope locks a top-level `tests/` folder; co-located `*.test.ts` is the alternative | **Follow ROADMAP: `tests/`** — mirroring `src/sim` + `src/ui`. Co-location reconsidered only if Jay prefers it |
| **E** | **vitest config file** | Separate `vitest.config.ts` vs `test` block merged into `vite.config.ts` | **Separate** — matches the requested config-file list; default `node` env with per-file `jsdom` docblocks for UI tests |
| **F** | **Repo already initialised — no `git init`** | ROADMAP.md:20's `-B` row calls for "git init + main/staging branches", but this repo is already initialised and on `staging` at the supplied HEAD. (1) Re-run `git init` anyway; (2) skip `git init` — the existing `main` + `staging` branches already satisfy the requirement | **Skip `git init`** — treat the existing branches as meeting ROADMAP.md:20; `-B` opens a scoped task branch from `staging` per WORKFLOW.md and never re-runs `git init`. Confirm so ROADMAP wording can be adjusted at closeout |

---

*Prepared by OpenCode (deepseek-v4-flash) for P1-T01-A. No files outside `docs/P1_T01_A_AUDIT.md` created/modified. No commit made — awaiting Jay's decision + Hermes launch of P1-T01-B.*
