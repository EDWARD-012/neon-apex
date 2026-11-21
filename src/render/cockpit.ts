import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HalfFloatType,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
  Path,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  type Scene,
  Shape as Outline,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Shape } from '../sim/cars'
import { cabinTextures, PHOTO_TILE, photoTextures } from './cabinTextures'

// The inside of the player's car for the cockpit camera, built in code
// from layered panels with real seams, stitching, vents, switches and glass,
// and dressed in leather, suede, carbon, brushed metal and soft-touch
// plastic whose grain is drawn in the browser.
//
// From the driver's seat: a flat-bottomed wheel with perforated grips, a
// padded hub, paddles and buttons, held by gloved hands whose forearms
// follow it; two dials in a stitched cowl, each in its own pot under glass
// with a lit needle, and a screen between them with shift lights over it;
// a centre screen with the map; eyeball vents and a long vent on the
// passenger side; climate knobs and toggle switches; door cards; the
// windscreen with a little dust and the sky in it; pillars and the roof
// lining; a rear-view mirror and two door mirrors that show the road
// behind; and the bonnet in the car's paint.
//
// Car space: +x is the car's left, +z the nose, y up from the road. The
// camera starts drawing 0.3 m in front of the eye, so every part meant to
// be seen stays further out than that.

export interface CockpitStyle {
  // -1 puts the driver on the car's right (right-hand drive), +1 on its
  // left.
  side: 1 | -1
  eye: number
  leather: string
  // The dash top: suede, which keeps reflections off the windscreen, or
  // leather.
  pad: string
  top: 'suede' | 'leather'
  stitch: string
  trim: 'carbon' | 'alloy'
  // Dial faces: dark with light figures, or light with dark ones.
  face: 'dark' | 'light'
}

// Every car its own cabin. None is modelled on a real one.
export const COCKPITS: Partial<Record<Shape, CockpitStyle>> = {
  vanta: { side: -1, eye: 1.06, leather: '#16171a', pad: '#1a1b1f', top: 'suede', stitch: '#c8202b', trim: 'carbon', face: 'dark' },
  kite: { side: 1, eye: 1.04, leather: '#1d2027', pad: '#1b1d23', top: 'leather', stitch: '#3b86e8', trim: 'alloy', face: 'light' },
  brute: { side: 1, eye: 1.09, leather: '#4a2f1c', pad: '#2a1d14', top: 'leather', stitch: '#d8b46a', trim: 'alloy', face: 'light' },
  volt: { side: -1, eye: 1.06, leather: '#a9adb5', pad: '#1e2025', top: 'suede', stitch: '#38d8f0', trim: 'alloy', face: 'dark' },
  kestrel: { side: 1, eye: 1.05, leather: '#18191c', pad: '#18191c', top: 'suede', stitch: '#ff7a1a', trim: 'carbon', face: 'dark' },
}
// Police cars and anything else.
const DEFAULT_STYLE: CockpitStyle = { side: 1, eye: 1.07, leather: '#191a1e', pad: '#191a1e', top: 'leather', stitch: '#7f8794', trim: 'alloy', face: 'dark' }

// Where the driver's eye is, for the cockpit camera. Set by setCar.
export interface Eye {
  x: number
  y: number
  z: number
}

// The dashboard's face toward the driver slopes back at this angle; the
// dials, the centre screen and the vents sit on it.
const SLOPE = { z: 0.448, y: 0.775, dz: 0.578, dy: 0.816, length: 0.159 }
const TILT = Math.atan2(SLOPE.dz, SLOPE.dy)
const slope = (s: number, lift = 0) => ({ z: SLOPE.z + SLOPE.dz * s - lift * SLOPE.dy, y: SLOPE.y + SLOPE.dy * s + lift * SLOPE.dz })
// Rev counter up to 8000 with the red line at 6500, speedo up to 320 km/h.
const REV_MAX = 8
const RED_LINE = 6.5 / 8
const SPEED_MAX = 320
const SWEEP = Math.PI * 1.5
// The steering wheel: rim radius, its tube, and the flat at the bottom.
const RIM = 0.168
const TUBE = 0.0175
const FLAT = -0.128
// Shift lights: green, then amber, then red.
const SHIFT_COLOURS = ['#2fe05a', '#2fe05a', '#2fe05a', '#2fe05a', '#ffc21a', '#ffc21a', '#ffc21a', '#ff2a2a', '#ff2a2a', '#ff2a2a']

const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)
const Z = new Vector3(0, 0, 1)

// Puts something built along +y or +z between two points.
function span(mesh: Object3D, a: Vector3, b: Vector3, along: 'y' | 'z') {
  const dir = new Vector3().subVectors(b, a)
  const length = dir.length()
  mesh.position.copy(a).add(b).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(along === 'y' ? Y : Z, dir.multiplyScalar(1 / length))
  return length
}

// A side profile (z across, y up) extruded across the car, centred.
function across(profile: Outline, width: number, bevel: number) {
  const g = new ExtrudeGeometry(profile, { depth: width, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 12 })
  return g.rotateY(-Math.PI / 2).translate(width / 2, 0, 0)
}

// Box projection in metres, so the grain is the same size on every part
// whatever its own texture coordinates.
function projectUVs(g: BufferGeometry) {
  const p = g.attributes.position
  const n = g.attributes.normal
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i))
    const ay = Math.abs(n.getY(i))
    const az = Math.abs(n.getZ(i))
    if (ax >= ay && ax >= az) {
      uv[i * 2] = p.getZ(i)
      uv[i * 2 + 1] = p.getY(i)
    } else if (ay >= az) {
      uv[i * 2] = p.getX(i)
      uv[i * 2 + 1] = p.getZ(i)
    } else {
      uv[i * 2] = p.getX(i)
      uv[i * 2 + 1] = p.getY(i)
    }
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2))
}

const canvasOf = (w: number, h: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return { g: canvas.getContext('2d') as CanvasRenderingContext2D, texture }
}

interface Arm {
  sleeve: Mesh
  cuff: Mesh
  wrist: Vector3
  elbow: Vector3
}

export class Cockpit {
  readonly group = new Group()
  readonly driver: Eye = { x: 0.33, y: 1.07, z: -0.12 }
  private wheel = new Group()
  private mount = new Group()
  private lever = new Group()
  private needles: Mesh[] = []
  private needleAt = [0, 0]
  private shiftLights: InstancedMesh | null = null
  private arms: Arm[] = []
  // Dial faces and their backlit markings, the screen between the dials,
  // and the centre screen.
  private readonly faces = [canvasOf(512, 512), canvasOf(512, 512)]
  private readonly glows = [canvasOf(512, 512), canvasOf(512, 512)]
  private readonly display = canvasOf(256, 256)
  private readonly centre = canvasOf(320, 200)
  private style: CockpitStyle = DEFAULT_STYLE
  private mirrorGlass: Mesh[] = []
  private mirrorView: WebGLRenderTarget | null = null
  private mirrorLook: MeshBasicMaterial | null = null
  private readonly mirrorCam = new PerspectiveCamera(16, 3.2, 0.5, 900)
  private frame = 0
  private last = -Infinity
  private lastNow = 0
  private gearWas = 1
  private shift = 0
  private built = ''
  private wanted = 'vanta|#5c6270'
  private scheduled = false
  private owned: Material[] = []
  private ownedTextures: Texture[] = []
  private readonly tmp = new Vector3()
  private readonly tmp2 = new Vector3()
  private readonly tmpColour = new Color()

  constructor() {
    // Named so the ride height leaves the cabin where the eye is.
    this.group.name = 'cockpit'
    this.group.visible = false
    this.setCar('vanta')
    // The dials are drawn once per car; draw them again once the game's font
    // has arrived.
    document.fonts?.ready.then(() => {
      if (this.built) this.drawFaces()
    })
  }

