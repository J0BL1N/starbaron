# STARBARON — MASTER GAME VISION

> **Canonical high-level design reference for AI agents and developers.**
> The repository is the authority on what currently exists; this document is
> the authority on where the project is supposed to go. Never silently
> redefine canon because the prototype does something differently — document
> mismatches instead.
>
> Generated 2026-08-24 from the master vision brief (Hermes session) +
> repository inspection at HEAD `add4518`.

---

## 1. WHAT STARBARON IS

**StarBaron is a persistent, extremely long-term 4X MMO strategy game played
across a vast astronomical universe.**

Core fantasy:

> Start with one world in an enormous living universe, develop it over time,
> discover what exists beyond it, build an interplanetary civilisation,
> encounter other players, fight over worlds and resources, and eventually
> establish an empire across the stars.

Combines: persistent MMO strategy · idle/offline progression · 4X gameplay ·
planetary development · astronomical exploration · scouting · fleets ·
conquest · diplomacy · alliances · trading · research · empire building ·
asynchronous PvP · persistent player ownership · continuous universe
navigation.

The player should feel like they are operating an actual interstellar
civilisation rather than playing a collection of disconnected menu screens.

## 2. THE MAIN VISION — THE UNIVERSE SHOWCASE

### THE UNIVERSE ITSELF IS THE MAIN INTERFACE.

StarBaron should NOT feel like: menus with space behind them · a dashboard
with a planet widget · a spreadsheet with a galaxy skin · a conventional
mobile city builder · a collection of isolated screens.

> **The Universe Showcase is the game.**

Players spend most of their time looking directly at planets, moons, stars,
systems and eventually enormous sections of the universe. The astronomical
scene remains visible whenever practical. Information appears **around** the
universe, rather than replacing it. The player should feel like they are
navigating a vast piece of astronomical command software.

## 3. UNIVERSE NAVIGATION

Continuous hierarchy:

```text
Moon / asteroid
      ↓
Planet
      ↓
Star
      ↓
Solar system
      ↓
Local stellar region
      ↓
Galaxy
      ↓
Intergalactic space
      ↓
Vast universe
```

Zooming between scales feels like **one continuous journey**. Avoid scene
changes, loading-screen transitions, hard camera cuts, disconnected map
modes. The camera experience is cinematic, extremely fluid, with smooth
acceleration/deceleration, seamless zooming, overlapping LOD transitions, no
obvious object popping, no abrupt handoffs, visually continuous. Where
mathematically practical, movement should feel **C2-continuous** rather than
simple linear lerps. The player should feel as though the camera physically
travels through the universe.

## 4. ASTRONOMICAL FOUNDATION

Inspired by the structure and scale of the real universe — but NOT a strict
NASA simulator. Goal: **believable astronomy + beautiful procedural
presentation + gameplay.** Use real concepts where appropriate (planets,
moons, stars, orbital systems, stellar/planetary classifications, orbital
periods, temperature, gravity, size, system composition, galaxies, distances)
but visual beauty and gameplay readability take priority over absolute
scientific realism. Aesthetic: **tastefully stylised realism.**

## 5. PROCEDURAL UNIVERSE

The universe is far too large to store or render conventionally. Approach:
**deterministic procedural generation + persistent authoritative state.**

```text
UNIVERSE SEED → Galaxy generation → Stellar regions → Star systems → Stars
→ Planets → Moons / asteroids / objects
```

Generated content is deterministic (same seed/coordinates reproduce the same
universe). Persistent player modifications layer on top: ownership, colonies,
buildings, stations, fleets, damage, discovered information, wars, trade,
diplomacy, player history.

## 6. EACH PLAYER'S BEGINNING

Each player begins with their own unique astronomical/exoplanet-style **home
world** within the shared universe.

### LOCKED RULE — HOME WORLD IMMUNITY

**A player's original home world can NEVER be permanently conquered away from
them.** Players may lose colonies, fleets, resources, conquered planets,
strategic positions, wars — but the original home world remains theirs.
Prevents complete account destruction while keeping conquest of everything
else extremely high stakes.

## 7. THE EMPIRE LOOP

```text
Observe → Develop home world → Generate resources → Research technology →
Scout nearby space → Discover worlds and players → Build fleets →
Colonise / conquer → Develop additional worlds → Trade / negotiate / form
alliances → Fight larger wars → Expand further into the universe
```

## 8. 4X FOUNDATION

- **EXPLORE** — moons, planets, stars, systems, resources, anomalies,
  strategic locations, other civilisations, player empires. Information has
  value; unknown space genuinely feels unknown.
- **EXPAND** — colonies, conquered planets, moons, orbital stations, mining
  locations, strategic systems, frontier territory.
