import { BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, Mesh, MeshStandardMaterial, RepeatWrapping } from 'three'
import { barrierOffset } from '../sim/car'
import { locate, type Track } from '../sim/track'

// Scrapes on the barrier: where a car grinds along the rail or the wall, a
// band of black rubber and the car's own paint is left on the barrier's
// face at the height the body touched it, and stays for the rest of the
// race. Like the skid marks, one mesh holds them all in a ring of quads
// that reuses the oldest once full. The band is drawn with streaks that run
// along it, so it reads as scuffing rather than paint.

// Streaks along a scuff: thin lines of different weight and strength, the
// texture's alpha, tiling along the barrier.
function streaks() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const g = c.getContext('2d') as CanvasRenderingContext2D
  let seed = 3
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let k = 0; k < 70; k++) {
    const y = 4 + random() * 56
    const x = random() * 256
    const len = 40 + random() * 220
    g.fillStyle = `rgba(255,255,255,${0.15 + random() * 0.6})`
    g.fillRect(x, y, len, 1 + random() * 3)
    // Wrap the streak round so the texture tiles.
    if (x + len > 256) g.fillRect(x - 256, y, len, 1 + random() * 3)
  }
  const t = new CanvasTexture(c)
  t.wrapS = RepeatWrapping
  return t
}

// The point on the barrier's face beside a car that is touching it, a
// little in front of the face, or null when the car is clear of both
// barriers or barely moving.
export function barrierContact(track: Track, x: number, z: number, hint: number, halfWidth: number, speed: number): { x: number; z: number } | null {
  if (speed <= 4) return null
  const where = locate(track, x, z, hint)
  const wall = barrierOffset(track)
  if (Math.abs(where.d) <= wall - halfWidth - 0.06) return null
  const side = Math.sign(where.d)
  const gap = wall - Math.abs(where.d) - 0.015
  return { x: x + track.nx[where.i] * side * gap, z: z + track.nz[where.i] * side * gap }
}

export class Scrapes {
  readonly mesh: Mesh
  private readonly pos: Float32Array
  private readonly col: Float32Array
  private readonly uv: Float32Array
  private readonly capacity: number
  private next = 0
  private readonly last = new Map<string, { x: number; z: number; u: number } | null>()
  private readonly tint = new Color()
  private readonly rubber = new Color('#141414')

  constructor(capacity = 2000) {
    this.capacity = capacity
    this.pos = new Float32Array(capacity * 4 * 3)
    this.col = new Float32Array(capacity * 4 * 3)
    this.uv = new Float32Array(capacity * 4 * 2)
    const index = new Uint32Array(capacity * 6)
    for (let q = 0; q < capacity; q++) index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage))
    geo.setAttribute('color', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage))
    geo.setAttribute('uv', new BufferAttribute(this.uv, 2).setUsage(DynamicDrawUsage))
    geo.setIndex(new BufferAttribute(index, 1))
    const material = new MeshStandardMaterial({ vertexColors: true, alphaMap: streaks(), roughness: 0.85, metalness: 0.1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: DoubleSide })
    this.mesh = new Mesh(geo, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }

  // Call every frame for every car; `at` is the point on the barrier's face
  // beside it while it touches, or null. y0 and y1 are the band it marks;
  // paint is the car's colour, mixed into the rubber.
  mark(key: string, at: { x: number; z: number } | null, y0: number, y1: number, paint: string) {
    const prev = this.last.get(key)
    if (!at) {
      this.last.set(key, null)
      return
    }
    let u = prev?.u ?? Math.random()
    if (prev) {
      const len = Math.hypot(at.x - prev.x, at.z - prev.z)
      // Too short to show yet, or a jump (a reset, a new lap of the ring).
      if (len < 0.35) return
      if (len < 4) {
        const q = this.next
        this.next = (this.next + 1) % this.capacity
        // Ragged: each stretch sits a little higher or lower.
        const wobble = (Math.random() - 0.5) * 0.04
        const a = y0 + wobble
        const b = y1 + wobble * 0.5
        this.pos.set([prev.x, a, prev.z, prev.x, b, prev.z, at.x, a, at.z, at.x, b, at.z], q * 12)
        const u1 = u + len / 1.6
        this.uv.set([u, 0, u, 1, u1, 0, u1, 1], q * 8)
        u = u1
        this.tint.set(paint).lerp(this.rubber, 0.55 + Math.random() * 0.35)
        for (let k = 0; k < 4; k++) this.col.set([this.tint.r, this.tint.g, this.tint.b], q * 12 + k * 3)
        const attributes = this.mesh.geometry.attributes
        attributes.position.needsUpdate = true
        attributes.color.needsUpdate = true
        attributes.uv.needsUpdate = true
      }
    }
    this.last.set(key, { x: at.x, z: at.z, u })
  }

  clear() {
    this.pos.fill(0)
    this.next = 0
    this.last.clear()
    this.mesh.geometry.attributes.position.needsUpdate = true
  }
}
