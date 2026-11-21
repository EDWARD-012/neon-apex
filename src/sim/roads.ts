import { type Track, wrapAngle } from './track'

// A road network: junctions joined by roads, each road a smooth centre line
// with a number of lanes each way. This is the start of Phase 5's open map.
// The closed race tracks in track.ts are untouched; a network is a second,
// separate way to lay out roads.
//
// Every road runs from the middle of one junction to the middle of another
// through a few points in between. Round each junction is an open area of
// tarmac, a circle cut open where its roads come in. The barriers are a
// set of wall segments: both edges of every road between its junctions,
// and the arcs of each junction between its roads.

export interface RoadSpec {
  name: string
  from: string
  to: string
  // Points the centre line passes through between the two junctions.
  via: [number, number][]
  // Lanes in each direction.
  lanes: number
}

export interface MapSpec {
  name: string
  junctions: { id: string; x: number; z: number }[]
  roads: RoadSpec[]
}

export const LANE = 3.5
// Tarmac past the outer lane line, to the barrier.
const SHOULDER = 1
// Barrier from the edge of the tarmac, as on the race tracks.
const BARRIER = 0.8
export const SAMPLE = 2

export interface Road {
  name: string
  from: number
  to: number
  lanes: number
  // Tarmac edge to edge.
  width: number
  // Centre to barrier.
  barrier: number
  n: number
  length: number
  x: Float64Array
  z: Float64Array
  // Unit tangent from `from` to `to`, and the normal to its right.
  tx: Float64Array
  tz: Float64Array
  nx: Float64Array
  nz: Float64Array
  // Where the road leaves the open area of each junction, along it.
  start: number
  end: number
}

export interface Junction {
  id: string
  x: number
  z: number
  // Radius of the open area.
  radius: number
  // Where each road meets it, by angle round the junction.
  mouths: { road: number; atStart: boolean; angle: number }[]
  // The edge of its open area, anticlockwise: across each road's mouth,
  // then round the barrier to the next road.
  outline: [number, number][]
}

// A stretch of barrier. The normal points out of the drivable area, into
// the wall.
export interface Wall {
  ax: number
  az: number
  bx: number
  bz: number
  nx: number
  nz: number
}

export interface RoadGraph {
  name: string
  junctions: Junction[]
  roads: Road[]
  walls: Wall[]
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  // Walls and road samples by grid cell, for nearby lookups.
  wallCells: Map<string, number[]>
  sampleCells: Map<string, number[]>
}

