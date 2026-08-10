// Showcase generator as a vitest test. Writes docs/showcase-planets-2d.html.
// Run: npx vitest run tests/showcase-planets-2d.test.ts
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PLANETS } from '../src/sim/data/planets'
import {
  generatePlanetIdentity,
  radiusBandOf,
  resolveRadius,
} from '../src/sim/planets'
import { generatePlanetRenderFeatures } from '../src/ui/planetgen/features'

const SHOWCASE_NAMES = [
  'K2-210 b',
  'Kepler-452 b',
  'K2-156 b',
  'Kepler-200 c',
  'HD 158259 e',
  'Kepler-22 b',
  'HD 205158 b',
  'Kepler-304 d',
  'HAT-P-64 b',
  'Kepler-82 c',
]

/**
 * Compact inline JS mirror of src/ui/planetgen/render.ts.
 * Keep in sync when changing the painter.
 */
const RENDER_JS = `function hexToRgba(hex, alpha) {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return 'rgba(192,192,192,' + alpha + ')';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
function withClip(ctx, cx, cy, r, fn) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  fn();
  ctx.restore();
}
function drawRingHalf(ctx, f, back, w, h) {
  const ri = f.rings;
  const cx = f.cx, cy = f.cy;
  ctx.save();
  ctx.beginPath();
  if (back) ctx.rect(0, 0, w, cy);
  else ctx.rect(0, cy, w, h - cy);
  ctx.clip();
  const ryO = ri.outerRadius * Math.sin(ri.tilt);
  const ryI = ri.innerRadius * Math.sin(ri.tilt);
  ctx.beginPath();
  ctx.ellipse(cx, cy, ri.outerRadius, ryO, 0, 0, Math.PI * 2);
  ctx.ellipse(cx, cy, ri.innerRadius, ryI, 0, 0, Math.PI * 2, true);
  ctx.fillStyle = hexToRgba(ri.color, ri.alpha);
  ctx.fill('evenodd');
  ctx.restore();
}
function renderPlanet(ctx, f) {
  const w = f.width, h = f.height, cx = f.cx, cy = f.cy, r = f.discRadius;
  ctx.clearRect(0, 0, w, h);
  for (const s of f.starfield) {
    ctx.fillStyle = 'rgba(245,240,224,' + s.alpha + ')';
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.size, 0, Math.PI * 2);
    ctx.fill();
  }
  if (f.rings.enabled) drawRingHalf(ctx, f, true, w, h);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = f.baseColor;
  ctx.fill();
  withClip(ctx, cx, cy, r, function () {
    if (f.radiusBand === 'rocky') {
      for (const c of f.surface.craters) {
        const px = cx + c.x * r, py = cy + c.y * r, pr = c.r * r;
        ctx.fillStyle = 'rgba(0,0,0,' + (0.25 + c.depth * 0.35) + ')';
        ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,' + (0.08 + c.depth * 0.12) + ')';
        ctx.beginPath(); ctx.arc(px - pr * 0.25, py - pr * 0.25, pr * 0.85, 0, Math.PI * 2); ctx.fill();
      }
    } else if (f.radiusBand === 'gaseous') {
      for (const b of f.surface.bands) {
        const by = cy + b.y * r, bh = b.height * r;
        const g = ctx.createLinearGradient(0, by - bh, 0, by + bh);
        g.addColorStop(0, hexToRgba(b.color, 0));
        g.addColorStop(0.5, hexToRgba(b.color, b.alpha));
        g.addColorStop(1, hexToRgba(b.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, by - bh, w, bh * 2);
      }
    } else {
      for (const b of f.surface.blobs) {
        const px = cx + b.x * r, py = cy + b.y * r, pr = b.r * r;
        ctx.fillStyle = hexToRgba(b.color, 0.78);
        ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      }
      for (const b of f.surface.bands) {
        const by = cy + b.y * r, bh = b.height * r;
        const g = ctx.createLinearGradient(0, by - bh, 0, by + bh);
        g.addColorStop(0, hexToRgba(b.color, 0));
        g.addColorStop(0.5, hexToRgba(b.color, b.alpha));
        g.addColorStop(1, hexToRgba(b.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, by - bh, w, bh * 2);
      }
    }
  });
  if (f.atmosphere.tint && f.atmosphere.alpha > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cy, r * 0.82, cx, cy, f.atmosphere.glowRadius);
    g.addColorStop(0, hexToRgba(f.atmosphere.tint, 0));
    g.addColorStop(0.6, hexToRgba(f.atmosphere.tint, f.atmosphere.alpha * 0.5));
    g.addColorStop(1, hexToRgba(f.atmosphere.tint, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const la = f.lightAngle;
  const ldx = Math.cos(la) * r * 0.55, ldy = Math.sin(la) * r * 0.55;
  const lx = cx + ldx, ly = cy + ldy;
  const ox = cx - ldx * 0.9, oy = cy - ldy * 0.9;
  const shade = ctx.createRadialGradient(lx, ly, 0, ox, oy, r * 1.9);
  shade.addColorStop(0, 'rgba(255,255,255,0.32)');
  shade.addColorStop(0.45, 'rgba(255,255,255,0.06)');
  shade.addColorStop(0.55, 'rgba(0,0,0,0.12)');
  shade.addColorStop(1, 'rgba(0,0,0,0.58)');
  ctx.fillStyle = shade;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  const hx = cx + Math.cos(la) * r * 0.42, hy = cy + Math.sin(la) * r * 0.42;
  const hi = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.28);
  hi.addColorStop(0, 'rgba(255,255,255,0.35)');
  hi.addColorStop(0.3, 'rgba(255,255,255,0.12)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hi;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (f.rings.enabled) drawRingHalf(ctx, f, false, w, h);
  for (const m of f.moons.items) {
    const mx = cx + Math.cos(m.angle) * m.distance;
    const my = cy + Math.sin(m.angle) * m.distance * 0.6;
    ctx.save();
    ctx.fillStyle = m.color;
    ctx.beginPath(); ctx.arc(mx, my, m.radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-atop';
    const ms = ctx.createRadialGradient(mx + Math.cos(la) * m.radius * 0.4, my + Math.sin(la) * m.radius * 0.4, 0, mx, my, m.radius * 1.6);
    ms.addColorStop(0, 'rgba(255,255,255,0.35)');
    ms.addColorStop(0.5, 'rgba(0,0,0,0.1)');
    ms.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = ms;
    ctx.beginPath(); ctx.arc(mx, my, m.radius, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}`

