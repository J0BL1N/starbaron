TASK (StarBaron PHASE 4 phase audit round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/ui/planet-panel.ts, tests/planet-panel.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS; import canViewLevel or the equivalent level-rank helper from src/sim/ui/info.ts (READ info.ts's export surface first and use the existing helper; if info.ts does not export one, use its LEVEL_RANK pattern — but prefer importing).

CODEX FINDING (fix exactly this):
[planet-panel.ts:169-188] For viewerLevel 'public', ONLY ownership is gated (140-155); the panel still exposes population, structure levels/costs/buildability, production, queue timing, defense power, and activity — while info.ts classifies population/structures/income as owner-only and defense power as intel-only. Fix: gate EVERY section through the info.ts level semantics:
- population {current, cap, growthPerSec}, structures (levels/costs/buildable), production, queues, activity → require 'owner' or above; for lower viewers, omit the section (null) — define the shape with nullable sections (document: PanelSection fields become `X | null` when the viewer level is below the required level; the UI renders '—').
- defenses.defensePower → require 'intel' or above.
- ownership fields → 'owner' or above (already gated — keep).
Add regression tests: public viewer gets null sections (population/structures/production/queues/defense/activity + ownership nulls); alliance viewer same as public (alliance is NOT owner); intel viewer gets defense but NOT owner sections (intel < owner); owner viewer gets everything.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/planet-panel.test.ts --pool threads` all pass (report counts). Report changed lines + results + which test covers which viewer level.
