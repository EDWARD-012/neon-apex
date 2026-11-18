import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  type Texture,
} from 'three'
import type { Shape as CarShape } from '../sim/cars'

// Cars built from a few extruded side profiles and primitives. None of them
// is modelled on a real car.

export interface CarModel {
  group: Group
  body: Group
  frontPivots: Group[]
  wheels: Mesh[]
  tail: MeshBasicMaterial
  flames: Mesh[]
  glow: Mesh | null
  // Police light bar, flashed by the game.
  siren: { red: MeshBasicMaterial; blue: MeshBasicMaterial } | null
  // Where the tail lights are, in car space, for the light trails.
  tailLights: [number, number, number][]
  materials: Material[]
}

type Points = [number, number][]

interface ShapeDef {
  // Side profiles: x runs from the rear (-) to the nose (+), y is height.
  body: Points
  bodyWidth: number
  bevel: number
  cabin: Points
  cabinWidth: number
  roof?: Points
  wheelFront: number
  wheelRear: number
  wheelX: number
  wheelR: number
  headY: number
  noseZ: number
  tailY: number
  tailZ: number
  tailWidth: number
  wing?: { y: number; z: number; width: number }
  extras?: (body: Group, paint: Material, dark: Material) => void
  sport: boolean
}

const SEDAN: Omit<ShapeDef, 'extras'> = {
  body: [[-2.2, 0.3], [-2.26, 0.84], [-1.6, 0.94], [1.2, 0.92], [2.2, 0.8], [2.3, 0.42], [2.2, 0.3]],
  bodyWidth: 1.7,
  bevel: 0.1,
  cabin: [[-1.5, 0.9], [-0.95, 1.42], [0.5, 1.45], [1.15, 0.92]],
  cabinWidth: 1.5,
  roof: [[-0.92, 1.4], [-0.85, 1.47], [0.45, 1.5], [0.52, 1.43]],
  wheelFront: 1.4,
  wheelRear: -1.4,
  wheelX: 0.86,
  wheelR: 0.36,
  headY: 0.7,
  noseZ: 2.3,
  tailY: 0.82,
  tailZ: -2.28,
  tailWidth: 1.5,
  sport: false,
}

