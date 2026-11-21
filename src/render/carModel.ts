import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Path,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  type Texture,
  Vector2,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { type AssetCar, contactShadow, makeAssetCar } from './carAssets'
import type { Shape as CarShape } from '../sim/cars'
import { type BodySpec, dent, loft, type Station } from './carBody'

// Car models: a lofted body (see carBody.ts) dressed with lights, grille,
// splitter, diffuser, exhausts, mirrors, a wing where the car has one, and
// wheels with spoked rims and brake calipers. None is modelled on a real car.

export interface CarModel {
  group: Group
  body: Group
  // Empty objects where the wheels go. The wheel bank draws the actual
  // wheels there, all cars in one draw call.
  wheels: Object3D[]
  frontPivots: Group[]
  tail: MeshBasicMaterial
  heads: MeshBasicMaterial[]
  flames: Mesh[]
  glow: Mesh | null
  siren: { red: MeshBasicMaterial; blue: MeshBasicMaterial } | null
  tailLights: [number, number, number][]
  exhausts: [number, number, number][]
  // Parts that can come off in a crash, by where they sit.
  loose: { mesh: Mesh; side: 'left' | 'right' | 'rear' | 'front' }[]
  // Dents and scrapes: hit at a point in car space with a strength.
  hit: (x: number, y: number, z: number, strength: number) => void
  half: { width: number; front: number; rear: number }
  materials: Material[]
}

interface Def {
  stations: Station[]
  wheelZ: [number, number]
  wheelR: number
  wheelX: number
  wing?: { y: number; z: number; width: number; chord: number }
  ducktail?: boolean
  roofSpoiler?: boolean
  exhausts: number
  sport: boolean
  lightBar?: boolean
  // Gloss-black lower body, as a fraction of the side height.
  lower?: number
  // Big side intakes behind the doors, mid-engine style.
  intakes?: boolean
}

const st = (z: number, w: number, bottom: number, shoulder: number, top: number, roof: number): Station => ({ z, w, bottom, shoulder, top, roof })

const SEDAN: Def = {
  stations: [
    st(-2.3, 0.8, 0.34, 0.84, 0.88, 0.7),
    st(-2.1, 0.88, 0.3, 0.92, 0.96, 0.8),
    st(-1.5, 0.9, 0.28, 0.93, 0.98, 0.82),
    st(-1.15, 0.9, 0.28, 0.93, 1.24, 0.66),
    st(-0.75, 0.9, 0.28, 0.92, 1.44, 0.62),
    st(0.45, 0.9, 0.28, 0.9, 1.46, 0.62),
    st(1.15, 0.9, 0.28, 0.88, 0.98, 0.76),
    st(1.8, 0.89, 0.28, 0.84, 0.88, 0.8),
    st(2.2, 0.84, 0.3, 0.74, 0.76, 0.74),
    st(2.33, 0.7, 0.36, 0.62, 0.64, 0.6),
  ],
  wheelZ: [1.4, -1.4],
  wheelR: 0.36,
  wheelX: 0.82,
  exhausts: 1,
  sport: false,
}

