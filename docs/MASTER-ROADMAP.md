# StarBaron — Master Development Roadmap & Agent Workflow

**Purpose:** Canonical implementation roadmap for Hermes and all downstream coding, audit, art, modelling, and generation agents.

**Project:** StarBaron  
**Primary orchestration model:** Hermes  
**Implementation model:** OpenCode using DeepSeek V4 Flash  
**Audit model:** Codex  
**Art / modelling specialist:** Kimi K3  
**Local image generation:** FLUX running locally on the user's GPU  

---

# 0. Agent Workflow — Locked Operating Model

## Standard Engineering Loop

The normal workflow is:

**Hermes (harness / orchestrator)**  
→ **OpenCode (DeepSeek V4 Flash) implements**  
→ **Codex independently audits**  
→ if Codex FAILS: **Hermes sends the findings back to OpenCode**  
→ OpenCode fixes  
→ Codex re-audits  
→ repeat until PASS  
→ Hermes reads the final agent responses and reports the result back to the user.

### Hermes responsibilities

Hermes is the orchestration layer.

Hermes should:

- break roadmap tasks into executable implementation jobs
- give OpenCode precise implementation instructions
- preserve the user's locked design decisions
- read OpenCode's implementation response
- invoke Codex for independent verification
- relay Codex failures back to OpenCode automatically
- keep looping until the task passes or a genuine blocker is found
- summarize the final result to the user
- maintain roadmap/task status
- prevent agents from silently changing unrelated systems
- protect previously verified navigation, renderer, economy, combat, and backend behavior
- invoke Kimi K3 when a task materially benefits from modelling, procedural generation expertise, art direction, or asset creation
- invoke the local FLUX pipeline when suitable image assets are required

Hermes should generally NOT implement production code itself when OpenCode can perform the implementation.

---

## OpenCode — DeepSeek V4 Flash

OpenCode is the primary implementation agent.

OpenCode should:

- write production code
- implement backend systems
- implement simulation logic
- implement Three.js rendering features
- implement database migrations
- implement UI
- add and update tests
- run relevant checks
- fix Codex findings
- preserve scope and avoid unrelated refactors

OpenCode should receive narrow, explicit tasks from Hermes.

---

## Codex — Independent Auditor

Codex is the verification layer.

Codex should:

- audit the implementation independently
- verify behavior against the task specification
- inspect relevant code paths
- check regressions
- check security assumptions
- check persistence and authority boundaries
- check simulation determinism
- check client/server information leakage
- check performance-sensitive architectural decisions where relevant
- return PASS or FAIL with concrete findings

Codex should not be treated as the primary implementer.

A Codex FAIL should normally loop back through Hermes to OpenCode.

---

# 1. Kimi K3 — Modelling, Art, Procedural Generation & Visual Systems

Kimi K3 should be treated as StarBaron's specialist for visual-generation work and procedural-world-generation work.

The user specifically wants Kimi K3 used for:

- 3D modelling
- ship concepts
- fleet visual design
- stations
- structures
- planet surface concepts
- moon and asteroid appearance
- galaxy art direction
- nebula and space-environment concepts
- iconography where useful
- procedural planet generation
- procedural galaxy generation
- procedural asset systems
- visual asset specifications
- model optimisation recommendations
- LOD model design

Kimi K3 has reportedly built planet generators and galaxy generators before.

Hermes should therefore FIRST investigate whether Kimi can reuse, adapt, or port its existing generator knowledge/approaches before asking OpenCode to reinvent those systems from scratch.

## Kimi usage rule

When a roadmap task involves one or more of the following:

- modelling
- procedural planets
- procedural galaxies
- procedural moons
- procedural asteroids
- ships
- stations
- structures
- art direction
- visual asset generation
- material design
- texture concepts
- shader concepts
- LOD model design

Hermes should consider invoking Kimi K3 before implementation.

A preferred workflow is:

**Hermes**
→ Kimi K3 produces visual/system specification or generator approach  
→ Hermes converts the result into an implementation brief  
→ OpenCode implements it  
→ Codex audits it.

If Kimi can produce directly usable model data, generator logic, procedural rules, material recipes, or asset specifications, Hermes should preserve that output as part of the task evidence.