  // Chooses the cabin for a car: its side, its eye height, its colours and
  // its paint on the bonnet. The eye moves at once; the cabin itself is
  // built when the browser has a moment, or when the cockpit view first
  // needs it.
  setCar(shape: Shape, paint = '#5c6270') {
    const s = COCKPITS[shape] ?? DEFAULT_STYLE
    Object.assign(this.driver, { x: s.side * 0.33, y: s.eye, z: -0.12 })
    this.wanted = `${shape}|${paint}`
    if (this.built === this.wanted || this.scheduled) return
    this.scheduled = true
    const idle = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const run = () => {
      this.scheduled = false
      this.build()
    }
    if (idle) idle(run, { timeout: 3000 })
    else setTimeout(run, 400)
  }

  private build() {
    if (this.built === this.wanted) return
    this.built = this.wanted
    const [shape, paint] = this.wanted.split('|') as [Shape, string]
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose()
    })
    for (const m of this.owned) m.dispose()
    for (const t of this.ownedTextures) t.dispose()
    this.owned = []
    this.ownedTextures = []
    this.group.clear()
    this.needles = []
    this.arms = []
    this.mirrorGlass = []
    this.mirrorLook = null
    this.shiftLights = null
    const s = COCKPITS[shape] ?? DEFAULT_STYLE
    this.style = s
    const dx = s.side * 0.33
    const passenger = -s.side
    this.drawFaces()

    // Materials. Every surface gets a normal map for its grain and a
    // roughness that suits it; inside the car the sky reflects less than
    // outside.
    const tex = cabinTextures()
    const rep = (t: Texture, r: number) => {
      const c = t.clone()
      c.repeat.set(r, r)
      c.needsUpdate = true
      this.ownedTextures.push(c)
      return c
    }
    const mat = <T extends Material>(m: T) => {
      this.owned.push(m)
      return m
    }
    const sheenOf = (c: string) => new Color(c).lerp(new Color('#ffffff'), 0.25)
    const leather = mat(
      new MeshPhysicalMaterial({ color: s.leather, roughness: 1, roughnessMap: rep(tex.leatherRough, 16), normalMap: rep(tex.leatherNormal, 16), sheen: 0.35, sheenRoughness: 0.55, sheenColor: sheenOf(s.leather), envMapIntensity: 0.45 }),
    )
    leather.normalScale.set(0.55, 0.55)
    const pad =
      s.top === 'suede'
        ? mat(new MeshPhysicalMaterial({ color: s.pad, roughness: 1, normalMap: rep(tex.suedeNormal, 12), sheen: 1, sheenRoughness: 0.5, sheenColor: sheenOf(s.pad), envMapIntensity: 0.18 }))
        : mat(new MeshPhysicalMaterial({ color: s.pad, roughness: 1, roughnessMap: rep(tex.leatherRough, 16), normalMap: rep(tex.leatherNormal, 16), sheen: 0.3, sheenRoughness: 0.6, sheenColor: sheenOf(s.pad), envMapIntensity: 0.35 }))
    const suede = mat(new MeshPhysicalMaterial({ color: '#1b1c20', roughness: 1, normalMap: rep(tex.suedeNormal, 12), sheen: 1, sheenRoughness: 0.5, sheenColor: '#4a4d55', envMapIntensity: 0.15 }))
    const perforated = mat(
      new MeshPhysicalMaterial({ color: s.leather, roughness: 1, roughnessMap: rep(tex.perforatedRough, 12), normalMap: rep(tex.perforatedNormal, 12), sheen: 0.3, sheenRoughness: 0.6, sheenColor: sheenOf(s.leather), envMapIntensity: 0.4 }),
    )
    perforated.normalScale.set(0.8, 0.8)
    const carbon = mat(new MeshPhysicalMaterial({ map: rep(tex.carbonColor, 15), normalMap: rep(tex.carbonNormal, 15), roughness: 0.45, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.6 }))
    carbon.normalScale.set(0.3, 0.3)
    const brushed = mat(new MeshPhysicalMaterial({ color: '#b9bec6', metalness: 1, roughness: 1, roughnessMap: rep(tex.brushedRough, 10), normalMap: rep(tex.brushedNormal, 10), anisotropy: 0.6, envMapIntensity: 0.75 }))
    brushed.normalScale.set(0.12, 0.12)
    const soft = mat(new MeshStandardMaterial({ color: '#141518', roughness: 0.82, normalMap: rep(tex.plasticNormal, 20), envMapIntensity: 0.3 }))
    soft.normalScale.set(0.35, 0.35)
    const softInside = mat(new MeshStandardMaterial({ color: '#08090a', roughness: 0.9, side: DoubleSide, envMapIntensity: 0.2 }))
    const piano = mat(new MeshPhysicalMaterial({ color: '#050506', roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.55 }))
    const chrome = mat(new MeshStandardMaterial({ color: '#d4d8de', metalness: 1, roughness: 0.16, envMapIntensity: 0.6 }))
    const rubber = mat(new MeshStandardMaterial({ color: '#0a0a0b', roughness: 0.9 }))
    const stitch = mat(new MeshStandardMaterial({ color: s.stitch, roughness: 0.55, envMapIntensity: 0.3 }))
    const trim = s.trim === 'carbon' ? carbon : brushed
    const glove = mat(new MeshPhysicalMaterial({ color: '#1c1e23', roughness: 1, roughnessMap: rep(tex.leatherRough, 26), normalMap: rep(tex.leatherNormal, 26), sheen: 0.4, sheenRoughness: 0.5, sheenColor: '#4a4e57', envMapIntensity: 0.4 }))
    const glovePanel = mat(new MeshPhysicalMaterial({ color: '#3a3e47', roughness: 1, normalMap: rep(tex.suedeNormal, 20), sheen: 0.6, sheenRoughness: 0.5, sheenColor: '#6a6e78', envMapIntensity: 0.3 }))
    const suit = mat(new MeshPhysicalMaterial({ color: '#1e2128', roughness: 1, normalMap: rep(tex.suedeNormal, 14), sheen: 0.5, sheenRoughness: 0.6, sheenColor: '#4b4f59', envMapIntensity: 0.3 }))
    suit.normalScale.set(0.7, 0.7)
    const body = mat(new MeshPhysicalMaterial({ color: paint, metalness: 0.5, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04 }))
    // Glass: no colour of its own, only what it reflects, added on top.
    const glass = mat(
      new MeshPhysicalMaterial({ color: '#000000', roughness: 0.06, metalness: 0, specularIntensity: 0.35, envMapIntensity: 0.9, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    )
    const dust = mat(new MeshBasicMaterial({ map: tex.dust, color: new Color(0.055, 0.055, 0.055), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }))
    const tint = mat(new MeshBasicMaterial({ color: '#0a1018', transparent: true, opacity: 0.14, depthWrite: false, side: DoubleSide }))
    const band = mat(new MeshBasicMaterial({ map: this.stripTexture(), transparent: true, depthWrite: false, side: DoubleSide }))
    // Casts the car's shadow into the cabin but draws nothing.
    const shade = mat(new MeshBasicMaterial({ colorWrite: false, depthWrite: false }))
    const projected = new Set<Material>([leather, pad, suede, perforated, carbon, brushed, soft, glove, glovePanel, suit])
    // The photographed grain for the leather and the suede, once it has
    // loaded. The box-projected coordinates are in metres, so each map
    // repeats once per tile of the real material it was scanned from.
    const build = this.built
    photoTextures().then((photo) => {
      if (!photo || this.built !== build) return
      const use = (m: MeshPhysicalMaterial, normal: Texture, rough: Texture, tile: number, depth: number) => {
        m.normalMap = rep(normal, 1 / tile)
        m.roughnessMap = rep(rough, 1 / tile)
        m.normalScale.set(depth, depth)
        m.roughness = 1
        m.needsUpdate = true
      }
      const asLeather = (m: MeshPhysicalMaterial, scale = 1, depth = 0.9) => use(m, photo.leatherNormal, photo.leatherRough, PHOTO_TILE.leather * scale, depth)
      const asSuede = (m: MeshPhysicalMaterial, scale = 1, depth = 1) => use(m, photo.suedeNormal, photo.suedeRough, PHOTO_TILE.suede * scale, depth)
      asLeather(leather)
      if (s.top === 'suede') asSuede(pad)
      else asLeather(pad)
      asSuede(suede)
      // Glove leather is finer than the seats'.
      asLeather(glove, 0.6, 0.8)
      asSuede(glovePanel, 0.6)
      asSuede(suit, 0.8, 0.8)
    })

    // Fixed parts are merged by material after the build; stitches are one
    // instanced mesh for the cabin and one for the wheel.
    const fixed: Mesh[] = []
    const stitches: Matrix4[] = []
    const wheelStitches: Matrix4[] = []
    const put = (parent: Object3D, m: Mesh, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      m.position.set(x, y, z)
      m.rotation.set(rx, ry, rz)
      parent.add(m)
      fixed.push(m)
      return m
    }
    const add = (m: Mesh, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => put(this.group, m, x, y, z, rx, ry, rz)
    const rounded = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, 0.45 * Math.min(w, h, d)))
    const q = new Quaternion()
    const one = new Vector3(1, 1, 1)
    // A line of stitches along a path, each 4 mm long with 3 mm between.
    const seam = (list: Matrix4[], path: Vector3[], spacing = 0.007) => {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]
        const b = path[i + 1]
        const dir = new Vector3().subVectors(b, a)
        const len = dir.length()
        dir.normalize()
        q.setFromUnitVectors(X, dir)
        for (let t = spacing / 2; t < len; t += spacing) list.push(new Matrix4().compose(a.clone().addScaledVector(dir, t), q, one))
      }
    }
    const line = (x0: number, x1: number, y: number, z: number) => [new Vector3(x0, y, z), new Vector3(x1, y, z)]
    // A panel lying on the dash's sloped face, s metres up it.
    const onSlope = (x: number, at: number, lift: number) => {
      const pod = new Group()
      const p = slope(at, lift)
      pod.position.set(x, p.y, p.z)
      pod.rotation.set(TILT, Math.PI, 0)
      this.group.add(pod)
      return pod
    }
    // Where a point in a pod ends up in the cabin.
    const fromPod = (pod: Group, x: number, y: number, z: number) => {
      pod.updateMatrix()
      return new Vector3(x, y, z).applyMatrix4(pod.matrix)
    }
    const inward = (p: { z: number; y: number }, d: number) => ({ z: p.z + SLOPE.dy * d, y: p.y - SLOPE.dz * d })

    // The dashboard, in layers with gaps between them: a dark core, the
    // lower dash in soft-touch plastic, a trim band, the sloped face in
    // stitched leather, and the top pad running to the windscreen.
    const W = 1.6
    const core = new Outline()
    core.moveTo(0.46, 0.56)
    core.lineTo(0.46, 0.76)
    core.lineTo(0.4578, 0.7681)
    core.lineTo(0.5497, 0.8978)
    core.lineTo(0.6, 0.925)
    core.lineTo(0.95, 0.94)
    core.lineTo(0.97, 0.92)
    core.lineTo(0.97, 0.56)
    core.closePath()
    add(new Mesh(across(core, W + 0.02, 0), softInside))
    const lower = new Outline()
    lower.moveTo(0.44, 0.56)
    lower.lineTo(0.44, 0.745)
    lower.quadraticCurveTo(0.44, 0.752, 0.448, 0.752)
    lower.lineTo(0.48, 0.752)
    lower.lineTo(0.48, 0.56)
    lower.closePath()
    add(new Mesh(across(lower, W, 0.006), soft))
    const trimBand = new Outline()
    trimBand.moveTo(0.438, 0.758)
    trimBand.lineTo(0.438, 0.778)
    trimBand.lineTo(0.47, 0.778)
    trimBand.lineTo(0.47, 0.758)
    trimBand.closePath()
    add(new Mesh(across(trimBand, W - 0.02, 0.003), trim))
    const face = new Outline()
    const a0 = slope(0.016)
    const a1 = slope(0.132)
    const b1 = inward(a1, 0.03)
    const b0 = inward(a0, 0.03)
    face.moveTo(a0.z, a0.y)
    face.lineTo(a1.z, a1.y)
    face.lineTo(b1.z, b1.y)
    face.lineTo(b0.z, b0.y)
    face.closePath()
    add(new Mesh(across(face, W - 0.04, 0.005), leather))
    const top = new Outline()
    const c0 = slope(0.142)
    const c1 = inward(c0, 0.03)
    top.moveTo(c0.z, c0.y)
    top.quadraticCurveTo(0.556, 0.936, 0.6, 0.94)
    top.quadraticCurveTo(0.8, 0.946, 0.955, 0.956)
    top.lineTo(0.975, 0.945)
    top.lineTo(0.975, 0.905)
    top.lineTo(0.6, 0.9)
    top.lineTo(c1.z, c1.y)
    top.closePath()
    add(new Mesh(across(top, W, 0.006), pad))
    // Stitching: a double row along the top pad's front edge, and one along
    // the bottom of the face.
    seam(stitches, line(-0.76, 0.76, 0.9468, 0.583))
    seam(stitches, line(-0.76, 0.76, 0.9472, 0.593))
    const st = slope(0.022, 0.0052)
    seam(stitches, line(-0.74, 0.74, st.y, st.z))
    // The demister slot along the foot of the windscreen.
    add(new Mesh(new RoundedBoxGeometry(1.3, 0.008, 0.035, 2, 0.003), piano), 0, 0.9585, 0.9)
    for (let i = 0; i < 40; i++) add(new Mesh(new BoxGeometry(0.004, 0.009, 0.03), soft), -0.63 + i * 0.0323, 0.9595, 0.9)

    // The dials, in a stitched cowl on the sloped face behind the wheel: rev
    // counter and speedo, each in its own pot with a chrome ring and glass,
    // a lit needle on a domed cap, a screen between them for the gear, and
    // shift lights across the top.
    // The pod stands 22 mm proud of the leather; the cowl runs back into it.
    const cluster = onSlope(dx, 0.072, 0.027)
    put(cluster, new Mesh(rounded(0.4, 0.15, 0.02, 0.012), piano), 0, 0, -0.012)
    const arch = new Outline()
    arch.absellipse(0, -0.07, 0.212, 0.157, 0, Math.PI, false, 0)
    arch.lineTo(-0.196, -0.07)
    const hole = new Path()
    hole.absellipse(0, -0.07, 0.196, 0.143, Math.PI, 0, true, 0)
    for (const p of hole.getPoints(40)) arch.lineTo(p.x, p.y)
    arch.lineTo(0.212, -0.07)
    const cowl = new ExtrudeGeometry(arch, { depth: 0.077, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 40 })
    put(cluster, new Mesh(cowl, leather), 0, 0, -0.032)
    const lip: Vector3[] = []
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI
      lip.push(fromPod(cluster, Math.cos(a) * 0.204, -0.07 + Math.sin(a) * 0.15, 0.05))
    }
    seam(stitches, lip, 0.0065)
    const needleShape = new Outline()
    needleShape.moveTo(-0.0026, 0)
    needleShape.lineTo(-0.0007, 0.05)
    needleShape.lineTo(0.0007, 0.05)
    needleShape.lineTo(0.0026, 0)
    needleShape.lineTo(0.0022, -0.012)
    needleShape.lineTo(-0.0022, -0.012)
    needleShape.closePath()
    const needleMat = mat(new MeshBasicMaterial({ color: s.face === 'light' ? '#ff3b1f' : '#ff5a24', toneMapped: false }))
    for (const [i, x] of [-0.1, 0.1].entries()) {
      const faceMat = mat(
        new MeshStandardMaterial({ map: this.faces[i].texture, emissive: '#ffffff', emissiveMap: this.glows[i].texture, emissiveIntensity: s.face === 'light' ? 0.25 : 0.9, roughness: 0.55, envMapIntensity: 0.3 }),
      )
      put(cluster, new Mesh(new CircleGeometry(0.058, 64), faceMat), x, -0.006, -0.0015)
      put(cluster, new Mesh(new CylinderGeometry(0.0605, 0.0605, 0.014, 64, 1, true).rotateX(Math.PI / 2), softInside), x, -0.006, 0.005)
      put(cluster, new Mesh(new TorusGeometry(0.0612, 0.0026, 12, 72), chrome), x, -0.006, 0.0118)
      put(cluster, new Mesh(new CircleGeometry(0.0605, 48), glass), x, -0.006, 0.011)
      const needle = new Mesh(new ExtrudeGeometry(needleShape, { depth: 0.0009, bevelEnabled: false }), needleMat)
      needle.position.set(x, -0.006, 0.0005)
      cluster.add(needle)
      this.needles.push(needle)
      put(cluster, new Mesh(new SphereGeometry(0.0062, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), piano), x, -0.006, 0.0016)
    }
    put(cluster, new Mesh(rounded(0.084, 0.08, 0.008, 0.006), piano), 0, -0.004, -0.002)
    put(cluster, new Mesh(new PlaneGeometry(0.074, 0.072), mat(new MeshBasicMaterial({ map: this.display.texture, toneMapped: false }))), 0, -0.004, 0.0022)
    put(cluster, new Mesh(new PlaneGeometry(0.076, 0.074), glass), 0, -0.004, 0.003)
    const led = new InstancedMesh(rounded(0.0062, 0.0036, 0.003, 0.0012), mat(new MeshBasicMaterial({ toneMapped: false })), SHIFT_COLOURS.length)
    for (let i = 0; i < SHIFT_COLOURS.length; i++) {
      led.setMatrixAt(i, new Matrix4().makeTranslation(-0.0338 + i * 0.0075, 0.047, 0.0005))
      led.setColorAt(i, this.tmpColour.set(SHIFT_COLOURS[i]).multiplyScalar(0.08))
    }
    cluster.add(led)
    this.shiftLights = led

    // The centre screen with the map, in a gloss-black bezel under glass.
    const screen = onSlope(0, 0.074, 0.005)
    put(screen, new Mesh(rounded(0.22, 0.138, 0.014, 0.008), piano), 0, 0, -0.005)
    put(screen, new Mesh(new PlaneGeometry(0.2, 0.124), mat(new MeshBasicMaterial({ map: this.centre.texture, toneMapped: false }))), 0, 0, 0.0025)
    put(screen, new Mesh(new PlaneGeometry(0.212, 0.132), glass), 0, 0, 0.0028)

    // Eyeball vents at both ends: a chrome bezel, the dark ball, five vanes
    // and the knob that aims them.
    for (const x of [-0.655, 0.655]) {
      const vent = onSlope(x, 0.072, 0.005)
      put(vent, new Mesh(new TorusGeometry(0.044, 0.0055, 12, 48), brushed), 0, 0, 0.004)
      put(vent, new Mesh(new CircleGeometry(0.0415, 40), softInside), 0, 0, 0.0008)
      for (let i = 0; i < 5; i++) put(vent, new Mesh(rounded(0.074 - Math.abs(i - 2) * 0.012, 0.0035, 0.008, 0.0012), brushed), 0, -0.028 + i * 0.014, 0.004, 0.35)
      put(vent, new Mesh(new CylinderGeometry(0.0075, 0.0075, 0.012, 20).rotateX(Math.PI / 2), brushed), 0, 0, 0.004)
    }
    // A long vent across the passenger side, with slats and vanes.
    const strip = onSlope(passenger * 0.38, 0.07, 0.005)
    put(strip, new Mesh(rounded(0.36, 0.04, 0.01, 0.006), piano), 0, 0, -0.002)
    put(strip, new Mesh(new PlaneGeometry(0.34, 0.03), softInside), 0, 0, 0.0035)
    for (let i = 0; i < 3; i++) put(strip, new Mesh(rounded(0.34, 0.0025, 0.012, 0.001), brushed), 0, -0.009 + i * 0.009, 0.004, 0.3)
    for (let i = 0; i < 7; i++) put(strip, new Mesh(new BoxGeometry(0.002, 0.03, 0.01), softInside), -0.15 + i * 0.05, 0, 0.002)

    // Climate panel on the lower dash under the screen: brushed plate, two
    // knurled knobs, a row of toggle switches and the start button.
    add(new Mesh(rounded(0.26, 0.07, 0.008, 0.006), brushed), 0, 0.7, 0.4335)
    const knurl = new CylinderGeometry(0.017, 0.017, 0.016, 48).rotateX(Math.PI / 2)
    const kp = knurl.attributes.position
    for (let i = 0; i < kp.count; i++) {
      const r = Math.hypot(kp.getX(i), kp.getY(i))
      if (r > 0.016) {
        const a = Math.atan2(kp.getY(i), kp.getX(i))
        const k = 1 + 0.06 * Math.sign(Math.sin(a * 24))
        kp.setXY(i, kp.getX(i) * k, kp.getY(i) * k)
      }
    }
    knurl.computeVertexNormals()
    for (const x of [-0.09, 0.09]) {
      add(new Mesh(knurl.clone(), brushed), x, 0.7, 0.4255)
      add(new Mesh(new CircleGeometry(0.013, 32), piano), x, 0.7, 0.4174, 0, Math.PI)
    }
    knurl.dispose()
    for (let i = 0; i < 4; i++) {
      const x = -0.045 + i * 0.03
      add(new Mesh(rounded(0.018, 0.022, 0.006, 0.003), piano), x, 0.708, 0.428)
      add(new Mesh(new CylinderGeometry(0.0025, 0.003, 0.016, 10), chrome), x, 0.714, 0.42, -0.9)
    }
    add(new Mesh(new CylinderGeometry(0.011, 0.011, 0.006, 32).rotateX(Math.PI / 2), piano), 0.015, 0.68, 0.428)
    add(new Mesh(new TorusGeometry(0.011, 0.0018, 8, 32), stitch), 0.015, 0.68, 0.4245)

    // Centre console between the seats, and the gear lever on it.
    add(new Mesh(rounded(0.26, 0.3, 0.8, 0.03), trim), 0, 0.5, 0.02)
    this.lever = new Group()
    this.lever.position.set(s.side * 0.03, 0.66, -0.02)
    const shaft = new Mesh(new CylinderGeometry(0.012, 0.016, 0.16, 10), brushed)
    shaft.position.y = 0.08
    const knob = new Mesh(new SphereGeometry(0.03, 14, 10), leather)
    knob.position.y = 0.17
    this.lever.add(shaft, knob, new Mesh(new CylinderGeometry(0.05, 0.06, 0.04, 14), leather))
    this.group.add(this.lever)

    // Door cards: the panel, the stitched sill under the window, an
    // armrest, a pull handle, a speaker, and the dark corner where the
    // door mirror mounts; tinted glass with the sky in it.
    for (const k of [-1, 1]) {
      add(new Mesh(rounded(0.05, 0.52, 1.25, 0.02), leather), k * 0.8, 0.69, 0.05)
      add(new Mesh(rounded(0.08, 0.035, 1.22, 0.014), pad), k * 0.785, 0.95, 0.05)
      seam(stitches, [new Vector3(k * 0.745, 0.95, -0.4), new Vector3(k * 0.745, 0.95, 0.62)])
      add(new Mesh(rounded(0.1, 0.05, 0.45, 0.02), leather), k * 0.75, 0.78, 0.0)
      add(new Mesh(rounded(0.022, 0.03, 0.14, 0.01), brushed), k * 0.765, 0.86, 0.12)
      add(new Mesh(new CircleGeometry(0.05, 32), softInside), k * 0.773, 0.6, 0.38, 0, -k * Math.PI / 2)
      add(new Mesh(new TorusGeometry(0.052, 0.004, 8, 40), piano), k * 0.772, 0.6, 0.38, 0, -k * Math.PI / 2)
      const sail = new Outline()
      sail.moveTo(0.6, 0.955)
      sail.lineTo(0.95, 0.955)
      sail.lineTo(0.84, 1.08)
      sail.closePath()
      const sailGeo = new ExtrudeGeometry(sail, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 })
      sailGeo.rotateY(-Math.PI / 2).translate(k * 0.8 + 0.006, 0, 0)
      add(new Mesh(sailGeo, soft))
      add(new Mesh(new PlaneGeometry(1.2, 0.29), tint), k * 0.81, 1.11, 0.0, 0, k * Math.PI / 2)
      add(new Mesh(new PlaneGeometry(1.2, 0.29), glass), k * 0.812, 1.11, 0.0, 0, k * Math.PI / 2)
    }

    // Windscreen pillars wrapped in suede, with a tweeter at the foot of
    // each; the roof's front rail and the lining rising steeply behind it
    // (laid flat over the head it would sit nearer the eye than the camera
    // draws); sun visors folded up.
    for (const k of [-1, 1]) {
      const a = new Vector3(k * 0.82, 0.92, 0.96)
      const b = new Vector3(k * 0.665, 1.31, 0.38)
      const pillar = new Mesh(rounded(0.09, 0.058, a.distanceTo(b), 0.024), suede)
      span(pillar, a, b, 'z')
      this.group.add(pillar)
      fixed.push(pillar)
      add(new Mesh(new CircleGeometry(0.02, 24), softInside), k * 0.77, 0.985, 0.86, -0.9, Math.PI)
      add(new Mesh(new TorusGeometry(0.021, 0.0028, 8, 32), piano), k * 0.77, 0.985, 0.86, -0.9, Math.PI)
    }
    add(new Mesh(rounded(1.42, 0.045, 0.1, 0.02), suede), 0, 1.32, 0.36)
    const roofFront = new Vector3(0, 1.345, 0.33)
    const roofBack = new Vector3(0, 1.72, 0.21)
    const roofDir = new Vector3().subVectors(roofBack, roofFront).normalize()
    const roof = new Mesh(rounded(1.66, 0.02, roofFront.distanceTo(roofBack), 0.008), suede)
    span(roof, roofFront, roofBack, 'z')
    this.group.add(roof)
    fixed.push(roof)
    const toEye = new Vector3(0, -roofDir.z, roofDir.y).multiplyScalar(-0.014)
    for (const k of [-1, 1]) {
      const a = roofFront.clone().addScaledVector(roofDir, 0.02).add(toEye).setX(k * 0.36)
      const b = roofFront.clone().addScaledVector(roofDir, 0.2).add(toEye).setX(k * 0.36)
      const visor = new Mesh(rounded(0.36, 0.018, a.distanceTo(b), 0.008), suede)
      span(visor, a, b, 'z')
      this.group.add(visor)
      fixed.push(visor)
    }

    // The windscreen: a curved pane with the sky in it and a little dust,
    // and a tinted strip along its top.
    const screenGeo = new PlaneGeometry(1, 1, 16, 8)
    const sp = screenGeo.attributes.position
    for (let i = 0; i < sp.count; i++) {
      const a = sp.getX(i)
      const t = sp.getY(i) + 0.5
      const half = 0.8 + (0.665 - 0.8) * t
      const x = a * 2 * half
      sp.setXYZ(i, x, 0.965 + 0.34 * t, 0.985 - 0.595 * t + 0.035 * (1 - (x / 0.82) ** 2))
    }
    screenGeo.computeVertexNormals()
    add(new Mesh(screenGeo, glass))
    add(new Mesh(screenGeo.clone(), dust))
    add(new Mesh(new PlaneGeometry(1.5, 0.22), band), 0, 1.254, 0.47, -1.036, Math.PI)

    // Rear-view mirror on a stem from the roof rail, turned toward the
    // driver, with the rain sensor's housing behind it.
    add(new Mesh(new CylinderGeometry(0.008, 0.008, 0.06, 10), piano), 0, 1.285, 0.395)
    add(new Mesh(rounded(0.1, 0.05, 0.05, 0.015), piano), 0, 1.292, 0.43)
    const mirror = new Group()
    mirror.position.set(0, 1.245, 0.4)
    mirror.rotation.set(0, Math.PI - s.side * 0.29, 0)
    this.group.add(mirror)
    put(mirror, new Mesh(rounded(0.26, 0.075, 0.03, 0.02), piano))
    const rear = new Mesh(new PlaneGeometry(0.248, 0.062), mat(new MeshStandardMaterial({ color: '#0c0f14', roughness: 0.05, metalness: 1 })))
    rear.position.z = 0.0155
    mirror.add(rear)
    this.mirrorGlass.push(rear)
    // Door mirrors, in the car's paint, on arms from the door; their glass
    // shows the same view behind, each its own side of it.
    for (const k of [-1, 1]) {
      const housing = new Group()
      housing.position.set(k * 1.0, 1.0, 0.8)
      housing.rotation.set(0, Math.PI + k * 0.12, 0)
      this.group.add(housing)
      put(housing, new Mesh(rounded(0.17, 0.09, 0.075, 0.032), body), 0, 0, -0.02)
      const g = new PlaneGeometry(0.15, 0.072)
      const uv = g.attributes.uv
      for (let i = 0; i < uv.count; i++) uv.setX(i, (k > 0 ? 0 : 0.5) + uv.getX(i) * 0.5)
      const side = new Mesh(g, rear.material)
      side.position.z = 0.0185
      housing.add(side)
      this.mirrorGlass.push(side)
      add(new Mesh(rounded(0.1, 0.03, 0.05, 0.012), soft), k * 0.88, 0.985, 0.8)
    }

    // Through the windscreen: the bonnet, crowned in the middle, with the
    // tops of the front wings rising at its sides, the black panel at the
    // foot of the glass, and the wipers parked on it.
    const bonnet = new PlaneGeometry(1.84, 1.25, 28, 14).rotateX(-Math.PI / 2).translate(0, 0, 1.58)
    const bp = bonnet.attributes.position
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i)
      const z = bp.getZ(i)
      const wing = Math.exp(-(((Math.abs(x) - 0.74) / 0.13) ** 2)) * Math.min(1, Math.max(0, (z - 0.95) / 0.25)) * Math.min(1, Math.max(0, (2.2 - z) / 0.5))
      bp.setY(i, 0.94 - (z - 0.955) * 0.075 + 0.02 * (1 - (x / 0.92) ** 2) + 0.085 * wing)
    }
    bonnet.computeVertexNormals()
    add(new Mesh(bonnet, body))
    add(new Mesh(rounded(1.58, 0.012, 0.1, 0.005), soft), 0, 0.962, 1.03)
    for (const x of [0.3, -0.26]) {
      add(new Mesh(rounded(0.5, 0.009, 0.014, 0.003), rubber), x, 0.972, 1.0, 0, 0, 0.04)
      add(new Mesh(rounded(0.014, 0.008, 0.1, 0.003), rubber), x - 0.22, 0.968, 1.04)
    }

    // The car's body, drawn by nothing but casting its shadow, so sunlight
    // comes in only through the glass.
    for (const [w, h, d, x, y, z] of [
      [1.6, 0.04, 1.5, 0, 1.38, -0.38],
      [0.04, 0.6, 2.4, 0.88, 0.66, -0.15],
      [0.04, 0.6, 2.4, -0.88, 0.66, -0.15],
      [0.08, 0.42, 0.14, 0.84, 1.16, -0.6],
      [0.08, 0.42, 0.14, -0.84, 1.16, -0.6],
      [1.6, 0.85, 0.05, 0, 0.8, -1.3],
    ]) {
      add(new Mesh(new BoxGeometry(w, h, d), shade), x, y, z).castShadow = true
    }

    // The steering wheel: a flat-bottomed rim, thicker at the grips, in
    // perforated leather there, suede or carbon at the top with a marker
    // in the stitch colour, and smooth leather at the bottom; three spokes,
    // a padded hub with a badge, buttons, a mode knob and paddles behind.
    this.wheel = new Group()
    const rimAt = (t: number) => new Vector3(RIM * Math.cos(t), Math.max(FLAT, RIM * Math.sin(t)), 0)
    const near = (t: number, c: number) => Math.atan2(Math.sin(t - c), Math.cos(t - c))
    const grip = (t: number) => 1 + 0.2 * (Math.exp(-((near(t, 0) / 0.42) ** 2)) + Math.exp(-((near(t, Math.PI) / 0.42) ** 2)))
    const rimPiece = (t0: number, t1: number, m: Material, scale = 1) => {
      const pts = Array.from({ length: 25 }, (_, i) => rimAt(t0 + ((t1 - t0) * i) / 24))
      const curve = new CatmullRomCurve3(pts)
      const segs = 40
      const radial = 16
      const tube = new TubeGeometry(curve, segs, TUBE, radial, false)
      const tp = tube.attributes.position
      for (let i = 0; i <= segs; i++) {
        const c = curve.getPointAt(i / segs)
        const f = grip(t0 + ((t1 - t0) * i) / segs) * scale
        for (let j = 0; j <= radial; j++) {
          const k = i * (radial + 1) + j
          tp.setXYZ(k, c.x + (tp.getX(k) - c.x) * f, c.y + (tp.getY(k) - c.y) * f, c.z + (tp.getZ(k) - c.z) * f)
        }
      }
      tube.computeVertexNormals()
      put(this.wheel, new Mesh(tube, m))
    }
    rimPiece(-0.8, 0.95, perforated)
    rimPiece(0.93, Math.PI - 0.93, s.trim === 'carbon' ? carbon : suede)
    rimPiece(Math.PI - 0.95, Math.PI + 0.8, perforated)
    rimPiece(Math.PI + 0.78, Math.PI * 2 - 0.78, leather)
    rimPiece(Math.PI / 2 - 0.05, Math.PI / 2 + 0.05, stitch, 1.04)
    // Stitches along the inside of the rim, facing the driver.
    const rimSeam: Vector3[] = []
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * Math.PI * 2
      const c = rimAt(t)
      const toward = c.clone().setZ(0).normalize().multiplyScalar(-0.55).add(new Vector3(0, 0, 0.84)).normalize()
      rimSeam.push(c.clone().addScaledVector(toward, TUBE * grip(t) * 1.02))
    }
    seam(wheelStitches, rimSeam, 0.0068)
    // Hub: a padded cushion with the badge, a shield with a chevron cut
    // through it.
    const cushion = new Outline()
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * Math.PI * 2
      const c = Math.cos(t)
      const sn = Math.sin(t)
      const px = 0.054 * Math.sign(c) * Math.abs(c) ** 0.55
      const py = 0.042 * Math.sign(sn) * Math.abs(sn) ** 0.55 - 0.004 + (sn < 0 ? 0.004 * Math.abs(c) : 0)
      if (i === 0) cushion.moveTo(px, py)
      else cushion.lineTo(px, py)
    }
    put(this.wheel, new Mesh(new ExtrudeGeometry(cushion, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 6, curveSegments: 4 }), leather), 0, 0, -0.026)
    put(this.wheel, new Mesh(new CylinderGeometry(0.062, 0.066, 0.03, 40).rotateX(Math.PI / 2), piano), 0, 0, -0.035)
    const shield = new Outline()
    shield.moveTo(-0.011, 0.012)
    shield.lineTo(0.011, 0.012)
    shield.lineTo(0.011, -0.002)
    shield.quadraticCurveTo(0.009, -0.01, 0, -0.014)
    shield.quadraticCurveTo(-0.009, -0.01, -0.011, -0.002)
    shield.closePath()
    const chevron = new Path()
    chevron.moveTo(-0.006, 0.006)
    chevron.lineTo(0, 0.0)
    chevron.lineTo(0.006, 0.006)
    chevron.lineTo(0.006, 0.002)
    chevron.lineTo(0, -0.004)
    chevron.lineTo(-0.006, 0.002)
    chevron.closePath()
    shield.holes.push(chevron)
    put(this.wheel, new Mesh(new ExtrudeGeometry(shield, { depth: 0.0015, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0006, bevelSegments: 2 }), chrome), 0, 0.004, 0.0185)
    // Side spokes, tapering out to the rim, with a brushed strip under
    // each, a pad of buttons and a coloured one; a paddle behind each.
    for (const k of [-1, 1]) {
      const spoke = new Outline()
      spoke.moveTo(0.045, 0.024)
      spoke.lineTo(RIM - 0.008, 0.011)
      spoke.lineTo(RIM - 0.008, -0.015)
      spoke.lineTo(0.045, -0.032)
      spoke.closePath()
      const sg = new ExtrudeGeometry(spoke, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 })
      if (k < 0) sg.scale(-1, 1, 1)
      put(this.wheel, new Mesh(sg, piano), 0, 0, -0.016)
      put(this.wheel, new Mesh(rounded(0.1, 0.004, 0.004, 0.0015), trim), k * 0.103, -0.026, 0, 0, 0, k * 0.12)
      for (const [bx, by] of [
        [0.072, 0.008],
        [0.094, 0.007],
        [0.083, -0.009],
      ]) {
        put(this.wheel, new Mesh(rounded(0.014, 0.011, 0.004, 0.002), soft), k * bx, by, 0)
      }
      put(this.wheel, new Mesh(new CylinderGeometry(0.0055, 0.0055, 0.004, 16).rotateX(Math.PI / 2), stitch), k * 0.114, -0.004, 0)
      const paddle = new Outline()
      paddle.moveTo(0, -0.012)
      paddle.lineTo(0.07, -0.004)
      paddle.quadraticCurveTo(0.082, 0.004, 0.07, 0.014)
      paddle.lineTo(0, 0.016)
      paddle.closePath()
      const pg = new ExtrudeGeometry(paddle, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2 })
      if (k < 0) pg.scale(-1, 1, 1)
      put(this.wheel, new Mesh(pg, brushed), k * 0.1, 0.0, -0.045)
    }
    const lowerSpoke = new Outline()
    lowerSpoke.moveTo(-0.026, -0.036)
    lowerSpoke.lineTo(0.026, -0.036)
    lowerSpoke.lineTo(0.016, FLAT + 0.008)
    lowerSpoke.lineTo(-0.016, FLAT + 0.008)
    lowerSpoke.closePath()
    put(this.wheel, new Mesh(new ExtrudeGeometry(lowerSpoke, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 }), trim), 0, 0, -0.014)
    put(this.wheel, new Mesh(new CylinderGeometry(0.011, 0.011, 0.008, 32).rotateX(Math.PI / 2), brushed), 0, -0.072, 0)
    put(this.wheel, new Mesh(new TorusGeometry(0.0112, 0.0014, 6, 32), stitch), 0, -0.072, 0.0042)

    // The driver's gloved hands at quarter to three: four fingers of three
    // joints wrapped round the grip, the back of the hand with a padded
    // panel, and the thumb along the inside of the rim. They turn with the
    // wheel; the forearms follow.
    const rg = TUBE * 1.2
    for (const k of [-1, 1]) {
      const P = new Vector3(k * RIM, 0, 0)
      const u = (deg: number) => {
        const a = (deg * Math.PI) / 180
        return new Vector3(k * Math.cos(a), 0, -Math.sin(a))
      }
      const around = (deg: number, r: number, y: number) => P.clone().addScaledVector(u(deg), r).setY(y)
      const fingers = [
        { y: 0.025, r: 0.0086, joints: [6, 70, 126, 176] },
        { y: 0.0085, r: 0.009, joints: [6, 70, 128, 180] },
        { y: -0.0085, r: 0.0086, joints: [6, 70, 126, 176] },
        { y: -0.0245, r: 0.0076, joints: [6, 68, 120, 162] },
      ]
      for (const f of fingers) {
        const radius = rg + f.r + 0.0008
        for (let j = 0; j < 3; j++) {
          const a = around(f.joints[j], radius, f.y)
          const b = around(f.joints[j + 1], radius, f.y)
          const seg = new Mesh(new CapsuleGeometry(f.r * (1 - j * 0.06), a.distanceTo(b), 4, 10), glove)
          span(seg, a, b, 'y')
          this.wheel.add(seg)
          fixed.push(seg)
        }
      }
      // The back of the hand, from the knuckles toward the wrist.
      const knuckles = around(2, rg + 0.012, 0)
      const wrist = P.clone().add(new Vector3(k * 0.045, -0.03, 0.068))
      const along = new Vector3().subVectors(wrist, knuckles)
      const length = along.length()
      along.normalize()
      const out = new Vector3().crossVectors(along, Y).multiplyScalar(-k).normalize()
      const up = new Vector3().crossVectors(out, along).normalize()
      const basis = new Matrix4().makeBasis(along, up, out)
      const back = new Mesh(new SphereGeometry(1, 24, 16), glove)
      back.position.copy(knuckles).add(wrist).multiplyScalar(0.5).addScaledVector(out, -0.004)
      back.quaternion.setFromRotationMatrix(basis)
      back.scale.set(length * 0.56, 0.043, 0.019)
      this.wheel.add(back)
      fixed.push(back)
      const panel = new Mesh(rounded(length * 0.55, 0.05, 0.008, 0.004), glovePanel)
      panel.position.copy(back.position).addScaledVector(out, 0.014).addScaledVector(along, -length * 0.08)
      panel.quaternion.copy(back.quaternion)
      this.wheel.add(panel)
      fixed.push(panel)
      // The thumb, along the driver's side of the rim toward the spoke.
      const t0 = around(-60, rg + 0.012, -0.016)
      const t1 = around(-115, rg + 0.0098, -0.002)
      const t2 = around(-158, rg + 0.009, 0.01)
      for (const [a, b, r] of [
        [t0, t1, 0.0098],
        [t1, t2, 0.0088],
      ] as [Vector3, Vector3, number][]) {
        const seg = new Mesh(new CapsuleGeometry(r, a.distanceTo(b), 4, 10), glove)
        span(seg, a, b, 'y')
        this.wheel.add(seg)
        fixed.push(seg)
      }
      const sleeve = new Mesh(new CylinderGeometry(0.04, 0.048, 1, 16), suit)
      const cuff = new Mesh(new CylinderGeometry(0.033, 0.036, 1, 16), glove)
      sleeve.receiveShadow = true
      cuff.receiveShadow = true
      this.group.add(sleeve, cuff)
      this.arms.push({ sleeve, cuff, wrist, elbow: new Vector3(dx - k * 0.27, 0.56, 0.04) })
    }
    if (wheelStitches.length) {
      const ws = new InstancedMesh(new BoxGeometry(0.0042, 0.0011, 0.0011), stitch, wheelStitches.length)
      wheelStitches.forEach((m, i) => ws.setMatrixAt(i, m))
      this.wheel.add(ws)
    }
    // The rim leans back at the top, its face toward the driver's chest.
    this.mount = new Group()
    this.mount.position.set(dx, 0.79, 0.35)
    this.mount.rotation.set(0.35, Math.PI, 0)
    this.mount.add(this.wheel)
    const shroud = new Mesh(rounded(0.075, 0.07, 0.2, 0.025), soft)
    shroud.position.set(0, -0.012, -0.14)
    this.mount.add(shroud)
    this.group.add(this.mount)

    if (stitches.length) {
      const all = new InstancedMesh(new BoxGeometry(0.0042, 0.0012, 0.0012), stitch, stitches.length)
      stitches.forEach((m, i) => all.setMatrixAt(i, m))
      this.group.add(all)
    }

    // Shadows: the roof, the pillars and the visors shade the dash, and
    // every solid surface takes shadow.
    for (const m of fixed) {
      if (m.material === suede) m.castShadow = true
      const material = m.material as Material
      m.receiveShadow = !material.transparent && material !== shade && !(material instanceof MeshBasicMaterial)
    }
    this.merge(fixed, this.group, projected)
    const held: Mesh[] = []
    this.wheel.traverse((o) => {
      if (o instanceof Mesh && !(o instanceof InstancedMesh)) held.push(o)
    })
    this.merge(held, this.wheel, projected)
    if (this.mirrorView) this.useMirror()
    this.last = -Infinity
    this.update(0, 0, 0, 1, 0, 0, 0)
  }

  // Merges parts that share a material and shadow settings into one mesh
  // each, under root, giving the textured ones box-projected coordinates.
  private merge(parts: Mesh[], root: Object3D, projected: Set<Material>) {
    this.group.updateMatrixWorld(true)
    const toRoot = new Matrix4().copy(root.matrixWorld).invert()
    const sets = new Map<string, Mesh[]>()
    const ids = new Map<Material, number>()
    for (const m of parts) {
      const material = m.material as Material
      if (!ids.has(material)) ids.set(material, ids.size)
      const key = `${ids.get(material)}|${m.castShadow}|${m.receiveShadow}`
      const list = sets.get(key) ?? []
      list.push(m)
      sets.set(key, list)
    }
    for (const list of sets.values()) {
      const material = list[0].material as Material
      const geometries: BufferGeometry[] = list.map((m) => {
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
        g.clearGroups()
        g.applyMatrix4(new Matrix4().multiplyMatrices(toRoot, m.matrixWorld))
        if (projected.has(material)) projectUVs(g)
        return g
      })
      const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries)
      if (geometries.length > 1) for (const g of geometries) g.dispose()
      if (!merged) continue
      const whole = new Mesh(merged, material)
      whole.castShadow = list[0].castShadow
      whole.receiveShadow = list[0].receiveShadow
      for (const m of list) {
        m.removeFromParent()
        m.geometry.dispose()
      }
      root.add(whole)
    }
  }

  private stripTexture() {
    const { g, texture } = canvasOf(4, 64)
    const grad = g.createLinearGradient(0, 0, 0, 64)
    grad.addColorStop(0, 'rgba(6,14,24,0.8)')
    grad.addColorStop(1, 'rgba(6,14,24,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 4, 64)
    this.ownedTextures.push(texture)
    return texture
  }

  // Points the mirrors' glass at the view drawn behind.
  private useMirror() {
    const texture = (this.mirrorView as WebGLRenderTarget).texture
    // A mirror shows the world turned left to right.
    texture.repeat.set(-1, 1)
    texture.offset.set(1, 0)
    if (!this.mirrorLook) {
      this.mirrorLook = new MeshBasicMaterial({ map: texture })
      this.owned.push(this.mirrorLook)
    }
    for (const g of this.mirrorGlass) g.material = this.mirrorLook
  }

  // Draws the road behind into the mirrors, every other frame. The cabin is
  // hidden while it draws, so the view goes out through the back of the
  // car.
  renderMirror(renderer: WebGLRenderer, scene: Scene) {
    if (!this.mirrorGlass.length || !this.group.visible || this.frame++ % 2 === 1) return
    if (!this.mirrorView) {
      this.mirrorView = new WebGLRenderTarget(512, 160, { type: HalfFloatType })
      this.useMirror()
    }
    this.mirrorGlass[0].getWorldPosition(this.mirrorCam.position)
    this.mirrorCam.lookAt(this.group.localToWorld(this.tmp.set(0, 0.9, -40)))
    const target = renderer.getRenderTarget()
    const shadows = renderer.shadowMap.autoUpdate
    renderer.shadowMap.autoUpdate = false
    this.group.visible = false
    renderer.setRenderTarget(this.mirrorView)
    renderer.render(scene, this.mirrorCam)
    renderer.setRenderTarget(target)
    this.group.visible = true
    renderer.shadowMap.autoUpdate = shadows
  }

  // The steering wheel turns six times the front wheels' angle, up to a
  // little over a third of a turn. The needles follow the revs and the
  // speed with a little lag, as real ones do; the shift lights fill as the
  // revs rise and flash at the limiter. The gear lever gives a nudge on
  // each shift. The gear screen and the centre screen are drawn about
  // twenty times a second.
  update(steer: number, kmh: number, rpm: number, gear: number, nitro: number, damage: number, now: number, aspect = 16 / 9, map?: HTMLCanvasElement) {
    if (this.built !== this.wanted) this.build()
    const dt = Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000))
    this.lastNow = now
    this.wheel.rotation.z = Math.max(-2.4, Math.min(2.4, -steer * 6))
    // A wide phone screen in landscape gets a slightly smaller rim.
    this.mount.scale.setScalar(aspect > 1.9 ? 0.92 : 1)
    if (gear !== this.gearWas) {
      this.shift = 1
      this.gearWas = gear
    }
    this.shift = Math.max(0, this.shift - 0.08)
    this.lever.rotation.x = -this.shift * 0.35
    const clamp = (v: number) => Math.max(0, Math.min(1, v))
    const follow = dt === 0 ? 1 : 1 - Math.exp(-dt * 14)
    this.needleAt[0] += (clamp(rpm) - this.needleAt[0]) * follow
    this.needleAt[1] += (clamp(kmh / SPEED_MAX) - this.needleAt[1]) * follow
    if (this.needles.length === 2) {
      this.needles[0].rotation.z = 0.75 * Math.PI - this.needleAt[0] * SWEEP
      this.needles[1].rotation.z = 0.75 * Math.PI - this.needleAt[1] * SWEEP
    }
    if (this.shiftLights) {
      const lit = Math.round(clamp((rpm - 0.55) / (RED_LINE + 0.1 - 0.55)) * SHIFT_COLOURS.length)
      const flash = rpm > RED_LINE + 0.1 && Math.floor(now / 80) % 2 === 0
      for (let i = 0; i < SHIFT_COLOURS.length; i++) {
        const on = !flash && i < lit
        this.shiftLights.setColorAt(i, this.tmpColour.set(flash ? '#3d6bff' : SHIFT_COLOURS[i]).multiplyScalar(on || flash ? 1.6 : 0.07))
      }
      if (this.shiftLights.instanceColor) this.shiftLights.instanceColor.needsUpdate = true
    }
    // Forearms from the elbows, out of view below, to the wrists on the
    // wheel.
    this.mount.updateMatrix()
    this.wheel.updateMatrix()
    for (const arm of this.arms) {
      const wrist = this.tmp.copy(arm.wrist).applyMatrix4(this.wheel.matrix).applyMatrix4(this.mount.matrix)
      const dir = this.tmp2.subVectors(wrist, arm.elbow).normalize()
      const cuffStart = dir.clone().multiplyScalar(-0.07).add(wrist)
      arm.sleeve.scale.y = span(arm.sleeve, arm.elbow, cuffStart, 'y')
      arm.cuff.scale.y = span(arm.cuff, cuffStart, dir.multiplyScalar(0.012).add(wrist), 'y')
    }
    if (now - this.last < 50) return
    this.last = now
    this.drawDisplay(kmh, gear, nitro, damage)
    if (map) {
      const c = this.centre.g
      const grad = c.createLinearGradient(0, 0, 0, 200)
      grad.addColorStop(0, '#0a0e16')
      grad.addColorStop(1, '#04060a')
      c.fillStyle = grad
      c.fillRect(0, 0, 320, 200)
      c.drawImage(map, 70, 10, 180, 180)
      c.fillStyle = '#8a93a6'
      c.font = '600 13px "Chakra Petch", sans-serif'
      c.textAlign = 'left'
      c.fillText('NAV', 14, 24)
      c.textAlign = 'right'
      c.fillText(`${Math.round(kmh)} km/h`, 306, 24)
      this.centre.texture.needsUpdate = true
    }
  }

  // The two dial faces for the current car, and the markings that glow
  // through them: a machined centre, a chapter ring, fine and heavy ticks,
  // figures, a red band on the rev counter and the unit under the pivot.
  private drawFaces() {
    const light = this.style.face === 'light'
    const ink = light ? '#15171c' : '#eef1f6'
    const minor = light ? '#4d515b' : '#8d95a6'
    for (let i = 0; i < 2; i++) {
      const rev = i === 0
      const { g, texture } = this.faces[i]
      const { g: lg, texture: glow } = this.glows[i]
      const c = 256
      const grad = g.createRadialGradient(c, c - 20, 20, c, c, 260)
      grad.addColorStop(0, light ? '#f7f4ec' : '#1c2029')
      grad.addColorStop(0.7, light ? '#e7e3d8' : '#0d0f14')
      grad.addColorStop(1, light ? '#c9c5b9' : '#050608')
      g.fillStyle = grad
      g.fillRect(0, 0, 512, 512)
      // Machined rings round the centre.
      for (let r = 20; r < 150; r += 3) {
        g.strokeStyle = light ? `rgba(0,0,0,${0.025 + (r % 2) * 0.02})` : `rgba(255,255,255,${0.012 + (r % 2) * 0.012})`
        g.lineWidth = 1
        g.beginPath()
        g.arc(c, c, r, 0, Math.PI * 2)
        g.stroke()
      }
      lg.fillStyle = '#000'
      lg.fillRect(0, 0, 512, 512)
      const both = (fn: (x: CanvasRenderingContext2D, glowing: boolean) => void) => {
        fn(g, false)
        fn(lg, true)
      }
      const from = 0.75 * Math.PI
      both((x, glowing) => {
        x.strokeStyle = glowing ? '#3a3f49' : minor
        x.lineWidth = 2
        x.beginPath()
        x.arc(c, c, 236, from, from + SWEEP)
        x.stroke()
      })
      if (rev) {
        both((x, glowing) => {
          x.strokeStyle = glowing ? '#ff2a1a' : '#d62a2a'
          x.lineWidth = 16
          x.beginPath()
          x.arc(c, c, 222, from + SWEEP * RED_LINE, from + SWEEP)
          x.stroke()
        })
      }
      const majors = rev ? REV_MAX : 8
      const minors = rev ? 5 : 4
      const steps = majors * minors
      for (let k = 0; k <= steps; k++) {
        const a = from + (SWEEP * k) / steps
        const major = k % minors === 0
        const mid = !major && minors % 2 === 0 && k % (minors / 2) === 0
        const inner = major ? 196 : mid ? 210 : 218
        const red = rev && k / steps >= RED_LINE
        both((x, glowing) => {
          x.strokeStyle = glowing ? (red ? '#ff3a2a' : light ? '#6a6f7a' : '#f4f6fa') : red ? '#d62a2a' : major ? ink : minor
          x.lineWidth = major ? 6 : mid ? 3.5 : 2
          x.beginPath()
          x.moveTo(c + Math.cos(a) * 234, c + Math.sin(a) * 234)
          x.lineTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner)
          x.stroke()
        })
        if (major) {
          const value = rev ? k / minors : (k / minors) * (SPEED_MAX / 8)
          both((x, glowing) => {
            x.fillStyle = glowing ? (red ? '#ff3a2a' : light ? '#555a64' : '#f4f6fa') : red ? '#d62a2a' : ink
            x.font = `600 ${rev ? 46 : 38}px "Chakra Petch", sans-serif`
            x.textAlign = 'center'
            x.textBaseline = 'middle'
            x.fillText(String(value), c + Math.cos(a) * 160, c + Math.sin(a) * 160)
          })
        }
      }
      both((x, glowing) => {
        x.fillStyle = glowing ? (light ? '#40444d' : '#9aa3b4') : minor
        x.font = '600 24px "Chakra Petch", sans-serif'
        x.textAlign = 'center'
        x.textBaseline = 'middle'
        x.fillText(rev ? 'x1000 r/min' : 'km/h', c, c + 92)
      })
      texture.needsUpdate = true
      glow.needsUpdate = true
    }
  }

  // The screen between the dials: the gear large, the speed under it,
  // nitro and damage lights, and the nitro tank.
  private drawDisplay(kmh: number, gear: number, nitro: number, damage: number) {
    const g = this.display.g
    const grad = g.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0, '#0b1019')
    grad.addColorStop(1, '#030406')
    g.fillStyle = grad
    g.fillRect(0, 0, 256, 256)
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    g.fillStyle = nitro > 0.98 ? '#38a8ff' : '#132030'
    g.fillRect(24, 18, 96, 30)
    g.fillStyle = damage > 0.7 ? '#ff3b3b' : damage > 0.35 ? '#ffb02e' : '#2a1c12'
    g.fillRect(136, 18, 96, 30)
    g.font = '700 20px "Chakra Petch", sans-serif'
    g.fillStyle = '#05070b'
    g.fillText('N2O', 72, 41)
    g.fillText('DMG', 184, 41)
    g.shadowColor = this.style.stitch
    g.shadowBlur = 18
    g.fillStyle = '#ffffff'
    g.font = '700 116px "Chakra Petch", sans-serif'
    g.fillText(gear <= 0 ? 'N' : String(gear), 128, 170)
    g.shadowBlur = 0
    g.fillStyle = '#d9dee8'
    g.font = '700 38px "Chakra Petch", sans-serif'
    g.fillText(String(Math.round(kmh)), 128, 214)
    g.fillStyle = '#1a1f29'
    g.fillRect(28, 230, 200, 10)
    g.fillStyle = '#38a8ff'
    g.fillRect(28, 230, 200 * Math.max(0, Math.min(1, nitro)), 10)
    this.display.texture.needsUpdate = true
  }
}
