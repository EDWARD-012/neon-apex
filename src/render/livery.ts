import { Box3, BufferGeometry, CanvasTexture, Euler, Float32BufferAttribute, Group, type Material, Matrix4, Mesh, MeshPhysicalMaterial, type Object3D, SRGBColorSpace, type Texture, Vector3 } from 'three'
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js'
import { type Livery, type Looks, TRIMS, type WrapLayer } from '../looks'
import type { Shape } from '../sim/cars'
import type { CarModel } from './carModel'

// A livery laid on the player's car: stripes over the top, a flash down
// each side, race numbers on the doors and bonnet, or a chequered band,
// in a colour of the player's choice, and number plates front and back
// showing their username. Each piece is a decal: the body's own triangles
// inside a box, cut out and given the artwork's coordinates, so it follows
// every curve of the panel. Only faces that look toward the box's front
// keep it, so a stripe laid from above stays off the sides and the
// underneath.

interface Surface {
  mesh: Mesh
  toBody: Matrix4
  box: Box3
}

interface Piece {
  // Where the artwork is centred, in body space, and how big it is: width
  // and height on the artwork, and how deep the box reaches into the car.
  at: Vector3
  size: Vector3
  // Across the artwork, up the artwork, and out toward whoever reads it.
  across: Vector3
  up: Vector3
  art: Texture
  plate?: boolean
  // Turned about the line out toward the reader, in radians.
  spin?: number
  // Drawn over the pieces with a lower number.
  layer?: number
}

const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)
const Z = new Vector3(0, 0, 1)

const canvas = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d') as CanvasRenderingContext2D)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

// Light enough that a dark number reads on it.
const light = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150
}

// A stripe running along the car, with a fine dark line at each edge.
const stripe = (trim: string) =>
  canvas(64, 512, (g) => {
    g.fillStyle = trim
    g.fillRect(0, 0, 64, 512)
    g.fillStyle = 'rgba(0,0,0,0.35)'
    g.fillRect(3, 0, 2, 512)
    g.fillRect(59, 0, 2, 512)
  })

// A flash down the side: full height at the front, thinning to a point
// toward the back, with a second thin line under it. frontAtRight says
// which way the artwork runs on this side of the car.
const flash = (trim: string, frontAtRight: boolean) =>
  canvas(1024, 128, (g) => {
    if (frontAtRight) {
      g.translate(1024, 0)
      g.scale(-1, 1)
    }
    g.fillStyle = trim
    g.beginPath()
    g.moveTo(40, 14)
    g.lineTo(1000, 50)
    g.lineTo(1000, 62)
    g.lineTo(20, 84)
    g.closePath()
    g.fill()
    g.beginPath()
    g.moveTo(30, 98)
    g.lineTo(760, 104)
    g.lineTo(760, 110)
    g.lineTo(26, 112)
    g.closePath()
    g.fill()
  })

// Two rows of squares across the car.
const chequer = (trim: string) =>
  canvas(768, 64, (g) => {
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? '#111214' : trim
        g.fillRect(i * 32, j * 32, 32, 32)
      }
    }
  })

// A roundel with the race number.
const roundel = (trim: string, number: number) =>
  canvas(256, 256, (g) => {
    g.fillStyle = trim
    g.beginPath()
    g.arc(128, 128, 122, 0, Math.PI * 2)
    g.fill()
    g.lineWidth = 8
    g.strokeStyle = light(trim) ? '#111214' : '#f4f4f0'
    g.beginPath()
    g.arc(128, 128, 108, 0, Math.PI * 2)
    g.stroke()
    g.fillStyle = light(trim) ? '#111214' : '#f4f4f0'
    g.font = '700 148px "Chakra Petch", sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(String(number), 128, 136)
  })

// A number plate with the player's name, black on white with no country:
// long, or tall for the cars whose own plate mount is the taller kind.
type PlateStyle = 'long' | 'tall'
const plate = (text: string, style: PlateStyle) => {
  const h = style === 'long' ? 112 : 256
  return canvas(512, h, (g) => {
    g.fillStyle = '#f2f2ec'
    g.beginPath()
    g.roundRect(2, 2, 508, h - 4, 12)
    g.fill()
    g.lineWidth = 6
    g.strokeStyle = '#111214'
    g.beginPath()
    g.roundRect(9, 9, 494, h - 18, 8)
    g.stroke()
    g.fillStyle = '#111214'
    let size = style === 'long' ? 78 : 150
    g.font = `700 ${size}px "Chakra Petch", sans-serif`
    while (g.measureText(text).width > 450 && size > 30) {
      size -= 4
      g.font = `700 ${size}px "Chakra Petch", sans-serif`
    }
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, 256, h / 2 + size * 0.06)
  })
}