- **EXPLOIT** — population, resource extraction, energy, production,
  construction, planetary infrastructure, logistics, research, trade,
  specialised worlds.
- **EXTERMINATE** — raids, fleet engagements, planetary attacks, system
  wars, alliance wars, territorial conquest. Combat is meaningful because
  territorial loss is real.

## 9. POPULATION IS IMPORTANT

### LOCKED DESIGN

**Population is effectively part of the currency of war.** Military campaigns
cost lives: attacking consumes population, defending can consume population,
major wars cause severe demographic damage. Population regenerates slowly. A
careless empire may win territory while severely damaging its ability to
continue fighting. Creates attrition, strategic restraint, meaningful
casualties, recovery periods, long wars, high-stakes decisions. **War must
never feel completely free.**

## 10. CONQUEST

Other planets can be conquered — eventually an entire developed planet from
another player. Requires substantial effort; cost escalates with planetary
strength, defences, population, infrastructure, defending fleets, attacking
distance, logistics, attacker strength, technology, reinforcement capability.
Capturing an advanced world is one of the most consequential actions in the
game. **Home planets are protected from permanent conquest; everything else
may eventually be at risk.**

## 11. ASYNCHRONOUS MMO

Not dependent on everyone being online simultaneously. The world continues
while players are offline: construction, research, fleet movement, resource
extraction, population growth, trade, scouting, attack/defence, events —
all without constant active sessions.

## 12. TIME-BASED SIMULATION

The universe is NOT a giant continuously-simulated real-time process. The
architectural backbone is:

> **Persistent authoritative state + timestamp/event-driven simulation +
> viewport-driven reconstruction.**

Instead of updating a mine every second:

```text
last_updated_at = T1
production_rate = X
elapsed = current_time - last_updated_at
produced = elapsed × production_rate
```

Apply the same philosophy to: resource production, construction, research,
population, fleet movement, orbital positions, trade, recovery, events. This
is critical for scalability.

## 13. ORBITS

Planets and moons appear to orbit continuously WITHOUT per-frame database
writes. Orbital states reconstruct from orbital parameters + epoch +
elapsed time:

```text
orbital position = orbital function(current timestamp)
```

The frontend reconstructs the current position visually — an apparently
living universe without simulating every celestial body server-side.

## 14. VIEWPORT-DRIVEN RECONSTRUCTION

Only the portion of the universe relevant to the player receives heavy
rendering/simulation work:

```text
Entire universe → Relevant region → Visible systems → Visible objects →
Current LOD
```

Never render the entire universe simultaneously. Use regional loading,
deterministic reconstruction, LOD, culling, streaming, simplified distant
representations, instancing, asynchronous loading. The visual illusion is
enormous; the actual computational workload remains bounded.

## 15. LEVELS OF DETAIL

LOD is fundamental. Conceptual hierarchy:

```text
Universe scale  → points / density fields
Galaxy scale    → galaxy forms / major regions
Regional scale  → star fields
System scale    → stars + planetary orbit representations
Planetary scale → detailed planets / moons
Close scale     → highest visual detail / structures / atmosphere
```

Transitions overlap enough that the player never notices the handoff.

## 16. PLANETS ARE THE HERO ASSET

Planets must be beautiful — not icons, not simple coloured spheres. A player
should enjoy looking at a planet even when doing nothing else. Variation:
terrestrial, ocean, desert, frozen, volcanic, toxic, barren worlds, gas
giants, unusual worlds, moons, rings, atmospheres, storms, cloud systems,
city lights, artificial structures. Procedural generation creates strong
visual variation without looking random or incoherent.

## 17. VISUAL IDENTITY

Cinematic · dark · premium · elegant · astronomical · futuristic · minimal ·
mysterious · beautiful · highly polished. Primary tones: deep navy, black,
blue, cyan, teal, silver, restrained white light. Nebulae may add natural
colour. Avoid: everything-neon, excessive glowing borders, generic "sci-fi
HUD everywhere". **The universe remains visually dominant.**

## 18. UI PHILOSOPHY

UI resembles elegant astronomical telemetry / futuristic command software,
existing **on top of** the universe, not instead of it. Planets carry thin
information boxes attached with subtle connector lines:

```text
         ┌────────────────────┐
         │ KALDORA PRIME      │
         │ TERRAN WORLD       │
         │ POP     8.4B       │
         │ OUTPUT  +42.8K/h   │
         │ STATUS  STABLE     │
         └───────────┬────────┘
                     │
                  ◉ PLANET
```

Panels float near the object, stay thin, restrained typography, useful
information, never hide the planet, scale with camera distance, simplify or
disappear when inappropriate. The astronomical body remains the focus.

## 19. BOTTOM COMMAND INTERFACE