describe('showcase-planets-2d', () => {
  it('generates docs/showcase-planets-2d.html', () => {
    const samples = SHOWCASE_NAMES.map((name) => {
      const entry = PLANETS.find((p) => p.name === name)!
      const identity = generatePlanetIdentity(entry)
      const band = radiusBandOf(resolveRadius(entry, () => 0.5))
      const features = generatePlanetRenderFeatures(
        name,
        identity.visual,
        entry.tier,
        band,
      )
      return {
        ...features,
        starType: entry.starType,
        distancePc: entry.distancePc,
        radiusEarth: entry.radiusEarth,
      }
    })

    const planetData = JSON.stringify(samples)


    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>StarBaron — 2.5D Planet Renderer Showcase</title>
<style>
body{margin:0;background:#0b0e1a;color:#e8eaf6;font-family:system-ui,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:28px}
h1{font-size:24px}
.note{font-size:12px;color:#8a93b8;line-height:1.6}
code{background:#1c2338;padding:2px 6px;border-radius:5px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-top:16px}
.card{background:#151a2e;border:1px solid #2a3152;border-radius:14px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:10px}
.name{font-size:16px;font-weight:700;color:#fff}
.meta{font-size:12px;color:#8a93b8;text-align:center}
.tags{font-size:12px;color:#5ab8ff;min-height:18px}
</style>
</head>
<body><div class="wrap">
<h1>🪐 StarBaron — 2.5D Planet Renderer Showcase</h1>
<p class="note">Deterministic 2.5D canvas planets. Tier affects size; radius band drives surface style. <code>file://</code> safe — no build imports.</p>
<div class="grid" id="grid"></div>
<p class="note" style="margin-top:18px">Generated by <code>tests/showcase-planets-2d.test.ts</code> · inline painter mirrors <code>src/ui/planetgen/render.ts</code>.</p>
<script type="application/json" id="planet-data">${planetData}</script>
<script>
${RENDER_JS}
(function () {
  const data = JSON.parse(document.getElementById('planet-data').textContent)
  const grid = document.getElementById('grid')
  for (const f of data) {
    const card = document.createElement('div')
    card.className = 'card'
    const canvas = document.createElement('canvas')
    canvas.width = f.width
    canvas.height = f.height
    canvas.style.width = f.cssSize + 'px'
    canvas.style.height = f.cssSize + 'px'
    renderPlanet(canvas.getContext('2d'), f)
    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = f.name
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = [f.starType || 'unknown star', f.distancePc ? f.distancePc.toFixed(1) + ' pc' : 'distance unknown', 'Tier ' + f.tier, f.radiusEarth ? f.radiusEarth.toFixed(2) + ' R⊕' : '?'].join(' · ')
    const tags = document.createElement('div')
    tags.className = 'tags'
    const t = []
    if (f.rings.enabled) t.push('🪐 rings')
    if (f.moons.count) t.push('🌙 ' + f.moons.count + ' moon' + (f.moons.count > 1 ? 's' : ''))
    if (f.atmosphere.tint) t.push('☁️ atmosphere')
    tags.textContent = t.join(' · ') || 'no rings · no moons'
    card.append(canvas, name, meta, tags)
    grid.appendChild(card)
  }
})()
</script>
</div></body></html>`

    const out = join(process.cwd(), 'docs', 'showcase-planets-2d.html')
    mkdirSync(join(process.cwd(), 'docs'), { recursive: true })
    writeFileSync(out, html, 'utf8')

    expect(html).toContain('Kepler-452 b')
    expect(html).toContain('K2-210 b')
    expect(html).toContain(RENDER_JS.slice(0, 40))
  })
})
