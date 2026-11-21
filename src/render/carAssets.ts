import { fetchBytes } from '../loader'
import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
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
  MeshStandardMaterial,
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
  // Front wheels are the ones ahead of the middle, when names do not say.
  frontByPosition?: boolean
}

// The traffic pack: ten everyday cars, keeping the paint they came with.
const TRAFFIC: AssetDef = {
  file: 'traffic.glb',
  turn: 0,
  length: 0,
  wheels: /^Wheel_/,
  paint: /^$/,
  exhaustX: [],
  exhaustY: 0.3,
  tailY: 0.8,
  frontByPosition: true,
}
// In the pack every car's nose points along its body's local x axis, this
// way round.
const PACK_NOSE = 1
// Cars in the pack whose body axis points the other way, found by looking
// at where their tail lights are.
const FLIP = new Set<string>(['compact', 'minivan', 'suv', 'offroad'])
// Which pack cars stand in for the drawn sedan and van shapes.
const SEDANS = ['sedan', 'compact', 'coupe', 'hatchback', 'wagon', 'sport']
const VANS = ['minivan', 'suv', 'offroad', 'pickup']

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
    // three.js drops the dots from node names on load: Coupe-Wheel.Ft.L
    // arrives as Coupe-WheelFtL_03.
    wheels: /^Coupe-Wheel(Ft|Bk)[LR]/,
    paint: /^car-body$/,
    paintHue: 0.0,
    tail: /^Glass_-_Red/,
    head: /^headlights[lr]_/,
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
const traffic = new Map<string, Template>()

// Loads every model; resolves when they are ready, or quietly falls back
// to the drawn cars if they cannot load.
// Downloads the car models: the given car's file first, so the menu can
// show it, then the rest and the traffic pack in the background. A file
// that fails after its retries leaves the drawn car in its place.
let pending = true
export function carAssetsPending() {
  return pending
}

export function loadCarAssets(first: CarShape = 'vanta'): { first: Promise<void>; all: Promise<void> } {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const base = `${import.meta.env.BASE_URL}models/`
  const scenes = new Map<string, Promise<Group | null>>()
  const scene = (file: string) => {
    if (!scenes.has(file))
      scenes.set(
        file,
        fetchBytes(base + file)
          .then((bytes) => loader.parseAsync(bytes, base))
          .then(
            (g) => g.scene as unknown as Group,
            (error) => {
              console.warn(`${file} did not load; the drawn cars stand in.`, error)
              return null
            },
          ),
      )
    return scenes.get(file) as Promise<Group | null>
  }
  // One template per file: shapes that share a model share its template.
  const prepared = new Map<string, Promise<Template | null>>()
  const fit = async (shape: CarShape, def: AssetDef) => {
    if (!prepared.has(def.file)) prepared.set(def.file, scene(def.file).then((g) => (g ? prepare(g, def) : null)))
    const template = await (prepared.get(def.file) as Promise<Template | null>)
    if (template) templates.set(shape, template)
  }
  const pack = () =>
    scene(TRAFFIC.file).then((g) => {
      if (g && traffic.size === 0) for (const [name, template] of splitPack(g)) traffic.set(name, template)
    })
  // The Kestrel S is a car from the traffic pack, so for it the pack comes
  // first.
  const firstDef = DEFS[first]
  const firstDone = firstDef ? fit(first, firstDef) : first === 'kestrel' ? pack() : Promise.resolve()
  const all = firstDone
    .then(() => Promise.all([...(Object.entries(DEFS) as [CarShape, AssetDef][]).map(([shape, def]) => fit(shape, def)), pack()]))
    .then(() => {
      pending = false
    })
  return { first: firstDone, all }
}