const DEFS: Record<CarShape, Def> = {
  // A mid-engine hypercar: low pointed nose, a teardrop canopy set well
  // forward, high haunches over the rear wheels and a long engine deck.
  vanta: {
    stations: [
      st(-2.3, 0.86, 0.34, 0.8, 0.84, 0.74),
      st(-2.12, 0.98, 0.28, 0.86, 0.92, 0.86),
      st(-1.6, 1.0, 0.25, 0.88, 0.95, 0.84),
      st(-1.05, 0.98, 0.24, 0.86, 1.0, 0.62),
      st(-0.55, 0.96, 0.23, 0.82, 1.12, 0.52),
      st(0.15, 0.95, 0.23, 0.78, 1.14, 0.54),
      st(0.75, 0.94, 0.23, 0.72, 0.98, 0.6),
      st(1.3, 0.96, 0.23, 0.66, 0.72, 0.84),
      st(1.9, 0.92, 0.24, 0.56, 0.6, 0.86),
      st(2.32, 0.76, 0.27, 0.42, 0.45, 0.68),
    ],
    wheelZ: [1.42, -1.5],
    wheelR: 0.37,
    wheelX: 0.9,
    wing: { y: 1.02, z: -2.02, width: 1.84, chord: 0.32 },
    exhausts: 2,
    sport: true,
    lower: 0.34,
    intakes: true,
  },
  kite: {
    stations: [
      st(-1.98, 0.78, 0.33, 0.86, 0.92, 0.7),
      st(-1.85, 0.88, 0.28, 0.9, 1.2, 0.68),
      st(-1.55, 0.91, 0.27, 0.9, 1.34, 0.64),
      st(0.2, 0.91, 0.27, 0.88, 1.38, 0.64),
      st(0.95, 0.9, 0.27, 0.86, 0.94, 0.76),
      st(1.55, 0.88, 0.27, 0.78, 0.82, 0.8),
      st(1.9, 0.82, 0.29, 0.66, 0.68, 0.72),
      st(2.02, 0.68, 0.34, 0.56, 0.58, 0.56),
    ],
    wheelZ: [1.26, -1.22],
    wheelR: 0.34,
    wheelX: 0.82,
    roofSpoiler: true,
    exhausts: 1,
    sport: true,
    lower: 0.26,
  },
  brute: {
    stations: [
      st(-2.42, 0.86, 0.34, 0.86, 0.9, 0.76),
      st(-2.25, 0.97, 0.3, 0.94, 0.98, 0.86),
      st(-1.5, 0.99, 0.28, 0.96, 1.0, 0.86),
      st(-1.25, 0.99, 0.28, 0.96, 1.18, 0.7),
      st(-0.75, 0.98, 0.28, 0.96, 1.33, 0.66),
      st(0.25, 0.97, 0.28, 0.95, 1.34, 0.66),
      st(0.8, 0.97, 0.28, 0.94, 1.0, 0.8),
      st(1.6, 0.98, 0.28, 0.92, 0.97, 0.88),
      st(2.25, 0.95, 0.29, 0.86, 0.9, 0.86),
      st(2.46, 0.86, 0.34, 0.72, 0.74, 0.76),
    ],
    wheelZ: [1.52, -1.5],
    wheelR: 0.39,
    wheelX: 0.9,
    ducktail: true,
    exhausts: 4,
    sport: true,
    lower: 0.22,
  },
  volt: {
    stations: [
      st(-2.24, 0.8, 0.32, 0.7, 0.73, 0.66),
      st(-2.0, 0.92, 0.27, 0.78, 0.84, 0.78),
      st(-1.6, 0.95, 0.25, 0.8, 0.98, 0.66),
      st(-0.8, 0.95, 0.24, 0.8, 1.13, 0.6),
      st(0.3, 0.94, 0.24, 0.79, 1.12, 0.6),
      st(1.2, 0.93, 0.24, 0.74, 0.86, 0.7),
      st(1.9, 0.9, 0.25, 0.6, 0.62, 0.76),
      st(2.32, 0.72, 0.3, 0.44, 0.46, 0.6),
    ],
    wheelZ: [1.42, -1.42],
    wheelR: 0.36,
    wheelX: 0.87,
    lightBar: true,
    exhausts: 0,
    sport: true,
    lower: 0.3,
    intakes: true,
  },
  sedan: SEDAN,
  van: {
    stations: [
      st(-2.42, 0.9, 0.36, 1.0, 1.9, 0.88),
      st(-2.3, 0.95, 0.32, 1.02, 1.98, 0.9),
      st(1.0, 0.95, 0.32, 1.02, 2.0, 0.9),
      st(1.35, 0.95, 0.32, 1.0, 1.7, 0.86),
      st(2.0, 0.94, 0.33, 0.98, 1.12, 0.84),
      st(2.4, 0.9, 0.34, 0.86, 0.9, 0.8),
      st(2.48, 0.78, 0.4, 0.7, 0.72, 0.7),
    ],
    wheelZ: [1.55, -1.55],
    wheelR: 0.38,
    wheelX: 0.86,
    exhausts: 1,
    sport: false,
  },
  police: { ...SEDAN, exhausts: 2 },
  'police-heavy': { ...SEDAN, exhausts: 2 },
  'police-fast': { ...SEDAN, exhausts: 2 },
  // The Kestrel S is the traffic pack's sports car in the player's paint;
  // this drawn body only shows if the models fail to load.
  kestrel: { ...SEDAN, exhausts: 2, sport: true },
  finch: { ...SEDAN, exhausts: 1, sport: true },
  marten: { ...SEDAN, exhausts: 1 },
  granite: { ...SEDAN, exhausts: 1 },
  moraine: { ...SEDAN, exhausts: 2 },
}

