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
