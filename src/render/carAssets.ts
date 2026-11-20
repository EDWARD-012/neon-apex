import {
  AdditiveBlending,
  Box3,
  type BufferAttribute,
  Float32BufferAttribute,
  Color,
  ConeGeometry,
  Group,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  type MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  type Texture,
  Vector3,
} from 'three'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Shape as CarShape } from '../sim/cars'

// The player's and rivals' cars as real 3D models made by artists (CC-BY,
// from Sketchfab; see the README's Credits). public/models holds versions
// made small by scripts/prepare-cars.mjs. This file loads them once, turns
// and scales each to the game's car size, finds its wheels so they can spin
// and steer, and repaints the body in the colour the player picks.

interface AssetDef {
  file: string
  // Turn about y that points the nose along +z.
  turn: number
  // Nose to tail, metres.
  length: number
  // Wheel nodes: the first group in the match says front (F...) or back.
  wheels: RegExp
  // Body paint materials, and the hue (0 to 1) of the paint baked into the
  // texture, so only paint-coloured texels are repainted.
  paint: RegExp
  paintHue?: number
  // Tail and head light parts, by material or mesh name.
  tail?: RegExp
  head?: RegExp
  // Nitro flame and light trail positions, as fractions of half width.
  exhaustX: number[]
  exhaustY: number
  tailY: number
}

const DEFS: Partial<Record<CarShape, AssetDef>> = {
  vanta: {
    file: 'vanta.glb',
    turn: Math.PI,
    length: 4.55,
    wheels: /^car_wheel_(F|B)(?:L|R)$/,
    // The paint is a separate shell over the darker body.
    paint: /^clearcoat$/,
    exhaustX: [-0.16, 0.16],
    exhaustY: 0.36,
    tailY: 0.72,
  },
  kite: {
    file: 'kite.glb',
    turn: 0,
    length: 4.3,
    wheels: /^WH_(F|R)(?:L|R)_/,
    paint: /^Azura_Body$/,
    tail: /^Azura_Glass_Red$/,
    head: /^Azura_Glass_Orange$/,
    exhaustX: [0.55],
    exhaustY: 0.3,
    tailY: 0.82,
  },
  brute: {
    file: 'brute.glb',
    turn: 0,
    length: 4.75,
    wheels: /^Coupe-Wheel\.(Ft|Bk)\./,
    paint: /^car-body$/,
    paintHue: 0.0,
    tail: /^Glass_-_Red/,
    head: /^headlights\./,
    exhaustX: [-0.62, -0.48, 0.48, 0.62],
    exhaustY: 0.33,
    tailY: 0.95,
  },
}
// The electric car shares the hypercar's body.
DEFS.volt = DEFS.vanta

interface Template {
  def: AssetDef
  root: Group
  half: { width: number; front: number; rear: number }
}

const templates = new Map<CarShape, Template>()

// Loads every model; resolves when they are ready, or quietly falls back
// to the drawn cars if they cannot load.
export async function loadCarAssets(): Promise<void> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const base = `${import.meta.env.BASE_URL}models/`
  // One template per file: shapes that share a model share its template.
  const prepared = new Map<string, Promise<Template>>()
  await Promise.all(
    (Object.entries(DEFS) as [CarShape, AssetDef][]).map(async ([shape, def]) => {
      try {
        if (!prepared.has(def.file)) prepared.set(def.file, loader.loadAsync(base + def.file).then((g) => prepare(g.scene as unknown as Group, def)))
        templates.set(shape, await (prepared.get(def.file) as Promise<Template>))
      } catch {
        // Keep the drawn car for this shape.
      }
    }),
  )
}

export function hasCarAsset(shape: CarShape) {
  return templates.has(shape)
}

// Turns, scales and centres a model: nose at +z, wheels on y = 0.
function prepare(scene: Group, def: AssetDef): Template {
  const turned = new Group()
  turned.rotation.y = def.turn
  turned.add(scene)
  const root = new Group()
  root.add(turned)
  root.updateMatrixWorld(true)
  let box = new Box3().setFromObject(root)
  const scale = def.length / (box.max.z - box.min.z)
  root.scale.setScalar(scale)
  root.updateMatrixWorld(true)
  box = new Box3().setFromObject(root)
  const c = box.getCenter(new Vector3())
  root.position.set(-c.x, -box.min.y, -c.z)
  root.updateMatrixWorld(true)
  box = new Box3().setFromObject(root)
  return { def, root, half: { width: (box.max.x - box.min.x) / 2, front: box.max.z, rear: box.min.z } }
}

