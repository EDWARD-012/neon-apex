import { BoxGeometry, BufferAttribute, BufferGeometry, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { LANE, type RoadGraph, SAMPLE } from '../sim/roads'
import type { Track } from '../sim/track'
import { pbr } from './assets'
import { buildLandscape, type Landscape } from './landscape'
import { misty } from './mist'

// The test map drawn by day in the mountain valley: tarmac for every road
// and junction, white lines, a steel barrier along every wall, and the
// valley's forest, boulders and mountains round it.

// UVs in metres over this, so the road photo tiles as on the race tracks.
const ROAD_UV = 12

function geometry(pos: number[], uv: number[] | null, index: number[] | null) {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  if (uv) geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  if (index) geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

// Every road between its junctions, barrier to barrier.
function tarmac(graph: RoadGraph): BufferGeometry {
  const parts: BufferGeometry[] = []
  for (const road of graph.roads) {
    const i0 = Math.round(road.start / SAMPLE)
    const i1 = Math.round(road.end / SAMPLE)
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    for (let i = i0; i <= i1; i++) {
      for (const side of [-1, 1]) {
        const d = side * road.barrier
        pos.push(road.x[i] + road.nx[i] * d, 0, road.z[i] + road.nz[i] * d)
        uv.push(d / ROAD_UV, (i * SAMPLE) / ROAD_UV)
      }
      const r = (i - i0) * 2
      if (i < i1) index.push(r, r + 1, r + 2, r + 1, r + 3, r + 2)
    }
    parts.push(geometry(pos, uv, index))
  }
  // Each junction's open area, as a fan from its middle.
  for (const j of graph.junctions) {
    const pos = [j.x, 0, j.z]
    const uv = [j.x / ROAD_UV, j.z / ROAD_UV]
    for (const [x, z] of j.outline) {
      pos.push(x, 0, z)
      uv.push(x / ROAD_UV, z / ROAD_UV)
    }
    const index: number[] = []
    const n = j.outline.length
    for (let k = 0; k < n; k++) index.push(0, 1 + ((k + 1) % n), 1 + k)
    parts.push(geometry(pos, uv, index))
  }
  return mergeGeometries(parts)
}

// White lines: solid along both edges; down the middle a dashed line on
// a road with one lane each way, a solid double line with dashed lanes
// beside it on one with two.
function lines(graph: RoadGraph): BufferGeometry {
  const pos: number[] = []
  const strip = (road: RoadGraph['roads'][number], d: number, half: number, dash: boolean) => {
    const i0 = Math.round(road.start / SAMPLE)
    const i1 = Math.round(road.end / SAMPLE)
    for (let i = i0; i < i1; i++) {
      // Dashes 3 m on, 5 m off.
      if (dash && ((i * SAMPLE) % 8) >= 3) continue
      const j = i + 1
      const a = [road.x[i] + road.nx[i] * (d - half), road.z[i] + road.nz[i] * (d - half)]
      const b = [road.x[i] + road.nx[i] * (d + half), road.z[i] + road.nz[i] * (d + half)]
      const c = [road.x[j] + road.nx[j] * (d - half), road.z[j] + road.nz[j] * (d - half)]
      const e = [road.x[j] + road.nx[j] * (d + half), road.z[j] + road.nz[j] * (d + half)]
      pos.push(a[0], 0.012, a[1], b[0], 0.012, b[1], c[0], 0.012, c[1], b[0], 0.012, b[1], e[0], 0.012, e[1], c[0], 0.012, c[1])
    }
  }
  for (const road of graph.roads) {
    const edge = road.width / 2 - 0.35
    strip(road, -edge, 0.08, false)
    strip(road, edge, 0.08, false)
    if (road.lanes === 1) strip(road, 0, 0.07, true)
    else {
      strip(road, -0.15, 0.06, false)
      strip(road, 0.15, 0.06, false)
      for (let lane = 1; lane < road.lanes; lane++) {
        strip(road, -lane * LANE, 0.06, true)
        strip(road, lane * LANE, 0.06, true)
      }
    }
  }
  return geometry(pos, null, null)
}

// A galvanised rail along every wall, its lip leaning out a little like the
// fold of a W-beam, on posts every 2.5 m.
function barriers(graph: RoadGraph, group: Group) {
  const metal = misty(new MeshStandardMaterial({ color: '#c3c8cc', metalness: 0.85, roughness: 0.32, side: DoubleSide }))
  const pos: number[] = []
  for (const w of graph.walls) {
    for (const [y0, y1, out] of [
      [0.52, 0.86, 0],
      [0.86, 0.9, 0.06],
    ]) {
      const ax = w.ax + w.nx * out
      const az = w.az + w.nz * out
      const bx = w.bx + w.nx * out
      const bz = w.bz + w.nz * out
      pos.push(ax, y0, az, bx, y0, bz, ax, y1, az, ax, y1, az, bx, y0, bz, bx, y1, bz)
    }
  }
  const rail = new Mesh(geometry(pos, null, null), metal)
  rail.castShadow = true
  rail.receiveShadow = true
  group.add(rail)
  const spots: [number, number][] = []
  let carry = 0
  for (const w of graph.walls) {
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az)
    let at = carry
    while (at < len) {
      spots.push([w.ax + ((w.bx - w.ax) * at) / len + w.nx * 0.1, w.az + ((w.bz - w.az) * at) / len + w.nz * 0.1])
      at += 2.5
    }
    carry = at - len
  }
  const posts = new InstancedMesh(new BoxGeometry(0.14, 0.9, 0.14), misty(new MeshStandardMaterial({ color: '#8f969c', metalness: 0.7, roughness: 0.45 })), spots.length)
  const m = new Matrix4()
  spots.forEach(([x, z], k) => posts.setMatrixAt(k, m.makeTranslation(x, 0.45, z)))
  posts.castShadow = true
  group.add(posts)
}

// The roads' samples as one long "track", for the landscape, which keeps
// its trees and boulders off them and rings them with mountains.
function asTrack(graph: RoadGraph): Track {
  const x: number[] = []
  const z: number[] = []
  for (const road of graph.roads) {
    x.push(...road.x)
    z.push(...road.z)
  }
  const n = x.length
  const zero = () => new Float64Array(n)
  return { seed: graph.name, n, spacing: SAMPLE, length: n * SAMPLE, width: Math.max(...graph.roads.map((r) => r.width)), x: Float64Array.from(x), z: Float64Array.from(z), tx: zero(), tz: zero(), nx: zero(), nz: zero(), curvature: zero() }
}

export interface RoadMap {
  group: Group
  road: MeshStandardMaterial
  land: Landscape
}

export function buildRoadMap(graph: RoadGraph): RoadMap {
  const group = new Group()
  const road = misty(new MeshStandardMaterial({ ...pbr('road', 3, 3), roughness: 1, metalness: 0, envMapIntensity: 0.5 }))
  road.normalScale.set(0.7, 0.7)
  const surface = new Mesh(tarmac(graph), road)
  surface.receiveShadow = true
  group.add(surface)
  const paint = new Mesh(lines(graph), misty(new MeshStandardMaterial({ color: '#bdbcb4', roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 })))
  paint.receiveShadow = true
  group.add(paint)
  barriers(graph, group)
  // The trees keep off each junction's open area too.
  const land = buildLandscape(
    asTrack(graph),
    graph.junctions.map((j) => ({ x: j.x, z: j.z, r: j.radius + 8 })),
  )
  group.add(land.group)
  return { group, road, land }
}