---

# 2. Local FLUX — Image Asset Generation

A local FLUX model is available and can run using the user's GPU.

FLUX should be used for high-volume image generation where consistency can be managed through prompt templates and seeds.

Planned uses include:

- player avatars
- NPC portraits
- faction portraits
- alliance artwork
- commander portraits
- profile images
- loading-screen artwork
- event artwork
- achievement artwork
- structure concept sheets
- ship concept sheets
- cosmetic assets
- marketing mockups

## Avatar Generation Plan

The user specifically wants FLUX to eventually generate a large avatar library for use in-game.

The avatar pipeline should eventually support:

- large batch generation
- deterministic seeds
- visual diversity
- consistent framing
- consistent lighting
- clean backgrounds
- multiple species / human styles if StarBaron's canon later requires them
- gender/presentation variety
- age variety where appropriate
- faction/style variants
- rarity tiers if desired
- moderation/review before shipping
- metadata linking each image to its generation seed/prompt/version

FLUX-generated images should remain a separate asset pipeline from gameplay simulation.

---

# 3. Global Engineering Rules

These rules apply across ALL phases.

- Preserve the existing continuous universe navigation.
- Preserve existing smooth C2-style camera/travel behavior unless a task explicitly changes it.
- Keep gameplay/simulation logic separate from Three.js rendering where practical.
- Prefer deterministic seeded generation over `Math.random`.
- Real astronomical/catalogue data takes priority over procedural fallback data.
- Never present procedural game data as NASA-confirmed information.
- Hidden PvP/intelligence data must never be sent to unauthorized clients and merely hidden in UI.
- Persistent simulation should be event/timestamp-based rather than brute-force server simulation every frame.
- Render only what is relevant to the player's viewport and LOD.
- Maintain stable canonical IDs for persistent game objects.
- Keep world state authoritative on the backend.
- Keep rendering reconstructable from game state.
- Avoid hard visual scene swaps.
- Use LOD, instancing, pooling, and cheap distant representations.
- Do not render every ship/fleet/object in the universe at full fidelity merely because it exists.
- The universe must continue progressing even when nobody is viewing a region.
- Photo/render mode must use the SAME live Three.js scene, camera, materials, shaders, and gameplay objects.
- Do not create a duplicate photo-mode universe.
- Protect previously verified systems from unrelated regressions.

---

# Phase 1 — Universe Foundation & Data Model

**Goal:** Convert the current universe showcase into a persistent canonical game-world foundation.

## T01 — Canonical Object Identity

Subtasks:
- define stable `galaxyId`
- define stable `systemId`
- define stable `bodyId`
- support star, planet, moon, asteroid, and future body types
- define parent-child identity chains
- ensure IDs survive reloads and deterministic reconstruction

## T02 — Galaxy Data Model

Subtasks:
- galaxy ID
- seed
- galaxy type/class
- universe-space position
- system registry
- generation/version metadata
- persistent identity separated from render objects

## T03 — Solar-System Data Model

Subtasks:
- parent galaxy reference
- system ID
- system seed
- galaxy-space position
- star metadata
- body registry
- deterministic reconstruction

## T04 — Celestial-Body Data Model

Subtasks:
- star/planet/moon/asteroid body types
- radius
- mass
- environmental properties
- orbit parameters
- parent references
- procedural metadata
- real-data provenance flags

## T05 — Real Astronomy Integration

Subtasks:
- preserve pinned NASA Exoplanet Archive snapshot
- map catalogue fields into canonical body records
- distinguish real catalogue fields from procedural fields
- use procedural fallback only when needed
- preserve deterministic assignment
- add validation against catalogue drift

## T06 — Persistence Schema

Subtasks:
- Supabase/Postgres world tables
- foreign keys
- indexes
- timestamps
- world generation version
- migration strategy
- integrity constraints

## T07 — Deterministic Universe Reconstruction

Subtasks:
- same seed recreates same galaxy
- same seed recreates same system
- same seed recreates moons/asteroids
- prevent duplicates
- deterministic reconstruction tests
- reload consistency checks

## T08 — World-State API

Subtasks:
- query galaxy
- query system
- query body
- region query
- response minimisation
- permission-safe projections
- renderer-friendly payloads

