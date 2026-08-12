# StarBaron — Complete Game System Reference
*For design discussion with GPT. Compiled 2026-08-12 from DESIGN.md (canonical), ROADMAP.md (implemented status), and src/sim source. Working title, final name TBD.*

---

## 1. Elevator Pitch

An **idle planet-conquest game set in the real universe**. Every player starts with **one real, unique planet** (from real astronomical catalogues — thousands of confirmed exoplanets, so every player gets their own), builds **structures on it** that produce resources passively (Egg Inc / Idle Miner loop). Then the hook: **conquer other players' planets** — but taking one burns a large, escalating resource cost, so conquest is a strategy decision, not a grief-fest. **Build your empire. Steal someone else's. Keep your home planet forever.**

Design principles (Jay-mandated): **FUN · HIGH STAKES · STRATEGIC** — you can lose planets but never the game (unconquerable home world); save up to conquer vs grow economy, fortify vs expand, raid timing; the "I just took his planet" dopamine.

---

## 2. Locked Design Decisions

| Area | Decision |
|---|---|
| Genre | Idle/incremental + **async PvP conquest** (OGame model, modernised) |
| Setting | Space — galaxies of player planets |
| Twist | **Full planet theft** gated by escalating resource cost · unconquerable home planet · async PvP (no real-time servers) |
| Real universe | Planets are **real, unique astronomical objects** — players claim real exoplanets. Planets aren't built — **structures are built ON them** |
| Universe | Separate from Realmcraft/Hedgeborn — own canon from day one |
| Art | Emoji + simple shapes first (Cookie Clicker lesson); AI-generated assets when player data justifies it |
| Platform | Web preview first → **Capacitor** (React/Vite — TradieHubAU pattern) for iOS + Android |
| Monetisation | F2P + rewarded ads + IAP: shields, speed-ups, premium currency (conquest economy = whale engine) |

---

## 3. Tech Stack (LOCKED)

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Rendering | Web: canvas/DOM first (Three.js ^0.185 for the 3D zoom journey); Capacitor later |
| Simulation | Pure TS engine + vitest-tested (generators, cost curves, offline calc, combat) |
| Backend | **Supabase** (Postgres): players, planets, attacks, tick timers, galaxy map — shared universe state |
| Hosting | Cloudflare Pages (client) + Supabase (DB/auth) |
| PvP model | **Async** — attacks resolve on timers, results on login. NO real-time servers. Tick-based |

---

## 4. The Core Idle Loop

1. Claim your planet → build **structures** → structures produce passively → offline earnings on return
2. Structures are built **ON planets**; planets themselves are claimed real objects, never built
3. Start with 1 planet (home, unconquerable) — colonise/claim more as you grow (each new planet = new structure grid)
4. Long-term retention = the PvP layer (revenge, wars, leaderboards, seasons) — **no prestige reset**, empire stays forever
5. Number formatting: K, M, B, T, Qa, Qi, Sx… scientific notation

---

## 5. Resources — 4 Currencies, Each With a Job

| Currency | Job | How it flows |
|---|---|---|
| **Credits** | Grow — build structures, upgrade | Idle income (tap + structures). The everyday currency |
| **Alloys/ore** | Defend — build defenses | Slower, rarer production. Fortifying costs real time |
| **Population** | **War currency — attack AND defend** | Grows over time per planet (Housing raises cap + growth). **Attacking commits population** (they die in the attack). **Defending draws population** (they die if the planet falls). Losing a planet = losing its people |
| **Invasion fleet** | The conquest instrument | Built from credits + population (recruits), burned when you attack. The assembled army that travels |

**Population rules (the soul of the game):**
- Every planet has population that grows (Housing → cap + rate)
- **Attack cost = population + fleet**: "launch invasion of 5,000 troops" — those 5,000 are gone whether you win or lose
- **Defense cost = population**: defending a siege consumes defenders; a lost planet loses its population
- Population is the *only* resource that doesn't come back instantly — it re-grows slowly, so **wars leave scars**
- Rich in credits but low on population? You can't war. Population-heavy but poor? You can bleed an enemy dry… if you're willing to pay in lives

---

## 6. The Real Universe (planet catalogue)