// Where a plate goes, by height in body space, and its shape. Some models
// came with their own plates, so ours goes right over them; the Brute's
// nose is all grille, so it carries no plate at the front.
interface Spot {
  y: number
  style: PlateStyle
}
const PLATE_SPOTS: Partial<Record<Shape, { rear?: Spot | null; front?: Spot | null }>> = {
  vanta: { rear: { y: 0.515, style: 'tall' } },
  volt: { rear: { y: 0.515, style: 'tall' } },
  kite: { rear: { y: 0.54, style: 'tall' } },
  brute: { front: null },
}
const PLATE_SIZE: Record<PlateStyle, [number, number]> = { long: [0.52, 0.112], tall: [0.34, 0.185] }

// The decal pieces for a livery, placed from the body's bounds.
function pieces(livery: Livery, trim: string, number: number, b: Box3): Piece[] {
  const h = b.max.y - b.min.y
  const length = b.max.z - b.min.z
  const width = b.max.x - b.min.x
  const cz = (b.min.z + b.max.z) / 2
  // Read from behind and above: across toward the car's right, up toward
  // the nose.
  const top = (x: number, z: number, w: number, l: number, art: Texture): Piece => ({ at: new Vector3(x, b.max.y, z), size: new Vector3(w, l, h * 2), across: X.clone().negate(), up: Z.clone(), art })
  // Read standing beside the car: on its left side across runs toward the
  // tail, on its right side toward the nose.
  const side = (left: boolean, y: number, z: number, w: number, tall: number, art: Texture): Piece => ({
    at: new Vector3(left ? b.max.x : b.min.x, y, z),
    size: new Vector3(w, tall, width),
    across: left ? Z.clone().negate() : Z.clone(),
    up: Y.clone(),
    art,
  })
  if (livery === 'twin') {
    const art = stripe(trim)
    return [top(width * 0.09, cz, width * 0.11, length * 1.05, art), top(-width * 0.09, cz, width * 0.11, length * 1.05, art)]
  }
  if (livery === 'centre') return [top(0, cz, width * 0.2, length * 1.05, stripe(trim))]
  if (livery === 'chequer') return [top(0, b.max.z - length * 0.2, width * 1.05, 0.16, chequer(trim))]
  if (livery === 'flash') {
    const y = b.min.y + h * 0.4
    return [side(true, y, cz + length * 0.03, length * 0.74, 0.14, flash(trim, false)), side(false, y, cz + length * 0.03, length * 0.74, 0.14, flash(trim, true))]
  }
  if (livery === 'number') {
    const art = roundel(trim, number)
    const y = b.min.y + h * 0.45
    return [side(true, y, cz - length * 0.04, 0.46, 0.46, art), side(false, y, cz - length * 0.04, 0.46, 0.46, art), top(0, b.max.z - length * 0.24, 0.5, 0.5, art)]
  }
  return []
}

// Artwork for a wrap layer: one shape or a line of text in the layer's
// colour, on a transparent canvas, square or four times as wide as tall.
function wrapArt(layer: WrapLayer) {
  const wide = layer.kind === 'stripe' || layer.kind === 'text'
  const w = wide ? 512 : 256
  const h = wide ? 128 : 256
  const art = canvas(w, h, (g) => {
    g.fillStyle = layer.color
    g.translate(w / 2, h / 2)
    const r = h * 0.46
    g.beginPath()
    if (layer.kind === 'stripe') {
      g.rect(-w * 0.49, -h * 0.3, w * 0.98, h * 0.6)
      g.fill()
      g.fillStyle = 'rgba(0,0,0,0.3)'
      g.fillRect(-w * 0.49, -h * 0.3, w * 0.98, 4)
      g.fillRect(-w * 0.49, h * 0.3 - 4, w * 0.98, 4)
      return
    }
    if (layer.kind === 'circle') g.arc(0, 0, r, 0, Math.PI * 2)
    else if (layer.kind === 'star') {
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5
        const rr = k % 2 ? r * 0.42 : r
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
      }
    } else if (layer.kind === 'chevron') {
      for (const [x, y] of [
        [-0.75, -0.9],
        [-0.2, -0.9],
        [0.75, 0],
        [-0.2, 0.9],
        [-0.75, 0.9],
        [0.2, 0],
      ])
        g.lineTo(x * r, y * r)
    } else {
      let size = h * 0.78
      g.font = `italic 700 ${size}px "Chakra Petch", sans-serif`
      while (g.measureText(layer.text).width > w * 0.94 && size > 20) {
        size -= 4
        g.font = `italic 700 ${size}px "Chakra Petch", sans-serif`
      }
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(layer.text, 0, h * 0.04)
      return
    }
    g.closePath()
    g.fill()
  })
  return { art, wide }
}