Empire-level information and actions live in a separate command area toward
the bottom of the screen:

```text
┌─────────────────────────────────────────────────────────────┐
│ Empire │ Resources │ Research │ Fleets │ Diplomacy │ Intel │
│ contextual information / selected object / commands         │
└─────────────────────────────────────────────────────────────┘
```

Adapts to current zoom, selected object, game mode, alerts, fleet activity,
empire state. Prevents the central universe viewport from becoming overloaded.

## 20. MAIN MENU

Establishes the visual identity: wallpaper feels like entering an enormous
living universe — one major hero planet, possibly distant moons/worlds,
stars, restrained nebulae, strong astronomical scale, cinematic lighting.
Preserves negative/dark space for: STARBARON logo, Continue, New Game /
Enter Universe, Settings, Account, Exit. Do NOT cover the wallpaper with
informational panels; detailed telemetry belongs inside the universe
experience.

## 21. PACING

Intentionally a **slow game** — but slow because interstellar civilisation
should feel consequential, NOT because the UI performs badly:

| GOOD SLOW | BAD SLOW |
|---|---|
| Long-term strategy | Input lag |
| Meaningful construction/travel | Janky camera movement |
| Slow population recovery | Delayed buttons |
| Long research | Low FPS |
| Large strategic decisions | Blocking requests |
| Persistent empires | Slow page transitions / unresponsive controls |

Gameplay can span hours, days, weeks, months. **The interface must still
feel immediate and responsive.**

## 22. PERFORMANCE IS A FIRST-CLASS SYSTEM

The existing prototype has previously felt extremely slow, sluggish,
unresponsive — NOT part of the intended experience. Before dramatically
expanding the game, investigate: excessive React rerenders, expensive
Three.js work, unnecessary procedural regeneration, blocking loops,
excessive object creation, unnecessary geometry rebuilds, too many draw
calls, database requests in rendering paths, synchronous heavy computation,
camera update problems, memory leaks, uncontrolled effects/hooks, large
texture usage, missing LOD/culling, inefficient event listeners, expensive
state subscriptions.

## 24. FLEETS

Persistent fleets with: owner, composition, location, origin, destination,
departure/arrival timestamps, mission, combat capability, cargo,
population/troops. Movement uses **timestamp-driven travel**, not continuous
server-side positional updates — the client reconstructs intermediate
movement visually:

```text
departure = T1   arrival = T2   origin = A   target = B
```

## 25. SCOUTING AND INTELLIGENCE

Players do not automatically know everything. Information states:

```text
UNKNOWN → DETECTED → SCANNED → SURVEYED → KNOWN → OWNED
```

Different intel levels expose different information; scouting is
strategically useful; intel may decay or become outdated.

## 26. DIPLOMACY

Player relationships: alliances, treaties, trade agreements, neutrality,
rivalry, wars, shared intelligence, coordinated military actions.
Alliance-scale gameplay becomes important later in progression.

## 27. TRADING AND ECONOMY

Resources tradable: player-to-player trade, market orders, alliance trade,
transport/logistics, resource scarcity, regional economics, specialised
worlds, strategic resources. Economic strength can become as important as
military strength.

## 28. RESEARCH

Technology provides long-term progression: economy, resource production,
population, ships, weapons, defence, sensors, travel, colonisation, planetary
development, logistics, diplomacy, specialised infrastructure. Uses
prerequisites, timers, branching choices, empire specialisation. **Avoid
making every empire automatically identical.**

## 29. NO PRESTIGE RESET

### LOCKED DESIGN

No traditional `build → reset → multiplier → rebuild` core loop. Players
become attached to worlds, history, territory, empire, alliances,
achievements. **Persistent history matters.**

## 30. ANTI-SNOWBALLING

Runaway leaders controlled through systems, not arbitrary resets: logistics,
distance penalties, administrative overhead, defence requirements,
population constraints, war attrition, recovery time, frontier vulnerability,
alliance resistance, diminishing efficiency, strategic overextension. Do not
implement arbitrary anti-snowball systems without understanding their
systemic effects.

## 31. HISTORY

The universe develops persistent history: who discovered a world, original
owner, colonisation, conquest, wars, previous owners, major battles,
destruction, alliances, unusual events, empire milestones. A planet owned
for two years should feel different from a disposable level.

## 32. PLAYER EXPERIENCE TARGET

The player should sometimes zoom around space simply because it looks
beautiful: inspect another player's world, watch planets orbit, look at
distant systems, observe their empire, discover something unexpected. The
universe itself should be enjoyable to observe. Moments where **nothing
needs to happen immediately.**

## 33. SCALE