- **Source:** real confirmed exoplanets from NASA Exoplanet Archive (public-domain data, TAP query) — **6,321 planets pinned** in `src/sim/data/planets.ts` (byte-strict drift-gated snapshot, `PLANET_SNAPSHOT` SHA; re-pin is a deliberate process)
- **Fields per planet:** name, hostname, RA/Dec, distance (parsecs), radius, star type → derived **tier** (T1–T5, radius-first mapping)
- **Assignment:** every new user claims one unique planet — deterministic hash `fnv1a("starbaron-claim-v1|playerId") % catalogue.length` (audited, do-not-touch)
- **Uniqueness:** each real planet exists once — no two players share a planet
- **Scale:** catalogue far exceeds players for the foreseeable future
- **Flavour:** planet stats (gravity, atmosphere, star type) affect structure efficiency via **quirks**

---

## 7. Planet Model (P2, implemented)

- **Tier → stats:** T1 small rocky → T5 super-Earth/giant. Higher tier = higher base income + higher pop cap
  - **Base passive income:** `10 × tier` credits/sec, always running
  - **Pop-cap multiplier by tier:** T1 ×1.0, T2 ×1.2, T3 ×1.4, T4 ×1.7, T5 ×2.0 (applied on top of `5,000 × (1 + 0.2 × Housing levels)`)
- **Structure slots: UNLIMITED** — no hard cap. Instead **diminishing returns per structure type**: fully effective up to level 10; each level beyond 10 counts as **half** (`effectiveLevel = min(level,10) + max(0,level−10) × 0.5`)
- **Procedural identity (deterministic, seeded by planet name):** FNV-1a hash + mulberry32 PRNG → visual palette, rings/moons, quirks, template-built descriptions. No storage, consistent across runs, no `Math.random` in pure modules
- **Quirks (7-quirk table):** structure-efficiency hooks, e.g. high gravity → +20% alloy output; `binarySystem` is a baseline-trait (income floor ×1.1 at ANY Trade Hub level including 0); `massiveWorld` → defense ×1.1 (PvP constant)
- **Colonise:** empty planets can be claimed by any player (growth without war); UI placeholder cost 1,000 cr (starter wallet) — **FLAGGED balance question**: DESIGN locks colonise FREE; the 1,000 cr is a UI-layer placeholder (~3-line strip if Jay decides free at playtest)

---

## 8. Structures — v1 Roster (7, implemented)

**Income model:** every planet has **baseline passive income** (auto, scales with tier + population). Structures don't create the income — they add/multiply it.

| Structure | Category | Effect per level | Base cost | Build time |
|---|---|---|---|---|
| Ore Mine | Economy | +5 alloys/min | 500 cr | 30s |
| Trade Hub | Economy | +10% baseline passive income | 2,000 cr | 2min |
| Housing | Population | +1,000 pop cap, +2 pop/sec growth | 300 cr | 20s |
| Hydroponics | Population | +50% population growth rate | 800 cr | 45s |
| Barracks | Military | Converts 10 civilians/sec → soldiers (while running) | 1,500 cr | 1min |
| Shipyard | Military | +1,000 fleet cap + **+50 credits/min shipbuilding income** | 5,000 cr | 5min |
| Defense Turret | Defense | +500 DP | 2,000 cr + 1,000 alloys | 3min |

**Cost curve:** `cost = base × 1.15^level` (exponential growth, keeps everything buildable forever, kills "one type only" exploit)

**The chain:** Housing grows population → Barracks turns people into fleet → Shipyard launches bigger invasions → take planets → more Ore Mines/Trade Hubs → more Turrets to protect it.

**Economy numbers:**
- Population: start 1,000 pop, cap 5,000. Cap = `5,000 × (1 + 0.2 × Housing levels)`. Base growth 2/sec, boosted by Hydroponics
- Garrison (soldiers): cap = `5,000 × Barracks levels`; Barracks converts civilians → soldiers at 10/sec while active
- Fleet cap: `1,000 × Shipyard levels`. Deployment doesn't consume soldiers permanently *until combat* — only committed troops are lost
- Offline earnings: 100% of production rate, capped at **8h banked** (rewarded ads double it)

---

## 9. PvP — Planet Conquest (the differentiator)

