# 🪐 StarBaron

**Idle planet-conquest in the real universe.**

> ## 🚧 In Development
> StarBaron is **currently in active development** — an early-stage prototype. Phases 1–2 (core idle engine, real-universe planet catalogue, procedural planet generator, claim flow) are complete; Phase 3 (async PvP + backend) is in progress. Everything here is a work in progress — expect rough edges, and welcome to the ride.

Every player starts with **one real planet** — a genuine exoplanet from the NASA Exoplanet Archive (6,321 confirmed worlds, all public-domain data). Build structures on it, grow your economy, colonise empty worlds — and conquer other players' planets. Or get ganged up on and lose them.

> **Population is a war currency.** "Money saves time, never lives." You can speed up growth, but you can never buy population outright — every soldier is a civilian who chose the barracks.

---

## The loop

```
Claim your real planet → build → earn → grow → colonise → conquer → defend
```

1. **You own a real place** — your planet has its actual name, star, size, and distance (Kepler-452 b, Gliese 667 Cc…)
2. **Earn** — baseline passive income on every planet (scales with tier + population); structures add/multiply it
3. **Build** — 7 structures, unlimited levels (diminishing returns after level 10)
4. **Grow** — population, garrison, fleet — the war economy
5. **Conquer** — async PvP: scout, commit forces, travel real distances, fight
6. **Defend** — turrets, militia, and the fortification ceiling (up to 10× defended strength — if you can afford it)

## Core rules

| Rule | Why |
|---|---|
| **Your home planet is always safe** | Rage-quit protection — lose progress, never the game |
| **Every planet is unique** | No two players share a world (server-side enforced in P3) |
| **Soldiers cost civilians, 1:1, permanently** | Population is the war currency — no free armies |
| **Banding together is allowed** | Small players can dethrone empires — combined force, one winner |
| **Fortification costs a fortune** | Turrets bleed the planet's economy — fortresses are a *choice* |
| **No prestige reset** | Your empire is yours forever; expansion IS progression |
| **8-hour offline banking** | Real life happens — come back to "While you were away…" |

## Structures (v1)

| Structure | Cost | Effect |
|---|---|---|
| Ore Mine | 500 cr | +5 alloys/min |
| Trade Hub | 2,000 cr | +10% baseline income |
| Housing | 300 cr | +1,000 pop cap, +2/sec growth |
| Hydroponics | 800 cr | +50% population growth |
| Barracks | 1,500 cr | Converts 10 civilians/sec → soldiers |
| Shipyard | 5,000 cr | +1,000 fleet cap + 50 cr/min income |
| Defense Turret | 2,000 cr + 1,000 alloys | +500 DP (defense power) |

## The real universe

- **6,321 real exoplanets** from the NASA Exoplanet Archive (public domain, attribution: *Planet data courtesy NASA Exoplanet Archive*)
- Every planet is **procedurally generated** from its real data — a deterministic hash of its name seeds its visual palette, a structure-efficiency quirk (high gravity → +alloy output, cold star → slower growth…), and a description
- Planets with sparse data get graceful fallbacks — all 6,321 generate successfully
- Weekly snapshot, drift-gated, deterministic — the same planet always looks the same

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Sim engine | Pure TS (no game engine — idle games are numbers) + **vitest** |
| Web preview | React 19 + Vite |
| Mobile | Capacitor (React/Vite codebase wrapped) |
| Backend (P3) | Supabase (Postgres + RLS) |
| Hosting | Cloudflare Pages + Supabase |

## Current status

**Phase 1–2 (core engine, structures, web preview, save/load, real-universe catalogue, planet model + procedural generator, claim flow) — complete.** 420+ tests, every task audited by an independent AI review loop.

**Phase 3 (Supabase backend + async PvP conquest)** — in progress.

Full design: [`DESIGN.md`](DESIGN.md) · Task tracker: [`ROADMAP.md`](ROADMAP.md)

## Roadmap

| Phase | Scope |
|---|---|
| **P1** | Core idle engine + web preview (✅) |
| **P2** | Real universe: exoplanet catalogue, planet generator, claim flow (✅) |
| **P3** | Supabase backend + async PvP (scout → launch → travel → resolve, band-together, fortification, anti-grief) |
| **P4** | Meta layer (leaderboards, seasons, notifications) + monetisation (rewarded ads, IAP) + launch |

## Development

```bash
npm install
npm run dev        # web preview
npm run test       # vitest suite (420+ tests)
npm run build      # typecheck + production build
```

## License

Open source — details TBD. Planet data courtesy [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/) (US public domain).
