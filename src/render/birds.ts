import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, Euler, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createRng } from '../sim/rng'
import type { Track } from '../sim/track'

// Birds on the mountain road: small flocks pecking at the edge of the
// tarmac on the straighter stretches. When a car comes they burst up and
// scatter over the barrier, and once the road has been quiet for a while
// they are back. All the birds are two instanced meshes, bodies and
// wings; the wings flap by scaling their height through zero.

export interface CarLike {
  x: number
  z: number
  vx: number
  vz: number
}

interface Bird {
  // Where it sits.
  x: number
  z: number
  yaw: number
  phase: number
  // How long after the flock is startled this one goes.
  delay: number
  // In the air.
  px: number
  py: number
  pz: number
  vx: number
  vy: number
  vz: number
}

interface Flock {
  i: number
  side: number
  x: number
  z: number
  size: number
  birds: Bird[]
  // When it was startled, or null while it sits.
  startled: number | null
}

// How long a bird flies before it is out of sight, in seconds.
const FLIGHT = 8
// How long the road must be clear before a flock is back.
const AWAY = 12

// Where the flocks sit: one in each equal part of the lap, on a gentle
// stretch away from the start line, by one edge of the road.
export function birdSpots(track: Track, flocks: number, seed: string): { i: number; side: number }[] {
  const rng = createRng(`birds/${seed}`)
  const n = track.n
  const clear = Math.ceil(90 / track.spacing)
  const spots: { i: number; side: number }[] = []
  for (let f = 0; f < flocks; f++) {
    const from = Math.floor((f / flocks) * n)
    const to = Math.floor(((f + 1) / flocks) * n)
    let best = -1
    for (let tries = 0; tries < 40; tries++) {
      const i = from + Math.floor(rng() * (to - from))
      if (i < clear || i > n - clear) continue
      if (Math.abs(track.curvature[i]) > 1 / 160) continue
      best = i
      break
    }
    if (best >= 0) spots.push({ i: best, side: rng() < 0.5 ? -1 : 1 })
  }
  return spots
}

function bodyGeometry(): BufferGeometry {
  const body = new SphereGeometry(0.06, 8, 6).scale(0.9, 0.9, 2.2).translate(0, 0.11, -0.01)
  const head = new SphereGeometry(0.043, 8, 6).translate(0, 0.155, 0.125)
  const beak = new SphereGeometry(0.015, 5, 4).scale(1, 0.8, 2.4).translate(0, 0.148, 0.175)
  const tail = new BufferGeometry()
  tail.setAttribute('position', new BufferAttribute(new Float32Array([-0.03, 0.115, -0.11, 0.03, 0.115, -0.11, -0.055, 0.105, -0.24, 0.055, 0.105, -0.24]), 3))
  tail.setIndex([0, 2, 1, 1, 2, 3])
  // Two thin legs.
  const legs = [-1, 1].map((s) => new CylinderGeometry(0.006, 0.005, 0.07, 4).translate(s * 0.022, 0.035, 0.01))
  const parts = [body, head, beak, tail, ...legs].map((g) => {
    g.deleteAttribute('uv')
    g.deleteAttribute('normal')
    return g.toNonIndexed()
  })
  const merged = mergeGeometries(parts)
  merged.computeVertexNormals()
  return merged
}