const SHAPES: Record<CarShape, ShapeDef> = {
  vanta: {
    body: [[-2.12, 0.3], [-2.2, 0.62], [-2.08, 0.82], [-1.2, 0.86], [0.9, 0.84], [1.9, 0.7], [2.2, 0.56], [2.18, 0.3]],
    bodyWidth: 1.64,
    bevel: 0.14,
    cabin: [[-1.45, 0.8], [-0.65, 1.13], [0.2, 1.15], [1.05, 0.82]],
    cabinWidth: 1.22,
    roof: [[-0.62, 1.12], [-0.55, 1.2], [0.18, 1.22], [0.26, 1.13]],
    wheelFront: 1.38,
    wheelRear: -1.38,
    wheelX: 0.86,
    wheelR: 0.36,
    headY: 0.64,
    noseZ: 2.24,
    tailY: 0.74,
    tailZ: -2.3,
    tailWidth: 1.5,
    wing: { y: 1.06, z: -1.92, width: 1.76 },
    sport: true,
  },
  kite: {
    body: [[-1.88, 0.3], [-1.95, 0.72], [-1.75, 0.9], [0.8, 0.88], [1.7, 0.72], [1.98, 0.56], [1.96, 0.3]],
    bodyWidth: 1.6,
    bevel: 0.16,
    cabin: [[-1.72, 0.86], [-1.45, 1.3], [0.35, 1.34], [1.05, 0.88]],
    cabinWidth: 1.36,
    roof: [[-1.42, 1.28], [-1.3, 1.36], [0.3, 1.39], [0.42, 1.31]],
    wheelFront: 1.25,
    wheelRear: -1.2,
    wheelX: 0.84,
    wheelR: 0.34,
    headY: 0.66,
    noseZ: 2.0,
    tailY: 0.86,
    tailZ: -1.98,
    tailWidth: 1.36,
    wing: { y: 1.4, z: -1.6, width: 1.3 },
    sport: true,
  },
  brute: {
    body: [[-2.35, 0.32], [-2.4, 0.82], [-1.5, 0.96], [0.6, 0.95], [2.2, 0.9], [2.42, 0.72], [2.38, 0.32]],
    bodyWidth: 1.8,
    bevel: 0.08,
    cabin: [[-1.38, 0.93], [-0.78, 1.3], [0.28, 1.32], [0.78, 0.95]],
    cabinWidth: 1.5,
    roof: [[-0.76, 1.29], [-0.7, 1.36], [0.24, 1.38], [0.3, 1.31]],
    wheelFront: 1.52,
    wheelRear: -1.5,
    wheelX: 0.9,
    wheelR: 0.39,
    headY: 0.72,
    noseZ: 2.44,
    tailY: 0.78,
    tailZ: -2.44,
    tailWidth: 1.7,
    extras: (body, paint, dark) => {
      // Bonnet scoop and a ducktail lip.
      const scoop = new Mesh(new BoxGeometry(0.6, 0.12, 0.9), dark)
      scoop.position.set(0, 1.0, 1.35)
      const lip = new Mesh(new BoxGeometry(1.7, 0.08, 0.3), paint)
      lip.position.set(0, 0.98, -2.25)
      lip.rotation.x = -0.25
      body.add(scoop, lip)
    },
    sport: true,
  },
  volt: {
    body: [[-2.2, 0.3], [-2.26, 0.68], [-1.95, 0.8], [1.2, 0.8], [2.3, 0.46], [2.26, 0.3]],
    bodyWidth: 1.68,
    bevel: 0.12,
    cabin: [[-1.65, 0.76], [-0.45, 1.14], [0.55, 1.12], [1.6, 0.74]],
    cabinWidth: 1.3,
    wheelFront: 1.42,
    wheelRear: -1.42,
    wheelX: 0.87,
    wheelR: 0.36,
    headY: 0.56,
    noseZ: 2.3,
    tailY: 0.72,
    tailZ: -2.3,
    tailWidth: 1.66,
    sport: true,
  },
  sedan: SEDAN,
  van: {
    body: [[-2.4, 0.35], [-2.42, 1.95], [1.1, 2.0], [2.25, 1.15], [2.45, 0.62], [2.4, 0.35]],
    bodyWidth: 1.86,
    bevel: 0.08,
    cabin: [[1.05, 1.92], [2.18, 1.16], [2.26, 1.02], [1.0, 1.02]],
    cabinWidth: 1.9,
    wheelFront: 1.55,
    wheelRear: -1.55,
    wheelX: 0.92,
    wheelR: 0.38,
    headY: 0.78,
    noseZ: 2.46,
    tailY: 1.0,
    tailZ: -2.44,
    tailWidth: 1.6,
    sport: false,
  },
  police: {
    ...SEDAN,
    extras: (body) => {
      // White doors on the dark body.
      const door = new Mesh(new BoxGeometry(1.78, 0.34, 1.9), new MeshStandardMaterial({ color: '#e8eaf0', roughness: 0.4 }))
      door.position.set(0, 0.62, -0.1)
      body.add(door)
    },
  },
}

function profile(points: Points) {
  const shape = new Shape()
  shape.moveTo(points[0][0], points[0][1])
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y)
  shape.closePath()
  return shape
}

// Extruded geometry is shared between every car of the same shape.
const geometryCache = new Map<string, BufferGeometry>()
function extrude(key: string, points: Points, width: number, bevel: number) {
  const cached = geometryCache.get(key)
  if (cached) return cached
  const geo = new ExtrudeGeometry(profile(points), {
    depth: width,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 4,
  })
  // Turn the profile so the nose points along +z and the width runs along x.
  geo.rotateY(-Math.PI / 2)
  geo.translate(width / 2, 0, 0)
  geometryCache.set(key, geo)
  return geo
}

