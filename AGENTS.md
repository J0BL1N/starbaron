# StarBaron — AGENTS.md (contribution guide)

## Source of truth
- `DESIGN.md` is the canonical game design (locked decisions only — do not invent features).
- `ROADMAP.md` is the completion record (which tasks are done + evidence).
- `WORKFLOW.md` is the AI loop (how OpenCode + Codex + Hermes operate).
- Never reset, discard, overwrite, or stash unrelated work. Never commit secrets/env files.

## Repository layout
- `F:\VSC Projects\StarBaron` — primary repo (working copy).
- Private repo by default (Jay makes public later).

## Branch model (matches TradieHubAU discipline)
- `main` — release-ready. NO ordinary phase work directly on it.
- `staging` — the dev/integration base. This is where game work happens.
- Scoped task branches from `staging`; merge back only after Codex PASS.
- Do not push, deploy, tag, or contact a live provider unless explicitly authorised.

## The AI loop (summary — full detail in WORKFLOW.md)
1. Hermes (bridge) inspects repo state, confirms the authorised task.
2. **OpenCode** (`opencode run --auto --model deepseek/deepseek-v4-flash`) implements the bounded task + tests.
3. **Codex Terra 5.6 Medium** (CLI, read-only) audits independently. NEVER run both simultaneously.
4. Codex PASS → evidence + ROADMAP update → commit to `staging` (explicit paths, no `-A`).
5. Codex FAIL → pass exact findings back to OpenCode verbatim → re-audit. Max 6 attempts/task.
6. Whole-phase Codex audit at the end. Push + verify only when Jay authorises.

## Task structure (A–D subtasks, TradieHubAU pattern)
- `-A` audit/bound scope (what exists, exclusions, blockers)
- `-B` implement the primary bounded change
- `-C` negative-path + regression coverage
- `-D` package evidence + independent Codex audit

## Rules for agents
- Hermes (bridge) does NOT edit files or take over implementation — it instructs OpenCode, relays Codex findings, reports to Jay.
- OpenCode: bounded prompts only — allowed files, restrictions, task, required report format. Run tests (`npm test`, `tsc -b`, `npm run build`) and report exact commands/results/SHA.
- Codex: read-only static review (cannot run the test suite in sandbox — verify by reading; OpenCode runs suites).
- No feature invention beyond DESIGN.md. No migration/deploy/push without authorisation.

## Verification
- Every task: focused tests + full suite PASS + `tsc -b` exit 0 + `npm run build` exit 0 (once the web preview exists).
- Report changed files, exact commands/results, final SHA, limitations, remote/push status.