// Both wings, from the root at the bird's back out to the tips, bent up a
// little so scaling the height flaps them. Tips are darker.
function wingGeometry(): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  for (const s of [-1, 1]) {
    const a = [s * 0.03, 0, 0.07]
    const b = [s * 0.03, 0, -0.06]
    const c = [s * 0.17, 0.05, 0.05]
    const d = [s * 0.17, 0.05, -0.085]
    const e = [s * 0.34, 0.09, -0.08]
    for (const [p, q, r] of [
      [a, b, c],
      [b, d, c],
      [c, d, e],
    ]) {
      pos.push(...p, ...q, ...r)
      for (const v of [p, q, r]) {
        const shade = 1 - Math.abs(v[0]) * 1.4
        col.push(shade, shade, shade)
      }
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.computeVertexNormals()
  return geo
}

export class Birds {
  readonly group = new Group()
  private readonly bodies: InstancedMesh
  private readonly wings: InstancedMesh
  private readonly flocks: Flock[] = []
  private readonly m = new Matrix4()
  private readonly w = new Matrix4()
  private readonly q = new Quaternion()
  private readonly e = new Euler(0, 0, 0, 'YXZ')
  private readonly p = new Vector3()
  private readonly s = new Vector3()
  private readonly lift = new Matrix4().makeTranslation(0, 0.13, 0)
  private readonly hidden = new Matrix4().makeScale(0, 0, 0)
  private readonly track: Track

  constructor(track: Track, seed: string, many: boolean) {
    this.track = track
    const rng = createRng(`flock/${seed}`)
    const edge = track.width / 2
    for (const spot of birdSpots(track, many ? 5 : 3, seed)) {
      const crows = rng() < 0.65
      const count = many ? 9 + Math.floor(rng() * 5) : 6 + Math.floor(rng() * 3)
      const birds: Bird[] = []
      for (let k = 0; k < count; k++) {
        const j = (spot.i + Math.round(((rng() - 0.5) * 8) / track.spacing) + track.n) % track.n
        const d = spot.side * (edge - 2.4 + rng() * 2.8)
        const x = track.x[j] + track.nx[j] * d
        const z = track.z[j] + track.nz[j] * d
        birds.push({ x, z, yaw: rng() * Math.PI * 2, phase: rng() * Math.PI * 2, delay: rng() * 0.45, px: x, py: 0, pz: z, vx: 0, vy: 0, vz: 0 })
      }
      const i = spot.i
      this.flocks.push({ i, side: spot.side, x: track.x[i] + track.nx[i] * spot.side * (edge - 1), z: track.z[i] + track.nz[i] * spot.side * (edge - 1), size: crows ? 1.3 : 1.05, birds, startled: null })
    }
    const total = Math.max(1, this.flocks.reduce((sum, f) => sum + f.birds.length, 0))
    this.bodies = new InstancedMesh(bodyGeometry(), new MeshStandardMaterial({ roughness: 0.85 }), total)
    this.wings = new InstancedMesh(wingGeometry(), new MeshStandardMaterial({ roughness: 0.85, vertexColors: true, side: DoubleSide }), total)
    // Crows, nearly black, or grey pigeons.
    const c = new Color()
    let k = 0
    for (const f of this.flocks) {
      for (let b = 0; b < f.birds.length; b++, k++) {
        c.set(f.size > 1.2 ? '#1d1d21' : '#727a86').offsetHSL(0, 0, (rng() - 0.5) * 0.06)
        this.bodies.setColorAt(k, c)
        this.wings.setColorAt(k, c)
      }
    }
    for (const mesh of [this.bodies, this.wings]) {
      mesh.castShadow = many
      mesh.frustumCulled = false
    }
    this.group.add(this.bodies, this.wings)
    this.reset()
  }

  // Every flock back on the road.
  reset() {
    for (const f of this.flocks) {
      f.startled = null
      for (const b of f.birds) {
        b.px = b.x
        b.py = 0
        b.pz = b.z
      }
    }
    this.update(0, 0, [], Infinity, Infinity)
  }

  // Birds in the air now, for the tests.
  get flying(): number {
    let n = 0
    for (const f of this.flocks) for (const b of f.birds) if (f.startled !== null && b.py > 0.3) n++
    return n
  }

  get spots(): readonly { x: number; z: number }[] {
    return this.flocks
  }

  // cars are everything driving; the camera's place decides which sitting
  // flocks are near enough to bother animating.
  update(dt: number, time: number, cars: readonly CarLike[], camX: number, camZ: number) {
    let k = 0
    let changed = dt === 0
    for (const f of this.flocks) {
      if (f.startled === null) {
        for (const car of cars) {
          const speed = Math.hypot(car.vx, car.vz)
          if (speed > 3 && Math.hypot(car.x - f.x, car.z - f.z) < 14 + speed * 0.35) {
            this.startle(f, car, time)
            break
          }
        }
      } else if (time - f.startled > AWAY && cars.every((car) => Math.hypot(car.x - f.x, car.z - f.z) > 80)) {
        f.startled = null
        for (const b of f.birds) {
          b.px = b.x
          b.py = 0
          b.pz = b.z
        }
        changed = true
      }
      const near = Math.hypot(camX - f.x, camZ - f.z) < 140
      if (f.startled === null && !near && !changed) {
        k += f.birds.length
        continue
      }
      changed = true
      for (const b of f.birds) this.place(f, b, k++, dt, time)
    }
    if (changed) {
      this.bodies.instanceMatrix.needsUpdate = true
      this.wings.instanceMatrix.needsUpdate = true
    }
  }

  private startle(f: Flock, car: CarLike, time: number) {
    f.startled = time
    const t = this.track
    const ox = t.nx[f.i] * f.side
    const oz = t.nz[f.i] * f.side
    const speed = Math.max(1, Math.hypot(car.vx, car.vz))
    for (const b of f.birds) {
      // Up, out over the barrier, along the way the car is going, and a
      // little away from it.
      const ax = b.x - car.x
      const az = b.z - car.z
      const away = Math.max(1, Math.hypot(ax, az))
      const out = 2.5 + Math.random() * 3
      const along = 2 + Math.random() * 4
      b.vx = ox * out + (car.vx / speed) * along + (ax / away) * 2 + (Math.random() - 0.5) * 3
      b.vz = oz * out + (car.vz / speed) * along + (az / away) * 2 + (Math.random() - 0.5) * 3
      b.vy = 3.2 + Math.random() * 2.2
      b.px = b.x
      b.py = 0
      b.pz = b.z
    }
  }

  private place(f: Flock, b: Bird, k: number, dt: number, time: number) {
    const t = f.startled === null ? -1 : time - f.startled - b.delay
    if (t > FLIGHT) {
      this.bodies.setMatrixAt(k, this.hidden)
      this.wings.setMatrixAt(k, this.hidden)
      return
    }
    let flap: number
    let spread: number
    if (t < 0) {
      // On the road, head up and tail down: turning now and then, and
      // pecking at the ground.
      const peck = Math.max(0, Math.sin(time * 2.3 + b.phase)) ** 6
      const turn = Math.sin(time * 0.31 + b.phase * 3) * 0.8
      this.e.set(peck * 0.9 - 0.32, b.yaw + turn, 0)
      this.p.set(b.x, 0, b.z)
      flap = 0.25
      spread = 0.32
    } else {
      // Climbing hard at first, then settling to an easy climb, flying
      // faster and drifting off line as it goes.
      const h = Math.hypot(b.vx, b.vz)
      const grow = h > 0.01 ? 1 + ((10 - h) / h) * Math.min(1, dt * 0.6) : 1
      const veer = 0.5 * Math.sin(t * 1.3 + b.phase) * dt
      const vx = (b.vx * Math.cos(veer) - b.vz * Math.sin(veer)) * grow
      const vz = (b.vx * Math.sin(veer) + b.vz * Math.cos(veer)) * grow
      b.vx = vx
      b.vz = vz
      b.vy += (2.2 - b.vy) * Math.min(1, dt * 0.7)
      b.px += b.vx * dt
      b.py += b.vy * dt
      b.pz += b.vz * dt
      this.e.set(-Math.atan2(b.vy, Math.max(0.1, h)) * 0.6, Math.atan2(b.vx, b.vz), -Math.sin(t * 1.3 + b.phase) * 0.35)
      this.p.set(b.px, b.py, b.pz)
      // Fast beats off the ground, then beats with glides between.
      const rate = t < 1.6 ? 11 : 7
      const gliding = t > 2 && Math.sin(t * 1.7 + b.phase) < -0.2
      flap = gliding ? 0.35 : 1.3 * Math.cos(b.phase + t * Math.PI * 2 * rate)
      spread = 1
    }
    this.q.setFromEuler(this.e)
    this.s.setScalar(f.size)
    this.m.compose(this.p, this.q, this.s)
    this.bodies.setMatrixAt(k, this.m)
    this.w.makeScale(spread, flap, spread > 0.5 ? 1 : 0.95).premultiply(this.lift).premultiply(this.m)
    this.wings.setMatrixAt(k, this.w)
  }
}
