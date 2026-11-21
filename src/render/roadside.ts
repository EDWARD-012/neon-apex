import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createRng } from '../sim/rng'
import type { Track } from '../sim/track'

// Things by the road that are not the road: chevron signs on the outside of
// sharp corners, arrows painted on the road before them, puddles that only
// show in the rain, and a crowd and marshals at the start line.

// A corner tighter than this radius gets chevrons.
const SHARP = 70

// The signed curvature of the centre line at each sample: positive bends
// to the right.
function curvature(track: Track): Float32Array {
  const n = track.n
  const k = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = (i - 3 + n) % n
    const b = (i + 3) % n
    const turn = Math.atan2(track.tx[a] * track.tz[b] - track.tz[a] * track.tx[b], track.tx[a] * track.tx[b] + track.tz[a] * track.tz[b])
    k[i] = turn / (6 * track.spacing)
  }
  return k
}

function chevronTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 96
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#111317'
  g.fillRect(0, 0, 128, 96)
  g.fillStyle = '#f3c21b'
  for (const x of [20, 62]) {
    g.beginPath()
    g.moveTo(x, 14)
    g.lineTo(x + 30, 48)
    g.lineTo(x, 82)
    g.lineTo(x + 16, 82)
    g.lineTo(x + 46, 48)
    g.lineTo(x + 16, 14)
    g.closePath()
    g.fill()
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

let chevrons: CanvasTexture | null = null

export interface SignSpot {
  x: number
  z: number
  // Which way the board faces (towards the cars coming in), and whether the
  // corner turns right.
  facing: number
  right: boolean
}

// Where the chevrons go: three on the outside of the tightest point of each
// sharp corner, one at the apex and one 12 m either side of it.
export function signSpots(track: Track): SignSpot[] {
  const k = curvature(track)
  const n = track.n
  const gap = Math.round(40 / track.spacing)
  const spots: SignSpot[] = []
  let last = -Infinity
  for (let i = 0; i < n; i++) {
    const r = Math.abs(k[i]) > 1e-6 ? 1 / Math.abs(k[i]) : Infinity
    if (r > SHARP || Math.abs(k[i]) < Math.abs(k[(i + 1) % n]) || Math.abs(k[i]) < Math.abs(k[(i - 1 + n) % n]) || i - last < gap) continue
    last = i
    const right = k[i] > 0
    // Outside of the corner: the left of the road for a right-hander.
    const side = right ? -1 : 1
    for (const back of [-12, 0, 12]) {
      const j = (i + Math.round(back / track.spacing) + n) % n
      const off = side * (track.width / 2 + 2.2)
      spots.push({ x: track.x[j] + track.nx[j] * off, z: track.z[j] + track.nz[j] * off, facing: Math.atan2(-track.tx[j], -track.tz[j]), right })
    }
  }
  return spots
}

// The chevron boards on their posts, facing the cars coming into each
// corner and pointing the way it turns.
export function buildSigns(track: Track): Group {
  const group = new Group()
  chevrons ??= chevronTexture()
  const face = new MeshStandardMaterial({ map: chevrons, roughness: 0.6, side: DoubleSide })
  const post = new MeshStandardMaterial({ color: '#6b7079', roughness: 0.5, metalness: 0.6 })
  const board = new PlaneGeometry(1.3, 0.95)
  const pole = new BoxGeometry(0.08, 1.2, 0.08)
  for (const spot of signSpots(track)) {
    const sign = new Group()
    sign.position.set(spot.x, 0, spot.z)
    sign.rotation.y = spot.facing
    const p = new Mesh(pole, post)
    p.position.y = 0.6
    const b = new Mesh(board, face)
    b.position.y = 1.45
    // Facing the driver, the board's own x axis is the driver's right, so
    // a left-hander flips it.
    b.scale.x = spot.right ? 1 : -1
    sign.add(p, b)
    group.add(sign)
  }
  return group
}

export interface Puddle {
  x: number
  z: number
  i: number
}

// Standing water on the road, spread round the lap, the same for every
// race on the track. Shown only in the rain.
export function buildPuddles(track: Track, seed: string): { group: Group; puddles: Puddle[] } {
  const rng = createRng(`puddles/${seed}`)
  const group = new Group()
  const water = new MeshStandardMaterial({ color: '#0a0d14', roughness: 0.04, metalness: 0.7, transparent: true, opacity: 0.85 })
  const shape = new CircleGeometry(1, 28).rotateX(-Math.PI / 2)
  const puddles: Puddle[] = []
  const count = Math.round(track.length / 90)
  for (let k = 0; k < count; k++) {
    const i = Math.floor(rng() * track.n)
    const off = (rng() - 0.5) * (track.width - 3)
    const x = track.x[i] + track.nx[i] * off
    const z = track.z[i] + track.nz[i] * off
    const m = new Mesh(shape, water)
    m.position.set(x, 0.025, z)
    m.scale.set(1.2 + rng() * 1.2, 1, 0.7 + rng() * 0.6)
    m.rotation.y = rng() * Math.PI
    group.add(m)
    puddles.push({ x, z, i })
  }
  return { group, puddles }
}

// Arrows painted on the road before each sharp corner, 30 m and 18 m out,
// one in each lane, bending the way the corner turns.
export interface ArrowSpot {
  x: number
  z: number
  // The way the arrow points (along the road), and whether it bends right.
  facing: number
  right: boolean
}

export function arrowSpots(track: Track): ArrowSpot[] {
  const k = curvature(track)
  const n = track.n
  const gap = Math.round(40 / track.spacing)
  const spots: ArrowSpot[] = []
  let last = -Infinity
  for (let i = 0; i < n; i++) {
    const r = Math.abs(k[i]) > 1e-6 ? 1 / Math.abs(k[i]) : Infinity
    if (r > SHARP || Math.abs(k[i]) < Math.abs(k[(i + 1) % n]) || Math.abs(k[i]) < Math.abs(k[(i - 1 + n) % n]) || i - last < gap) continue
    last = i
    for (const back of [30, 18]) {
      const j = (i - Math.round(back / track.spacing) + n) % n
      for (const lane of [-1, 1]) {
        const off = (lane * track.width) / 4
        spots.push({ x: track.x[j] + track.nx[j] * off, z: track.z[j] + track.nz[j] * off, facing: Math.atan2(-track.tx[j], -track.tz[j]), right: k[i] > 0 })
      }
    }
  }
  return spots
}

// A worn white arrow: up the lane, then bending to the right.
function arrowTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 256
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.strokeStyle = '#ffffff'
  g.fillStyle = '#ffffff'
  g.lineWidth = 22
  g.lineCap = 'butt'
  g.beginPath()
  g.moveTo(44, 250)
  g.lineTo(44, 120)
  g.quadraticCurveTo(44, 70, 86, 62)
  g.stroke()
  g.beginPath()
  g.moveTo(80, 22)
  g.lineTo(124, 62)
  g.lineTo(80, 102)
  g.closePath()
  g.fill()
  // Worn by tyres: speckles knocked out of the paint.
  g.globalCompositeOperation = 'destination-out'
  let seed = 5
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 260; i++) g.fillRect(random() * 128, random() * 256, 1 + random() * 3, 1 + random() * 3)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