// The pieces for the wrap layers: sides along the length and up the door,
// the bonnet and the roof along their part of the car and across it.
function wrapPieces(layers: WrapLayer[], b: Box3): Piece[] {
  const h = b.max.y - b.min.y
  const length = b.max.z - b.min.z
  const width = b.max.x - b.min.x
  const cz = (b.min.z + b.max.z) / 2
  const out: Piece[] = []
  layers.forEach((layer, i) => {
    const { art, wide } = wrapArt(layer)
    const w = wide ? layer.size * (layer.kind === 'stripe' ? 2.6 : 2) : layer.size
    const t = wide ? w / 4 : layer.size
    const spin = (layer.angle * Math.PI) / 180
    const common = { art, spin, layer: 2 + i }
    if (layer.where === 'bonnet' || layer.where === 'roof') {
      const z = layer.where === 'bonnet' ? b.max.z - length * 0.22 - layer.along * length * 0.12 : cz - length * 0.06 - layer.along * length * 0.12
      // Across the top, 0 is toward the car's right and 1 its left.
      const x = (layer.up - 0.5) * width * 0.8
      out.push({ at: new Vector3(x, b.max.y, z), size: new Vector3(w, t, h * 2), across: X.clone().negate(), up: Z.clone(), ...common })
      return
    }
    const y = b.min.y + h * (0.25 + 0.4 * layer.up)
    const z = cz - layer.along * length * 0.42
    for (const left of [true, false]) {
      if ((left && layer.where === 'right') || (!left && layer.where === 'left')) continue
      out.push({ at: new Vector3(left ? b.max.x : b.min.x, y, z), size: new Vector3(w, t, width), across: left ? Z.clone().negate() : Z.clone(), up: Y.clone(), ...common })
    }
  })
  return out
}

const plates = (text: string, b: Box3, shape?: Shape): Piece[] => {
  const usual: Spot = { y: b.min.y + (b.max.y - b.min.y) * 0.28, style: 'long' }
  const spots = shape ? PLATE_SPOTS[shape] : undefined
  const depth = (b.max.z - b.min.z) * 0.3
  const out: Piece[] = []
  const rear = spots?.rear === undefined ? usual : spots.rear
  const front = spots?.front === undefined ? usual : spots.front
  if (rear) {
    const [w, h] = PLATE_SIZE[rear.style]
    out.push({ at: new Vector3(0, rear.y, b.min.z), size: new Vector3(w, h, depth), across: X.clone().negate(), up: Y.clone(), art: plate(text, rear.style), plate: true })
  }
  if (front) {
    const [w, h] = PLATE_SIZE[front.style]
    out.push({ at: new Vector3(0, front.y, b.max.z), size: new Vector3(w, h, depth), across: X.clone(), up: Y.clone(), art: plate(text, front.style), plate: true })
  }
  return out
}

// Keeps only the triangles that face out toward the reader.
function facing(g: BufferGeometry, out: Vector3, min: number): BufferGeometry {
  const p = g.attributes.position
  const n = g.attributes.normal
  const uv = g.attributes.uv
  const keep: number[] = []
  const v = new Vector3()
  for (let i = 0; i < p.count; i += 3) {
    v.set(0, 0, 0)
    for (let k = 0; k < 3; k++) v.add(new Vector3(n.getX(i + k), n.getY(i + k), n.getZ(i + k)))
    if (v.normalize().dot(out) > min) keep.push(i, i + 1, i + 2)
  }
  if (keep.length === p.count) return g
  const pick = (a: typeof p, size: number) => {
    const values = new Float32Array(keep.length * size)
    keep.forEach((i, j) => {
      for (let c = 0; c < size; c++) values[j * size + c] = a.array[i * size + c] as number
    })
    return new Float32BufferAttribute(values, size)
  }
  const next = new BufferGeometry()
  next.setAttribute('position', pick(p, 3))
  next.setAttribute('normal', pick(n, 3))
  next.setAttribute('uv', pick(uv, 2))
  g.dispose()
  return next
}