---

# Phase 2 — Players, Home Worlds & Empire Ownership

**Goal:** Give each new player a permanent home and establish empire ownership.

## T01 — Player Profile

Subtasks:
- player ID
- display name
- empire name
- join timestamp
- settings
- progression state
- home-world link

## T02 — Home-World Assignment

Subtasks:
- select eligible unclaimed planet
- deterministic assignment
- atomic claim
- collision prevention
- persistence
- exhaustion handling
- repeat-login validation

## T03 — Home-World Protection

Subtasks:
- mark home as unconquerable
- enforce backend protection
- prevent ownership transfer
- protect against edge cases
- expose protected state to UI
- add attempted-conquest tests

## T04 — Planet Ownership

Subtasks:
- current owner
- previous owner
- acquisition method
- acquisition time
- neutral/unowned states
- ownership audit history

## T05 — Empire Territory

Subtasks:
- owned planet query
- controlled system query
- territory totals
- future moon/station support
- empire summary data
- ownership-independent rendering

## T06 — Colonisation

Subtasks:
- colonisation eligibility
- cost
- fleet/travel requirement
- completion event
- ownership creation
- duplicate claim prevention

## T07 — Ownership Transfer

Subtasks:
- conquest transfer
- surviving population rules
- structure survival/damage rules
- previous-owner history
- transaction safety
- notifications hooks

## T08 — New-Player Entry Flow

Subtasks:
- account creation
- home assignment
- initial resources
- initial structures
- initial camera destination
- tutorial/onboarding state

---

# Phase 3 — Planet Economy & Structures

**Goal:** Establish the core idle/incremental economy.

## T01 — Credits

Subtasks:
- base income
- structure income
- storage/balance
- spending
- transaction validation
- formatting

## T02 — Alloys / Ore

Subtasks:
- generation
- storage
- spending
- scarcity curve
- defensive uses
- economy tests

## T03 — Population

Subtasks:
- current population
- population cap
- growth rate
- growth modifiers
- timestamp recovery
- war loss integration hooks

## T04 — Structure Framework

Subtasks:
- structure IDs
- levels
- build costs
- upgrade costs
- prerequisites
- placement/grid rules
- backend authority

## T05 — Housing

Subtasks:
- cap bonus
- growth bonus
- upgrade curve
- planet modifiers
- offline calculation
- UI-ready state

## T06 — Production Structures

Subtasks:
- credit production
- ore/alloy production
- rate formulas
- structure levels
- planet efficiency modifiers
- production summary API

## T07 — Construction Queues

Subtasks:
- start time
- finish time
- resource reservation
- cancellation rules
- offline completion
- idempotent completion

## T08 — Offline Progression

Subtasks:
- resource accrual
- population growth
- construction completion
- capped/unlimited policy
- reconnect calculation
- anti-duplication

## T09 — Planet Quirks

Subtasks:
- atmosphere effects
- gravity effects
- star/environment effects
- structure modifiers
- production modifiers
- deterministic generation

## T10 — Economy Balancing Harness

Subtasks:
- automated economy simulations
- cost curves
- income curves
- time-to-upgrade
- early/mid/late progression tests
- telemetry-ready outputs

---

# Phase 4 — Core Game UI

**Goal:** Expose the game systems cleanly without overwhelming the universe view.

## T01 — Main HUD

Subtasks:
- current location
- resources
- population
- alerts
- selected/focused body
- responsive layout

## T02 — Contextual Hover Intelligence HUD

Subtasks:
- galaxy hover
- system hover
- star hover
- planet hover
- moon hover
- asteroid hover
- smooth target switching

## T03 — Object Information Contracts

Subtasks:
- public information
- owner-visible information
- alliance-visible information
- intel-gated information
- unknown/estimated/stale/verified states
- per-object display schema

## T04 — Planet Management Panel

Subtasks:
- structures
- population
- production
- queues
- defenses
- ownership
- current activity

## T05 — System Overview

Subtasks:
- star
- planets
- moons
- asteroid fields
- ownership
- activity
- navigation shortcuts

## T06 — Empire Overview

Subtasks:
- owned worlds
- total production
- population
- construction
- fleet summary hooks
- warnings