Design for extremely large eventual numbers of astronomical bodies, players,
planets, fleets, structures, events. Do NOT architect foundational systems
around hundreds-of-objects assumptions. BUT: do not prematurely build massive
distributed infrastructure. **Design scalable boundaries first; scale
infrastructure progressively.**

## 34. CURRENT / INTENDED TECHNOLOGY DIRECTION

Web-first stack: TypeScript · Vite · Three.js / WebGL · Supabase · PostgreSQL
· Cloudflare. Mobile via Capacitor. Do not replace major technologies
casually — any architectural replacement needs a concrete technical reason.

## 35. SERVER AUTHORITY

Anything economically or competitively important must be server-authoritative.
Never trust the browser for permanent values: resources, ownership, combat
results, research/construction completion, fleet arrival, purchases,
population, conquest, premium currency, inventory. The client may predict and
reconstruct visuals; **the server/database owns truth.**

## 36. MONETISATION DIRECTION

Free-to-play; potential advertising and in-app purchases. **NO pay-to-win** —
monetisation must not destroy the strategic legitimacy of the universe.
Subject to future detailed design.

## 37. AGENT DEVELOPMENT WORKFLOW

```text
Hermes orchestrates/plans/delegates → OpenCode/DeepSeek implements →
Codex independently audits → FAIL: return for correction → PASS: phase accepted
```

Specialist agents may assist with procedural generation, modelling, visuals,
image assets. **No agent should blindly rewrite systems simply because it
prefers another architecture.**

## 38. DEVELOPMENT PHILOSOPHY

Build interconnected systems, not isolated demos. Every major system has
clearly understood relationships (e.g. POPULATION → economy, construction,
military, colonisation, defence, recovery; PLANET → owner, population,
resources, structures, orbit, defence, fleets, trade, history; FLEET →
owner, ships, population, fuel, location, movement, combat, orders). When
implementing a feature always ask: *What systems does this feature read
from, modify, trigger or depend upon?*

## 39. TARGET ROADMAP

```text
PHASE 01 — Universe foundation            (✅ P1 complete, phase audit blocked r6)
PHASE 02 — Players + home worlds          (✅ complete incl. phase audit)
PHASE 03 — Economy + planetary structures (✅ complete incl. phase audit)
PHASE 04 — Core universe UI               (✅ tasks complete, phase audit blocked r6)
PHASE 05 — Fleets + travel                (✅ complete incl. phase audit)
PHASE 06 — Scouting + intelligence        (✅ tasks complete, phase audit blocked r6)
PHASE 07 — Combat + conquest              (✅ tasks complete, phase audit blocked r6)
PHASE 08 — Diplomacy + alliances          (⬜ not started)
PHASE 09 — Trading + larger economy       (⬜ not started)
PHASE 10 — Persistent MMO hardening       (⬜ not started — MMO DEFERRED per Jay)
PHASE 11 — Full 4X progression            (⬜ not started)
PHASE 12 — Visual polish + release + mobile + scale (⬜ not started)
```

Dependency-oriented; visual quality does NOT wait for Phase 12 — visual
experimentation happens earlier (it already has).

## 40. THE END-STATE

Opening StarBaron years into its life: the player zooms outward from a
developed planet. Cities glow across the night side; orbital infrastructure
surrounds it; moons move naturally. The camera continues outward: several
owned planets appear, fleet markers travel between worlds. The camera leaves
the system; nearby stars appear — some allied, some hostile. Trade routes
cross the region; an unexplored system lies beyond the frontier. Farther
outward, the player's empire becomes a tiny region inside a galaxy containing
thousands of civilisations. And the camera can continue outward.

**That feeling is StarBaron.** Less like navigating menus in a strategy game;
more like **being given command of a civilisation inside a living universe.**

---

# CURRENT IMPLEMENTATION STATUS

> Repository inspected at HEAD `add4518` (2026-08-24). Status key:
> IMPLEMENTED · PARTIAL · BROKEN · PLACEHOLDER · NOT IMPLEMENTED · UNKNOWN.
> The React UI was deleted by commit `add4518`; the live game is now the
> single-file three.js app `starbaron-main.html` (repo copy: `index.html`).

