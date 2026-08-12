/**
 * Deterministic PRNG helpers for the 3D planet generator.
 * No Math.random — every value is seeded from a string or integer hash.
 */

export const FNV1A_32_OFFSET = 0x811c9dc5
export const FNV1A_32_PRIME = 0x01000193

export function fnv1a(input: string): number {
  let hash = FNV1A_32_OFFSET
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV1A_32_PRIME)
  }
  return hash >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function rngFrom(seed: string): () => number {
  return mulberry32(fnv1a(seed))
}
