import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Points,
  ShaderMaterial,
  type Texture,
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