| System | Status | Evidence / notes |
|---|---|---|
| **Single-file universe showcase game** | IMPLEMENTED | `starbaron-main.html` / `index.html` (3,010 lines, self-contained three.js): seeded PRNG (fnv1a/rngFrom mirror), galaxy disk + distant-galaxy textures, galaxy entity (one group), HD starfield (3 parallax shader shells), universe entity (~20 named galaxies), solar system (moons, asteroid field, rings, orbits), 36-system registry, velocity-momentum zoom glide, galaxy travel leg machine, planet/star body focus, system travel, photo mode (R/P/C, bloom+ACES, capture at up to 4K+SS), main menu overlay (working tree: STARBARON logo, New Game, Photo Mode, ESC) |
| **Continuous zoom journey** (planet→system→galaxy→universe) | IMPLEMENTED | Zoom spline `zoomDist(z, d0)` with log-space Catmull-Rom anchors `[3.4, 62, 420, 4200, 42000, 420000]`; momentum glide (`zoomVel`, `inputVel`); overlapping fades; LOD per level. No abrupt handoffs |
| **Orbital motion** | IMPLEMENTED (visual) | `advanceOrbits(group, dt)` — accelerated game-time orbital motion; moons as planet children; small-body LOD. NOTE: this is the showcase's visual simulator, NOT the sim's timestamp-based reconstruction |
| **Timestamp/event simulation** (offline progression) | IMPLEMENTED (sim) | `src/sim/core/offline.ts`, `offline-model.ts` (locked 8h bank), `population-model.ts`, `transactions.ts`, `accrual.ts`, `estimator.ts` — pure TS, vitest-tested (P3 ✅) |
| **Procedural universe foundation** (identity/data models) | IMPLEMENTED (sim) | `src/sim/world/` — identity (branded GalaxyId/SystemId/BodyId), galaxy/system/body models, real astronomy catalogue (6,321 rows → 4,746 systems), deterministic reconstruction, world-state API (P1 tasks, phase audit blocked) |
| **Real astronomy integration** | IMPLEMENTED | `src/sim/world/catalogue.ts` + `src/sim/data/planets.ts` (6,321 NASA exoplanets, byte-strict drift gate, pinned CSV in scripts/data/) |
| **Home-world assignment / claim** | IMPLEMENTED | `src/sim/player/claim.ts`, `assignment.ts`, `onboarding.ts`, `ownership.ts`, `protection.ts`, `territory.ts`, `transfer.ts`, `colonisation.ts` (P2 ✅ incl. phase audit) |
| **Home-world immunity (locked rule)** | IMPLEMENTED | `src/sim/combat/home-immunity.ts` (26 tests) + write-only SQL `0019_home_immunity.sql` — launch + conquest guards |
| **Economy & structures** | IMPLEMENTED (sim) | `src/sim/core/` (transactions, alloys, ledger, economy, population), `src/sim/structures/` (framework, housing, production, queues, effects, data) + `src/sim/balance/harness.ts` (P3 ✅ incl. phase audit; tier-1 stall balance finding surfaced) |
| **UI contracts (sim-side)** | IMPLEMENTED (sim, unused by live game) | `src/sim/ui/` — hud, hover, info, planet-panel, system-overview, empire-overview, notifications, layout, data-sources, fleet-panel, hover-intel, attack-notifications (P4 ✅ tasks, phase audit blocked). These are data contracts/adapters — the deleted React UI consumed them; the new three.js shell does NOT yet |
| **Fleets & travel** | IMPLEMENTED (sim) | `src/sim/fleet/` — ships (5-class locked roster), shipyard, fleet, movement, positioning, render-state, orders, routes, persistence (P5 ✅ incl. phase audit; SQL `0017_fleets.sql` write-only) |
| **Fleet rendering in universe** | NOT IMPLEMENTED | `src/sim/fleet/render-state.ts` exists (LOD apportionment, labels) but nothing renders fleets in the three.js game — no fleet meshes/markers in `starbaron-main.html` |
| **Scouting / intelligence** | IMPLEMENTED (sim) | `src/sim/intel/` — permissions, levels, scouts, missions, reports, staleness, pvp-gate, store, sensors + `src/sim/ui/hover-intel.ts` (P6 ✅ tasks, phase audit blocked; SQL `0018_intel.sql` write-only). No in-game intel UI yet |
| **Combat & conquest** | IMPLEMENTED (sim) | `src/sim/combat/` — attack-orders, invasion, resolution, defense, casualties, conquest-cost, capture, home-immunity, combat-reports, sim-harness (P7 ✅ tasks, phase audit blocked). No combat UI/flow in live game |
| **Diplomacy / alliances** | NOT IMPLEMENTED | P8 all tasks ⬜ |
| **Trading / galactic economy** | NOT IMPLEMENTED | P9 all tasks ⬜ |
| **Async PvP / MMO** | PLACEHOLDER→NOT IMPLEMENTED | `src/backend/api.ts` (277 lines) + `src/backend/supabase.ts` (54) + `src/boundary/id.ts` (20) exist as thin API client; Supabase migrations 0001–0012 applied, 0013–0019 **WRITE-ONLY pending Jay authorisation**; no auth UI, no multiplayer loop wired to the game. MMO deferred by design (Path B) |
| **Server authority** | PARTIAL | Supabase RLS + write-only migrations define the intended authority boundary; live game is 100% client-side (no persistence) |
| **Persistence / save** | NOT IMPLEMENTED (live game) | `save.ts` deleted with React UI; the three.js game has no save/load — every refresh is a fresh universe. Sim-side persistence contracts exist (fleet persistence, store) |
| **Main menu** | IMPLEMENTED (working tree, uncommitted) | `#menu` overlay: STARBARON logo, kicker, New Game / Photo Mode buttons, ESC toggle — matches vision §20 (still minimal; no Settings/Account/Continue) |
| **Photo mode** | IMPLEMENTED | R/P/C + panel: resolution (1080p/1440p/4K/window), supersample 1×/2×/4×, clean view, bloom (str 0.12 / radius 0.35 / thresh 1.0), tone map (None/ACES/Reinhard), capture PNG; preserveDrawingBuffer: true; calibrated against "bloom far too strong" finding |
| **Telemetry boxes / command deck (HUD)** | NOT IMPLEMENTED (deleted) | The 2026-08 HUD slice (PlanetTelemetryLayer + CommandDeck in React) was deleted with the React UI. Vision §18/§19 unimplemented in the current game |
| **Mobile (Capacitor)** | NOT IMPLEMENTED | Planned; deferred (P12) |
| **Monetisation** | NOT IMPLEMENTED | Undesigned beyond F2P + no-pay-to-win direction |