## T07 — Notifications Framework

Subtasks:
- construction finished
- fleet arrival
- scouting report
- incoming attack
- trade
- conquest
- alliance events

## T08 — Responsive / Touch UI

Subtasks:
- desktop hover
- tablet
- phone
- tap alternatives
- gesture conflicts
- safe-area support

## T09 — UI Mock/Real Data Boundary

Subtasks:
- allow mocked data during unfinished systems
- clearly mark mock adapters
- real data contracts defined first
- replace mocks system-by-system
- prevent mock values leaking to production
- add integration checks

---

# Phase 5 — Fleets & Space Travel

**Goal:** Add player-controlled movement through the persistent universe.

## T01 — Ship Definitions

Subtasks:
- ship classes
- costs
- speed
- cargo
- combat stats
- scouting stats
- future tech modifiers

## T02 — Shipyard

Subtasks:
- ship construction
- queue
- costs
- unlocks
- planet linkage
- offline completion

## T03 — Fleet Creation

Subtasks:
- fleet ID
- ship composition
- owner
- current location
- home location
- order state
- creation validation

## T04 — Fleet Movement

Subtasks:
- origin
- destination
- departure
- arrival
- travel time
- route state
- recall hooks

## T05 — Timestamp-Based Positioning

Subtasks:
- calculate current interpolation
- server does not animate every frame
- reconstruct after reconnect
- deterministic route position
- arrival handling
- time-drift checks

## T06 — Fleet Rendering

Subtasks:
- far marker
- medium representative formation
- near individual ships
- InstancedMesh where appropriate
- engine trails
- viewport culling
- LOD transitions

## T07 — Fleet Orders

Subtasks:
- move
- return
- scout
- attack
- defend
- trade
- colonise

## T08 — Fleet UI

Subtasks:
- composition
- destination
- ETA
- current order
- recall
- status
- selected fleet actions

## T09 — Travel Routes

Subtasks:
- planet-to-planet
- system-to-system
- galaxy travel
- distance calculation
- route validation
- future speed modifiers

## T10 — Fleet Persistence

Subtasks:
- authoritative backend
- reload-safe orders
- idempotent arrival
- anti-duplication
- concurrent order handling
- audit trail

## Kimi K3 involvement

Kimi should assist with:
- ship model families
- fleet visual language
- LOD ship model sets
- formation concepts
- procedural ship variation
- optimisation recommendations for many visible ships

---

# Phase 6 — Scouting, Sensors & Intelligence

**Goal:** Make information itself a strategic resource.

## T01 — Intel Permission Model

Subtasks:
- public
- owner-only
- alliance-visible
- scout-required
- war-state visibility
- backend enforcement

## T02 — Intel Levels

Subtasks:
- observed
- scanned
- scouted
- deep recon
- full intelligence
- field-by-field reveal rules

## T03 — Scout Ships

Subtasks:
- scout class
- cost
- speed
- sensor strength
- survivability
- fleet integration

## T04 — Scout Missions

Subtasks:
- select target
- send scout
- travel
- arrival
- resolution
- report generation

## T05 — Intel Reports

Subtasks:
- observer player
- target object
- timestamp
- revealed fields
- confidence
- source
- report history

## T06 — Intel Staleness

Subtasks:
- last observed
- stale timer
- estimated values
- age labels
- field-specific staleness
- refresh rules

## T07 — PvP Information Gating

Subtasks:
- population
- structures
- defenses
- fleets
- resources
- production
- construction activity

## T08 — Intel-Safe Backend

Subtasks:
- never send unauthorized hidden truth
- server-side projections
- permission checks
- request caching
- audit tests
- anti-enumeration considerations

## T09 — Hover HUD Integration

Subtasks:
- UNKNOWN
- ESTIMATED
- VERIFIED
- STALE
- scout action
- last report age
- available intel actions

## T10 — Future Sensor Hooks

Subtasks:
- sensor range
- stealth
- counter-intelligence
- detection chance
- alliance sharing
- misinformation hooks

---

# Phase 7 — Combat & Planet Conquest

**Goal:** Implement StarBaron's high-stakes PvP conquest loop.

## T01 — Attack Orders