// How bright the paint texels of a body texture are, in linear light: the
// brighter quarter of the texels within the paint's hue. Repainting scales
// the new colour by each texel's brightness over this, so the texture's
// shading and dirt survive the change of colour.
const references = new Map<Texture, { reference: number; coverage: number }>()
function paintReference(map: Texture, hue: number): { reference: number; coverage: number } {
  const known = references.get(map)
  if (known) return known
  let reference = 0.2
  let coverage = 0
  try {
    const image = map.image as CanvasImageSource & { width: number; height: number }
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = Math.max(1, Math.round((128 * image.height) / image.width))
    const g = canvas.getContext('2d') as CanvasRenderingContext2D
    g.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = g.getImageData(0, 0, canvas.width, canvas.height).data
    const lin = (v: number) => (v / 255) ** 2.2
    const values: number[] = []
    for (let i = 0; i < data.length; i += 4) {
      const r = lin(data[i])
      const gr = lin(data[i + 1])
      const b = lin(data[i + 2])
      const hi = Math.max(r, gr, b)
      const chroma = hi - Math.min(r, gr, b)
      if (hi <= 0 || chroma / hi < 0.3) continue
      let h = hi === r ? ((gr - b) / chroma + 6) % 6 : hi === gr ? (b - r) / chroma + 2 : (r - gr) / chroma + 4
      h /= 6
      const dh = Math.min(Math.abs(h - hue), 1 - Math.abs(h - hue))
      if (dh < 0.08) values.push(hi)
    }
    coverage = values.length / (data.length / 4)
    if (values.length > 20) {
      values.sort((a, b) => a - b)
      reference = values[Math.floor(values.length * 0.75)]
    }
  } catch {
    // Keep the defaults.
  }
  const result = { reference, coverage }
  references.set(map, result)
  return result
}

// Repaints paint-coloured texels of a textured body in the chosen colour,
// leaving black trim, grilles and chrome baked into the same texture alone.
function paintMaterial(original: MeshStandardMaterial, color: string, hue: number | undefined): MeshPhysicalMaterial {
  // Where the paint colour is in the texture, repaint those texels. Where
  // the texture is only grey detail and the colour comes from the material,
  // simply tint it.
  const probe = original.map && hue !== undefined ? paintReference(original.map, hue) : null
  const recolour = probe !== null && probe.coverage > 0.03
  const paint = new MeshPhysicalMaterial({
    name: original.name,
    color: recolour ? '#ffffff' : color,
    map: original.map,
    normalMap: original.normalMap,
    aoMap: original.aoMap,
    roughnessMap: original.roughnessMap,
    metalnessMap: original.metalnessMap,
    metalness: 0.45,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.2,
  })
  if (recolour && probe && hue !== undefined) {
    const uniforms = { uPaint: { value: new Color(color) }, uHue: { value: hue }, uRef: { value: probe.reference } }
    paint.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.fragmentShader = `uniform vec3 uPaint;\nuniform float uHue;\nuniform float uRef;\n${shader.fragmentShader}`.replace(
        '#include <map_fragment>',
        /* glsl */ `
        #ifdef USE_MAP
          vec4 texel = texture2D(map, vMapUv);
          vec3 c = texel.rgb;
          float hi = max(c.r, max(c.g, c.b));
          float lo = min(c.r, min(c.g, c.b));
          float chroma = hi - lo;
          float sat = hi > 0.0 ? chroma / hi : 0.0;
          float h = 0.0;
          if (chroma > 1e-4) {
            if (hi == c.r) h = mod((c.g - c.b) / chroma, 6.0);
            else if (hi == c.g) h = (c.b - c.r) / chroma + 2.0;
            else h = (c.r - c.g) / chroma + 4.0;
            h /= 6.0;
          }
          float dh = abs(h - uHue);
          dh = min(dh, 1.0 - dh);
          float mask = (1.0 - smoothstep(0.06, 0.12, dh)) * smoothstep(0.2, 0.4, sat);
          // Keep the texture's shading: scale the new colour by how bright
          // the paint texel was compared with the brightest of it.
          vec3 painted = uPaint * clamp(hi / uRef, 0.35, 1.4);
          texel.rgb = mix(c, painted, mask);
          diffuseColor *= texel;
        #endif`,
      )
    }
    paint.customProgramCacheKey = () => `paint-${hue}`
  }
  return paint
}

