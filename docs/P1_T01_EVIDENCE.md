# P1-T01 — Scaffold + Sim Core Evidence

*Closeout evidence for **P1-T01 Scaffold** (Phase 1 — Core Idle Engine + Web Preview). Consolidates the subtask record for `-A`/`-B`/`-C`/`-D`. Per WORKFLOW.md, no HEAD SHAs are embedded in prose — SHAs appear only where the record already references them (commit subjects).*

---

## 1. Subtask Record

| Subtask | Scope | Status | Evidence |
|---|---|---|---|
| **-A** | Audit: empty-project/toolchain inventory, Vite+TS+vitest layout decision | Complete | `docs/P1_T01_A_AUDIT.md` (committed 3f1ebe6, "docs: P1-T01-A scaffold audit") |
| **-B** | Scaffold Vite+TS project, vitest config, folder structure, pinned deps | Complete | Scaffold commit fe9c8b4; vitest smoke 5/5 PASS |
| **-C** | Smoke test: dev server starts, vitest runs, build passes | Complete | Sim core 4 modules, 39 tests PASS, `tsc -b` exit 0, `npm run build` exit 0 |
| **-D** | Evidence: SHA, branch state, Codex PASS | Complete | This doc; Codex PASS; committed to `staging` |

---

## 2. Files

```
src/sim/
├── core/
│   ├── economy.ts      # baseline income, cost curves
│   ├── population.ts   # population growth
│   ├── offline.ts      # offline progression calc
│   └── format.ts       # number formatting (K/M/B/T…)
└── structures/         # empty — P1-T03
tests/
├── economy.test.ts
├── population.test.ts
├── offline.test.ts
└── format.test.ts
```

---

## 3. Verification Results

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | **4 files / 39 tests PASS** |
| Typecheck | `tsc -b` | **exit 0** |
| Build | `npm run build` | **exit 0** (tsc -b + vite build) |

---

## 4. Codex Verdicts (per subtask)

| Subtask | Verdict |
|---|---|
| -A | PASS (audit scope/boundaries, toolchain, layout) |
| -B | PASS (scaffold, pinned deps, lockfile, folder structure) |
| -C | PASS (sim core + negative-path/regression coverage) |
| -D | PASS (evidence + closeout) |

---

## 5. Bounded Decisions Taken

| # | Decision | Choice |
|---|---|---|
| 1 | Layout | **Flat root** — no monorepo; docs stay at AGENTS-referenced root |
| 2 | Version policy | **Latest majors** — React 19, Vite 8, vitest 4 (peers verified compatible at -A) |
| 3 | ESLint | **Template default kept** — gates are `tsc -b` + `npm run build` + tests, not lint |
| 4 | `git init` | **Not re-run** — existing `main` + `staging` branches already satisfy the -B row |
| 5 | Lockfile | **Committed** — `package-lock.json` freezes the dependency graph |

---

## 6. Branch / Remote State

- Branch: `staging` (no work on `main`).
- No push, no tag, no deploy — remote unchanged pending authorisation.

---

*Prepared by OpenCode (deepseek-v4-flash) for P1-T01-D. Only ROADMAP.md + this file changed in this subtask.*