const CELL = 24
const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`

// A Catmull-Rom curve through the points, sampled every SAMPLE metres of
// its length.
function centreLine(points: [number, number][]): { x: number[]; z: number[] } {
  const dense: [number, number][] = []
  for (let k = 0; k < points.length - 1; k++) {
    const p0 = points[Math.max(0, k - 1)]
    const p1 = points[k]
    const p2 = points[k + 1]
    const p3 = points[Math.min(points.length - 1, k + 2)]
    const steps = Math.max(8, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.5))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  dense.push(points[points.length - 1])
  const x = [dense[0][0]]
  const z = [dense[0][1]]
  let carry = 0
  for (let k = 1; k < dense.length; k++) {
    const [ax, az] = dense[k - 1]
    const [bx, bz] = dense[k]
    const seg = Math.hypot(bx - ax, bz - az)
    let at = SAMPLE - carry
    while (at <= seg) {
      x.push(ax + ((bx - ax) * at) / seg)
      z.push(az + ((bz - az) * at) / seg)
      at += SAMPLE
    }
    carry = seg - (at - SAMPLE)
  }
  const [ex, ez] = dense[dense.length - 1]
  if (Math.hypot(ex - x[x.length - 1], ez - z[z.length - 1]) > 0.2) {
    x.push(ex)
    z.push(ez)
  }
  return { x, z }
}

function openFrames(x: ArrayLike<number>, z: ArrayLike<number>) {
  const n = x.length
  const tx = new Float64Array(n)
  const tz = new Float64Array(n)
  const nx = new Float64Array(n)
  const nz = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1)
    const b = Math.min(n - 1, i + 1)
    const dx = x[b] - x[a]
    const dz = z[b] - z[a]
    const len = Math.hypot(dx, dz) || 1
    tx[i] = dx / len
    tz[i] = dz / len
    // To the right of the direction of travel, as on the race tracks.
    nx[i] = -tz[i]
    nz[i] = tx[i]
  }
  return { tx, tz, nx, nz }
}

// The sample index nearest to a distance along a road.
const sampleAt = (road: Road, s: number) => Math.max(0, Math.min(road.n - 1, Math.round(s / SAMPLE)))

export function buildGraph(spec: MapSpec): RoadGraph {
  const ids = new Map(spec.junctions.map((j, k) => [j.id, k]))
  const junctions: Junction[] = spec.junctions.map((j) => ({ id: j.id, x: j.x, z: j.z, radius: 0, mouths: [], outline: [] }))
  const roads: Road[] = spec.roads.map((r, k) => {
    const from = ids.get(r.from)
    const to = ids.get(r.to)
    if (from === undefined || to === undefined) throw new Error(`Road ${r.name} joins an unknown junction`)
    const a = junctions[from]
    const b = junctions[to]
    const line = centreLine([[a.x, a.z], ...r.via, [b.x, b.z]])
    const x = Float64Array.from(line.x)
    const z = Float64Array.from(line.z)
    const width = 2 * r.lanes * LANE + 2 * SHOULDER
    junctions[from].mouths.push({ road: k, atStart: true, angle: 0 })
    junctions[to].mouths.push({ road: k, atStart: false, angle: 0 })
    return { name: r.name, from, to, lanes: r.lanes, width, barrier: width / 2 + BARRIER, n: x.length, length: (x.length - 1) * SAMPLE, x, z, ...openFrames(x, z), start: 0, end: 0 }
  })

  // Each junction's open area: big enough that no two roads' barriers
  // meet before they reach it. Measured on the direction each road leaves
  // in, a few metres out.
  for (const j of junctions) {
    for (const m of j.mouths) {
      const road = roads[m.road]
      const i = sampleAt(road, m.atStart ? 8 : road.length - 8)
      m.angle = Math.atan2(road.z[i] - j.z, road.x[i] - j.x)
    }
    j.mouths.sort((p, q) => p.angle - q.angle)
    let radius = Math.max(...j.mouths.map((m) => roads[m.road].barrier)) + 3
    for (let k = 0; k < j.mouths.length && j.mouths.length > 1; k++) {
      const p = j.mouths[k]
      const q = j.mouths[(k + 1) % j.mouths.length]
      let gap = q.angle - p.angle
      if (gap <= 0) gap += Math.PI * 2
      const need = (roads[p.road].barrier + roads[q.road].barrier) / (2 * Math.sin(Math.min(gap, Math.PI) / 2)) + 3
      radius = Math.max(radius, need)
    }
    j.radius = radius
  }
  for (const road of roads) {
    road.start = junctions[road.from].radius
    road.end = road.length - junctions[road.to].radius
    if (road.end - road.start < 10) throw new Error(`Road ${road.name} is too short for its junctions`)
  }

  const walls: Wall[] = []
  // A wall from a to b. Its normal is square to it, on the side that
  // (ox, oz) points to.
  const push = (ax: number, az: number, bx: number, bz: number, ox: number, oz: number) => {
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 1e-3) return
    let nx = -(bz - az) / len
    let nz = (bx - ax) / len
    if (nx * ox + nz * oz < 0) {
      nx = -nx
      nz = -nz
    }
    walls.push({ ax, az, bx, bz, nx, nz })
  }
  // Both edges of every road between its junctions.
  for (const road of roads) {
    const i0 = sampleAt(road, road.start)
    const i1 = sampleAt(road, road.end)
    for (const side of [-1, 1]) {
      for (let i = i0; i < i1; i++) {
        // Facing away from the road on this side.
        const b = road.barrier * side
        push(road.x[i] + road.nx[i] * b, road.z[i] + road.nz[i] * b, road.x[i + 1] + road.nx[i + 1] * b, road.z[i + 1] + road.nz[i + 1] * b, road.nx[i] * side, road.nz[i] * side)
      }
    }
  }
  // Round each junction, from one road's barrier to the next one's.
  for (const j of junctions) {
    const corners = j.mouths.map((m) => {
      const road = roads[m.road]
      const i = sampleAt(road, m.atStart ? road.start : road.end)
      // The road's two barriers where it leaves the junction. Whichever is
      // at the smaller angle round the junction is the clockwise one.
      const a = [road.x[i] + road.nx[i] * road.barrier, road.z[i] + road.nz[i] * road.barrier]
      const b = [road.x[i] - road.nx[i] * road.barrier, road.z[i] - road.nz[i] * road.barrier]
      const angle = (p: number[]) => Math.atan2(p[1] - j.z, p[0] - j.x)
      return wrapAngle(angle(a) - angle(b)) < 0 ? { cw: a, ccw: b } : { cw: b, ccw: a }
    })
    const count = corners.length
    for (let k = 0; k < count; k++) {
      j.outline.push([corners[k].cw[0], corners[k].cw[1]], [corners[k].ccw[0], corners[k].ccw[1]])
      const from = corners[k].ccw
      const to = count === 1 ? corners[k].cw : corners[(k + 1) % count].cw
      let a0 = Math.atan2(from[1] - j.z, from[0] - j.x)
      let a1 = Math.atan2(to[1] - j.z, to[0] - j.x)
      while (a1 <= a0) a1 += Math.PI * 2
      const r0 = Math.hypot(from[0] - j.x, from[1] - j.z)
      const r1 = Math.hypot(to[0] - j.x, to[1] - j.z)
      const steps = Math.max(2, Math.ceil(((a1 - a0) * Math.max(r0, r1)) / 3))
      let px = from[0]
      let pz = from[1]
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        const a = a0 + (a1 - a0) * t
        const r = r0 + (r1 - r0) * t
        const qx = s === steps ? to[0] : j.x + Math.cos(a) * r
        const qz = s === steps ? to[1] : j.z + Math.sin(a) * r
        // Facing away from the junction's middle.
        push(px, pz, qx, qz, (px + qx) / 2 - j.x, (pz + qz) / 2 - j.z)
        if (s < steps) j.outline.push([qx, qz])
        px = qx
        pz = qz
      }
    }
  }

  const wallCells = new Map<string, number[]>()
  walls.forEach((w, k) => {
    // Every cell the segment's bounding box touches.
    for (let cx = Math.floor(Math.min(w.ax, w.bx) / CELL); cx <= Math.floor(Math.max(w.ax, w.bx) / CELL); cx++) {
      for (let cz = Math.floor(Math.min(w.az, w.bz) / CELL); cz <= Math.floor(Math.max(w.az, w.bz) / CELL); cz++) {
        const id = `${cx},${cz}`
        const list = wallCells.get(id)
        if (list) list.push(k)
        else wallCells.set(id, [k])
      }
    }
  })
  const sampleCells = new Map<string, number[]>()
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  roads.forEach((road, r) => {
    for (let i = 0; i < road.n; i++) {
      const id = key(road.x[i], road.z[i])
      const list = sampleCells.get(id)
      // Road and sample packed into one number.
      if (list) list.push(r * 100000 + i)
      else sampleCells.set(id, [r * 100000 + i])
      minX = Math.min(minX, road.x[i])
      maxX = Math.max(maxX, road.x[i])
      minZ = Math.min(minZ, road.z[i])
      maxZ = Math.max(maxZ, road.z[i])
    }
  })
  return { name: spec.name, junctions, roads, walls, bounds: { minX, maxX, minZ, maxZ }, wallCells, sampleCells }
}

export interface NearWall {
  // The nearest point on the barrier, the normal into the wall there, and
  // how far the point asked about is from it (negative past the wall).
  x: number
  z: number
  nx: number
  nz: number
  distance: number
}

// The nearest barrier within a few cells, or null with none near.
export function nearestWall(graph: RoadGraph, x: number, z: number): NearWall | null {
  const cx = Math.floor(x / CELL)
  const cz = Math.floor(z / CELL)
  let bestD = Infinity
  let px = 0
  let pz = 0
  // Where segments meet, more than one is nearest at the same corner; their
  // normals together say which side of the corner the point is on.
  let sumX = 0
  let sumZ = 0
  let atEnd = false
  for (let ox = -1; ox <= 1; ox++) {
    for (let oz = -1; oz <= 1; oz++) {
      for (const k of graph.wallCells.get(`${cx + ox},${cz + oz}`) ?? []) {
        const w = graph.walls[k]
        const dx = w.bx - w.ax
        const dz = w.bz - w.az
        const t = Math.max(0, Math.min(1, ((x - w.ax) * dx + (z - w.az) * dz) / (dx * dx + dz * dz)))
        const qx = w.ax + dx * t
        const qz = w.az + dz * t
        const d = Math.hypot(qx - x, qz - z)
        if (d > bestD + 1e-6) continue
        const end = t === 0 || t === 1
        const same = Math.abs(qx - px) < 1e-6 && Math.abs(qz - pz) < 1e-6
        if (d < bestD - 1e-6 || !same) {
          bestD = d
          px = qx
          pz = qz
          sumX = w.nx
          sumZ = w.nz
          atEnd = end
        } else {
          sumX += w.nx
          sumZ += w.nz
          atEnd = atEnd && end
        }
      }
    }
  }
  if (bestD === Infinity) return null
  // Past the wall, on its outer side, the distance counts as negative.
  const outside = (x - px) * sumX + (z - pz) * sumZ > 0
  let nx = sumX
  let nz = sumZ
  // Round a corner from the inside, the wall faces the point.
  if (atEnd && !outside && bestD > 1e-4) {
    nx = px - x
    nz = pz - z
  }
  const len = Math.hypot(nx, nz) || 1
  return { x: px, z: pz, nx: nx / len, nz: nz / len, distance: outside ? -bestD : bestD }
}

export interface Place {
  road: number
  i: number
  // Along the road from its start, and across it (to the right).
  s: number
  d: number
  // The junction whose open area it is in, or -1.
  junction: number
}

// Where a point is on the network: the nearest road sample, and the
// junction if it is in one's open area.
export function whereOnGraph(graph: RoadGraph, x: number, z: number): Place | null {
  const cx = Math.floor(x / CELL)
  const cz = Math.floor(z / CELL)
  let best = -1
  let bestD = Infinity
  for (let reach = 1; reach <= 3 && best < 0; reach++) {
    for (let ox = -reach; ox <= reach; ox++) {
      for (let oz = -reach; oz <= reach; oz++) {
        for (const packed of graph.sampleCells.get(`${cx + ox},${cz + oz}`) ?? []) {
          const road = graph.roads[Math.floor(packed / 100000)]
          const i = packed % 100000
          const d = (road.x[i] - x) ** 2 + (road.z[i] - z) ** 2
          if (d < bestD) {
            bestD = d
            best = packed
          }
        }
      }
    }
  }
  if (best < 0) return null
  const r = Math.floor(best / 100000)
  const i = best % 100000
  const road = graph.roads[r]
  const dx = x - road.x[i]
  const dz = z - road.z[i]
  const s = i * SAMPLE + dx * road.tx[i] + dz * road.tz[i]
  let junction = -1
  for (const k of [road.from, road.to]) {
    const j = graph.junctions[k]
    if (Math.hypot(x - j.x, z - j.z) < j.radius) junction = k
  }
  return { road: r, i, s, d: dx * road.nx[i] + dz * road.nz[i], junction }
}

// The race code's cars collide with a closed track's barriers. On a
// network the barrier nearest the car stands in for it: a one-sample
// "track" whose right-hand barrier is that wall, so the car's own collision
// (push back, bounce, scrape, damage) works unchanged. It is far wider
// than any road, so its other barrier is never reached.
const REACH = 200
export function wallTrack(): Track {
  return {
    seed: 'wall',
    n: 1,
    spacing: 1,
    length: 1,
    width: (REACH - BARRIER) * 2,
    x: new Float64Array(1),
    z: new Float64Array(1),
    tx: new Float64Array(1),
    tz: new Float64Array([1]),
    nx: new Float64Array([1]),
    nz: new Float64Array(1),
    curvature: new Float64Array(1),
  }
}

// Points the stand-in track at the barrier nearest (x, z), or out of the
// way when none is near.
export function aimWallTrack(track: Track, graph: RoadGraph, x: number, z: number) {
  const wall = nearestWall(graph, x, z)
  if (!wall) {
    track.x[0] = x
    track.z[0] = z
    track.nx[0] = 1
    track.nz[0] = 0
    return
  }
  track.nx[0] = wall.nx
  track.nz[0] = wall.nz
  track.tx[0] = wall.nz
  track.tz[0] = -wall.nx
  track.x[0] = wall.x - wall.nx * REACH
  track.z[0] = wall.z - wall.nz * REACH
}