// The pack has all ten cars on one stand, each turned a different way.
// Each car's body is lifted out with the wheels next to it, turned nose
// along +z and centred.
function splitPack(scene: Group): Map<string, Template> {
  scene.updateMatrixWorld(true)
  const bodies: Object3D[] = []
  const wheels: Object3D[] = []
  scene.traverse((o) => {
    // Spaces in node names arrive as underscores.
    if (/[ _]body$/i.test(o.name)) bodies.push(o)
    else if (TRAFFIC.wheels.test(o.name) && !TRAFFIC.wheels.test(o.parent?.name ?? '')) wheels.push(o)
  })
  const out = new Map<string, Template>()
  for (const body of bodies) {
    const centre = new Box3().setFromObject(body).getCenter(new Vector3())
    const pivot = new Group()
    pivot.position.copy(centre)
    pivot.updateMatrixWorld(true)
    const hubs: Vector3[] = []
    for (let k = wheels.length - 1; k >= 0; k--) {
      const c = new Box3().setFromObject(wheels[k]).getCenter(new Vector3())
      if (Math.hypot(c.x - centre.x, c.z - centre.z) < 3) {
        hubs.push(c)
        pivot.attach(wheels[k])
        wheels.splice(k, 1)
      }
    }
    // The car's length runs along the longer side of its four hubs. Which
    // way is the nose comes from the body's own x axis.
    let forward = new Vector3(1, 0, 0).transformDirection(body.matrixWorld).setY(0).normalize()
    if (hubs.length === 4) {
      // Of the six hub-to-hub spans, the two shortest are across the axles,
      // the two longest are the diagonals, and the middle two run along the
      // car: the wheelbase.
      const spans: Vector3[] = []
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) spans.push(hubs[b].clone().sub(hubs[a]).setY(0))
      spans.sort((p, q) => p.length() - q.length())
      const along = spans[3].normalize()
      forward = along.multiplyScalar(Math.sign(along.dot(forward)) || 1)
    }
    forward.multiplyScalar(PACK_NOSE * (FLIP.has(body.name.replace(/[ _]body$/i, '').toLowerCase()) ? -1 : 1))
    pivot.attach(body)
    pivot.position.set(0, 0, 0)
    pivot.rotation.y = -Math.atan2(forward.x, forward.z)
    const root = new Group()
    root.add(pivot)
    root.updateMatrixWorld(true)
    let box = new Box3().setFromObject(root)
    const c = box.getCenter(new Vector3())
    root.position.set(-c.x, -box.min.y, -c.z)
    root.updateMatrixWorld(true)
    box = new Box3().setFromObject(root)
    out.set(body.name.replace(/[ _]body$/i, '').toLowerCase(), { def: TRAFFIC, root, half: { width: (box.max.x - box.min.x) / 2, front: box.max.z, rear: box.min.z } })
  }
  return out
}

// The model for a shape: the cars' own models, or for traffic and police a
// car from the pack, chosen by variant so a road has a mix.
function templateFor(shape: CarShape, variant: number): Template | undefined {
  if (shape === 'sedan' || shape === 'van') {
    const names = (shape === 'van' ? VANS : SEDANS).filter((n) => traffic.has(n))
    return names.length ? traffic.get(names[Math.abs(variant) % names.length]) : undefined
  }
  // Patrol cars are the pack's sedan, heavy units its SUV and interceptors
  // its sports car, all in police paint.
  if (shape === 'police') return traffic.get('sedan')
  if (shape === 'police-heavy') return traffic.get('suv') ?? traffic.get('sedan')
  if (shape === 'police-fast') return traffic.get('sport') ?? traffic.get('sedan')
  if (shape === 'kestrel') return traffic.get('sport')
  return templates.get(shape)
}

export function packCarNames() {
  return [...traffic.keys()]
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

// The commonest strongly coloured hue in a texture, 0 to 1, for a body whose
// paint colour is not known ahead: the pack cars came painted in their own
// colours.
const hues = new Map<Texture, number | undefined>()
function dominantHue(map: Texture): number | undefined {
  if (hues.has(map)) return hues.get(map)
  let found: number | undefined
  try {
    const image = map.image as CanvasImageSource & { width: number; height: number }
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = Math.max(1, Math.round((128 * image.height) / image.width))
    const g = canvas.getContext('2d') as CanvasRenderingContext2D
    g.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = g.getImageData(0, 0, canvas.width, canvas.height).data
    const bins = new Array(36).fill(0)
    let counted = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255
      const gr = data[i + 1] / 255
      const b = data[i + 2] / 255
      const hi = Math.max(r, gr, b)
      const chroma = hi - Math.min(r, gr, b)
      if (hi < 0.08 || chroma / hi < 0.3) continue
      let h = hi === r ? ((gr - b) / chroma + 6) % 6 : hi === gr ? (b - r) / chroma + 2 : (r - gr) / chroma + 4
      h /= 6
      bins[Math.min(35, Math.floor(h * 36))]++
      counted++
    }
    const top = bins.indexOf(Math.max(...bins))
    if (counted > (data.length / 4) * 0.03) found = (top + 0.5) / 36
  } catch {
    // No hue: the material is tinted instead.
  }
  hues.set(map, found)
  return found
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
  siren: { red: MeshBasicMaterial; blue: MeshBasicMaterial } | null
}

