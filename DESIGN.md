# StarBaron — Living Design Doc
*Working title — final name TBD (see §16). Status: PLANNING → SPEC DRAFT. Living doc; edited freely as we lock things in.*

**Design principles (Jay-mandated):** FUN · HIGH STAKES · STRATEGIC.
- *High stakes:* you can lose planets — but never the game (unconquerable home world)
- *Strategic:* save up to conquer vs grow your economy · fortify vs expand · raid timing
- *Fun:* the "I just took his planet" dopamine · idle progression dopamine · escalation

---

## 1. Elevator Pitch
An **idle planet-conquest game set in the real universe**: every player starts with **one real, unique planet** (from real astronomical catalogues — thousands of confirmed exoplanets, so every player gets their own), and builds **structures on it** that produce resources passively (Egg Inc / Idle Miner loop). Then comes the hook: **conquer other players' planets** — but taking one burns a large, escalating resource cost, so conquest is a strategy decision, not a grief-fest. **Build your empire. Steal someone else's. Keep your home planet forever.**

## 2. Locked Decisions
| Area | Decision |
|---|---|
| Genre | Idle/incremental + **async PvP conquest** (OGame model, modernised) |
| Setting | Space — galaxies of player planets |
| Twist | **Full planet theft** gated by escalating resource cost · unconquerable home planet · async PvP (no real-time servers) |
| **Real universe** | Planets are **real, unique astronomical objects** — players claim real exoplanets (thousands available, so each user gets their own). Planets aren't built — **structures are built ON them** |
| Universe | **Separate from Realmcraft/Hedgeborn** (those are low-fantasy; this is the real universe). Own canon from day one |
| Art | Emoji + simple shapes first (Cookie Clicker lesson); AI-generated assets when player data justifies it |
| Platform | Web preview first → **Capacitor** (React/Vite — TradieHubAU pattern) for iOS + Android |
| Monetisation | F2P + rewarded ads + IAP: shields, speed-ups, premium currency (conquest economy = whale engine) |

## 3. Tech Stack (LOCKED)
| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Rendering | Web: canvas/DOM first; **Capacitor** later (idle = mostly UI + numbers) |
| Simulation | Pure TS engine + vitest-tested (generators, cost curves, offline calc, combat) |
| Backend | **Supabase** (Postgres): players, planets, attacks, tick timers, galaxy map — shared universe state |
| Hosting | Cloudflare Pages (client) + Supabase (DB/auth) |
| PvP model | **Async** — attacks resolve on timers, results on login. NO real-time servers (the "avoid online multiplayer" trap avoided: this is tick-based, buildable) |

## 4. Core Idle Loop (proven formula)
1. Tap to earn → build **structures** on your planet → structures produce passively → offline earnings on return
2. **Structures** (built ON planets): generators, resource extractors, defenses, etc. Planets themselves are never built — they're claimed real objects
3. **Start with 1 planet** (your home planet, unconquerable) — colonise/claim more planets as you grow (each new planet = new structure grid)
4. **Long-term retention** = the PvP layer itself (revenge, wars, leaderboards, seasons) — no prestige reset (empire stays yours forever)
5. Number formatting: K, M, B, T, Qa, Qi, Sx… scientific notation

## 4a. Resources (4 currencies, each with a job)
| Currency | Job | How it flows |
|---|---|---|
| **Credits** | Grow — build structures, upgrade | Idle income (tap + structures). The everyday currency |
| **Alloys/ore** | Defend — build defenses | Slower, rarer production. Fortifying costs real time |
| **Population** | **War currency — attack AND defend** | Grows over time on each planet (housing structures raise cap + growth). **Attacking commits population** (they die in the attack). **Defending draws population** (they die if the planet falls). Losing a planet = losing its people |
| **Invasion fleet** | The conquest instrument | Built from credits + population (recruits), burned when you attack. The assembled army that travels |

**Population rules (the soul of the game):**
- Every planet has a population that grows (housing → cap + rate)
- **Attack cost = population + fleet:** "launch invasion of 5,000 troops" — those 5,000 are gone whether you win or lose
- **Defense cost = population:** defending a siege consumes defenders; a lost planet loses its population (captured/destroyed)
- Population is the *only* resource that doesn't come back instantly — it re-grows slowly, so wars leave scars
- This makes conquest a **moral + strategic decision**: rich in credits but low on population? You can't war. Population-heavy but poor? You can bleed an enemy dry... if you're willing to pay in lives

