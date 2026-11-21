import { BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Group, Matrix4, Mesh, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { barrierOffset } from '../sim/car'
import type { Track } from '../sim/track'
import { TV_EVERY } from '../cinema'
import { pbr } from './assets'
import { distanceField } from './city'

// A concrete overpass across the mountain road: a deck on two abutments
// just beyond the barriers, carrying a side road that runs down grass
// embankments either side. It stands on the straightest stretch well away
// from the start, where its embankments meet no other part of the road.

// Height of the deck's underside above the road.
const CLEAR = 5.6
// Top of the deck, where the side road runs.
const TOP = 6.75
// Half the deck's width, along the race road.
const HALF = 4.5
// How far each embankment runs out from its abutment.
const RAMP = 45

export interface BridgePlace {
  i: number
  // Distance from the centre line to each abutment's inner face.
  inner: number
  // And to its outer face, where the embankment starts.
  outer: number
}

export function bridgeSpot(track: Track): BridgePlace | null {
  const n = track.n
  const wall = barrierOffset(track)
  const inner = wall + 2.6
  const outer = wall + 5
  const near = distanceField(track)
  const away = Math.ceil(160 / track.spacing)
  const reach = Math.ceil(12 / track.spacing)
  let best: BridgePlace | null = null
  let bestBend = Infinity
  for (let i = away; i < n - away; i += 3) {
    // Clear of the replays' TV cameras, which stand by the road.
    const gap = (i * track.spacing) % TV_EVERY
    if (gap < 22 || gap > TV_EVERY - 22) continue
    // Straight for the deck's width and a little either side.
    let bend = 0
    for (let k = -reach; k <= reach; k++) bend = Math.max(bend, Math.abs(track.curvature[(i + k + n) % n]))
    if (bend > 1 / 300 || bend >= bestBend) continue
    // The abutments and embankments meet no other road: everywhere along
    // them, the nearest road is this one.
    let clear = true
    for (const side of [-1, 1]) {
      for (let u = inner; u <= outer + RAMP + 6 && clear; u += 3) {
        for (const v of [-HALF - 4, 0, HALF + 4]) {
          const x = track.x[i] + track.nx[i] * side * u + track.tx[i] * v
          const z = track.z[i] + track.nz[i] * side * u + track.tz[i] * v
          if (near(x, z, 120) < Math.min(u, wall + 14) - 1.5) clear = false
        }
      }
    }
    if (!clear) continue
    best = { i, inner, outer }
    bestBend = bend
  }
  return best
}

// Board-marked concrete, weathered: grey with fine speckle, the lines of
// the formwork boards, and dark streaks running down from the top.
function concreteTexture() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#b4b1aa'
  g.fillRect(0, 0, 256, 256)
  let seed = 11
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let k = 0; k < 2600; k++) {
    const v = 150 + random() * 60
    g.fillStyle = `rgba(${v},${v - 2},${v - 6},0.35)`
    g.fillRect(random() * 256, random() * 256, 1 + random() * 2, 1 + random() * 2)
  }
  // Formwork boards, 20 cm, each a shade off the next.
  for (let y = 0; y < 256; y += 32) {
    g.fillStyle = `rgba(0,0,0,${0.02 + random() * 0.04})`
    g.fillRect(0, y, 256, 32)
    g.fillStyle = 'rgba(60,58,54,0.25)'
    g.fillRect(0, y, 256, 1)
  }
  for (let k = 0; k < 26; k++) {
    const x = random() * 256
    const len = 40 + random() * 200
    const grad = g.createLinearGradient(0, 0, 0, len)
    grad.addColorStop(0, `rgba(55,52,48,${0.12 + random() * 0.2})`)
    grad.addColorStop(1, 'rgba(55,52,48,0)')
    g.fillStyle = grad
    g.fillRect(x, 0, 2 + random() * 7, len)
  }
  const t = new CanvasTexture(c)
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  return t
}

