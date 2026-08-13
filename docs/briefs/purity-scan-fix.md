TASK (StarBaron — purity-scan regression fix, ONE finding, no broadening):

CONTEXT: tests/sim-purity.test.ts (P1-T03-C) scans src/sim/** for the DOM-global regex `\b(document|window|localStorage|sessionStorage|navigator|HTMLElement|location)\b`. The P3/P5 modules legitimately use `location` as a DOMAIN field (OwnedPlanet/fleet location refs, travel refs) — 8 false-positive failures: harness.ts, offline-model.ts, population-model.ts, fleet/fleet.ts, fleet/routes.ts, fleet/persistence.ts, ui/fleet-panel.ts, ui/hud.ts (verify the exact list by running the scan). The word `location` as a field/property name is NOT a DOM-API usage; the scan's word-boundary match is too broad.

ALLOWED FILES: tests/sim-purity.test.ts ONLY (the scan itself).

RESTRICTIONS: do not weaken the scan's real protections (document/window/localStorage/sessionStorage/navigator/HTMLElement stays banned). Do not touch any src file.

FIX: refine the DOM-global regex so `location` is only flagged as a DOM-API usage when it is a STANDALONE identifier reference (property access on nothing / `window.location` / `document.location` / `globalThis.location` / assignment to bare `location`), NOT when it appears as an object property definition or type field (`location:`, `location?`, `'location'`, `.location` on a domain object, `location:` in an interface). Concretely: replace the bare word `location` in the alternation with a negative-lookahead pattern that excludes `location:` (property definitions) and `['"].location`-style strings, e.g. `\blocation\b(?!\s*[:?.])` — pick the precise pattern that (a) still catches real DOM location usage, (b) no longer flags the 8 module fields. Add a small comment documenting why.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/sim-purity.test.ts --pool threads` — ALL tests pass (report counts). Also run `npx vitest run tests/harness.test.ts tests/fleet-panel.test.ts --pool threads` to confirm the affected modules' own suites are untouched. DO NOT run the full suite.
