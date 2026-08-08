// Showcase generator as a vitest test — vitest resolves TS + extensionless
// imports natively (raw node ESM can't). Writes docs/showcase.html.
// Run: npx vitest run tests/showcase-generate.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PLANETS, PLANET_SNAPSHOT } from '../src/sim/data/planets.ts';
import { makePlanet } from '../src/sim/planets/index.ts';
import { generatePlanetIdentity } from '../src/sim/planets/generator.ts';

const QUIRK_LABEL: Record<string, string> = {
  highGravity: 'High Gravity', coldStar: 'Cold Star', hotStar: 'Hot Star',
  denseCore: 'Dense Core', gasGiant: 'Gas Giant', binarySystem: 'Binary System',
  massiveWorld: 'Massive World',
};

describe('showcase', () => {
  it('generates the showcase page from real planet data', () => {
    const quirkCounts: Record<string, number> = {};
    const tierCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let missingDataHandled = 0;
    let zeroQuirk = 0;
    const nameSet = new Set<string>();
    let dupes = 0;

    for (const p of PLANETS) {
      if (nameSet.has(p.name)) dupes++;
      nameSet.add(p.name);
      tierCounts[p.tier] = (tierCounts[p.tier] ?? 0) + 1;
      const identity = generatePlanetIdentity(p);
      const quirk = identity.quirks[0];
      if (!quirk) zeroQuirk++;
      else quirkCounts[quirk.id] = (quirkCounts[quirk.id] ?? 0) + 1;
      if (!p.starType || !p.radiusEarth || !p.massJup || !p.distancePc) missingDataHandled++;
    }

    const k452 = PLANETS.find((p) => p.name === 'Kepler-452 b');
    expect(k452).toBeDefined();
    const det1 = JSON.stringify(generatePlanetIdentity(k452!));
    const det2 = JSON.stringify(generatePlanetIdentity(k452!));
    expect(det1).toBe(det2);

    const tiers = [1, 2, 3, 4, 5];
    const pick: typeof PLANETS = [];
    for (const t of tiers) {
      const pool = PLANETS.filter((p) => p.tier === t);
      if (pool.length) {
        pick.push(pool[Math.floor(pool.length * 0.1)]);
        pick.push(pool[Math.floor(pool.length * 0.6)]);
      }
    }
    const seen = new Set<string>();
    const showcase = pick.filter((p) => (seen.has(p.name) ? false : seen.add(p.name))).slice(0, 12);

    const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const planetCard = (p: (typeof PLANETS)[number]) => {
      const identity = generatePlanetIdentity(p);
      const planet = makePlanet(p);
      const pal = identity.visual.surfacePalette;
      const swatches = pal
        .map((c) => `<span style="display:inline-block;width:34px;height:34px;border-radius:8px;background:${c};margin-right:4px;border:1px solid rgba(255,255,255,0.25)"></span>`)
        .join('');
      const features: string[] = [];
      if (identity.visual.ringed) features.push('🪐 rings');
      if (identity.visual.moons > 0) features.push(`🌙 ${identity.visual.moons} moon${identity.visual.moons > 1 ? 's' : ''}`);
      if (identity.visual.atmosphereTint) features.push('☁️ atmosphere');
      const quirk = identity.quirks[0];
      const quirkHtml = quirk
        ? `<span style="color:#ffb454;font-weight:700">${quirk.name}</span> — <span style="color:#aab3d1">${quirk.blurb} (${quirk.structureId} ×${quirk.multiplier})</span>`
        : '<span style="color:#777">No quirk (data too sparse)</span>';
      return `
  <div style="background:#151a2e;border:1px solid #2a3152;border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:10px">
    <div style="font-size:17px;font-weight:700;color:#fff">${esc(p.name)}</div>
    <div style="font-size:12px;color:#8a93b8">${esc(p.starType ?? 'unknown star')} · ${p.distancePc ? p.distancePc.toFixed(1) + ' pc' : 'distance unknown'} · Tier ${p.tier} · ${p.radiusEarth ? p.radiusEarth.toFixed(2) + ' R⊕' : '?'}${p.massJup ? ' / ' + p.massJup.toFixed(2) + ' M♃' : ''}</div>
    <div>${swatches}</div>
    <div style="font-size:12px;color:#8a93b8">${features.length ? features.join(' · ') : 'no rings · no moons'}</div>
    <div style="background:#1c2338;border-radius:8px;padding:8px 10px;font-size:12px">${quirkHtml}</div>
    <div style="font-size:12px;line-height:1.5;color:#c3c9e2;font-style:italic">"${esc(identity.description)}"</div>
    <div style="font-size:11px;color:#5a6285">baseline income ${planet.baselineIncomePerSec} cr/s · pop cap ×${planet.populationCapMultiplier}</div>
  </div>`;
    };

    const quirkStats = Object.entries(quirkCounts)
      .map(([k, v]) => `<div class="stat">${QUIRK_LABEL[k] ?? k}: <b>${v}</b></div>`)
      .join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>StarBaron — Planet Generator Showcase</title>
<style>
body{margin:0;background:#0b0e1a;color:#e8eaf6;font-family:system-ui,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:28px}
h1{font-size:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-top:16px}
.stat-row{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
.stat{background:#151a2e;border:1px solid #2a3152;border-radius:10px;padding:10px 14px;font-size:13px}
.stat b{color:#ffb454;font-size:16px}
.note{font-size:12px;color:#8a93b8;line-height:1.6}
code{background:#1c2338;padding:2px 6px;border-radius:5px}
</style>
</head>
<body><div class="wrap">
<h1>🪐 StarBaron — Planet Generator Showcase</h1>
<div class="stat-row">
  <div class="stat"><b>${PLANETS.length}</b><br>real planets</div>
  ${[1, 2, 3, 4, 5].map((t) => `<div class="stat"><b>${tierCounts[t] ?? 0}</b><br>T${t}</div>`).join('')}
  <div class="stat"><b>${missingDataHandled}</b><br>missing fields handled</div>
  <div class="stat"><b>${zeroQuirk}</b><br>no quirk (sparse data)</div>
  <div class="stat"><b>${dupes}</b><br>duplicate names</div>
</div>
<div class="stat-row">${quirkStats}</div>
<p class="note">Determinism: Kepler-452 b generated twice → <code>${det1 === det2 ? 'IDENTICAL ✅' : 'MISMATCH ❌'}</code> · snapshot ${PLANET_SNAPSHOT.fetchedAt} · sha ${PLANET_SNAPSHOT.sha.slice(0, 10)}</p>
<div class="grid">
${showcase.map(planetCard).join('')}
</div>
<p class="note" style="margin-top:18px">Generated by <code>tests/showcase-generate.test.ts</code> — every palette, quirk, and description is derived from the planet's real catalogue data via FNV-1a seed. Regenerate: <code>npx vitest run tests/showcase-generate.test.ts</code></p>
</div></body></html>`;

    const out = join(process.cwd(), 'docs', 'showcase.html');
    mkdirSync(join(process.cwd(), 'docs'), { recursive: true });
    writeFileSync(out, html, 'utf8');
    expect(html).toContain('Kepler-452 b');
  });
});
