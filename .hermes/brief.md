# StarBaron — Brief
_Last updated: 2026-08-23_

## Current status
- **ARCHITECTURE RESET (2026-08-23): the main game is `starbaron-main.html`** —
  the single-file three.js zoom-journey app (planet → system → galaxy →
  universe, photo mode R/P/C). Repo root `index.html` is an identical copy so
  `npm run dev` / `npm run build` serve and bundle it directly.
  Canonical editable copy: `C:\Users\jayde\AppData\Local\hermes\previews\starbaron-main.html`.
- **The React UI was DELETED** at Jay's direction ("everything but the starbaron
  main"). PlanetView/useGameState/hud deck/components/save.ts + their tests are
  gone. Do not reference them as existing.
- We BUILD THE GAME UP FROM HERE: new UI/gameplay gets attached to the
  three.js shell in starbaron-main.html (or modules it imports), never by
  resurrecting the React dashboard.
- Kept on purpose ("remember the system"): `src/sim/**` (authoritative sim:
  economy, combat, fleet, structures, catalogue, claim — fully tested) and
  `src/ui/planetgen3d/**` (the engine the main game runs on).

## Decisions
- 2026-08-23: single-file three.js main game; everything else deleted.
- 2026-08: functioning game first; MMO deferred. FULL MODULAR ships approved.
- Locked design canon lives in DESIGN.md + docs/MASTER-ROADMAP.md.

## Open items / next steps
- Re-attach game systems (claim/economy/structures/fleet) onto the three.js
  shell — sim-first, rendered in-world per the original HUD spec
  (universe-as-interface), NOT a React dashboard.
- P8–P11 milestone work after the functioning loop is live.

## Gotchas & conventions
- Skill: `starbaron-dev` (repo ops, planetgen, HUD pitfalls incl. the
  screenshot-lies-about-WebGL and jsdom-canvas crash notes).
- Gates: `npx tsc -b`, `npm run lint`, targeted vitest files only,
  `npm run build`. planetview*/save* tests no longer exist.
- If index.html and previews/starbaron-main.html drift, index.html wins for
  dev/build; re-copy after editing either.