- **Any planet except your home planet can be taken**
- Taking a planet costs a **large, escalating cost in population + fleet + credits** — not easy, not spammable, *lives are the real price*
- Defender's defenses increase the cost (fortify-or-grow choice)
- Conquest is **async**: launch attack → timer → resolves → you log in to see the result (OGame/Travian model)
- **Unconquerable home planet** — rage-quit protection: lose progress, never the game
- Loser loses the claimed planet + its population; keeps home planet + any other planets
- **Taken-planet structures (LOCKED):** everything survives **EXCEPT defenses** — Turrets are destroyed in the fall. Conqueror keeps economy (Ore Mine, Trade Hub), population (Housing, Hydroponics), military (Barracks, Shipyard), must rebuild defenses to hold it. *The prize is the economy, not the shell.*

**PvP defaults (LOCKED):** retake allowed (revenge loop) · full-info scouting (attackers see defender's defenses + estimated odds before launching) · travel time scales with real distance between planets · loser sees a full attack report (who, what, when — feeds revenge) · empty planets can be colonised.

---

## 10. Conquest Math (LOCKED, exact constants from `PVP_CONSTANTS`)

**Attack Power (AP)** = deployed soldiers (fleet) × effectiveLevel(shipyard tier) — shipyard contributes its **effective** level (half-after-10), so a tier-15 shipyard multiplies AP by 12.5, not 15
**Defense Power (DP)** = Turrets × 500 × effectiveLevel + population × 0.15 militia rate (×1.1 if massiveWorld quirk). Garrison does NOT add to DP (locked formula). DP never scales with attacker count.
**Ratio = AP ÷ DP**

| Ratio | Result | Attacker loses | Defender loses |
|---|---|---|---|
| ≥ 1.5 | **Decisive win** — planet taken | 40% of force | Planet + population + turrets |
| 1.0 – 1.5 | **Pyrrhic win** — planet taken | 70% of force | Planet + population + turrets |
| 0.75 – 1.0 | **Repelled** — attack fails | 60% of force | 30% population, some turrets |
| < 0.75 | **Crushed** — attack fails | 90% of force | Minimal |

- Boundaries are inclusive (`>=` on all upper boundaries)
- Casualty rounding is `round()`, not floor
- **Garrison model (LOCKED):** every planet has its own soldiers (garrison) produced by Barracks from civilians. They defend automatically. **Attack = deploying soldiers off-planet** → your own DP drops while they're gone → the galaxy map shows you exposed. Militia (15% of civilians) fights only if the garrison is overwhelmed — formula-only, not tracked
- **Design rules:** close wins cost more (pyrrhic = the interesting outcome) · fortified planets punish attackers · casualties both ways (wars leave scars) · ratio-based, explainable ("I needed 1.5× and brought 1.2×")

**PvP tunables (exact, mirrored client/server via seeded game_config):**
| Knob | Value |
|---|---|
| Travel time | `distancePc × 1 min`, floor 10 min, cap 48h (172,800s) |
| Launch cost | `200 cr + fleet × 0.2 cr + distancePc × 10 cr` |
| War-weariness | **+20% (×1.2) required force per conquest within 24h**, resets daily. Stacks multiplicatively: 1st = 1.0×, 2nd = 1.2×, 3rd = 1.2², 4th = 1.2³ — spamming is self-punishing |
| New-player shield | 3 days untouchable |
| Join window | 7,200s (2h) for band-together |

**Band-together attacks (LOCKED):** multiple players can join an attack on one target within a 2h window. **Attacker APs COMBINE against the defender's FIXED, unchanged DP** — the gang's total AP vs normal DP. War-weariness still applies per player per 24h. **The planet goes to the attacker with the highest committed force** — cooperation with one winner (drama + betrayal). Anti-whale valve: no empire is untouchable when the galaxy coordinates. Min join commitment: 100.

**Fortification ceiling (LOCKED):** a player can make a planet repel up to **10× its own defended strength** (AP needed = up to 10× the planet's own DP) — but turret costs are alloy-heavy and escalate fast, draining the planet's economy and slowing growth elsewhere. Balance triangle: small players coordinate (anti-whale) · big players fortify (anti-gang) · investment is the trade-off (anti-stalemate).

**First-conquest timeline target:** ~2–3 days of play for an active player. Colonise first empty planet: day 1–2.

---

## 11. The 3D Zoom Journey — Planet → Solar System → Galaxy → Universe (implemented in showcase, being wired into the real app)

The game now has a continuous 3D camera journey through 4 zoom levels, **each level = ONE entity** (the core performance principle — never thousands of objects):

| Level | What's rendered | Entity count |
|---|---|---|
| **Planet View** | The player's home planet (sphere + atmosphere glow + moon), camera frames it whole | 1 planet mesh |
| **Solar System** | Seeded system: spectral-class sun + glow, Keplerian planets + moons + rings, orbit tracks, instanced asteroid belt | 1 system group (~10–30 meshes max) |
| **Galaxy** | **ONE high-detail spiral galaxy model**: 3 logarithmic spiral arms painted on a seeded 2048px canvas texture, dark dust lanes between arms, blue-white star clusters in arms, warm glowing core, halo bloom, nebula haze — PLUS ~9,000 tier-coloured host-star points embedded in the disk, and a separate ~4,200-dot planet layer clustered around hosts | 1 group (~4 draw calls) |
| **Universe** | **ONE entity**: deep-space backdrop + 20–42 named distant-galaxy sprites (seeded mix of face-on blue spirals, edge-on orange slivers, faint ellipticals). **Click a named galaxy → camera flies to it** (smooth travel ease, arrival status, scroll up to return home) | 1 group |

**Zoom motion (current prototype):** velocity-momentum glide — wheel input feeds a velocity target, camera velocity approaches it exponentially, position integrates continuously. Feels like a trackpad pinch-zoom: no per-notch transitions, flat mid-velocity, invisible start/stop, retargeting is continuous. Distance follows ONE Catmull-Rom spline through the 4 levels in log-space (no boundary jumps). Real frame-delta integration, 60fps+.

**Determinism:** every layer is seeded (`rngFrom(seed)`) — same seed = identical galaxy/system/planet every load. No `Math.random` in pure modules (test-enforced).

**Spawn markers (prototype):** 3 pulsing rings + labels showing deterministic new-player spawn locations, mirroring the real claim hash (`fnv1a("starbaron-claim-v1|playerId")`). Labels only appear on hover or travel — never clutter the view.

**Implementation status:** visual prototype is in the Hermes preview pane (interactive HTML mirror). Real renderer (`src/ui/planetgen3d/`, Three.js) already has: spiral-disk galaxy texture, universe sprites, `disposeSystemMeshes()` lazy swap (frees solar-system meshes when zoomed past system level, hysteresis 1.5/1.8), owned-planet pins + home-ring highlight layer, all test-asserted (galaxy ≤ 8 children, universe ≤ 45 children, determinism, no-Math.random grep).

---

## 12. Galaxy Map (gameplay screen, planned)

- Grid of star systems showing player planets (the "come take this" screen)
- Filterable: find weak neighbours, allies, empty space to colonise
- Travel time scales with real distance between planets (real universe, real distances — the map matters)
- The social glue + discovery surface

---

## 13. Session Flow & UI (LOCKED, 6 screens)

| Screen | What it shows |
|---|---|
| Planet View (home) | The planet itself, structure grid, resource bar (credits/alloys/pop/fleet), build menu, garrison count. The "living room" |
| Galaxy Map | Star systems with player planets, distance readouts, scouting, launch attacks, colonise empty planets. Where war happens |
| Fleet View | Garrison (home defenders) vs deployed (away on invasion) — the "who's exposed" screen |
| Attack Report | Full resolution: outcome, casualties both sides, what survived, who gets the planet |
| Leaderboard | Weekly + all-time rankings |
| Notifications | Under attack · invasion landed · planet fell · attack results · revenge button |

**First-session onboarding (6 steps):** claim your planet ("You now own Gliese 667 Cc" — hook in 10s) → build first Housing → build Ore Mine → first "While you were away…" offline reveal → open Galaxy Map → tutorial scout + attack preview.

**Attack flow (6 steps):** scout (defenses + odds) → assemble (commit soldiers/fleet) → launch (travel time by real distance) → wait (async timer) → resolve → report. If won: takeover screen shows what survived + "rebuild defenses" prompt (you're exposed now).

**Daily check-in:** open app → "While you were away…" summary → notifications (threats/vengeance) → 3–5 quick taps to collect/upgrade/respond. 10–15 min/day, 3–5 sessions.

**UI principles:** mobile-first (Capacitor-wrapped web app) · big readable numbers · planet identity front-and-center (name + real stats = emotional anchor) · attacks in urgent red · offline summary on every open · one-thumb operations.

---

## 14. Anti-Griefing & Retention

| Rule | Why |
|---|---|
| Unconquerable home planet | Never a total loss → no rage-quit |
| Escalating conquest cost (exponential with target size/defenses) | No steamrolling weak players |
| New-player protection: untouchable first 3 days | Day-2 quit prevention |
| Shields: 12/24/48h paid protection (v1.1) | Whale hook + break mechanic |
| Attack cost scales with target value | High-stakes but fair |

---

## 15. Meta Layer (LOCKED)

**v1:** Leaderboards (weekly + all-time) · Seasons (fresh rotations) · Notifications (under attack / invasion landed / planet fell) · Revenge tracking ("attack back" hook).
**Later (v1.1+):** Alliances/guilds (biggest retention + whale engine) · Galaxy chat/diplomacy · Timed events ("conquest week") · Feuds/notoriety (public war history).

---

## 16. Monetisation

- **Rewarded ads** (2× offline earnings, boosts) — never forced
- **IAP**: shields, attack speed-ups, invasion-force top-ups, premium currency
- Conquest games monetise better than pure idle — rich players buy to conquer
- **NO pay-to-win units** (design principle: skill/strategy wins, money saves time)

---

## 17. Benchmarks (idle games)

D1 30–40% · D7 10–15% · D30 5–8% · 3–5 sessions/day · ARPDAU $0.05–0.15 early. PvP layer should lift D7+ (the "revenge/attack back" hook).

---

## 18. Build Status (ROADMAP, 2026-08-12)

| Phase | Status |
|---|---|
| **P1 — Core idle engine + web preview** | ✅ COMPLETE (217 tests, Codex PASS): sim core (income/costs/pop/offline/format), 7 structures, PlanetView UI, save/load + onboarding |
| **P2 — Real universe + planets** | ✅ COMPLETE (508 tests, Codex PASS): 6,321-planet catalogue (drift-gated), planet model + quirks + procedural identity, claim flow, multi-planet economies, colonise button |
| **P3 — Supabase backend + async PvP** | 🟡 IN PROGRESS: schema (0001–0007 applied live), attack lifecycle (0008–0009), conquest math (0010 + 04 suite), band-together (0011), fortification + weariness (0012 — **apply to live PENDING Jay authorisation**). Remaining: P3-T05-C/D, P3-T06 anti-grief |
| **P4 — Meta + monetisation + launch** | ⬜ Not started |
| **Visual layer (3D zoom journey)** | 🟡 Showcase prototype approved-in-direction; real renderer (planetgen3d) implemented + verified; galaxy planets/spawn markers/travel are next to fold in |

**Test suite:** 35+ files / 661+ tests, tsc/build/lint all 0, live Supabase SQL suites exit 0. Known infra issue: full-suite vitest run hangs on 6 pre-existing test files (worker crashes, not code failures) — bounded-worker config is the fix.

---

## 19. Open Questions / Flagged Items (for design discussion)

1. **Colonise cost:** DESIGN locks colonise FREE; UI has a 1,000 cr placeholder (exactly starter wallet). Free or costed? (P2-T03+UI)
2. **In-flight weariness semantics:** exact behaviour when a band attack joins mid-window (P3-T04, flagged)
3. **Renaming planets** (e.g. "Lardelli Prime") — parked, UI/backend work
4. **Shield Generator structure** — reserved, only if playtest shows rage-quit on population loss
5. **Balance:** ALL numbers are v0.1 drafts, tuned from real player data at soft launch — never guesses
6. **Seed AI targets/bots** early so the PvP universe feels alive before real players arrive
7. **The 3D zoom journey:** how deep does it integrate with gameplay? (e.g. clicking a real host star in the galaxy → that system's planets → colonise/attack from the map layer, vs the current DOM-based Galaxy Map screen — do they coexist?)