---

# CURRENT ARCHITECTURE

```text
┌─────────────────────────────────────────────────────────────┐
│  LIVE GAME (entry)                                           │
│  index.html == starbaron-main.html (3,010 lines)             │
│  self-contained three.js app, CDN importmap (three 0.185)    │
│  No build step for game logic; served by Vite (dev/build)    │
│  Systems: seeded PRNG → galaxy/universe/starfield/systems    │
│  → zoom journey → photo mode → main menu                     │
├─────────────────────────────────────────────────────────────┤
│  ENGINE (kept, authoritative for visuals)                    │
│  src/ui/planetgen3d/ — galaxy.ts, hosts.ts, orbits.ts,       │
│  random.ts, render.ts, spectral.ts, system.ts, textures.ts   │
│  NOTE: the single-file game is a PORT of this engine (its     │
│  textures/LOD/zoom logic mirror these modules); render.ts     │
│  previously drove the React HUD and is currently NOT wired    │
│  into the live game                                          │
├─────────────────────────────────────────────────────────────┤
│  SIM (kept, authoritative for rules) — pure TS, zero DOM      │
│  src/sim/ — world/ (identity·galaxy·system·body·catalogue·    │
│  reconstruct·api) · player/ (claim·ownership·territory·       │
│  colonisation·transfer·onboarding·protection·accrual·         │
│  estimator·wallet·grid·assignment·profile) · core/ (ledger·   │
│  transactions·alloys·economy·population·offline) ·            │
│  structures/ (framework·housing·production·queues·effects) ·  │
│  fleet/ (ships·shipyard·fleet·movement·positioning·orders·    │
│  routes·persistence·render-state) · intel/ (levels·scouts·    │
│  missions·reports·staleness·permissions·pvp-gate·store·       │
│  sensors·server-gate) · combat/ (attack-orders·invasion·      │
│  resolution·defense·casualties·conquest-cost·capture·         │
│  home-immunity·combat-reports·sim-harness) · ui/ (data        │
│  contracts for the deleted UI — kept for reuse) ·             │
│  balance/ (economy harness) · data/ (6,321-row catalogue)     │
├─────────────────────────────────────────────────────────────┤
│  BACKEND (thin, aspirational)                                 │
│  src/backend/api.ts + supabase.ts · src/boundary/id.ts        │
│  supabase/migrations 0001–0012 APPLIED; 0013–0019 WRITE-ONLY  │
│  RLS-secured world/ownership/fleet/intel/home-immunity schema  │
└─────────────────────────────────────────────────────────────┘
```

Key relationships:
- **Sim is the brain** (pure, tested, authoritative); the **game shell is the
  face** (visual, currently disconnected from the sim).
- The deleted React UI was the ONLY consumer of `src/sim/ui/*` contracts and
  `save.ts` persistence. Rebuilding the UI layer (in the three.js shell) will
  reconnect sim → game.
- 91 test files / ~2,900+ tests (sim-heavy, node env); `sim-purity.test.ts`
  enforces no DOM/globals in `src/sim`.

---

# CURRENT PERFORMANCE RISKS