// Station values at any point along a car, linearly.
function at(def: Def, z: number) {
  const s = def.stations
  let i = 0
  while (i < s.length - 2 && s[i + 1].z < z) i++
  const a = s[i]
  const b = s[i + 1]
  const t = Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z || 1)))
  const mix = (k: keyof Station) => a[k] + (b[k] - a[k]) * t
  return { w: mix('w'), bottom: mix('bottom'), shoulder: mix('shoulder'), top: mix('top'), roof: mix('roof') }
}

function placed(geo: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const o = new Object3D()
  o.position.set(x, y, z)
  o.rotation.set(rx, ry, rz)
  o.updateMatrix()
  return geo.clone().applyMatrix4(o.matrix)
}

// Wheels for every car in the scene, drawn as two instanced meshes: tyres,
// and rims with their brake discs. The game moves each slot every frame.
export class WheelBank {
  readonly tyres: InstancedMesh
  readonly rims: InstancedMesh
  private slots: (Object3D | null)[] = []
  private readonly scale = new Matrix4()
  private readonly m = new Matrix4()

  constructor(capacity = 160) {
    // Tyre: a rounded profile turned round the axle.
    // Low profile: a short sidewall round a big rim.
    const profile = [
      [0.285, -0.16],
      [0.318, -0.165],
      [0.348, -0.14],
      [0.36, -0.08],
      [0.362, 0],
      [0.36, 0.08],
      [0.348, 0.14],
      [0.318, 0.165],
      [0.285, 0.16],
    ].map(([r, y]) => new Vector2(r, y))
    const tyre = new LatheGeometry(profile, 28).rotateZ(Math.PI / 2)
    this.tyres = new InstancedMesh(tyre, new MeshStandardMaterial({ color: '#141416', roughness: 0.82, metalness: 0 }), capacity)

    // Rim: a disc with five spoke-shaped holes, extruded and turned to face
    // out, plus a hub and a brake disc behind it.
    // Ten thin spokes in five pairs, as on a forged supercar wheel.
    const face = new Shape()
    face.absarc(0, 0, 0.285, 0, Math.PI * 2, false)
    for (let k = 0; k < 10; k++) {
      const gap = k % 2 === 0 ? 0.1 : 0.42
      const a0 = (k / 10) * Math.PI * 2 + 0.07
      const a1 = a0 + (Math.PI * 2) / 10 - (k % 2 === 0 ? 0.14 : 0.14) - gap * 0.2
      const hole = new Path()
      hole.absarc(0, 0, 0.255, a0, a1, false)
      hole.absarc(0, 0, 0.085, a1 - 0.08, a0 + 0.08, true)
      hole.closePath()
      face.holes.push(hole)
    }
    const rimFace = new ExtrudeGeometry(face, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.008, bevelSegments: 2, curveSegments: 14 })
    rimFace.rotateY(Math.PI / 2).translate(0.085, 0, 0)
    const barrel = new CylinderGeometry(0.29, 0.29, 0.22, 28, 1, true).rotateZ(Math.PI / 2)
    const hub = new CylinderGeometry(0.05, 0.06, 0.06, 12).rotateZ(Math.PI / 2).translate(0.12, 0, 0)
    const disc = new CylinderGeometry(0.24, 0.24, 0.03, 28).rotateZ(Math.PI / 2).translate(-0.02, 0, 0)
    const merged = mergeGeometries([rimFace.toNonIndexed(), barrel.toNonIndexed(), hub.toNonIndexed(), disc.toNonIndexed()])
    this.rims = new InstancedMesh(merged, new MeshStandardMaterial({ color: '#c3c8d0', metalness: 1, roughness: 0.2, envMapIntensity: 1.4 }), capacity)
    for (const mesh of [this.tyres, this.rims]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      mesh.frustumCulled = false
      mesh.count = 0
    }
  }

  add(slot: Object3D): number {
    const free = this.slots.indexOf(null)
    if (free >= 0) {
      this.slots[free] = slot
      return free
    }
    this.slots.push(slot)
    return this.slots.length - 1
  }

  clear() {
    this.slots = []
  }

  // Copies every slot's world transform into the instances.
  update() {
    const n = Math.min(this.slots.length, this.tyres.instanceMatrix.count)
    for (let k = 0; k < n; k++) {
      const slot = this.slots[k]
      if (!slot || !slot.parent || !isVisible(slot)) {
        this.m.makeScale(0, 0, 0)
      } else {
        slot.updateWorldMatrix(true, false)
        const r = slot.userData.radius as number
        this.scale.makeScale(slot.userData.flip ? -1 : 1, r / 0.36, r / 0.36)
        this.m.multiplyMatrices(slot.matrixWorld, this.scale)
      }
      this.tyres.setMatrixAt(k, this.m)
      this.rims.setMatrixAt(k, this.m)
    }
    this.tyres.count = n
    this.rims.count = n
    this.tyres.instanceMatrix.needsUpdate = true
    this.rims.instanceMatrix.needsUpdate = true
  }
}