Subtasks:
- target
- attacking fleet
- troop commitment
- validation
- confirmation
- departure

## T02 — Invasion Fleet

Subtasks:
- credit cost
- population recruitment
- ship composition
- transport capacity
- launch rules
- loss rules

## T03 — Combat Resolution

Subtasks:
- attack power
- defense power
- ship losses
- population losses
- deterministic/random model
- report output

## T04 — Planet Defense

Subtasks:
- defense structures
- population garrison
- defending fleet
- defensive modifiers
- readiness
- owner notifications

## T05 — Population Casualties

Subtasks:
- committed attackers lost appropriately
- defender losses
- planet-fall consequences
- regrowth
- recovery pressure
- report integration

## T06 — Conquest Cost

Subtasks:
- base cost
- empire-size escalation
- target-value modifiers
- anti-snowball design
- balancing harness
- UI estimate rules

## T07 — Planet Capture

Subtasks:
- ownership transfer
- structures
- surviving population
- fleet occupation
- production ownership
- history entry

## T08 — Home-World Immunity

Subtasks:
- reject attack/conquest
- backend enforcement
- UI explanation
- tests
- indirect exploit checks
- fleet behavior

## T09 — Combat Reports

Subtasks:
- winner/loser
- ship losses
- population losses
- defenses destroyed
- planet captured
- intel gained
- timestamps

## T10 — Combat Simulation Harness

Subtasks:
- scenario generation
- deterministic replay
- edge cases
- balance testing
- regression tests
- telemetry output

## T11 — Attack Notifications

Subtasks:
- incoming attack
- ETA
- battle start
- battle complete
- territory loss
- retaliation hooks

---

# Phase 8 — Diplomacy & Alliances

**Goal:** Turn individual PvP into persistent politics and coordinated strategy.

## T01 — Alliance Creation

Subtasks:
- name
- tag
- founder
- description
- uniqueness
- creation rules

## T02 — Membership

Subtasks:
- invite
- apply
- accept
- reject
- leave
- kick

## T03 — Alliance Roles

Subtasks:
- leader
- officer
- member
- permissions
- role changes
- audit history

## T04 — Diplomatic States

Subtasks:
- allied
- friendly
- neutral
- rival
- war
- transitions
- cooldowns

## T05 — Alliance Territory

Subtasks:
- member holdings
- territory totals
- system presence
- galaxy influence
- map display
- ownership changes

## T06 — Shared Intelligence

Subtasks:
- report sharing
- permissions
- report freshness
- provenance
- disable sharing
- alliance visibility

## T07 — Alliance Wars

Subtasks:
- declaration
- participants
- war state
- timeline
- objectives
- victory tracking

## T08 — Alliance Coordination

Subtasks:
- shared targets
- rally locations
- defense requests
- fleet coordination hooks
- shared alerts
- strategic markers

## T09 — Diplomacy UI

Subtasks:
- alliance profile
- member list
- relations
- war state
- applications/invites
- permissions

---

# Phase 9 — Trading & Galactic Economy

**Goal:** Create meaningful economic interaction between players.

## T01 — Tradable Resources

Subtasks:
- credits policy
- alloys/ore
- future commodities
- trade restrictions
- ownership validation
- anti-abuse limits

## T02 — Direct Trade

Subtasks:
- offer
- request
- accept
- reject
- cancel
- expiry
- transaction safety

## T03 — Trade Fleets

Subtasks:
- cargo
- route
- departure
- arrival
- loss/interception hooks
- return logic

## T04 — Trade Routes

Subtasks:
- source
- destination
- cargo type
- frequency
- repeat rules
- pause/cancel
- route risk

## T05 — Market

Subtasks:
- sell listings
- buy orders
- matching
- settlement
- history
- fees

## T06 — Market Pricing

Subtasks:
- supply/demand
- fees
- manipulation resistance
- rate limits
- price history
- analytics

## T07 — Alliance Trading

Subtasks:
- preferential access
- internal routes
- permissions
- shared logistics
- alliance market hooks
- tax hooks

## T08 — Trade Risk

Subtasks:
- war zones
- fleet danger
- interception hooks
- warnings
- loss handling
- future insurance

## T09 — Economy Telemetry

