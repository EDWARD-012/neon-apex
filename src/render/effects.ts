import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Points,
  ShaderMaterial,
  type Texture,
  Vector3,
} from 'three'

// Particles for tyre smoke and barrier sparks, and black skid marks laid on
// the road while a car slides. Each is one draw call with a fixed pool.

const vertex = /* glsl */ `
  attribute float size;
  attribute float alpha;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (420.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`

const fragment = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 color;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(color, t.a * vAlpha);
  }
`

export class Particles {
  readonly points: Points
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly life: Float32Array
  private readonly maxLife: Float32Array
  private readonly size: Float32Array
  private readonly alpha: Float32Array
  private readonly grow: number
  private readonly gravity: number
  private next = 0

  constructor(count: number, map: Texture, color: string, options: { additive?: boolean; grow?: number; gravity?: number; brightness?: number }) {
    this.pos = new Float32Array(count * 3)
    this.vel = new Float32Array(count * 3)
    this.life = new Float32Array(count)
    this.maxLife = new Float32Array(count).fill(1)
    this.size = new Float32Array(count)
    this.alpha = new Float32Array(count)
    this.grow = options.grow ?? 0
    this.gravity = options.gravity ?? 0
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage))
    geo.setAttribute('size', new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage))
    geo.setAttribute('alpha', new BufferAttribute(this.alpha, 1).setUsage(DynamicDrawUsage))
    const material = new ShaderMaterial({
      uniforms: { map: { value: map }, color: { value: new Color(color).multiplyScalar(options.brightness ?? 1) } },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: options.additive ? AdditiveBlending : NormalBlending,
    })
    this.points = new Points(geo, material)
    this.points.frustumCulled = false
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number) {
    const k = this.next
    this.next = (this.next + 1) % this.life.length
    this.pos.set([x, y, z], k * 3)
    this.vel.set([vx, vy, vz], k * 3)
    this.life[k] = life
    this.maxLife[k] = life
    this.size[k] = size
  }

  update(dt: number) {
    for (let k = 0; k < this.life.length; k++) {
      if (this.life[k] <= 0) {
        this.alpha[k] = 0
        continue
      }
      this.life[k] -= dt
      const t = Math.max(0, this.life[k] / this.maxLife[k])
      this.vel[k * 3 + 1] -= this.gravity * dt
      for (let a = 0; a < 3; a++) this.pos[k * 3 + a] += this.vel[k * 3 + a] * dt
      // Smoke slows down as it spreads.
      if (this.grow > 0) {
        this.vel[k * 3] *= 1 - 1.5 * dt
        this.vel[k * 3 + 2] *= 1 - 1.5 * dt
      }
      this.size[k] += this.grow * dt
      this.alpha[k] = t * (this.grow > 0 ? 0.5 : 1)
    }
    const geo = this.points.geometry
    geo.attributes.position.needsUpdate = true
    geo.attributes.size.needsUpdate = true
    geo.attributes.alpha.needsUpdate = true
  }
}

// Skid marks: a ring buffer of thin quads. Each wheel remembers where its
// last mark ended so the next one joins up with it.
export class Skids {
  readonly mesh: Mesh
  private readonly pos: Float32Array
  private readonly capacity: number
  private next = 0
  private readonly last = new Map<string, [number, number] | null>()

  constructor(capacity = 4000) {
    this.capacity = capacity
    this.pos = new Float32Array(capacity * 4 * 3)
    const index = new Uint32Array(capacity * 6)
    for (let q = 0; q < capacity; q++) index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage))
    geo.setIndex(new BufferAttribute(index, 1))
    this.mesh = new Mesh(geo, new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }

  // Call every frame for every wheel; `on` says whether it is skidding.
  mark(key: string, x: number, z: number, on: boolean) {
    const prev = this.last.get(key)
    if (!on) {
      this.last.set(key, null)
      return
    }
    if (prev) {
      const dx = x - prev[0]
      const dz = z - prev[1]
      const len = Math.hypot(dx, dz)
      if (len < 0.4) return
      const w = 0.14
      const nx = (-dz / len) * w
      const nz = (dx / len) * w
      const q = this.next
      this.next = (this.next + 1) % this.capacity
      this.pos.set([prev[0] + nx, 0.035, prev[1] + nz, prev[0] - nx, 0.035, prev[1] - nz, x + nx, 0.035, z + nz, x - nx, 0.035, z - nz], q * 12)
      this.mesh.geometry.attributes.position.needsUpdate = true
    }
    this.last.set(key, [x, z])
  }

  clear() {
    this.pos.fill(0)
    this.last.clear()
    this.mesh.geometry.attributes.position.needsUpdate = true
  }
}

// Light trails: a fading ribbon behind each tail light, drawn at speed. The
// ribbon always faces the camera, so it reads as a streak of light from
// any angle. All trails share one mesh that is rebuilt every frame.
const TRAIL_POINTS = 26

const trailVertex = /* glsl */ `
  attribute float alpha;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const trailFragment = /* glsl */ `
  uniform vec3 color;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(color * vAlpha, vAlpha);
  }
`

export class Trails {
  readonly mesh: Mesh
  private readonly pos: Float32Array
  private readonly alpha: Float32Array
  private readonly trails: { pts: number[]; last: number }[] = []
  private readonly capacity: number

