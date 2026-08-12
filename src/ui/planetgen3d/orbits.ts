/**
 * Pure Kepler orbital mechanics.
 * No THREE dependency — plain math, fully unit-testable.
 */

import { rngFrom } from './random'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface OrbitalElements {
  a: number // semi-major axis
  e: number // eccentricity
  inc: number // inclination (rad)
  node: number // longitude of ascending node (rad)
  argP: number // argument of periapsis (rad)
  period: number // orbital period (time units)
  phase: number // time offset
  spin: number // planet spin rate (rad / time)
  tilt: number // axial tilt (rad)
}

/**
 * Solve Kepler's equation for position in the orbital plane, then rotate by
 * inclination, argument of periapsis and longitude of ascending node.
 *
 * @param a semi-major axis
 * @param e eccentricity (0 <= e < 1)
 * @param inc inclination (radians)
 * @param node longitude of ascending node (radians)
 * @param argP argument of periapsis (radians)
 * @param period orbital period (same time unit as t)
 * @param t current time
 */
export function keplerPosition(
  a: number,
  e: number,
  inc: number,
  node: number,
  argP: number,
  period: number,
  t: number,
): Vec3 {
  const safeE = Math.min(Math.max(e, 0), 0.999)
  const M = ((t / period) % 1) * Math.PI * 2

  // Newton-Raphson solve for eccentric anomaly E
  let E = M
  for (let i = 0; i < 8; i++) {
    const denom = 1 - safeE * Math.cos(E)
    if (Math.abs(denom) < 1e-12) break
    E = E - (E - safeE * Math.sin(E) - M) / denom
  }

  // Position in orbital plane (perifocal frame)
  const x = a * (Math.cos(E) - safeE)
  const z = a * Math.sqrt(1 - safeE * safeE) * Math.sin(E)

  // Rotate by argument of periapsis
  const cw = Math.cos(argP)
  const sw = Math.sin(argP)
  const x1 = x * cw - z * sw
  const z1 = x * sw + z * cw

  // Rotate by inclination
  const ci = Math.cos(inc)
  const si = Math.sin(inc)
  const y1 = z1 * si
  const z2 = z1 * ci

  // Rotate by longitude of ascending node
  const cn = Math.cos(node)
  const sn = Math.sin(node)

  return {
    x: x1 * cn + z2 * sn,
    y: y1,
    z: -x1 * sn + z2 * cn,
  }
}

/**
 * Generate deterministic orbital elements from a seed string and semi-major axis.
 */
export function seededOrbitalElements(seed: string, a: number): OrbitalElements {
  const r = rngFrom(seed)
  const e = 0.01 + r() * 0.09
  const inc = (r() - 0.5) * 0.05
  const node = r() * Math.PI * 2
  const argP = r() * Math.PI * 2
  const period = Math.pow(a, 1.5) * 30
  const phase = r() * Math.PI * 2
  const spin = 0.05 + r() * 0.4
  const tilt = (r() - 0.5) * 0.5

  return { a, e, inc, node, argP, period, phase, spin, tilt }
}

/**
 * Generate deterministic elements for a moon orbiting a planet.
 */
export function seededMoonElements(
  seed: string,
  planetRadius: number,
  index: number,
): OrbitalElements {
  const a = planetRadius * (2.2 + index * 0.5)
  const el = seededOrbitalElements(`${seed}|moon|${index}`, a)
  el.period = el.period * 0.05
  return el
}