Subtasks:
- inflation
- sinks
- wealth concentration
- market volume
- resource velocity
- outlier alerts

## T10 — Trading UI

Subtasks:
- market
- orders
- routes
- offers
- cargo tracking
- price history

---

# Phase 10 — Persistent MMO World

**Goal:** Make StarBaron's universe continue living whether players are online or not.

## T01 — World Event Scheduler

Subtasks:
- fleet arrival
- construction
- scouting
- combat
- trade
- colonisation
- retries

## T02 — Timestamp Simulation

Subtasks:
- population
- resources
- fleet movement
- orbit reconstruction
- construction
- recurring trade

## T03 — Event Resolution

Subtasks:
- idempotency
- retries
- duplicate prevention
- locks
- audit log
- failure recovery

## T04 — Regional Loading

Subtasks:
- visible region query
- nearby fleets
- nearby players
- nearby celestial objects
- nearby battles
- LOD payloads

## T05 — Viewport Reconstruction

Subtasks:
- create render objects on demand
- calculate current positions
- select LOD
- remove irrelevant objects
- smooth object entry/exit
- no simulation dependency on visibility

## T06 — Continuous Player Population

Subtasks:
- new joins
- home-world availability
- galaxy distribution
- capacity
- expansion policy
- population balancing

## T07 — Concurrency

Subtasks:
- simultaneous conquest
- simultaneous trade
- simultaneous planet claims
- fleet order races
- market settlement
- transaction tests

## T08 — Server Authority

Subtasks:
- economy validation
- ownership validation
- combat validation
- fleet validation
- intel validation
- reject client manipulation

## T09 — World History

Subtasks:
- ownership history
- battle history
- alliance history
- major events
- player milestones
- queryable timeline

## T10 — Scale Testing

Subtasks:
- thousands of players
- many fleets
- large markets
- heavy war activity
- database stress
- event backlog simulation

## T11 — Observability

Subtasks:
- errors
- failed jobs
- latency
- simulation backlog
- query performance
- alerts

---

# Phase 11 — 4X Progression & Long-Term Game

**Goal:** Turn the connected systems into a deep long-term 4X experience.

## T01 — Explore Progression

Subtasks:
- sensor range
- discovery
- unknown-space rewards
- exploration missions
- map knowledge
- scouting synergy

## T02 — Expand Progression

Subtasks:
- colonisation limits
- conquest pressure
- logistics
- empire-size costs
- expansion bonuses
- border pressure

## T03 — Exploit Progression

Subtasks:
- planet specialisation
- mining worlds
- industrial worlds
- population centres
- research worlds
- trade hubs

## T04 — Exterminate Progression

Subtasks:
- military tech
- doctrine
- invasion upgrades
- fleet bonuses
- defensive doctrine
- siege progression

## T05 — Technology System

Subtasks:
- research resources
- research timers
- branches
- prerequisites
- unlocks
- modifiers

## T06 — Empire Specialisation

Subtasks:
- economy
- military
- exploration
- trade
- hybrid paths
- respec policy

## T07 — Leaderboards

Subtasks:
- empire size
- economy
- military
- conquest
- alliance
- seasonal rankings

## T08 — Seasonal Layer

Subtasks:
- objectives
- rankings
- rewards
- limited-time events
- no empire wipe
- season history

## T09 — Achievements

Subtasks:
- exploration
- economy
- war
- diplomacy
- trade
- collection

## T10 — Retention Balancing

Subtasks:
- early game
- mid game
- late game
- catch-up mechanics
- anti-snowball
- inactivity handling

---

# Phase 12 — Visual Assets, Release, Mobile & Scale Polish

**Goal:** Turn StarBaron into a polished, performant, shippable game across web and mobile.

## T01 — Three.js Performance Pass

Subtasks:
- draw calls
- instancing
- geometry budgets
- material budgets
- texture budgets
- GPU profiling
- memory profiling

## T02 — Full LOD Audit

Subtasks:
- ships
- fleets
- planets
- moons
- asteroids
- systems
- galaxies
- universe markers

## T03 — Procedural Planet & Galaxy Generation Upgrade