let arrows: CanvasTexture | null = null

export function buildArrows(track: Track): Group {
  arrows ??= arrowTexture()
  const spots = arrowSpots(track)
  const mesh = new InstancedMesh(
    new PlaneGeometry(1.3, 2.6).rotateX(-Math.PI / 2),
    new MeshStandardMaterial({ map: arrows, color: '#d8d6cc', roughness: 0.85, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    Math.max(1, spots.length),
  )
  const m = new Matrix4()
  spots.forEach((spot, k) => {
    // Lying flat, the texture's right is the driver's right, so a left-hander
    // is the same arrow flipped.
    m.makeRotationY(spot.facing).scale(new Vector3(spot.right ? 1 : -1, 1, 1)).setPosition(spot.x, 0.024, spot.z)
    mesh.setMatrixAt(k, m)
  })
  mesh.count = spots.length
  mesh.receiveShadow = true
  const group = new Group()
  group.add(mesh)
  return group
}

// One standing figure, feet at the origin and 1.7 m tall without the head:
// two legs in jeans, a torso and arms in the colour each person's
// instance gives it (white here, so the instance colour shows true), and
// shoes. The head is a separate mesh in a skin tone.
function person(): BufferGeometry {
  const part = (g: BufferGeometry, rgb: [number, number, number]) => {
    const n = g.attributes.position.count
    const c = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) c.set(rgb, i * 3)
    g.setAttribute('color', new BufferAttribute(c, 3))
    return g.index ? g.toNonIndexed() : g
  }
  const denim: [number, number, number] = [0.16, 0.19, 0.27]
  const white: [number, number, number] = [1, 1, 1]
  const shoe: [number, number, number] = [0.06, 0.06, 0.07]
  const parts = [
    part(new CylinderGeometry(0.075, 0.062, 0.82, 7).translate(0.09, 0.47, 0), denim),
    part(new CylinderGeometry(0.075, 0.062, 0.82, 7).translate(-0.09, 0.47, 0), denim),
    part(new BoxGeometry(0.12, 0.07, 0.24).translate(0.09, 0.035, 0.04), shoe),
    part(new BoxGeometry(0.12, 0.07, 0.24).translate(-0.09, 0.035, 0.04), shoe),
    part(new CylinderGeometry(0.19, 0.16, 0.62, 9).scale(1, 1, 0.62).translate(0, 1.18, 0), white),
    part(new CylinderGeometry(0.055, 0.045, 0.6, 6).translate(0.235, 1.15, 0), white),
    part(new CylinderGeometry(0.055, 0.045, 0.6, 6).translate(-0.235, 1.15, 0), white),
    part(new CylinderGeometry(0.05, 0.05, 0.08, 6).translate(0, 1.52, 0), [0.72, 0.55, 0.42]),
  ]
  return mergeGeometries(parts) as BufferGeometry
}

// The crowd at the start line: people in two rows behind each barrier for
// 25 m either side of the line, and marshals in orange with flags by the
// gantry. They jump and wave when the race starts and when a car goes by.
export class Crowd {
  readonly group = new Group()
  private readonly bodies: InstancedMesh
  private readonly heads: InstancedMesh
  private readonly flags: InstancedMesh
  private readonly people: { x: number; z: number; facing: number; phase: number; marshal: boolean }[] = []
  private readonly m = new Matrix4()
  private readonly v = new Vector3()

  constructor(track: Track, wall: number, seed: string, many: boolean) {
    const rng = createRng(`crowd/${seed}`)
    const n = track.n
    const span = Math.round(25 / track.spacing)
    const step = many ? 1.1 : 2.2
    for (const side of [-1, 1]) {
      for (const row of [0, 1]) {
        for (let along = -25; along <= 25; along += step) {
          if (rng() < 0.18) continue
          const i = (Math.round((along + rng() * 0.6) / track.spacing) + n) % n
          if (Math.abs(along) > span * track.spacing) continue
          const d = side * (wall + 1.6 + row * 0.95 + rng() * 0.3)
          // Facing the road.
          const facing = Math.atan2(-track.nx[i] * side, -track.nz[i] * side)
          this.people.push({ x: track.x[i] + track.nx[i] * d, z: track.z[i] + track.nz[i] * d, facing, phase: rng() * Math.PI * 2, marshal: false })
        }
      }
      // Two marshals at each side of the line, just behind the barrier.
      for (const along of [-3, 3]) {
        const i = (Math.round(along / track.spacing) + n) % n
        const d = side * (wall + 1.0)
        this.people.push({ x: track.x[i] + track.nx[i] * d, z: track.z[i] + track.nz[i] * d, facing: Math.atan2(-track.nx[i] * side, -track.nz[i] * side), phase: rng() * Math.PI * 2, marshal: true })
      }
    }
    const count = this.people.length
    this.bodies = new InstancedMesh(person(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), count)
    this.heads = new InstancedMesh(new SphereGeometry(0.105, 10, 8).scale(0.9, 1.05, 0.95), new MeshStandardMaterial({ roughness: 0.75 }), count)
    const marshals = this.people.filter((p) => p.marshal).length
    this.flags = new InstancedMesh(new PlaneGeometry(0.55, 0.38).translate(0.3, 0, 0), new MeshStandardMaterial({ color: '#3fd16a', roughness: 0.6, side: DoubleSide }), Math.max(1, marshals))
    // Everyday clothes, muted: jackets and tops over jeans.
    const shirts = ['#2b3a55', '#3a3d42', '#5b6b4a', '#6e2e34', '#c9bfa8', '#e8e6e1', '#7d8590', '#a5553a', '#1f2124', '#4f6d8f']
    const skins = ['#f1c9a5', '#d9a47c', '#b07a52', '#7d5236', '#e8b994']
    const c = new Color()
    this.people.forEach((p, k) => {
      this.bodies.setColorAt(k, c.set(p.marshal ? '#ff7a1a' : shirts[Math.floor(rng() * shirts.length)]))
      this.heads.setColorAt(k, c.set(skins[Math.floor(rng() * skins.length)]))
    })
    for (const mesh of [this.bodies, this.heads, this.flags]) {
      mesh.castShadow = true
      mesh.frustumCulled = false
    }
    this.group.add(this.bodies, this.heads, this.flags)
    this.update(0, 0)
  }

  // Excitement 0 is standing; 1 is jumping and waving.
  update(time: number, excitement: number) {
    let f = 0
    this.people.forEach((p, k) => {
      const hop = excitement * Math.max(0, Math.sin(time * 9 + p.phase)) * (p.marshal ? 0.05 : 0.18)
      this.m.makeRotationY(p.facing).setPosition(p.x, hop, p.z)
      this.bodies.setMatrixAt(k, this.m)
      this.m.makeRotationY(p.facing).setPosition(p.x, 1.6 + hop, p.z)
      this.heads.setMatrixAt(k, this.m)
      if (p.marshal) {
        // The flag held up beside the marshal, waved side to side.
        const wave = Math.sin(time * (3 + excitement * 7) + p.phase) * (0.25 + excitement * 0.6)
        this.v.set(Math.cos(p.facing), 0, -Math.sin(p.facing)).multiplyScalar(0.32)
        this.m.makeRotationY(p.facing).multiply(new Matrix4().makeRotationZ(0.9 + wave)).setPosition(p.x + this.v.x, 1.45 + hop, p.z + this.v.z)
        this.flags.setMatrixAt(f++, this.m)
      }
    })
    this.flags.count = f
    this.bodies.instanceMatrix.needsUpdate = true
    this.heads.instanceMatrix.needsUpdate = true
    this.flags.instanceMatrix.needsUpdate = true
  }
}