| # | Risk | Where | Severity |
|---|---|---|---|
| 1 | **Single-file monolith** — 3,010-line inline script; all logic (galaxy textures, systems, photo mode, menu) in one global scope | starbaron-main.html | MED (maintainability first, perf second) |
| 2 | **preserveDrawingBuffer: true always on** | renderer creation (line ~199) | LOW — costs some compositing efficiency on every frame; only needed for capture |
| 3 | **Canvas texture generation on main thread** (galaxy disk 1024–2048px, distant galaxies, planet surfaces) at boot + per system build | buildGalaxyDiskTexture, buildDistantGalaxyTexture, buildSolarSystem | MED — one-time hitches on zoom/entry; mitigable with async/cache |
| 4 | **No instancing for stars/planets layers at galaxy zoom** — points used for starfield (good); planet layer is a Points entity (good); verify no per-object draw-call growth at system scale | buildPlanets, buildSystemsRegistry | LOW–MED |
| 5 | **Orbit updates every frame for every body** (group.position writes + matrix updates) — fine for ≤36 systems but must not scale unbounded | advanceOrbits | LOW now / HIGH at scale (vision §14/§15: cull to viewport, LOD by distance) |
| 6 | **No frame-budgeting / no DPR cap validation** — DPR capped at 2 (good); no explicit LOD-by-fps or quality ladder yet | renderer.setPixelRatio | LOW |
| 7 | **Old React-era performance lessons must be preserved** — the historic sluggishness (1s-tick scene rebuilds, per-frame Kepler asteroid solves, StrictMode orphaned renderers, frozen clock.elapsedTime) was fixed in the deleted React path; the ported single-file game inherits the *fixed* patterns (momentum zoom, one-entity-per-level, static locators) but there is no test coverage guarding them now | starbaron-main.html vs old render.ts | MED — regression risk |
| 8 | **Sim ↔ game integration (when it lands) must not tick the render loop** — useGameState's 1s interval pattern was deleted; a new bridge must keep timestamps/events out of rAF | future integration | HIGH (design constraint) |

---

# IMPORTANT TECHNICAL DEBT

1. **The React UI was deleted but its contracts live on.** `src/sim/ui/*`
   (14 modules) defines HUD/hover/panel/notifications contracts with zero
   consumers. Either re-wire them into the three.js shell or delete them.