// A box in the bridge's own frame (u across the race road, v along it, y
// up), with UVs in metres over `tile` so textures keep their size.
function box(u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, tile: number): BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[], s: (p: number[]) => [number, number]) => {
    for (const p of [a, b, c, a, c, d]) {
      pos.push(p[0], p[1], p[2])
      const [su, sv] = s(p)
      uv.push(su / tile, sv / tile)
    }
  }
  const P = (u: number, y: number, v: number) => [u, y, v]
  const across = (p: number[]): [number, number] => [p[0], p[1]]
  const along = (p: number[]): [number, number] => [p[2], p[1]]
  const flat = (p: number[]): [number, number] => [p[0], p[2]]
  quad(P(u0, y0, v1), P(u1, y0, v1), P(u1, y1, v1), P(u0, y1, v1), across)
  quad(P(u1, y0, v0), P(u0, y0, v0), P(u0, y1, v0), P(u1, y1, v0), across)
  quad(P(u1, y0, v1), P(u1, y0, v0), P(u1, y1, v0), P(u1, y1, v1), along)
  quad(P(u0, y0, v0), P(u0, y0, v1), P(u0, y1, v1), P(u0, y1, v0), along)
  quad(P(u0, y1, v1), P(u1, y1, v1), P(u1, y1, v0), P(u0, y1, v0), flat)
  quad(P(u0, y0, v0), P(u1, y0, v0), P(u1, y0, v1), P(u0, y0, v1), flat)
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geo.computeVertexNormals()
  return geo
}

// A wall with the outline `shape` (points in v and y) running across from
// u0 to u1, with UVs in metres over tile.
function prism(u0: number, u1: number, shape: [number, number][], tile: number): BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const put = (u: number, v: number, y: number, su: number, sv: number) => {
    pos.push(u, y, v)
    uv.push(su / tile, sv / tile)
  }
  // The two faces, as fans.
  for (let k = 1; k < shape.length - 1; k++) {
    for (const [v, y] of [shape[0], shape[k], shape[k + 1]]) put(u1, v, y, v, y)
    for (const [v, y] of [shape[0], shape[k + 1], shape[k]]) put(u0, v, y, v, y)
  }
  // The sides between them.
  for (let k = 0; k < shape.length; k++) {
    const [va, ya] = shape[k]
    const [vb, yb] = shape[(k + 1) % shape.length]
    const run = Math.hypot(vb - va, yb - ya)
    put(u0, va, ya, u0, 0)
    put(u1, va, ya, u1, 0)
    put(u1, vb, yb, u1, run)
    put(u0, va, ya, u0, 0)
    put(u1, vb, yb, u1, run)
    put(u0, vb, yb, u0, run)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geo.computeVertexNormals()
  return geo
}

// One side's embankment, from the abutment at u = from (side 1 or -1) out
// RAMP metres, its top falling from TOP to the ground, its flanks at one
// in one and a half. Returns the grass and the road along its top.
function embankment(from: number, side: number): { grass: BufferGeometry; road: BufferGeometry } {
  const steps = 10
  const grass: number[] = []
  const guv: number[] = []
  const road: number[] = []
  const ruv: number[] = []
  const section = (k: number) => {
    const t = k / steps
    const u = side * (from + t * RAMP)
    // Eased so the top rounds over into the ground.
    const h = TOP * (1 - t) ** 1.3
    const spread = HALF + 1.5 * h
    return { u, h, spread }
  }
  const push = (list: number[], uvs: number[], p: number[][], tile: number) => {
    for (const q of p) {
      list.push(q[0], q[1], q[2])
      uvs.push(q[0] / tile, q[2] / tile + q[1] / tile)
    }
  }
  for (let k = 0; k < steps; k++) {
    const a = section(k)
    const b = section(k + 1)
    // Flanks: from the top edge down to the ground on each side.
    for (const s of [-1, 1]) {
      const ta = [a.u, a.h, s * HALF]
      const tb = [b.u, b.h, s * HALF]
      const ga = [a.u, -0.03, s * a.spread]
      const gb = [b.u, -0.03, s * b.spread]
      push(grass, guv, [ta, tb, gb, ta, gb, ga], 6)
    }
    // Verges of the top either side of the side road.
    for (const s of [-1, 1]) {
      const pa = [a.u, a.h, s * HALF]
      const pb = [b.u, b.h, s * HALF]
      const qa = [a.u, a.h + 0.02, s * 3.6]
      const qb = [b.u, b.h + 0.02, s * 3.6]
      push(grass, guv, [qa, qb, pb, qa, pb, pa], 6)
    }
    const la = [a.u, a.h + 0.03, -3.6]
    const ra = [a.u, a.h + 0.03, 3.6]
    const lb = [b.u, b.h + 0.03, -3.6]
    const rb = [b.u, b.h + 0.03, 3.6]
    push(road, ruv, [la, ra, rb, la, rb, lb], 8)
  }
  const make = (p: number[], uvs: number[]) => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(p), 3))
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
    geo.computeVertexNormals()
    return geo
  }
  return { grass: make(grass, guv), road: make(road, ruv) }
}