export interface AssetCar {
  root: Group
  wheels: Object3D[]
  frontPivots: Group[]
  tail: MeshBasicMaterial
  heads: MeshBasicMaterial[]
  flames: Mesh[]
  exhausts: [number, number, number][]
  tailLights: [number, number, number][]
  half: { width: number; front: number; rear: number }
  materials: Material[]
  hit: (x: number, y: number, z: number, strength: number) => void
}

const TAIL = new Color('#ff1a2e').multiplyScalar(1.6)

export function makeAssetCar(shape: CarShape, color: string): AssetCar | null {
  const template = templates.get(shape)
  if (!template) return null
  const { def, half } = template
  // car is in car space (metres, nose along +z); model is the scaled copy.
  const car = new Group()
  const model = template.root.clone(true)
  car.add(model)
  car.updateMatrixWorld(true)

  // Materials for this car: its own paint and its own lights.
  const tail = new MeshBasicMaterial({ color: TAIL.clone(), toneMapped: false })
  const heads = [new MeshBasicMaterial({ color: new Color('#eef4ff').multiplyScalar(3), toneMapped: false }), new MeshBasicMaterial({ color: new Color('#eef4ff').multiplyScalar(3), toneMapped: false })]
  const paints = new Map<Material, MeshPhysicalMaterial>()
  const panels: Mesh[] = []
  const inWheel = (o: Object3D) => {
    for (let p: Object3D | null = o; p; p = p.parent) if (def.wheels.test(p.name) || /brake/i.test(p.name)) return true
    return false
  }
  model.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    const material = mesh.material as MeshStandardMaterial
    const name = material.name ?? ''
    if (def.tail && (def.tail.test(name) || def.tail.test(mesh.name))) mesh.material = tail
    else if (def.head && (def.head.test(name) || def.head.test(mesh.name))) {
      const box = new Box3().setFromObject(mesh)
      mesh.material = heads[(box.min.x + box.max.x) / 2 > 0 ? 1 : 0]
    } else if (def.paint.test(name) && !inWheel(mesh)) {
      let paint = paints.get(material)
      if (!paint) {
        paint = paintMaterial(material, color, def.paintHue)
        paints.set(material, paint)
      }
      mesh.material = paint
    }
    // Every part of the body dents together, so a paint shell over an
    // inner body never sinks through it.
    if (!inWheel(mesh)) panels.push(mesh)
  })

  // Wheels: each one's parts move into a steering pivot and a spinning
  // pivot centred on the hub and lined up with the car.
  const wheels: Object3D[] = []
  const frontPivots: Group[] = []
  const found: { front: boolean; node: Object3D }[] = []
  model.traverse((o) => {
    const m = def.wheels.exec(o.name)
    if (!m) return
    // Only the outermost matching node of each wheel.
    for (let p = o.parent; p; p = p.parent) if (def.wheels.test(p.name)) return
    found.push({ front: m[1].startsWith('F'), node: o })
  })
  // Several nodes can make one wheel (tyre, rim, cap): merge by position.
  const merged: { front: boolean; nodes: Object3D[]; box: Box3 }[] = []
  for (const { front, node } of found) {
    const box = new Box3().setFromObject(node)
    const centre = box.getCenter(new Vector3())
    const near = merged.find((w) => w.box.getCenter(new Vector3()).distanceTo(centre) < 0.5)
    if (near) {
      near.nodes.push(node)
      near.box.union(box)
    } else merged.push({ front, nodes: [node], box })
  }
  for (const wheel of merged) {
    const steer = new Group()
    steer.position.copy(wheel.box.getCenter(new Vector3()))
    const spin = new Group()
    steer.add(spin)
    car.add(steer)
    car.updateMatrixWorld(true)
    for (const node of wheel.nodes) spin.attach(node)
    wheels.push(spin)
    if (wheel.front) frontPivots.push(steer)
  }

  // Nitro flames out of the exhausts.
  const flameMat = new MeshBasicMaterial({ color: new Color('#5fb6ff').multiplyScalar(3), toneMapped: false, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false })
  const coreMat = new MeshBasicMaterial({ color: new Color('#ffffff').multiplyScalar(4), toneMapped: false, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false })
  const exhausts: [number, number, number][] = def.exhaustX.map((f) => [f * half.width, def.exhaustY, half.rear - 0.02])
  const flames = exhausts.map(([x, y, z]) => {
    const flame = new Mesh(new ConeGeometry(0.1, 1.15, 12).rotateX(-Math.PI / 2).translate(0, 0, -0.58), flameMat)
    flame.add(new Mesh(new ConeGeometry(0.045, 0.55, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.28), coreMat))
    flame.position.set(x, y, z)
    flame.visible = false
    car.add(flame)
    return flame
  })
  const tailLights: [number, number, number][] = [
    [-half.width * 0.72, def.tailY, half.rear],
    [half.width * 0.72, def.tailY, half.rear],
  ]

  // Dents. Each body panel gets its own copy of its geometry the first time
  // it is hit, so other cars of the same model stay smooth. The work is done
  // in car space, so the push is towards the middle of the car whatever way
  // the model's own axes face.
  const own = new Map<Mesh, { original: Float32Array; toCar: Matrix4; toMesh: Matrix4 }>()
  const v = new Vector3()
  const o = new Vector3()
  const hit = (x: number, y: number, z: number, strength: number) => {
    car.updateMatrixWorld(true)
    const carInverse = car.matrixWorld.clone().invert()
    // Shallower than on the drawn cars: these models have layered panels.
    const radius = 0.55 + Math.min(0.6, strength * 0.03)
    const depth = Math.min(0.14, strength * 0.008)
    for (const mesh of panels) {
      let entry = own.get(mesh)
      if (!entry) {
        // The compressed models store positions and normals as small
        // integers. Dents need real numbers, so the copy gets float ones.
        const copy = mesh.geometry.clone()
        for (const name of ['position', 'normal']) {
          const a = copy.getAttribute(name)
          if (!a) continue
          const f = new Float32Array(a.count * 3)
          for (let i = 0; i < a.count; i++) f.set([a.getX(i), a.getY(i), a.getZ(i)], i * 3)
          copy.setAttribute(name, new Float32BufferAttribute(f, 3))
        }
        mesh.geometry = copy
        const toCar = new Matrix4().multiplyMatrices(carInverse, mesh.matrixWorld)
        const position = mesh.geometry.getAttribute('position') as BufferAttribute
        // Starting shape in car space; positions may be stored quantised.
        const original = new Float32Array(position.count * 3)
        for (let i = 0; i < position.count; i++) {
          v.fromBufferAttribute(position, i).applyMatrix4(toCar)
          original.set([v.x, v.y, v.z], i * 3)
        }
        entry = { original, toCar, toMesh: toCar.clone().invert() }
        own.set(mesh, entry)
      }
      const position = mesh.geometry.getAttribute('position') as BufferAttribute
      let moved = false
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(entry.toCar)
        const d = Math.hypot(v.x - x, (v.y - y) * 1.4, v.z - z)
        if (d > radius) continue
        const f = (1 - d / radius) ** 2
        const crumple = 0.8 + 0.4 * Math.sin(v.x * 6.1 + v.z * 4.3 + v.y * 3.7)
        const len = Math.hypot(v.x, v.z * 0.35) || 1
        const push = depth * f * crumple
        v.x -= (v.x / len) * push
        v.z -= ((v.z * 0.35) / len) * push
        v.y -= push * 0.25
        // No point moves more than 15 cm from where it started.
        o.set(entry.original[i * 3], entry.original[i * 3 + 1], entry.original[i * 3 + 2])
        const off = v.clone().sub(o)
        if (off.length() > 0.15) v.copy(o).add(off.setLength(0.15))
        v.applyMatrix4(entry.toMesh)
        position.setXYZ(i, v.x, v.y, v.z)
        moved = true
      }
      if (moved) {
        position.needsUpdate = true
        mesh.geometry.computeVertexNormals()
      }
    }
  }

  const materials: Material[] = [tail, ...heads, flameMat, ...paints.values()]
  return { root: car, wheels, frontPivots, tail, heads, flames, exhausts, tailLights, half, materials, hit }
}

// The soft spot under the car, shared by the model cars.
export function contactShadow(spot: Texture, half: { width: number; front: number; rear: number }) {
  const shadow = new Mesh(new PlaneGeometry(half.width * 2.3, half.front - half.rear + 0.7).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: spot, color: '#000', transparent: true, opacity: 0.75, depthWrite: false }))
  shadow.position.set(0, 0.03, (half.front + half.rear) / 2)
  return shadow
}