// Keeps only the layer nearest the reader: a plate laid on a bumper must
// not also land on a grille a hand's width behind it.
function frontmost(g: BufferGeometry, out: Vector3, within: number): BufferGeometry {
  const p = g.attributes.position
  if (!p || p.count === 0) return g
  let top = -Infinity
  const v = new Vector3()
  for (let i = 0; i < p.count; i++) top = Math.max(top, v.fromBufferAttribute(p, i).dot(out))
  const keep: number[] = []
  for (let i = 0; i < p.count; i += 3) {
    let d = 0
    for (let k = 0; k < 3; k++) d += v.fromBufferAttribute(p, i + k).dot(out) / 3
    if (d >= top - within) keep.push(i)
  }
  if (keep.length * 3 === p.count) return g
  const next = new BufferGeometry()
  for (const name of ['position', 'normal', 'uv']) {
    const a = g.attributes[name]
    const size = a.itemSize
    const values = new Float32Array(keep.length * 3 * size)
    keep.forEach((i, j) => {
      for (let k = 0; k < 3 * size; k++) values[j * 3 * size + k] = a.array[i * size + k] as number
    })
    next.setAttribute(name, new Float32BufferAttribute(values, size))
  }
  g.dispose()
  return next
}

const LIVERY = 'livery'

// Puts the livery and plates on a model, replacing any it had.
export function applyLivery(model: CarModel, looks: Looks, plateText: string, shape?: Shape) {
  const old = model.body.getObjectByName(LIVERY)
  if (old) {
    old.removeFromParent()
    const textures = new Set<Texture>()
    old.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      const m = mesh.material as MeshPhysicalMaterial
      if (m.map) textures.add(m.map)
      m.dispose()
    })
    for (const t of textures) t.dispose()
  }
  const livery = looks.livery ?? 'none'
  // The body's painted panels take the livery; the plates go on anything
  // solid on the body (a bumper may not be painted).
  model.group.updateMatrixWorld(true)
  const toBody = new Matrix4().copy(model.body.matrixWorld).invert()
  const wheels = new Set<Object3D>([...model.wheels, ...model.frontPivots])
  const inWheel = (o: Object3D) => {
    for (let p: Object3D | null = o; p && p !== model.body; p = p.parent) if (wheels.has(p)) return true
    return false
  }
  const painted: Surface[] = []
  const solid: Surface[] = []
  model.body.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh || inWheel(mesh) || (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return
    const material = mesh.material as Material
    if (Array.isArray(material) || material.transparent || !('roughness' in material)) return
    mesh.geometry.computeBoundingBox()
    const m = new Matrix4().multiplyMatrices(toBody, mesh.matrixWorld)
    const surface = { mesh, toBody: m, box: (mesh.geometry.boundingBox as Box3).clone().applyMatrix4(m) }
    solid.push(surface)
    if (material.userData.paint) painted.push(surface)
  })
  if (!painted.length) return
  const bounds = new Box3()
  for (const s of painted) bounds.union(s.box)
  const trim = TRIMS.find((t) => t.id === looks.trim)?.color ?? TRIMS[0].color
  const all = [...pieces(livery, trim, looks.number ?? 7, bounds), ...wrapPieces(looks.wrap ?? [], bounds), ...plates(plateText, bounds, shape)]
  const group = new Group()
  group.name = LIVERY
  const matte = looks.finish === 'matte'
  const materials = new Map<Texture, MeshPhysicalMaterial>()
  const proxy = new Mesh()
  for (const piece of all) {
    const out = new Vector3().crossVectors(piece.across, piece.up)
    const across = piece.across.clone().applyAxisAngle(out, piece.spin ?? 0)
    const up = piece.up.clone().applyAxisAngle(out, piece.spin ?? 0)
    const turn = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(across, up, out))
    const reach = new Box3().setFromCenterAndSize(piece.at, new Vector3(1, 1, 1).multiplyScalar(Math.max(piece.size.x, piece.size.y, piece.size.z)))
    let material = materials.get(piece.art)
    if (!material) {
      material = new MeshPhysicalMaterial({
        map: piece.art,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        roughness: piece.plate ? 0.45 : matte ? 0.75 : 0.3,
        metalness: 0,
        clearcoat: piece.plate || matte ? 0 : 1,
        clearcoatRoughness: 0.05,
      })
      materials.set(piece.art, material)
    }
    for (const s of piece.plate ? solid : painted) {
      if (!s.box.intersectsBox(reach)) continue
      proxy.geometry = s.mesh.geometry
      proxy.matrixWorld.copy(s.toBody)
      const faced = facing(new DecalGeometry(proxy, piece.at, turn, piece.size), out, piece.plate ? 0.6 : 0.3)
      const g = piece.plate ? frontmost(faced, out, 0.06) : faced
      if (!g.attributes.position || g.attributes.position.count === 0) {
        g.dispose()
        continue
      }
      const decal = new Mesh(g, material)
      decal.receiveShadow = true
      decal.renderOrder = piece.layer ?? 1
      group.add(decal)
    }
  }
  group.userData.bounds = bounds
  model.body.add(group)
}
