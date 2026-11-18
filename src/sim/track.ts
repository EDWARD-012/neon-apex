import { between, createRng, type Rng } from './rng'

// A closed circuit, sampled every SPACING metres along its centre line.
//
// Coordinates are metres on the ground plane: x and z, with y up. Heading 0
// faces +z. The track normal at each sample points to the right of the
// direction of travel, and lateral offsets are measured along it.
export interface Track {
  seed: string
  n: number
  spacing: number
  length: number
  width: number
  x: Float64Array
  z: Float64Array
  // Unit tangent (direction of travel) and unit normal (to the right).
  tx: Float64Array
  tz: Float64Array
  nx: Float64Array
  nz: Float64Array
  // Signed curvature in 1/m. Positive bends to the left.
  curvature: Float64Array
}

export const SPACING = 2
export const WIDTH = 15
// Tighter than this and a hairpin stops being fun at any speed.
export const MIN_RADIUS = 16
// Centre lines further apart than this keep two roads and their barriers
// from touching where the circuit folds back on itself.
const MIN_GAP = WIDTH * 2.6

export interface Location {
  // Nearest sample, distance along the centre line, and signed lateral
  // offset (positive to the right).
  i: number
  s: number
  d: number
}

function controlPoints(rng: Rng): [number, number][] {
  const count = Math.floor(between(rng, 9, 14))
  const base = between(rng, 230, 330)
  const stretch = between(rng, 0.75, 1.35)
  const points: [number, number][] = []
  for (let k = 0; k < count; k++) {
    const angle = ((k + between(rng, -0.3, 0.3)) / count) * Math.PI * 2
    // Some points get pulled in hard, which is where hairpins come from.
    const radius = base * (rng() < 0.25 ? between(rng, 0.35, 0.6) : between(rng, 0.75, 1.15))
    points.push([Math.cos(angle) * radius * stretch, Math.sin(angle) * radius / stretch])
  }
  return points
}