function isVisible(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false
  return true
}

export interface ModelOptions {
  shape?: CarShape
  ghost?: boolean
  // Underglow in the body colour. On by default for the sports cars.
  glow?: boolean
  // Where to draw the wheels. Without one the model makes its own.
  bank?: WheelBank
  // Which of several models to use where a shape has more than one, as
  // traffic does.
  variant?: number
}

// One shared bank for models made without one, like the garage car.
let ownBank: WheelBank | null = null

export function createCarModel(color: string, spot: Texture, options: ModelOptions = {}): CarModel {
  const shape = options.shape ?? 'vanta'
  const def = DEFS[shape]
  const ghost = options.ghost ?? false
  // Real 3D models for the cars that have one; the drawn body otherwise
  // (traffic, police, and the see-through ghost).
  const asset = ghost ? null : makeAssetCar(shape, color, options.variant ?? 0)
  if (asset) return assetModel(asset, color, spot, options)
  const fade = (m: Material, o = 0.3) => {
    if (ghost) {
      m.transparent = true
      m.opacity = o
      m.depthWrite = false
    }
  }
  const group = new Group()
  const body = new Group()
  group.add(body)

  // Metallic paint under a mirror clear coat: the base coat carries the
  // colour and a soft metallic sheen, the clear coat the sharp reflections
  // of the sky.
  const paint = new MeshPhysicalMaterial({
    color,
    vertexColors: true,
    metalness: def.sport ? 0.55 : 0.3,
    roughness: def.sport ? 0.34 : 0.45,
    clearcoat: 1,
    clearcoatRoughness: def.sport ? 0.025 : 0.1,
    envMapIntensity: 1.25,
  })
  // So the looks in the garage can find the paint.
  paint.userData.paint = true
  const glass = new MeshPhysicalMaterial({ color: '#06080d', metalness: 0.3, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2.2 })
  // Gloss black for the lower body, intakes and splitter.
  const trim = new MeshPhysicalMaterial({ color: '#0b0c0f', roughness: 0.42, metalness: 0.25, clearcoat: def.sport ? 0.7 : 0, clearcoatRoughness: 0.08, envMapIntensity: 1.1 })
  const chrome = new MeshStandardMaterial({ color: '#d8dce4', metalness: 1, roughness: 0.12, envMapIntensity: 2 })
  for (const m of [paint, glass, trim, chrome]) fade(m)

  const spec: BodySpec = { stations: def.stations, wheels: [def.wheelZ[0], def.wheelZ[1]].map((z) => ({ z, r: def.wheelR, x: def.wheelX })), lower: def.lower ?? 0 }
  const bodyGeo = loft(spec)
  const original = (bodyGeo.getAttribute('position').array as Float32Array).slice()
  body.add(new Mesh(bodyGeo, [paint, glass, trim]))
  // Lights, grille and other parts fixed to the shell. A dent moves them
  // with it, so nothing is left floating outside a crushed panel.
  const rigid: { geo: BufferGeometry; original: Float32Array }[] = []
  const fixed = (geo: BufferGeometry) => {
    rigid.push({ geo, original: (geo.getAttribute('position').array as Float32Array).slice() })
    return geo
  }

  const front = def.stations[def.stations.length - 1].z
  const rear = def.stations[0].z
  const nose = at(def, front - 0.12)
  const tailS = at(def, rear + 0.1)

  // Dark parts merged into one mesh: grille, splitter, diffuser, sills,
  // light housings.
  const dark: BufferGeometry[] = []
  const grilleY = nose.bottom + (nose.shoulder - nose.bottom) * 0.35
  dark.push(placed(new BoxGeometry(nose.w * 1.1, (nose.shoulder - nose.bottom) * 0.42, 0.08), 0, grilleY, front - 0.04))
  dark.push(placed(new BoxGeometry(nose.w * 1.9, 0.03, 0.32), 0, at(def, front - 0.2).bottom + 0.01, front - 0.08))
  dark.push(placed(new BoxGeometry(tailS.w * 1.5, 0.14, 0.3), 0, tailS.bottom + 0.08, rear + 0.08))
  for (let k = -2; k <= 2; k++) dark.push(placed(new BoxGeometry(0.02, 0.12, 0.26), k * 0.22, tailS.bottom + 0.06, rear + 0.05))
  const sillZ = (def.wheelZ[0] + def.wheelZ[1]) / 2
  const sillLen = def.wheelZ[0] - def.wheelZ[1] - def.wheelR * 2.3
  for (const side of [-1, 1]) {
    const s = at(def, sillZ)
    dark.push(placed(new BoxGeometry(0.06, 0.08, sillLen), side * (s.w * 0.96), s.bottom + 0.06, sillZ))
  }
  // Headlight housings.
  for (const side of [-1, 1]) dark.push(placed(new BoxGeometry(nose.w * 0.5, 0.1, 0.14), side * nose.w * 0.56, nose.shoulder - 0.07, front - 0.12, -0.15))
  if (def.sport) {
    // Big corner intakes in the front bumper, and a carbon-style blade
    // splitter that sticks out ahead of the nose.
    for (const side of [-1, 1]) dark.push(placed(new BoxGeometry(nose.w * 0.46, (nose.shoulder - nose.bottom) * 0.38, 0.12), side * nose.w * 0.6, nose.bottom + (nose.shoulder - nose.bottom) * 0.3, front - 0.08))
    dark.push(placed(new BoxGeometry(nose.w * 2.05, 0.025, 0.42), 0, nose.bottom - 0.02, front - 0.02))
  }
  if (def.intakes) {
    // Scoops in the flanks behind the doors, feeding the engine.
    const iz = def.wheelZ[1] + def.wheelR + 0.5
    const s = at(def, iz)
    for (const side of [-1, 1]) {
      dark.push(placed(new SphereGeometry(1, 18, 10).scale(0.07, (s.shoulder - s.bottom) * 0.32, 0.5), side * s.w * 0.985, s.bottom + (s.shoulder - s.bottom) * 0.55, iz, 0, side * 0.12))
    }
  }
  if (def.ducktail) dark.push(placed(new BoxGeometry(0.7, 0.12, 1.0), 0, at(def, 1.4).top + 0.04, 1.4))
  body.add(new Mesh(fixed(mergeGeometries(dark.map((g) => g.toNonIndexed()))), trim))

  // Exhaust tips.
  const exhausts: [number, number, number][] = []
  if (def.exhausts) {
    const tips: BufferGeometry[] = []
    const xs = def.exhausts === 4 ? [-0.62, -0.48, 0.48, 0.62] : def.exhausts === 2 ? [-0.5, 0.5] : [0.55]
    for (const x of xs) {
      tips.push(placed(new CylinderGeometry(0.055, 0.06, 0.18, 14, 1, true), x, tailS.bottom + 0.11, rear + 0.02, Math.PI / 2))
      exhausts.push([x, tailS.bottom + 0.11, rear - 0.05])
    }
    body.add(new Mesh(fixed(mergeGeometries(tips.map((g) => g.toNonIndexed()))), chrome))
  }

  // Lights. Each headlight is its own material so a crash can put one out.
  const heads: MeshBasicMaterial[] = []
  for (const side of [-1, 1]) {
    const head = new MeshBasicMaterial({ color: new Color('#e9f3ff').multiplyScalar(3.2), toneMapped: false })
    fade(head)
    heads.push(head)
    const x = side * nose.w * 0.56
    const y = nose.shoulder - 0.06
    const parts = def.lightBar
      ? [placed(new BoxGeometry(nose.w * 0.95, 0.025, 0.03), side * nose.w * 0.48, y + 0.02, front - 0.03)]
      : [
          placed(new BoxGeometry(nose.w * 0.46, 0.018, 0.02), x, y + 0.035, front - 0.04, -0.15),
          placed(new CylinderGeometry(0.035, 0.035, 0.02, 12), x - side * 0.09, y - 0.01, front - 0.05, Math.PI / 2),
          placed(new CylinderGeometry(0.035, 0.035, 0.02, 12), x + side * 0.05, y - 0.01, front - 0.05, Math.PI / 2),
        ]
    body.add(new Mesh(fixed(mergeGeometries(parts.map((g) => g.toNonIndexed()))), head))
  }
  const tail = new MeshBasicMaterial({ color: new Color('#ff1a2e').multiplyScalar(1.6), toneMapped: false })
  fade(tail)
  const tailY = tailS.shoulder - 0.07
  const tailParts = [placed(new BoxGeometry(tailS.w * 1.7, 0.035, 0.03), 0, tailY, rear - 0.005)]
  for (const side of [-1, 1]) {
    tailParts.push(placed(new BoxGeometry(0.22, 0.09, 0.03), side * tailS.w * 0.78, tailY - 0.03, rear))
    tailParts.push(placed(new BoxGeometry(0.03, 0.09, 0.16), side * tailS.w * 0.9, tailY - 0.03, rear + 0.08))
  }
  body.add(new Mesh(fixed(mergeGeometries(tailParts.map((g) => g.toNonIndexed()))), tail))
  const tailLights: [number, number, number][] = [
    [-tailS.w * 0.78, tailY, rear],
    [tailS.w * 0.78, tailY, rear],
  ]

  // Parts that can come off: mirrors and the wing.
  const loose: CarModel['loose'] = []
  const mirrorZ = def.stations.find((s) => s.top - s.shoulder > 0.25 && s.z > 0)?.z ?? 0.6
  const m = at(def, mirrorZ + 0.1)
  for (const side of [-1, 1]) {
    const mirror = new Mesh(placed(new CapsuleGeometry(0.045, 0.12, 4, 8), 0, 0, 0, 0, 0, Math.PI / 2), paint)
    mirror.position.set(side * (m.w + 0.08), m.shoulder + 0.07, mirrorZ + 0.05)
    body.add(mirror)
    loose.push({ mesh: mirror, side: side < 0 ? 'right' : 'left' })
  }
  if (def.wing) {
    const w = def.wing
    const wing = new Mesh(
      mergeGeometries([
        placed(new BoxGeometry(w.width, 0.04, w.chord), 0, 0, 0, -0.08),
        placed(new BoxGeometry(0.04, 0.12, w.chord * 0.9), -w.width / 2, 0, 0),
        placed(new BoxGeometry(0.04, 0.12, w.chord * 0.9), w.width / 2, 0, 0),
        placed(new BoxGeometry(0.05, w.y - at(def, w.z).top, 0.08), -w.width * 0.32, -(w.y - at(def, w.z).top) / 2, 0),
        placed(new BoxGeometry(0.05, w.y - at(def, w.z).top, 0.08), w.width * 0.32, -(w.y - at(def, w.z).top) / 2, 0),
      ].map((g) => g.toNonIndexed())),
      trim,
    )
    wing.position.set(0, w.y, w.z)
    body.add(wing)
    loose.push({ mesh: wing, side: 'rear' })
  }
  if (def.roofSpoiler) {
    const s = at(def, rear + 0.35)
    const lip = new Mesh(placed(new BoxGeometry(s.roof * 2, 0.04, 0.3), 0, 0, 0, 0.2), paint)
    lip.position.set(0, s.top + 0.03, rear + 0.3)
    body.add(lip)
    loose.push({ mesh: lip, side: 'rear' })
  }

  // Police light bar, flashed by the game.
  let siren: CarModel['siren'] = null
  if (shape.startsWith('police')) {
    const red = new MeshBasicMaterial({ color: new Color('#ff2030').multiplyScalar(4), toneMapped: false })
    const blue = new MeshBasicMaterial({ color: new Color('#2050ff').multiplyScalar(4), toneMapped: false })
    const roofTop = at(def, -0.1).top
    const base = new Mesh(new BoxGeometry(1.3, 0.06, 0.32), trim)
    base.position.set(0, roofTop + 0.04, -0.1)
    body.add(base)
    for (const [mat, x] of [
      [red, -0.34],
      [blue, 0.34],
    ] as const) {
      const block = new Mesh(new BoxGeometry(0.56, 0.1, 0.26), mat)
      block.position.set(x, roofTop + 0.12, -0.1)
      body.add(block)
    }
    // White doors on the dark body, and a push bar on the nose.
    const s = at(def, 0)
    for (const side of [-1, 1]) {
      const door = new Mesh(new PlaneGeometry(2.0, (s.shoulder - s.bottom) * 0.55), new MeshStandardMaterial({ color: '#e9ebf0', roughness: 0.4 }))
      door.position.set(side * (s.w + 0.006), s.bottom + (s.shoulder - s.bottom) * 0.55, -0.1)
      door.rotation.y = side * Math.PI / 2
      body.add(door)
    }
    const bar = new Mesh(new BoxGeometry(1.1, 0.3, 0.08), trim)
    bar.position.set(0, nose.bottom + 0.22, front + 0.06)
    body.add(bar)
    siren = { red, blue }
  }

  // Wheel slots. Front ones sit in pivots so they can steer.
  const bank = options.bank ?? (ownBank ??= new WheelBank(64))
  const wheels: Object3D[] = []
  const frontPivots: Group[] = []
  for (const z of def.wheelZ) {
    for (const side of [-1, 1]) {
      const slot = new Object3D()
      slot.userData = { radius: def.wheelR, flip: side < 0 }
      if (z > 0) {
        const pivot = new Group()
        pivot.position.set(side * def.wheelX, def.wheelR, z)
        pivot.add(slot)
        group.add(pivot)
        frontPivots.push(pivot)
      } else {
        slot.position.set(side * def.wheelX, def.wheelR, z)
        group.add(slot)
      }
      // Brake caliper, fixed to the pivot so it steers but does not spin.
      const caliper = new Mesh(new BoxGeometry(0.06, 0.16, 0.1), new MeshStandardMaterial({ color: def.sport ? '#e03030' : '#3a3d45', roughness: 0.4, metalness: 0.4 }))
      caliper.position.set(z > 0 ? 0 : side * def.wheelX, (z > 0 ? 0 : def.wheelR) + def.wheelR * 0.38, z > 0 ? -0.1 : z - 0.1)
      ;(z > 0 ? frontPivots[frontPivots.length - 1] : group).add(caliper)
      if (!ghost) bank.add(slot)
      wheels.push(slot)
    }
  }
  if (!options.bank && !ghost && !bank.tyres.parent) group.add(bank.tyres, bank.rims)

  // Nitro flames from the exhausts, hidden until the boost is on.
  const flameMat = new MeshBasicMaterial({ color: new Color('#5fb6ff').multiplyScalar(3), toneMapped: false, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false })
  const coreMat = new MeshBasicMaterial({ color: new Color('#ffffff').multiplyScalar(4), toneMapped: false, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false })
  const flames: Mesh[] = []
  for (const [x, y, z] of def.sport ? exhausts.length ? exhausts : ([[-0.4, tailS.bottom + 0.12, rear - 0.05], [0.4, tailS.bottom + 0.12, rear - 0.05]] as [number, number, number][]) : []) {
    const flame = new Mesh(new ConeGeometry(0.11, 1.2, 12).rotateX(-Math.PI / 2).translate(0, 0, -0.6), flameMat)
    flame.add(new Mesh(new ConeGeometry(0.05, 0.6, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.3), coreMat))
    flame.position.set(x, y, z)
    flame.visible = false
    body.add(flame)
    flames.push(flame)
  }

  // Headlight pool on the road ahead: cheaper than a real light per car.
  if (!ghost) {
    const beam = new Mesh(
      new PlaneGeometry(7, 16).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: spot, color: '#9fc4ff', transparent: true, opacity: 0.14, blending: AdditiveBlending, depthWrite: false }),
    )
    beam.position.set(0, 0.05, front + 8.3)
    beam.userData.night = true
    group.add(beam)
  }
  const length = front - rear
  let glow: Mesh | null = null
  if (options.glow ?? def.sport) {
    glow = new Mesh(
      new PlaneGeometry(2.8, length + 1).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: spot, color: new Color(color).multiplyScalar(ghost ? 0.2 : 0.5), transparent: true, blending: AdditiveBlending, depthWrite: false }),
    )
    glow.position.y = 0.04
    glow.userData.night = true
    group.add(glow)
  }
  if (!ghost) {
    const shadow = new Mesh(new PlaneGeometry(2.6, length + 0.8).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: spot, color: '#000', transparent: true, opacity: 0.8, depthWrite: false }))
    shadow.position.set(0, 0.03, (front + rear) / 2)
    group.add(shadow)
  }

  const maxW = Math.max(...def.stations.map((s) => s.w))
  return {
    group,
    body,
    wheels,
    frontPivots,
    tail,
    heads,
    flames,
    glow,
    siren,
    tailLights,
    exhausts,
    loose,
    hit: (x, y, z, strength) => {
      dent(bodyGeo, x, y, z, strength, original)
      for (const part of rigid) dent(part.geo, x, y, z, strength, part.original)
    },
    half: { width: maxW, front, rear },
    materials: [paint, glass, trim, chrome, tail, ...heads, flameMat],
  }
}