const TAIL = new Color('#ff1a2e').multiplyScalar(1.6)

export function makeAssetCar(shape: CarShape, color: string, variant = 0): AssetCar | null {
  const template = templateFor(shape, variant)
  if (!template) return null
  const { half } = template
  // The Kestrel S is a pack car the player paints: its body materials are
  // repainted wherever the texture shows the body's own colour.
  const def: AssetDef = shape === 'kestrel' ? { ...template.def, paint: /^Body/ } : template.def
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
        paint = paintMaterial(material, color, def.paintHue ?? (shape === 'kestrel' && material.map ? dominantHue(material.map) : undefined))
        paint.userData.paint = true
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
    const centreZ = new Box3().setFromObject(o).getCenter(new Vector3()).z
    found.push({ front: def.frontByPosition ? centreZ > 0 : (m[1] ?? '').startsWith('F'), node: o })
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

  // A patrol car: the pack's sedan in dark paint with white doors, a light
  // bar on the roof and a push bar on the nose.
  let siren: AssetCar['siren'] = null
  if (shape.startsWith('police')) {
    const dark = new Map<Material, Material>()
    model.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh || inWheel(mesh) || !/^Body/.test((mesh.material as Material).name)) return
      let m = dark.get(mesh.material as Material)
      if (!m) {
        m = (mesh.material as MeshStandardMaterial).clone()
        ;(m as MeshStandardMaterial).color.set('#2a2d34')
        dark.set(mesh.material as Material, m)
      }
      mesh.material = m
    })
    const box = new Box3().setFromObject(model)
    const roof = box.max.y
    const red = new MeshBasicMaterial({ color: new Color('#ff2030').multiplyScalar(4), toneMapped: false })
    const blue = new MeshBasicMaterial({ color: new Color('#2050ff').multiplyScalar(4), toneMapped: false })
    const black = new MeshStandardMaterial({ color: '#0d0e11', roughness: 0.5, metalness: 0.3 })
    const base = new Mesh(new BoxGeometry(1.2, 0.05, 0.3), black)
    base.position.set(0, roof + 0.03, -0.15)
    car.add(base)
    for (const [mat, x] of [
      [red, -0.32],
      [blue, 0.32],
    ] as const) {
      const block = new Mesh(new BoxGeometry(0.52, 0.09, 0.24), mat)
      block.position.set(x, roof + 0.1, -0.15)
      car.add(block)
    }
    const white = new MeshStandardMaterial({ color: '#e9ebf0', roughness: 0.4 })
    for (const side of [-1, 1]) {
      const door = new Mesh(new PlaneGeometry(1.9, roof * 0.24), white)
      door.position.set(side * (half.width - 0.04), roof * 0.5, -0.1)
      door.rotation.y = (side * Math.PI) / 2
      car.add(door)
    }
    const bar = new Mesh(new BoxGeometry(1.0, 0.28, 0.08), black)
    bar.position.set(0, 0.42, half.front + 0.04)
    car.add(bar)
    siren = { red, blue }
  }

  const materials: Material[] = [tail, ...heads, flameMat, ...paints.values()]
  return { root: car, wheels, frontPivots, tail, heads, flames, exhausts, tailLights, half, materials, hit, siren }
}

// The soft spot under the car, shared by the model cars.
export function contactShadow(spot: Texture, half: { width: number; front: number; rear: number }) {
  const shadow = new Mesh(new PlaneGeometry(half.width * 2.3, half.front - half.rear + 0.7).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: spot, color: '#000', transparent: true, opacity: 0.75, depthWrite: false }))
  shadow.position.set(0, 0.03, (half.front + half.rear) / 2)
  return shadow
}