export interface ModelOptions {
  shape?: CarShape
  ghost?: boolean
  // Underglow in the body colour. On by default for the sports cars only.
  glow?: boolean
}

export function createCarModel(color: string, spot: Texture, options: ModelOptions = {}): CarModel {
  const shapeId = options.shape ?? 'vanta'
  const def = SHAPES[shapeId]
  const ghost = options.ghost ?? false
  const fade = (m: Material, o = 0.35) => {
    if (ghost) {
      m.transparent = true
      m.opacity = o
    }
  }
  const group = new Group()
  const body = new Group()
  group.add(body)
  const paint = new MeshPhysicalMaterial({
    color,
    metalness: def.sport ? 0.55 : 0.3,
    roughness: def.sport ? 0.3 : 0.45,
    clearcoat: def.sport ? 1 : 0.4,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.5,
  })
  const glass = new MeshStandardMaterial({ color: '#06070c', metalness: 0.9, roughness: 0.08, envMapIntensity: 2 })
  const dark = new MeshStandardMaterial({ color: '#0c0d11', roughness: 0.7 })
  for (const m of [paint, glass, dark]) fade(m)

  body.add(new Mesh(extrude(`${shapeId}/body`, def.body, def.bodyWidth, def.bevel), paint))
  body.add(new Mesh(extrude(`${shapeId}/cabin`, def.cabin, def.cabinWidth, 0.06), glass))
  if (def.roof) body.add(new Mesh(extrude(`${shapeId}/roof`, def.roof, def.cabinWidth - 0.12, 0.04), paint))
  const length = def.noseZ - def.tailZ
  const skirt = new Mesh(new BoxGeometry(def.bodyWidth + 0.2, 0.14, length - 0.5), dark)
  skirt.position.set(0, 0.3, (def.noseZ + def.tailZ) / 2)
  body.add(skirt)
  if (def.wing) {
    const wing = new Mesh(new BoxGeometry(def.wing.width, 0.05, 0.34), dark)
    wing.position.set(0, def.wing.y, def.wing.z)
    body.add(wing)
    for (const side of [-1, 1]) {
      const strut = new Mesh(new BoxGeometry(0.06, 0.2, 0.12), dark)
      strut.position.set(side * def.wing.width * 0.3, def.wing.y - 0.1, def.wing.z)
      body.add(strut)
    }
  }
  def.extras?.(body, paint, dark)

  // Lamps glow through the bloom pass, so they are drawn without tone mapping.
  const head = new MeshBasicMaterial({ color: new Color('#e6f2ff').multiplyScalar(3), toneMapped: false })
  fade(head, 0.3)
  if (shapeId === 'volt') {
    // One light bar across the nose.
    const strip = new Mesh(new BoxGeometry(1.5, 0.05, 0.05), head)
    strip.position.set(0, def.headY, def.noseZ)
    body.add(strip)
  } else {
    for (const side of [-1, 1]) {
      const lamp = new Mesh(new BoxGeometry(0.42, 0.07, 0.06), head)
      lamp.position.set(side * def.bodyWidth * 0.36, def.headY, def.noseZ)
      lamp.rotation.x = -0.25
      body.add(lamp)
    }
  }
  const tail = new MeshBasicMaterial({ color: new Color('#ff1a2e').multiplyScalar(1.6), toneMapped: false })
  fade(tail, 0.3)
  const bar = new Mesh(new BoxGeometry(def.tailWidth, 0.06, 0.05), tail)
  bar.position.set(0, def.tailY, def.tailZ)
  body.add(bar)
  const tailLights: [number, number, number][] = [
    [-def.tailWidth / 2 + 0.1, def.tailY, def.tailZ],
    [def.tailWidth / 2 - 0.1, def.tailY, def.tailZ],
  ]

  // Police light bar: one red and one blue block, flashed by the game.
  let siren: CarModel['siren'] = null
  if (shapeId === 'police') {
    const red = new MeshBasicMaterial({ color: new Color('#ff2030').multiplyScalar(4), toneMapped: false })
    const blue = new MeshBasicMaterial({ color: new Color('#2050ff').multiplyScalar(4), toneMapped: false })
    const top = (def.roof ?? def.cabin).reduce((m, p) => Math.max(m, p[1]), 0)
    for (const [m, x] of [
      [red, -0.35],
      [blue, 0.35],
    ] as const) {
      const block = new Mesh(new BoxGeometry(0.62, 0.12, 0.26), m)
      block.position.set(x, top + 0.08, -0.2)
      body.add(block)
    }
    siren = { red, blue }
  }

  // Wheels. The front pair sit in pivots so they can steer.
  const tyre = new CylinderGeometry(def.wheelR, def.wheelR, 0.3, 18).rotateZ(Math.PI / 2)
  const rim = new CylinderGeometry(def.wheelR * 0.7, def.wheelR * 0.7, 0.32, 10).rotateZ(Math.PI / 2)
  const rubber = new MeshStandardMaterial({ color: '#111', roughness: 0.9 })
  const alloy = new MeshStandardMaterial({ color: '#9aa0ad', metalness: 0.9, roughness: 0.25 })
  fade(rubber)
  fade(alloy)
  const wheels: Mesh[] = []
  const frontPivots: Group[] = []
  for (const z of [def.wheelFront, def.wheelRear]) {
    for (const side of [-1, 1]) {
      const wheel = new Mesh(tyre, rubber)
      wheel.add(new Mesh(rim, alloy))
      if (z > 0) {
        const pivot = new Group()
        pivot.position.set(side * def.wheelX, def.wheelR, z)
        pivot.add(wheel)
        group.add(pivot)
        frontPivots.push(pivot)
      } else {
        wheel.position.set(side * def.wheelX, def.wheelR, z)
        group.add(wheel)
      }
      wheels.push(wheel)
    }
  }

  // Nitro flames from twin exhausts, hidden until the boost is on.
  const flameMat = new MeshBasicMaterial({ color: new Color('#5fb6ff').multiplyScalar(3), toneMapped: false, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false })
  const flames: Mesh[] = []
  if (def.sport) {
    for (const side of [-1, 1]) {
      const flame = new Mesh(new ConeGeometry(0.13, 1.1, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.55), flameMat)
      flame.position.set(side * 0.45, 0.42, def.tailZ)
      flame.visible = false
      body.add(flame)
      flames.push(flame)
    }
  }

  // A soft pool of headlight on the road ahead. Every car gets one, which is
  // far cheaper than a real light per car.
  if (!ghost) {
    const beam = new Mesh(
      new PlaneGeometry(7, 16).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: spot, color: '#9fc4ff', transparent: true, opacity: 0.14, blending: AdditiveBlending, depthWrite: false }),
    )
    beam.position.set(0, 0.05, def.noseZ + 8.3)
    group.add(beam)
  }

  // Underglow in the car's colour, and a soft dark shadow under it.
  let glow: Mesh | null = null
  if (options.glow ?? def.sport) {
    glow = new Mesh(
      new PlaneGeometry(3.0, length + 1.2).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: spot, color: new Color(color).multiplyScalar(ghost ? 0.25 : 0.55), transparent: true, blending: AdditiveBlending, depthWrite: false }),
    )
    glow.position.y = 0.04
    group.add(glow)
  }
  if (!ghost) {
    const shadow = new Mesh(
      new PlaneGeometry(def.bodyWidth + 0.9, length + 0.8).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: spot, color: '#000', transparent: true, opacity: 0.75, depthWrite: false }),
    )
    shadow.position.set(0, 0.03, (def.noseZ + def.tailZ) / 2)
    group.add(shadow)
  }

  return { group, body, frontPivots, wheels, tail, flames, glow, siren, tailLights, materials: [paint, glass, dark, head, tail, flameMat] }
}