## 4b. The Real Universe (planet catalogue)
- **Planet source:** real confirmed exoplanets from public astronomical catalogues (e.g., NASA Exoplanet Archive — thousands of entries with name, mass, radius, star type, distance)
- **Assignment:** every new user is assigned one unique planet from the catalogue (unclaimed pool) — "you own Gliese 667 Cc" is the hook
- **Uniqueness:** each real planet exists once — no two players share a planet
- **Easy to scale:** catalogue has far more planets than players for the foreseeable future — "give a planet to a random user" is just an index into the unclaimed pool
- **Data is free:** public domain astronomical data — no licensing cost
- **Flavour:** planet stats (gravity, atmosphere, star type) can subtly affect structure efficiency — makes every planet feel like a real place
- **FOR LATER (Jay notes 2026-08-08):** use **Kimi Code CLI (free via Allegro sub)** to bulk-design planets — enrich real exoplanet data with lore/flavour/quirks (e.g. "high gravity → +20% alloy output") or generate fictional planets at scale if needed. Zero-cost content engine. **Also: Kimi K3 to design 3D planets** (planet visuals/3D models) — parked, revisit at the art/asset stage.

## 4c. Structures (v1 roster — 7, room to grow)
**Income model:** every planet has **baseline passive income** (auto, scales with planet tier + population). Structures don't create the income — they add/multiply it.