Subtasks:
- invoke Kimi K3 for prior generator expertise
- review Kimi's planet-generation approach
- review Kimi's galaxy-generation approach
- adapt suitable generator techniques
- define shader/material requirements
- implement through OpenCode
- audit determinism/performance through Codex

## T04 — Ship / Station / Structure Art Pipeline

Subtasks:
- Kimi ship concepts
- Kimi station concepts
- Kimi structure concepts
- model families
- LOD variants
- material standards
- export conventions
- performance budgets

## T05 — Adaptive Graphics

Subtasks:
- low
- medium
- high
- ultra
- photo mode
- automatic device recommendation

## T06 — Mobile Controls

Subtasks:
- pinch zoom
- pan/drag
- tap selection
- long press
- touch hover replacement
- gesture conflict handling

## T07 — Capacitor App

Subtasks:
- Android packaging
- iOS packaging
- lifecycle behavior
- background/resume
- deep links if needed
- store-ready builds

## T08 — Save / Reconnect Resilience

Subtasks:
- dropped connection
- app backgrounding
- reconnect
- stale client state
- state reconciliation
- duplicate action prevention

## T09 — Security Audit

Subtasks:
- RLS
- RPC permissions
- economy exploits
- hidden intel leakage
- ownership exploits
- combat exploits
- market exploits

## T10 — Performance Testing

Subtasks:
- low-end phone
- mid-range phone
- flagship phone
- laptop
- desktop
- large battles
- dense fleet views

## T11 — FLUX Avatar / 2D Asset Pipeline

Subtasks:
- define avatar art direction
- create reusable FLUX prompt templates
- generate large seeded batches
- enforce consistent framing
- create diversity requirements
- review/cull unusable images
- attach metadata
- prepare game-ready sizes
- build import pipeline
- expand later to event/achievement/faction artwork

## T12 — Launch Readiness

Subtasks:
- production backend
- web deployment
- Android/iOS builds
- monitoring
- telemetry
- rollback procedure
- launch checklist
- beta feedback loop

---

# Recommended Execution Sequence

Hermes should execute phases in this order unless the user explicitly reprioritises:

**Phase 1 — Universe Foundation**  
→ **Phase 2 — Players & Ownership**  
→ **Phase 3 — Economy & Structures**  
→ **Phase 4 — Core UI shell**  
→ **Phase 5 — Fleets**  
→ **Phase 6 — Scouting / Intelligence**  
→ **Phase 7 — Combat / Conquest**  
→ **Phase 8 — Alliances / Diplomacy**  
→ **Phase 9 — Trading / Market**  
→ **Phase 10 — Persistent MMO Scale**  
→ **Phase 11 — 4X Progression**  
→ **Phase 12 — Visual Assets / Mobile / Release**

Visual work does NOT have to wait until Phase 12.

Hermes may invoke Kimi K3 and FLUX during earlier phases whenever visual assets, procedural generation, models, icons, concepts, or art are required.

---

# Task Execution Contract for Hermes

For each task:

1. Read the phase/task/subtasks.
2. Inspect the relevant existing implementation.
3. Identify dependencies.
4. Invoke Kimi K3 first if modelling, art, procedural planet/galaxy generation, or visual asset design materially benefits the task.
5. Prepare a precise implementation brief.
6. Send implementation to OpenCode using DeepSeek V4 Flash.
7. Let OpenCode implement and run its checks.
8. Send the resulting implementation to Codex for independent audit.
9. If Codex FAILS:
   - read the findings
   - relay them to OpenCode
   - have OpenCode fix only the verified issues
   - re-run Codex
10. Repeat until PASS or a genuine blocker exists.
11. Hermes reads all final responses.
12. Hermes reports the concise final task status to the user.
13. Update roadmap progress.
14. Preserve evidence/notes needed for later phases.

---

# Final Product Direction

StarBaron is intended to become a:

**Persistent 4X MMO strategy game with an idle economy, real astronomical foundations, continuous universe navigation, async PvP conquest, fleets, alliances, trade, scouting, and a universe that continues to move and evolve while players are offline.**

The client should create the experience of a fully living universe without brute-force rendering or simulating every object continuously.

The core architectural principle is:

**Persistent authoritative state + event/timestamp-driven simulation + viewport-driven real-time reconstruction.**