2. **index.html == starbaron-main.html duplication** (two 3,010-line copies;
   plus the canonical copy in hermes previews). Three copies of the same
   file, hand-synced. Any edit must be re-copied (brief: "if index.html and
   previews/starbaron-main.html drift, index.html wins for dev/build;
   re-copy after editing either"). Long-term: extract shared modules.
3. **Uncommitted working tree** — the main-menu overlay (+92 lines) is NOT in
   commit `add4518`; `git status` shows `M index.html` + `M starbaron-main.html`.
4. **Sim never touches the live game yet** — the entire tested rule layer
   (claim, economy, fleets, intel, combat) is unreachable from the game.
   This is the core gap.
5. **Supabase 0013–0019 write-only** — world schema, home protection,
   ownership audit, canonical ownership, fleets, intel, home immunity are
   designed + SQL-tested but never applied. Server authority (§35) is
   aspirational until they are.
6. **`test-output.log` committed at repo root** — stray artifact.
7. **`src/ui/planetgen3d/render.ts` is now orphaned** — the single-file game
   is a *port* of its patterns, but render.ts itself isn't imported anywhere
   (the React HUD that used it was deleted). Two parallel implementations of
   the same visuals = drift risk (they already differ: telemetry hooks exist
   in render.ts, not in the game).
8. **Docs still reference the old React era** — `docs/SYSTEM-REFERENCE.md`,
   `docs/MASTER-ROADMAP.md`, `ROADMAP.md` describe PlanetView/React UI that
   no longer exists; `ROADMAP-STATUS.md` is the live tracker (accurate).

---

# LOCKED DESIGN DECISIONS

- StarBaron is a persistent 4X MMO strategy game.
- The universe itself is the primary interface (**Universe Showcase is the game**).
- Players begin with a personal home world.
- **The original home world cannot permanently be conquered** (home immunity).
- Other worlds can eventually be conquered; conquest cost escalates.
- **Population is part of the cost/currency of warfare**; population regenerates slowly; war has meaningful attrition.
- The world progresses while players are offline (timestamp/event simulation).
- **No traditional prestige-reset core loop**; persistent history matters.
- Astronomy forms the procedural/world foundation (deterministic, seeded).
- Universe navigation is continuous; camera movement cinematic and extremely smooth (C2-continuous where practical).
- Planets are major visual hero assets (procedural, deterministic).
- UI floats around the universe rather than replacing it; telemetry boxes thin and restrained; empire-level controls live in a bottom command interface.
- Gameplay may be deliberately slow; UI/rendering/input must NOT feel slow (performance is first-class).
- Server-authoritative state for important systems; never trust the browser for permanent values.
- LOD and viewport-driven reconstruction are foundational.
- Design for enormous eventual scale; scale infrastructure progressively.
- No pay-to-win monetisation.
- (2026-08-23) The single-file three.js main game is THE main game; the React UI is dead; new UI attaches to the three.js shell.
- (2026-08-13) FULL MODULAR SHIPS approved (design brief exists) but not implemented — queued.

---

# OPEN DESIGN QUESTIONS

- Exact zoom→UI coupling: when does the bottom command deck appear / what tabs (Empire/Resources/Research/Fleets/Diplomacy/Intel) exist first?
- Save/account model for the current client-side game: localStorage first? Supabase auth when?
- How the sim's real-exoplanet catalogue (6,321 NASA bodies) merges with the showcase's fictional seeded systems (Aurora/Vespera/… + HD-564) — canon mismatch to resolve (see below).
- Fleet visualization style (markers vs meshes) — mesh art deferred to P12/Kimi K3 per roadmap.
- Research tree specifics; diplomatic state machine details; market pricing model (all P8/P9, currently undefined).
- Monetisation mechanics beyond "no pay-to-win" (P10+).
- Whether to re-wire or delete `src/sim/ui/*` contracts.

---

# IMPLEMENTATION / CANON MISMATCH

| # | Canon (vision) | Implementation (repo) | Notes |
|---|---|---|---|
| 1 | **Universe uses real astronomical foundation** (§4) — real stars, real exoplanets | Showcase game uses **fictional seeded systems** (`SYSTEM_NAMES`: Aurora, Vespera, Caldera…; galaxy seed "HD-564") | The SIM has the real 6,321-exoplanet catalogue + world models; the GAME shows procedural fiction. Bridge them: game systems should render real catalogue bodies (sim `world/catalogue.ts`) with procedural dressing |
| 2 | **Player home world** (§6) — each player gets a unique real planet | Live game has a generic seeded home system; no player identity, no claim flow wired | Sim has full claim/assignment/onboarding; game ignores it |
| 3 | **Population as war currency, conquest, fleets, intel** (§9/§10/§24/§25) | All implemented in sim, none in game | See core gap above |
| 4 | **Orbits reconstructable from timestamp** (§13) | Game orbits are a visual sim (`advanceOrbits` at accelerated game-time); sim `world/body.ts` has typed orbit elements + `reconstruct.ts` deterministic rebuild — but not wired together | When sim connects, orbit visuals should consume sim orbital functions per §13 |
| 5 | **Server authority** (§35) | Game is 100% client-side, no persistence; migrations write-only | Deliberate Path-B staging, but must be closed before any real economy/PvP |
| 6 | **Main menu** (§20) — Continue/Settings/Account/Exit | Only New Game + Photo Mode (+ESC) | Partial; Continue/Account need save/auth which don't exist yet |
| 7 | **UI floats around universe** (§18/§19) | No telemetry boxes, no command deck in game (deleted) | The 2026-08 HUD slice proved the pattern; must be rebuilt on the three.js shell |

---

# NEXT RECOMMENDED DEVELOPMENT PHASE

**Phase: "Sim meets Universe" (bridge layer) — the #1 priority.**

The single-file showcase is a beautiful, polished visual shell with **zero**
game systems attached. The sim is a fully-tested rule engine with **zero**
visual presence. The fastest path to "the universe is the game" is wiring
them together incrementally, in this order:

1. **Seed/registry bridge** — make the game's 36-system registry and galaxy
   seed consume `src/sim/world/*` (identity, catalogue, reconstruct) so the
   real exoplanet catalogue is what players see (canon mismatch #1).
2. **Persistence + claim** — add save/load (localStorage first) + the sim's
   claim/onboarding flow; "New Game" assigns a real home world per vision §6.
3. **In-world HUD, rebuilt thin** — telemetry boxes (§18) + bottom command
   deck (§19) as DOM overlays on the three.js shell (NOT React), consuming
   `src/sim/ui/*` contracts (or their direct replacements).
4. **Economy + structures in-world** — production/population ticks via
   timestamp math (no per-frame sim), rendered as planet telemetry.
5. **Fleets in-world** — sim movement/timestamp interpolation, fleet markers
   travelling between bodies per §24.
6. Then P8 (diplomacy) → P9 (trade) → P10 (MMO hardening + Supabase
   migrations) in the established OpenCode→Codex loop, per task.

Do NOT begin a large speculative rewrite. Preserve the single-file shell,
the sim, and the planetgen3d engine; build the bridge.

---

*End of canonical vision. Update this document when a genuinely approved
design decision changes StarBaron; do not rewrite locked decisions without
explicit approval.*