// Closed uniform Catmull-Rom spline through the control points, sampled
// densely, then resampled at equal arc length.
function spline(points: [number, number][]): { x: number[]; z: number[] } {
  const count = points.length
  const dense: [number, number][] = []
  const per = 60
  for (let k = 0; k < count; k++) {
    const p0 = points[(k - 1 + count) % count]
    const p1 = points[k]
    const p2 = points[(k + 1) % count]
    const p3 = points[(k + 2) % count]
    for (let j = 0; j < per; j++) {
      const t = j / per
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  const lengths = [0]
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1]
    const b = dense[i % dense.length]
    lengths.push(lengths[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const total = lengths[dense.length]
  const n = Math.round(total / SPACING)
  const x: number[] = []
  const z: number[] = []
  let j = 0
  for (let i = 0; i < n; i++) {
    const s = (i / n) * total
    while (lengths[j + 1] < s) j++
    const t = (s - lengths[j]) / (lengths[j + 1] - lengths[j] || 1)
    const a = dense[j]
    const b = dense[(j + 1) % dense.length]
    x.push(a[0] + (b[0] - a[0]) * t)
    z.push(a[1] + (b[1] - a[1]) * t)
  }
  return { x, z }
}

export function heading(dx: number, dz: number): number {
  return Math.atan2(dx, dz)
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

// Tangents, normals and curvature of a closed polyline.
export function frames(x: ArrayLike<number>, z: ArrayLike<number>) {
  const n = x.length
  const tx = new Float64Array(n)
  const tz = new Float64Array(n)
  const nx = new Float64Array(n)
  const nz = new Float64Array(n)
  const curvature = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n
    const b = (i + 1) % n
    const dx = x[b] - x[a]
    const dz = z[b] - z[a]
    const len = Math.hypot(dx, dz) || 1
    tx[i] = dx / len
    tz[i] = dz / len
    nx[i] = -tz[i]
    nz[i] = tx[i]
    // Turning angle between the two segments over their mean length.
    const h1 = heading(x[i] - x[a], z[i] - z[a])
    const h2 = heading(x[b] - x[i], z[b] - z[i])
    const ds = (Math.hypot(x[i] - x[a], z[i] - z[a]) + Math.hypot(x[b] - x[i], z[b] - z[i])) / 2 || 1
    curvature[i] = wrapAngle(h2 - h1) / ds
  }
  return { tx, tz, nx, nz, curvature }
}

function smooth(values: number[], passes: number) {
  const n = values.length
  for (let p = 0; p < passes; p++) {
    const copy = values.slice()
    for (let i = 0; i < n; i++) values[i] = (copy[(i - 1 + n) % n] + 2 * copy[i] + copy[(i + 1) % n]) / 4
  }
}

// Why a candidate circuit was thrown away, or null if it is fine.
export function problem(track: Track): string | null {
  if (track.length < 1200 || track.length > 2800) return 'length'
  for (let i = 0; i < track.n; i++) {
    if (Math.abs(track.curvature[i]) > 1 / MIN_RADIUS) return 'too tight'
  }
  // Non-neighbouring parts of the circuit must stay apart. A coarse grid
  // keeps this from being a full n² scan.
  const cell = MIN_GAP
  const grid = new Map<string, number[]>()
  for (let i = 0; i < track.n; i++) {
    const key = `${Math.floor(track.x[i] / cell)},${Math.floor(track.z[i] / cell)}`
    const list = grid.get(key)
    if (list) list.push(i)
    else grid.set(key, [i])
  }
  // Two samples count as neighbours along the road if the stretch between
  // them is short enough that it cannot have looped back.
  const near = Math.ceil((MIN_GAP * 1.6) / SPACING)
  for (let i = 0; i < track.n; i++) {
    const gx = Math.floor(track.x[i] / cell)
    const gz = Math.floor(track.z[i] / cell)
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        for (const j of grid.get(`${gx + ox},${gz + oz}`) ?? []) {
          const gap = Math.min(Math.abs(i - j), track.n - Math.abs(i - j))
          if (gap <= near) continue
          if (Math.hypot(track.x[i] - track.x[j], track.z[i] - track.z[j]) < MIN_GAP) return 'overlap'
        }
      }
    }
  }
  return null
}

export function buildTrack(seed: string): Track {
  const rng = createRng(`track/${seed}`)
  for (let attempt = 0; attempt < 400; attempt++) {
    const { x, z } = spline(controlPoints(rng))
    smooth(x, 6)
    smooth(z, 6)
    // Start the lap in the middle of the straightest stretch, so the grid
    // and the finish line never sit in a corner.
    const n = x.length
    const f = frames(x, z)
    let start = 0
    let best = Infinity
    const window = 30
    for (let i = 0; i < n; i++) {
      let bend = 0
      for (let k = -window; k <= window; k++) bend += Math.abs(f.curvature[(i + k + n) % n])
      if (bend < best) {
        best = bend
        start = i
      }
    }
    const rx = new Float64Array(n)
    const rz = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      rx[i] = x[(i + start) % n]
      rz[i] = z[(i + start) % n]
    }
    const track: Track = { seed, n, spacing: SPACING, length: n * SPACING, width: WIDTH, x: rx, z: rz, ...frames(rx, rz) }
    if (!problem(track)) return track
  }
  throw new Error(`No valid track for seed "${seed}"`)
}

// Finds where a point is relative to the track. With a hint (the last known
// sample) only a window around it is searched, which is what the game does
// every frame; without one the whole track is scanned.
export function locate(track: Track, x: number, z: number, hint = -1): Location {
  const n = track.n
  let best = -1
  let bestDist = Infinity
  const scan = (i: number) => {
    const k = ((i % n) + n) % n
    const d = (track.x[k] - x) ** 2 + (track.z[k] - z) ** 2
    if (d < bestDist) {
      bestDist = d
      best = k
    }
  }
  if (hint < 0) {
    for (let i = 0; i < n; i++) scan(i)
  } else {
    for (let i = hint - 40; i <= hint + 40; i++) scan(i)
  }
  // Project onto the segment towards whichever neighbour is closer.
  const i = best
  const dx = x - track.x[i]
  const dz = z - track.z[i]
  const along = dx * track.tx[i] + dz * track.tz[i]
  let s = i * track.spacing + along
  if (s < 0) s += track.length
  if (s >= track.length) s -= track.length
  return { i, s, d: dx * track.nx[i] + dz * track.nz[i] }
}

// A point on the track at distance s along it and offset d to the right.
export function pointAt(track: Track, s: number, d = 0): { x: number; z: number; heading: number } {
  const n = track.n
  const u = (((s / track.spacing) % n) + n) % n
  const i = Math.floor(u)
  const j = (i + 1) % n
  const t = u - i
  const x = track.x[i] + (track.x[j] - track.x[i]) * t + d * track.nx[i]
  const z = track.z[i] + (track.z[j] - track.z[i]) * t + d * track.nz[i]
  return { x, z, heading: heading(track.tx[i], track.tz[i]) }
}

// The track for a calendar day, the same for everyone.
export function dailySeed(date: Date = new Date()): string {
  return `night-${date.toISOString().slice(0, 10)}`
}
