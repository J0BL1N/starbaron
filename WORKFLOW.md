# StarBaron — WORKFLOW.md (AI loop spec)

The exact operating loop for building StarBaron. Same setup as TradieHubAU: **OpenCode implements → Codex Terra 5.6 Medium audits read-only → Hermes is the bridge**. Never run OpenCode and Codex simultaneously.

## Roles

| Role | Tool | Does | May NOT |
|---|---|---|---|
| **Implementer** | `opencode run --auto --model deepseek/deepseek-v4-flash` | Writes code + tests, runs suites, commits nothing | Invent features, touch restricted files, commit/push |
| **Auditor** | Codex CLI (Terra 5.6 Medium, read-only) | Independently verifies scope, correctness, tests, evidence | Edit anything, run suites (sandbox blocks it) |
| **Bridge** | Hermes (me) | Inspects repo, writes bounded prompts, relays Codex findings verbatim, tracks A–D, reports to Jay | Edit files, take over implementation, commit/push/deploy |

## The loop (per task)

1. **Confirm task** — exact tracker/task from Jay or the roadmap. Read `AGENTS.md`, `ROADMAP.md`, inspect git state (branch, HEAD, status, stash — read-only).
2. **If repo dirty / roadmap mismatch** → STOP, report to Jay. Never "clean up" uncommitted work.
3. **Launch OpenCode** with a bounded prompt: allowed files, restrictions, exact task, required final report format. One subtask at a time.
4. **Collect result** — changed files, test outputs, evidence. OpenCode reports; I relay.
5. **Launch Codex audit** (read-only) on the committed/diffed work. Independent of OpenCode.
6. **PASS** → update evidence + `ROADMAP.md`, commit to `staging` (explicit `git add` paths, conventional message). Push only when Jay authorises.
7. **FAIL** → copy Codex's EXACT findings into a new OpenCode correction prompt (never broaden). Re-run → re-audit. **Max 6 attempts/task** (Jay's budget). After 6th FAIL: STOP, root-cause audit, report to Jay.
8. **Whole phase done** → one full-phase Codex audit → report to Jay. Never auto-start the next phase/task.

## OpenCode invocation

```bash
opencode run --auto --model deepseek/deepseek-v4-flash "<bounded task prompt>"
```

Prompt must contain: exact task · allowed file paths · restrictions ("do NOT touch X, do NOT change Y") · required report format (changed files, commands run, results, SHA, limitations).

**Stall protocol:** a static output preview is NOT proof of a stall (deepseek-v4-flash writes in long stretches). Before killing: `process wait` 60–120s, check `total_lines` grows across two reads, prefer `notify_on_complete=true` and just wait. Only kill when line count is frozen AND well past usual duration. Kill + retry FRESH — never take over implementation.

## Codex audit invocation

```bash
codex exec --sandbox danger-full-access "<read-only audit prompt>"
```

Audit prompt must enumerate the READ LIST (every file the work references — a missing file in the read list is a bridge error, not a doc error), the authorised scope, and expected verification (exact filenames, test coverage by reading, no invented capabilities). Codex sandbox cannot run vitest/Docker — design for static review; OpenCode runs the suites.

## Task structure (A–D)

| Subtask | What it is |
|---|---|
| `-A` | Audit/bound scope: what exists, exclusions, blockers (docs-only) |
| `-B` | Implement the primary bounded change |
| `-C` | Negative-path + regression coverage |
| `-D` | Package evidence + independent Codex audit |

## Git discipline

- Commit/push are separate authorised steps AFTER PASS — never automatic.
- `git add` explicit paths only (never `-A`). Conventional messages.
- NO commits on `main`. Work on `staging` via scoped branches.
- Never `git clean`, `reset`, `stash`, force-push, or broad deletes without explicit authorisation.
- No HEAD SHAs in documents (stable wording only).

## Reporting contract (per task, to Jay)

| Field | Content |
|---|---|
| Task | Phase/task/subtask ID |
| OpenCode work | One line: what it inspected/implemented/tested |
| Codex verdict | PASS / FAIL (findings count) |
| Evidence | Test counts, SHA, files changed |
| Git state | Branch, ahead/behind, working tree, stash |
| Blockers / decisions | Anything needing Jay |

## Hard rules

- Never run OpenCode and Codex simultaneously.
- Never auto-advance to the next task/phase after PASS — wait for Jay.
- Never invent features beyond DESIGN.md.
- Provider actions (Supabase deploy, migration apply, store submission) require explicit Jay authorisation — NEVER automatic.
- Corrections: send only the exact Codex findings. Broadened prompts reintroduce drift.
