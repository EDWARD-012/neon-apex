import { CAR } from './car'
import { frames, type Track } from './track'

// The racing line and the speed to carry along it.
//
// The line is the minimum-curvature path through the corridor between the
// barriers: wide on the way into a corner, tight at the apex, wide again on
// the way out. The speed profile is the fastest a point mass can follow that
// line with a fixed sideways grip limit, the car's acceleration curve and a
// fixed braking rate. AI drivers follow both, and the lap time of the profile
// is shown after a race as a reference, not as a proven best.

export interface RacingLine {
  // Lateral offset from the centre line at every track sample.
  offset: Float64Array
  x: Float64Array
  z: Float64Array
  curvature: Float64Array
  speed: Float64Array
  lapTime: number
}

// Sideways grip the profile plans with. Lower than the car's real limit, so
// a driver following it has a margin for small errors.
export const PLAN_GRIP = 15.5
const MARGIN = 2.2

// For a path at lateral offset d(s) from a centre line of curvature k(s),
// the path's curvature is close to k - d''. The line wants that as small as
// possible everywhere, so this minimises the sum of (k·ds² - Δ²d)² over the
// offsets, by gradient descent, never letting an offset past the margin.
//
// (Minimising the second differences of the points themselves looks like
// the same thing but is not: it also rewards shorter steps, which drags the
// line onto the inside kerb and makes hairpins tighter, not wider.)
function descend(curvature: ArrayLike<number>, ds: number, off: Float64Array, bound: number, iterations: number) {
  const m = off.length
  const at = (k: number) => (k + m) % m
  const e = new Float64Array(m)
  for (let iter = 0; iter < iterations; iter++) {
    for (let k = 0; k < m; k++) e[k] = curvature[k] * ds * ds - (off[at(k - 1)] - 2 * off[k] + off[at(k + 1)])
    for (let k = 0; k < m; k++) {
      off[k] = Math.max(-bound, Math.min(bound, off[k] + 0.1 * (e[at(k - 1)] - 2 * e[k] + e[at(k + 1)])))
    }
  }
}

// Minimum-curvature offsets. Fourth-order smoothing spreads very slowly
// across fine samples, so the long sweep of the line is solved on a coarse
// copy of the track first, then carried over to every sample and finished
// there, where the tight detail inside hairpins settles quickly.
function minimumCurvature(track: Track): Float64Array {
  const bound = track.width / 2 - MARGIN
  const m = Math.floor(track.n / 4)
  const cx = new Float64Array(m)
  const cz = new Float64Array(m)
  // Coarse sample k sits at fine index k·n/m, so the wrap at the finish line
  // lines up even when n is not a multiple of four.
  for (let k = 0; k < m; k++) {
    const i = Math.floor((k * track.n) / m)
    cx[k] = track.x[i]
    cz[k] = track.z[i]
  }
  const coarse = new Float64Array(m)
  descend(frames(cx, cz).curvature, track.length / m, coarse, bound, 4000)
  const offset = new Float64Array(track.n)
  for (let i = 0; i < track.n; i++) {
    const u = (i * m) / track.n
    const k = Math.floor(u)
    const t = u - k
    offset[i] = coarse[k] + (coarse[(k + 1) % m] - coarse[k]) * t
  }
  descend(track.curvature, track.spacing, offset, bound, 1500)
  return offset
}

export function speedProfile(curvature: ArrayLike<number>, ds: ArrayLike<number>): { speed: Float64Array; lapTime: number } {
  const n = curvature.length
  const speed = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const k = Math.abs(curvature[i])
    speed[i] = Math.min(CAR.topSpeed, k > 1e-6 ? Math.sqrt(PLAN_GRIP / k) : CAR.topSpeed)
  }
  // Forward pass: no faster than accelerating from the previous sample
  // allows. Twice round, so the wrap at the finish line settles.
  for (let lap = 0; lap < 2; lap++) {
    for (let i = 0; i < n; i++) {
      const prev = speed[(i - 1 + n) % n]
      const accel = CAR.engine * Math.max(0, 1 - prev / CAR.topSpeed) - CAR.drag * prev * prev - CAR.roll
      speed[i] = Math.min(speed[i], Math.sqrt(prev * prev + 2 * Math.max(0, accel) * ds[(i - 1 + n) % n]))
    }
  }
  // Backward pass: no faster than braking in time for the next sample allows.
  for (let lap = 0; lap < 2; lap++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = speed[(i + 1) % n]
      speed[i] = Math.min(speed[i], Math.sqrt(next * next + 2 * CAR.brake * 0.85 * ds[i]))
    }
  }
  let lapTime = 0
  for (let i = 0; i < n; i++) lapTime += ds[i] / ((speed[i] + speed[(i + 1) % n]) / 2)
  return { speed, lapTime }
}

export function racingLine(track: Track): RacingLine {
  const offset = minimumCurvature(track)
  const x = new Float64Array(track.n)
  const z = new Float64Array(track.n)
  for (let i = 0; i < track.n; i++) {
    x[i] = track.x[i] + offset[i] * track.nx[i]
    z[i] = track.z[i] + offset[i] * track.nz[i]
  }
  const { curvature } = frames(x, z)
  const ds = new Float64Array(track.n)
  for (let i = 0; i < track.n; i++) {
    const j = (i + 1) % track.n
    ds[i] = Math.hypot(x[j] - x[i], z[j] - z[i])
  }
  return { offset, x, z, curvature, ...speedProfile(curvature, ds) }
}

// How bendy a closed path is: the sum of squared curvature times length.
export function bendiness(curvature: ArrayLike<number>, spacing: number): number {
  let sum = 0
  for (let i = 0; i < curvature.length; i++) sum += curvature[i] * curvature[i] * spacing
  return sum
}