  constructor(maxTrails: number) {
    this.capacity = maxTrails
    const verts = maxTrails * (TRAIL_POINTS - 1) * 4
    this.pos = new Float32Array(verts * 3)
    this.alpha = new Float32Array(verts)
    const index = new Uint32Array(maxTrails * (TRAIL_POINTS - 1) * 6)
    for (let q = 0; q < maxTrails * (TRAIL_POINTS - 1); q++) index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage))
    geo.setAttribute('alpha', new BufferAttribute(this.alpha, 1).setUsage(DynamicDrawUsage))
    geo.setIndex(new BufferAttribute(index, 1))
    this.mesh = new Mesh(
      geo,
      new ShaderMaterial({
        uniforms: { color: { value: new Color('#ff2238').multiplyScalar(2.2) } },
        vertexShader: trailVertex,
        fragmentShader: trailFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    )
    this.mesh.frustumCulled = false
    for (let k = 0; k < maxTrails; k++) this.trails.push({ pts: [], last: 0 })
  }

  // Adds the newest point of one trail, or lets it shrink when it is off.
  push(k: number, x: number, y: number, z: number, on: boolean) {
    const t = this.trails[k]
    if (!t) return
    const n = t.pts.length
    if (!on) {
      if (n) t.pts.splice(0, 3)
      return
    }
    if (n >= 3) {
      const dx = x - t.pts[n - 3]
      const dz = z - t.pts[n - 1]
      // A big jump means the car was reset; start the trail again.
      if (dx * dx + dz * dz > 400) t.pts.length = 0
      else if (dx * dx + dz * dz < 0.36) {
        t.pts[n - 3] = x
        t.pts[n - 2] = y
        t.pts[n - 1] = z
        return
      }
    }
    t.pts.push(x, y, z)
    if (t.pts.length > TRAIL_POINTS * 3) t.pts.splice(0, 3)
  }

  // Rebuilds the ribbons facing the camera at (cx, cy, cz).
  update(cx: number, cy: number, cz: number) {
    let q = 0
    for (let k = 0; k < this.capacity; k++) {
      const p = this.trails[k].pts
      const count = p.length / 3
      for (let i = 0; i + 1 < count; i++) {
        const ax = p[i * 3]
        const ay = p[i * 3 + 1]
        const az = p[i * 3 + 2]
        const bx = p[i * 3 + 3]
        const by = p[i * 3 + 4]
        const bz = p[i * 3 + 5]
        // Side vector: across the segment and across the view direction.
        const sx = bx - ax
        const sy = by - ay
        const sz = bz - az
        const vx = cx - ax
        const vy = cy - ay
        const vz = cz - az
        let wx = sy * vz - sz * vy
        let wy = sz * vx - sx * vz
        let wz = sx * vy - sy * vx
        const wl = Math.hypot(wx, wy, wz) || 1
        const fa = i / (count - 1)
        const fb = (i + 1) / (count - 1)
        const w = 0.07
        wx = (wx / wl) * w
        wy = (wy / wl) * w
        wz = (wz / wl) * w
        this.pos.set([ax + wx * fa, ay + wy * fa, az + wz * fa, ax - wx * fa, ay - wy * fa, az - wz * fa, bx + wx * fb, by + wy * fb, bz + wz * fb, bx - wx * fb, by - wy * fb, bz - wz * fb], q * 12)
        this.alpha.set([fa * fa, fa * fa, fb * fb, fb * fb], q * 4)
        q++
      }
    }
    this.mesh.geometry.setDrawRange(0, q * 6)
    this.mesh.geometry.attributes.position.needsUpdate = true
    this.mesh.geometry.attributes.alpha.needsUpdate = true
  }

  clear() {
    for (const t of this.trails) t.pts.length = 0
  }
}

// Rain: streaks in a box that follows the camera. Each streak's position is
// worked out in the vertex shader from its seed and the time, so the CPU
// does nothing per drop.
const rainVertex = /* glsl */ `
  attribute vec3 seed;
  attribute float tip;
  uniform float time;
  uniform vec3 focus;
  uniform vec3 box;
  uniform vec3 fall;
  varying float vTip;
  void main() {
    vec3 p = seed + fall * time;
    p = mod(p - focus + box * 0.5, box) - box * 0.5 + focus;
    p += normalize(fall) * tip * 0.9;
    vTip = tip;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`
const rainFragment = /* glsl */ `
  uniform float opacity;
  varying float vTip;
  void main() {
    gl_FragColor = vec4(0.75, 0.82, 1.0, opacity * (1.0 - vTip));
  }
`

export class Rain {
  readonly lines: LineSegments
  private readonly material: ShaderMaterial

  constructor(count = 7000) {
    const seed = new Float32Array(count * 2 * 3)
    const tip = new Float32Array(count * 2)
    for (let k = 0; k < count; k++) {
      const x = Math.random() * 60
      const y = Math.random() * 30
      const z = Math.random() * 60
      seed.set([x, y, z, x, y, z], k * 6)
      tip.set([0, 1], k * 2)
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(count * 2 * 3), 3))
    geo.setAttribute('seed', new BufferAttribute(seed, 3))
    geo.setAttribute('tip', new BufferAttribute(tip, 1))
    this.material = new ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        focus: { value: new Vector3() },
        box: { value: new Vector3(60, 30, 60) },
        fall: { value: new Vector3(3, -32, 1.5) },
        opacity: { value: 0.32 },
      },
      vertexShader: rainVertex,
      fragmentShader: rainFragment,
      transparent: true,
      depthWrite: false,
    })
    this.lines = new LineSegments(geo, this.material)
    this.lines.frustumCulled = false
    this.lines.visible = false
  }

  update(time: number, x: number, y: number, z: number) {
    this.material.uniforms.time.value = time
    this.material.uniforms.focus.value.set(x, y, z)
  }
}