export interface Bridge {
  group: Group
  // Places trees must keep away from.
  clear: { x: number; z: number; r: number }[]
}

export function buildBridge(track: Track, place: BridgePlace, shadows: boolean): Bridge {
  const { i, inner, outer } = place
  const concrete: BufferGeometry[] = []
  const grass: BufferGeometry[] = []
  const road: BufferGeometry[] = []
  const steel: BufferGeometry[] = []
  // The deck: a slab with a narrower box girder under it, so its edges
  // overhang and throw a line of shade.
  concrete.push(box(-outer, outer, -HALF, HALF, TOP - 0.4, TOP, 3))
  concrete.push(box(-outer, outer, -HALF + 0.9, HALF - 0.9, CLEAR, TOP - 0.4, 3))
  // Parapets the length of the deck, with a steel rail along the top.
  for (const s of [-1, 1]) {
    concrete.push(box(-outer, outer, s * HALF - (s > 0 ? 0.32 : 0), s * HALF + (s < 0 ? 0.32 : 0), TOP, TOP + 0.85, 3))
    steel.push(box(-outer, outer, s * (HALF - 0.16) - 0.04, s * (HALF - 0.16) + 0.04, TOP + 1.05, TOP + 1.12, 1))
    for (let u = -outer; u <= outer + 0.01; u += 2.4) steel.push(box(u - 0.04, u + 0.04, s * (HALF - 0.16) - 0.04, s * (HALF - 0.16) + 0.04, TOP + 0.85, TOP + 1.05, 1))
  }
  // Abutments: walls as wide as the embankment behind them, their sides
  // sloping with its flanks, on a footing.
  const foot = HALF + 1.5 * TOP
  for (const s of [-1, 1]) {
    const [u0, u1] = s > 0 ? [inner, outer] : [-outer, -inner]
    concrete.push(prism(u0, u1, [[-foot, -0.03], [foot, -0.03], [HALF, TOP], [-HALF, TOP]], 3))
    concrete.push(box(u0 - (s > 0 ? 0.3 : 0), u1 + (s < 0 ? 0.3 : 0), -foot - 0.3, foot + 0.3, -0.03, 0.3, 3))
    const e = embankment(outer, s)
    grass.push(e.grass)
    road.push(e.road)
  }
  // The side road across the deck itself.
  road.push(box(-outer, outer, -3.6, 3.6, TOP, TOP + 0.03, 8))

  // Into the race road's frame: u along the normal, v along the road.
  const frame = new Matrix4().makeRotationY(Math.atan2(track.tx[i], track.tz[i])).setPosition(track.x[i], 0, track.z[i])
  const group = new Group()
  const mesh = (parts: BufferGeometry[], material: MeshStandardMaterial, cast: boolean) => {
    const geo = mergeGeometries(parts)
    geo.applyMatrix4(frame)
    const m = new Mesh(geo, material)
    m.castShadow = cast && shadows
    m.receiveShadow = true
    group.add(m)
  }
  // Two-sided, so the winding of the hand-built faces doesn't matter.
  mesh(concrete, new MeshStandardMaterial({ map: concreteTexture(), roughness: 0.92, envMapIntensity: 0.4, side: DoubleSide }), true)
  mesh(grass, new MeshStandardMaterial({ ...pbr('ground', 1), color: '#8fa56a', roughness: 1, envMapIntensity: 0.35, side: DoubleSide }), false)
  mesh(road, new MeshStandardMaterial({ ...pbr('road', 1), roughness: 0.95, envMapIntensity: 0.4, side: DoubleSide }), false)
  mesh(steel, new MeshStandardMaterial({ color: '#7f868c', roughness: 0.45, metalness: 0.7 }), true)

  // Trees keep off the abutments and embankments.
  const clear: { x: number; z: number; r: number }[] = []
  // makeRotationY above turns local +u into (tz, -tx), which is the
  // normal pointing one way or the other; the embankments are symmetric,
  // so both sides are covered either way.
  for (const s of [-1, 1]) {
    for (let u = inner; u <= outer + RAMP + 4; u += 5) {
      const t = Math.min(1, Math.max(0, (u - outer) / RAMP))
      const r = HALF + 1.5 * TOP * (1 - t) ** 1.3 + 4
      clear.push({ x: track.x[i] + track.nx[i] * s * u, z: track.z[i] + track.nz[i] * s * u, r })
    }
  }
  return { group, clear }
}