| Structure | Category | What it does |
|---|---|---|
| **Ore Mine** | Economy | Generates alloys (income stream #2) |
| **Trade Hub** | Economy | Boosts baseline passive income (multiplier) |
| **Housing** | Population | Raises population cap + growth |
| **Hydroponics** | Population | Speeds population growth (food) |
| **Barracks** | Military | Converts population → fleet |
| **Shipyard** | Military | Raises fleet cap + generates income (shipbuilding) |
| **Defense Turret** | Defense | Adds defense power → raises attacker's conquest cost |

**The chain:** Housing grows population → Barracks turns people into fleet → Shipyard launches bigger invasions → take planets → more Ore Mines/Trade Hubs → more Turrets to protect it.

**RESERVED FOR LATER (not v1):** Shield Generator (revisit only if playtest shows rage-quit on population loss), research labs, special planetary structures (star-type bonuses), cloak/stealth, orbital weapons, trade routes between own planets, population morale buildings, solar/misc generators.

## 4d. Economy Numbers (v0.1 DRAFT — tune from real data, never guesses)
*All numbers are starting points for the sim; balance is tuned from player data in the soft-launch phase.*

**Planet tiers** (from catalogue data): Tier 1 (small rocky) → Tier 5 (super-Earth/giant). Higher tier = more structure slots + higher base income + higher pop cap.

**Baseline passive income:** `10 × tier` credits/sec, always running. Trade Hub multiplies it; nothing else touches the floor.

**Structure costs** (cost = `base × 1.15^level`, build time shown for level 1):

| Structure | Base cost | Build time | Effect per level |
|---|---|---|---|
| Housing | 300 cr | 20s | +1,000 pop cap, +2 pop/sec growth |
| Hydroponics | 800 cr | 45s | +50% population growth rate |
| Ore Mine | 500 cr | 30s | +5 alloys/min |
| Barracks | 1,500 cr | 1min | Converts 10 civilians/sec → soldiers (while running) |
| Trade Hub | 2,000 cr | 2min | +10% baseline passive income |
| Defense Turret | 2,000 cr + 1,000 alloys | 3min | +500 DP |
| Shipyard | 5,000 cr | 5min | +1,000 fleet cap + **+50 credits/min shipbuilding income** (per level) |

**Population:** start 1,000 pop, cap 5,000. Cap = `5,000 × (1 + 0.2 × Housing levels)`. Base growth 2/sec, boosted by Hydroponics.

**Garrison (soldiers):** cap = `5,000 × Barracks levels`. Barracks converts civilians → soldiers at 10/sec while active. Deploying soldiers → fleet (travel = real distance).

**Fleet cap:** `1,000 × Shipyard levels`. Deployment doesn't consume soldiers permanently *until combat* — only committed troops are lost.

**Defense math (concrete):** DP = `500 × Turret levels + 0.15 × current population`. Example: 8 turrets + 40k pop = 4,000 + 6,000 = **10,000 DP** → needs 15k AP for decisive, 10–15k for pyrrhic.

**Growth curve (no prestige):** economies grow continuously; the endgame driver is **planet count** — each claimed planet adds its own baseline income + structure grid, so expansion IS the progression. Bigger empire = more income = can afford bigger wars.

**Offline earnings:** 100% of production rate, capped at 8h banked (matches idle-genre norm; rewarded ads double it).

**Conquest escalation (the "not easy" knob):** required AP is already ratio-based (≥1.5 decisive). Escalation = target DP naturally grows with their investment **plus** a war-weariness tax: each conquest you launch within a 24h window costs +20% more force (attrition — armies don't teleport). Resets daily.

**First-conquest timeline target:** ~2–3 days of play for an active player (feels earned, not impossible). Colonise first empty planet: day 1–2.

## 5. PvP — Planet Conquest (the differentiator)
- **Any planet except your home planet can be taken**
- Taking a planet costs a **large, escalating cost in population + fleet + credits** — not easy, not spammable, and *lives are the real price*
- **Defender's defenses increase the cost** (more alloys = more defenders needed) → fortify-or-grow choice
- Conquest is **async**: launch attack → timer → resolves → you log in to see the result (OGame/Travian model)
- **Unconquerable home planet** — every player keeps their first planet forever (rage-quit protection: lose progress, never the game)
- Loser loses the claimed planet + its population; keeps home planet + any other planets
- **Taken-planet structures (LOCKED):** everything survives **EXCEPT defenses** — Turrets are destroyed in the fall. The conqueror keeps the economy (Ore Mine, Trade Hub), population (Housing, Hydroponics) and military (Barracks, Shipyard) structures, but must rebuild their own defenses to hold it. *The prize is the economy, not the shell.*

**PvP defaults (LOCKED 2026-08-08):** retake allowed (lost planets can always be attacked back — fuels the revenge loop) · full-info scouting (attackers see the defender's defenses + estimated odds before launching — "I needed 1.5× and brought 1.2×" only works if players see the math) · travel time scales with real distance between planets (real universe, real distances — the galaxy map matters) · loser sees a full attack report (who, what, when — feeds revenge) · empty planets can be colonised (growth without war).

**Band-together attacks (LOCKED 2026-08-08):** multiple players can join an attack on one target within a launch window (e.g. 2h). **Attacker APs COMBINE against the defender's FIXED, unchanged DP** — more attackers never buffs the defender; the gang's total AP is compared to the defender's normal DP. War-weariness tax still applies per player per 24h (the gang can't endlessly spam the same target). **The planet goes to the attacker with the highest committed force** — cooperation with one winner (drama + betrayal potential). *This is the anti-whale valve: no empire is untouchable when the galaxy can coordinate.*

**Fortification ceiling (LOCKED 2026-08-08):** a player CAN build enough defenses to make a planet repel up to **10× its own defended strength** (AP needed to take it = up to 10× the planet's own DP). **But it means investing in that planet** — turret costs are alloy-heavy and escalate fast, so maxed fortification drains the planet's economy and slows growth elsewhere. *The whale's answer to the gang is investment: you can make a fortress, but it costs you expansion.* Balance triangle complete: small players coordinate (anti-whale) · big players fortify (anti-gang) · investment is the trade-off (anti-stalemate).

## 5a. Conquest Math (LOCKED)
**Attack Power (AP)** = deployed soldiers (fleet) × Shipyard tier
**Defense Power (DP)** = Turrets × turret strength + (population × 0.15 militia rate)
**Ratio = AP ÷ DP**

| Ratio | Result | Attacker loses | Defender loses |
|---|---|---|---|
| ≥ 1.5 | Decisive win — planet taken | 40% of force | Planet + population + turrets |
| 1.0 – 1.5 | Pyrrhic win — planet taken | 70% of force | Planet + population + turrets |
| 0.75 – 1.0 | Repelled — attack fails | 60% of force | 30% population, some turrets |
| < 0.75 | Crushed — attack fails | 90% of force | Minimal |

**Garrison model (LOCKED):** every planet has its own **soldiers** (garrison), produced by Barracks from civilians. They defend automatically. **Attack = deploying soldiers off-planet** → your own DP drops while they're gone → the galaxy map shows you exposed. Militia (15% of civilians) fights only if the garrison is overwhelmed — formula-only, not tracked.

**Design rules:** close wins cost more (pyrrhic = the interesting outcome) · fortified planets punish attackers · casualties both ways (wars leave scars on both sides) · ratio-based, explainable ("I needed 1.5× and brought 1.2×") · small ±5% random variance as a balance-phase knob, not v1.

## 5b. Meta Layer (LOCKED)
**v1:** Leaderboards (weekly + all-time) · Seasons (Realmcraft pattern — fresh rotations) · Notifications (under attack / invasion landed / planet fell) · Revenge tracking ("attack back" hook).
**Later (v1.1+):** Alliances/guilds (biggest retention + whale engine, biggest build+moderation cost) · Galaxy chat/diplomacy · Timed events (e.g. "conquest week") · Feuds/notoriety (public war history).

## 5c. Session Flow & UI (LOCKED)

**Screens (6):**
| Screen | What it shows |
|---|---|
| **Planet View** (home) | The planet itself, structure grid, resource bar (credits/alloys/pop/fleet), build menu, garrison count. The "living room" of the game |
| **Galaxy Map** | Star systems with player planets, distance readouts, scouting, launch attacks, colonise empty planets. Where war happens |
| **Fleet View** | Garrison (home defenders) vs deployed (away on invasion) — the "who's exposed" screen |
| **Attack Report** | Full resolution: outcome, casualties both sides, what survived, who gets the planet |
| **Leaderboard** | Weekly + all-time rankings |
| **Notifications** | Under attack · invasion landed · planet fell · attack results · revenge button |

**First-session onboarding (step-by-step):**
1. **Claim your planet** — "You now own Gliese 667 Cc" (the hook lands in 10 seconds)
2. Build first Housing → watch population grow (learn the idle loop)
3. Build Ore Mine → see alloys appear (learn multi-resource)
4. First "While you were away…" offline earnings reveal
5. Open Galaxy Map → see neighbours + empty planets (learn the world)
6. Tutorial scout + attack preview (learn the war, no commitment)

**Daily check-in flow:** open app → "While you were away…" summary (income banked, any attacks, garrison intact) → notifications (threats/vengeance) → 3–5 quick taps to collect/upgrade/respond → done. Total 10–15 min/day, 3–5 sessions.

**Attack flow (6 steps):** scout (see defenses + odds) → assemble (commit soldiers/fleet) → launch (travel time by real distance) → wait (async timer) → resolve → report (outcome, casualties, planet to highest committer). If won: takeover screen shows what survived + "rebuild defenses" prompt (you're exposed now).

**UI principles:** mobile-first (Capacitor-wrapped web app) · big readable numbers (idle genre) · planet identity front-and-center (name + real stats = the emotional anchor) · attacks shown in urgent red · offline summary on every open · one-thumb operations.

## 6. Anti-Griefing & Retention
| Rule | Why |
|---|---|
| Unconquerable home planet | Never a total loss → no rage-quit |
| Escalating conquest cost (exponential with target size/defenses) | No steamrolling weak players |
| New-player protection: untouchable first 3 days | Day-2 quit prevention |
| Shields: 12/24/48h paid protection | Whale hook + break mechanic |
| Attack cost scales with target value | High-stakes but fair |

## 7. Galaxy Map
- Grid of star systems showing player planets (the "come take this" screen)
- Filterable: find weak neighbours, allies, empty space to colonise
- The social glue + discovery surface

## 8. Monetisation
- **Rewarded ads** (2× offline earnings, boosts) — never forced
- **IAP**: shields, attack speed-ups, invasion-force top-ups, premium currency
- Conquest games monetise better than pure idle — rich players buy to conquer
- **NO pay-to-win units** (design principle: skill/strategy wins, money saves time)

## 9. Benchmarks (idle games)
- D1 30–40% · D7 10–15% · D30 5–8% · 3–5 sessions/day · ARPDAU $0.05–0.15 early
- PvP layer should lift D7+ (the "revenge/attack back" hook)

## 10. Build Phases (4–6 weeks to MVP)
1. **Core engine in pure TS + tests** (generators, cost curves, offline calc, formatting) → **playable web preview** (feel the loop in days)
2. Achievements, save/load, onboarding tutorial
3. **Planets** (multi-planet economies)
4. **Supabase backend** (players, planets, timers)
5. **Async PvP v1** (attack → timer → resolve; home-world protection; new-player shield)
6. **Galaxy map** (find + attack targets)
7. Monetisation (rewarded ads, shields, IAP)
8. Store listings, ASO, soft launch, iterate on real retention

## 11. Risks
- **Balance is everything** — conquest cost curves tuned from real data, never guesses
- **Store discovery brutal** — plan distribution (FB page, content engine, audience) before launch
- PvP needs a minimum player base to be fun — seed with bots/AI targets early so the universe feels alive
- First 1–3 months is audience building, not profit

## 12. Rules
- Deliver a playable web preview early (Phase 1) so Jay feels the loop
- Dogfood daily; use real session data for balance changes
- Verify produced code — run the tests before trusting output

---

*Status log: created 2026-08-08 — concept from chat session (market gap validated: OGame 8 ratings on iOS, no mobile incumbent for idle+conquest; State.io 9k ratings proves conquest appeal, Idle Miner 74k proves idle demand — the merge is unclaimed).*
