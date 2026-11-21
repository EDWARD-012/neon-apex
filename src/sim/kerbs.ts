import type { Track } from './track'

// Red and white kerbs line the inside of the sharper corners. The track
// mesh draws them and the game rumbles when a car runs over them, so both
// read the same rule from here.

// Corners tighter than this radius, in metres, get a kerb.
export const KERB_RADIUS = 55
// The kerb starts this far inside the road's edge and ends this far
// outside it, in metres.
export const KERB_IN = 0.05
export const KERB_OUT = 0.9

// The side of the road that sample i has a kerb on: -1 left, 1 right, 0
// none. Kerbs are laid in blocks of two samples, and each block takes the
// side of its first sample.
export function kerbSide(track: Track, i: number): -1 | 0 | 1 {
  const n = track.n
  const at = (((i - (i % 2)) % n) + n) % n
  const k = track.curvature[at]
  if (Math.abs(k) < 1 / KERB_RADIUS) return 0
  // Positive curvature bends left, and left is the negative offset side.
  return k > 0 ? -1 : 1
}

// How much of a car is on the kerb, 0 to 1, for a car at sample i and
// lateral offset d (positive to the right), about `width` metres wide.
export function onKerb(track: Track, i: number, d: number, width = 1.9): number {
  const side = kerbSide(track, i)
  if (side === 0) return 0
  const half = track.width / 2
  const from = half - KERB_IN
  const to = half + KERB_OUT
  const centre = side * d
  const overlap = Math.min(centre + width / 2, to) - Math.max(centre - width / 2, from)
  return Math.max(0, Math.min(1, overlap / Math.min(width, to - from)))
}
