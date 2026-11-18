// Seeded random numbers (FNV-1a hash into mulberry32). A track is defined by
// its seed, so the same seed has to build the same track everywhere.

export type Rng = () => number

export function hashSeed(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function createRng(seed: string): Rng {
  let a = hashSeed(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const between = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng()
export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]