// A car built from a 3D model: the model with its own wheels and lights,
// plus the headlight pool, underglow and contact shadow the drawn cars have.
function assetModel(asset: AssetCar, color: string, spot: Texture, options: ModelOptions): CarModel {
  const group = new Group()
  const body = new Group()
  group.add(body)
  body.add(asset.root)
  const { half } = asset
  const beam = new Mesh(
    new PlaneGeometry(7, 16).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ map: spot, color: '#9fc4ff', transparent: true, opacity: 0.14, blending: AdditiveBlending, depthWrite: false }),
  )
  beam.position.set(0, 0.05, half.front + 8.3)
  beam.userData.night = true
  group.add(beam)
  let glow: Mesh | null = null
  if (options.glow ?? true) {
    glow = new Mesh(
      new PlaneGeometry(half.width * 2.6, half.front - half.rear + 1).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: spot, color: new Color(color).multiplyScalar(0.5), transparent: true, blending: AdditiveBlending, depthWrite: false }),
    )
    glow.position.y = 0.04
    glow.userData.night = true
    group.add(glow)
  }
  group.add(contactShadow(spot, half))
  return {
    group,
    body,
    wheels: asset.wheels,
    frontPivots: asset.frontPivots,
    tail: asset.tail,
    heads: asset.heads,
    flames: asset.flames,
    glow,
    siren: asset.siren,
    tailLights: asset.tailLights,
    exhausts: asset.exhausts,
    loose: [],
    hit: asset.hit,
    half,
    materials: asset.materials,
  }
}
