import {
  Box3,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  type Material,
  Matrix4,
  Mesh,
  type MeshPhysicalMaterial,
  MeshStandardMaterial,
  MeshPhysicalMaterial as Physical,
  type Object3D,
  Raycaster,
  Shape as Outline,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Looks, Rims } from '../looks'
import type { CarModel } from './carModel'

// Parts fitted to the player's car from the Looks tab: wheels, ride height,
// window tint and a spoiler. All of it is for looks; none of it changes the
// physics.
//
// Wheels: some models have tyre and rim in one mesh, so a new set replaces
// the whole wheel, tyre included, sized from the one it replaces. Ride
// height lowers the body, not the wheels. Tint darkens the side, rear and
// windscreen glass, found by name and by sitting above the waist, so the
// headlight lenses stay clear. Spoilers sit on the boot lid, found by
// casting a ray down onto the paint.

const DROP = { stock: 0, lowered: 0.03, slammed: 0.055 }
const TINT = { stock: 0, dark: 0.65, limo: 0.92 }

interface Wheel {
  radius: number
  width: number
  // +1 when the outer face looks toward the car's left (+x).
  out: number
}

// A tyre with rounded shoulders and a sidewall, turning about x.
function tyre(w: Wheel, rubber: Material) {
  const r = w.radius
  const inner = r * 0.7
  const h = w.width * 0.47
  const pts = [new Vector2(inner, -h), new Vector2(r - 0.025, -h), new Vector2(r - 0.004, -h + 0.02), new Vector2(r, -h + 0.045), new Vector2(r, h - 0.045), new Vector2(r - 0.004, h - 0.02), new Vector2(r - 0.025, h), new Vector2(inner, h)]
  return new Mesh(new LatheGeometry(pts, 48).rotateZ(Math.PI / 2), rubber)
}

// The rim designs, each built on the wheel's outer face.
function rim(design: Rims, w: Wheel, metals: Record<string, Material>) {
  const g = new Group()
  const r = w.radius * 0.7
  const face = w.out * w.width * 0.42
  const metal = design === 'split' ? metals.silver : design === 'mesh' ? metals.bronze : design === 'deep' ? metals.black : metals.gunmetal
  const lipMetal = design === 'deep' ? metals.chrome : metal
  const along = (m: Mesh, x: number) => {
    m.position.x = x
    g.add(m)
    return m
  }
  // Barrel, dark disc behind the spokes, polished lip and the hub.
  along(new Mesh(new CylinderGeometry(r * 0.98, r * 0.98, w.width * 0.84, 40, 1, true).rotateZ(Math.PI / 2), metals.inside), 0)
  along(new Mesh(new CylinderGeometry(r * 0.9, r * 0.9, 0.004, 40).rotateZ(Math.PI / 2), metals.inside), face - w.out * 0.06)
  along(new Mesh(new TorusGeometry(r * 0.97, design === 'deep' ? 0.014 : 0.008, 8, 48).rotateY(Math.PI / 2), lipMetal), face)
  along(new Mesh(new CylinderGeometry(r * 0.2, r * 0.22, 0.03, 24).rotateZ(Math.PI / 2), metal), face - w.out * 0.015)
  along(new Mesh(new CylinderGeometry(r * 0.09, r * 0.09, 0.012, 20).rotateZ(Math.PI / 2), metals.chrome), face + w.out * 0.002)
  // A spoke from the hub out to the rim at an angle round the wheel: it
  // leans back by depth at its outer end for a dish, and twists about its
  // own length for a turbine blade.
  const spoke = (angle: number, width: number, depth: number, twist = 0) => {
    const len = r * 0.76
    const s = new Mesh(new RoundedBoxGeometry(0.018, len, width, 2, Math.min(0.006, width * 0.4)), metal)
    const mid = r * 0.58
    s.position.set(face - w.out * (0.012 + depth / 2), Math.sin(angle) * mid, Math.cos(angle) * mid)
    s.rotation.set(Math.PI / 2 - angle, 0, 0)
    s.rotateZ(w.out * Math.atan2(depth, len))
    if (twist) s.rotateY(twist)
    g.add(s)
  }
  if (design === 'split') for (let k = 0; k < 5; k++) for (const d of [-0.11, 0.11]) spoke((k / 5) * Math.PI * 2 + d, 0.022, 0.02)
  else if (design === 'mesh') {
    for (let k = 0; k < 10; k++) {
      spoke((k / 10) * Math.PI * 2 + 0.16, 0.012, 0.012, 0.35)
      spoke((k / 10) * Math.PI * 2 - 0.16, 0.012, 0.012, -0.35)
    }
  } else if (design === 'deep') for (let k = 0; k < 6; k++) spoke((k / 6) * Math.PI * 2, 0.03, 0.07)
  else for (let k = 0; k < 12; k++) spoke((k / 12) * Math.PI * 2, 0.032, 0.015, 0.6)
  return g
}

// The size and outer side of a wheel, from the parts the model gave it.
function measure(spin: Object3D): Wheel | null {
  spin.updateMatrixWorld(true)
  const toSpin = new Matrix4().copy(spin.matrixWorld).invert()
  const box = new Box3()
  spin.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh || mesh.userData.fitted) return
    mesh.geometry.computeBoundingBox()
    box.union((mesh.geometry.boundingBox as Box3).clone().applyMatrix4(new Matrix4().multiplyMatrices(toSpin, mesh.matrixWorld)))
  })
  if (box.isEmpty()) return null
  const size = box.getSize(new Vector3())
  const steer = spin.parent
  return { radius: Math.max(size.y, size.z) / 2, width: Math.max(0.16, size.x), out: (steer?.position.x ?? 1) >= 0 ? 1 : -1 }
}

const FITTED = 'fitted-parts'

export function fitParts(model: CarModel, looks: Looks) {
  // Take off whatever was fitted before.
  model.group.traverse((o) => {
    if (o.name === FITTED) o.removeFromParent()
  })
  // Wheels.
  const metals: Record<string, Material> = {
    silver: new MeshStandardMaterial({ color: '#cfd2d8', metalness: 1, roughness: 0.28 }),
    bronze: new MeshStandardMaterial({ color: '#9a7646', metalness: 1, roughness: 0.32 }),
    black: new MeshStandardMaterial({ color: '#17181b', metalness: 0.6, roughness: 0.35 }),
    gunmetal: new MeshStandardMaterial({ color: '#4c5058', metalness: 1, roughness: 0.3 }),
    chrome: new MeshStandardMaterial({ color: '#eceff3', metalness: 1, roughness: 0.06 }),
    inside: new MeshStandardMaterial({ color: '#0d0e10', metalness: 0.4, roughness: 0.6, side: DoubleSide }),
  }
  const rubber = new MeshStandardMaterial({ color: '#141416', roughness: 0.92, metalness: 0 })
  for (const spin of model.wheels) {
    const stock = spin.children.filter((c) => c.name !== FITTED)
    for (const c of stock) c.visible = looks.rims === 'stock'
    if (looks.rims === 'stock') continue
    const w = (spin.userData.wheel ??= measure(spin)) as Wheel | null
    if (!w) {
      for (const c of stock) c.visible = true
      continue
    }
    const wheel = new Group()
    wheel.name = FITTED
    wheel.add(tyre(w, rubber), rim(looks.rims, w, metals))
    wheel.traverse((o) => {
      o.userData.fitted = true
      ;(o as Mesh).castShadow = true
    })
    spin.add(wheel)
  }

  // Ride height: everything on the body but the wheels moves down.
  const steers = new Set(model.wheels.map((w) => w.parent))
  const shell: Object3D[] = []
  for (const c of model.body.children) {
    if (c.name === 'cockpit') continue
    if (c.children.some((d) => steers.has(d))) for (const d of c.children) !steers.has(d) && shell.push(d)
    else shell.push(c)
  }
  const drop = DROP[looks.ride] ?? 0
  for (const o of shell) {
    o.userData.rideBase ??= o.position.y
    o.position.y = (o.userData.rideBase as number) - drop
  }

  // Paint bounds and the paint material, for the tint and the spoiler.
  model.group.updateMatrixWorld(true)
  const toBody = new Matrix4().copy(model.body.matrixWorld).invert()
  const bounds = new Box3()
  const painted: Mesh[] = []
  let paint: MeshPhysicalMaterial | null = null
  model.body.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh || mesh.userData.fitted) return
    const m = mesh.material as Material
    if (Array.isArray(m) || !m.userData.paint) return
    paint ??= m as MeshPhysicalMaterial
    painted.push(mesh)
    mesh.geometry.computeBoundingBox()
    bounds.union((mesh.geometry.boundingBox as Box3).clone().applyMatrix4(new Matrix4().multiplyMatrices(toBody, mesh.matrixWorld)))
  })
  if (bounds.isEmpty()) return

  // Tint: the car's own glass material is shared with the rivals' copies,
  // so the player's windows get their own copy, darkened.
  const waist = bounds.min.y + (bounds.max.y - bounds.min.y) * 0.5
  const tint = TINT[looks.tint] ?? 0
  model.body.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh || mesh.userData.fitted) return
    const m = (mesh.userData.stockGlass ?? mesh.material) as Material
    if (Array.isArray(m) || !/glass/i.test(m.name ?? '') || /red|orange|bump|ridged|optic/i.test(m.name ?? '')) return
    mesh.geometry.computeBoundingBox()
    const centre = (mesh.geometry.boundingBox as Box3).getCenter(new Vector3()).applyMatrix4(new Matrix4().multiplyMatrices(toBody, mesh.matrixWorld))
    if (centre.y < waist) return
    mesh.userData.stockGlass ??= m
    if (!tint) {
      mesh.material = m
      return
    }
    const dark = (m as MeshStandardMaterial).clone()
    dark.color.lerp(dark.color.clone().setRGB(0.01, 0.012, 0.016), tint)
    dark.transparent = true
    dark.opacity = Math.max(dark.opacity, 0.55 + tint * 0.4)
    mesh.material = dark
  })

  // Spoiler: find the boot lid's height near the back by casting down onto
  // the paint, then fit a lip in the paint colour or a wing on struts.
  if (looks.spoiler === 'stock' || !paint) return
  const ray = new Raycaster()
  const deckAt = (z: number) => {
    const from = model.body.localToWorld(new Vector3(0, bounds.max.y + 1, z))
    const down = model.body.localToWorld(new Vector3(0, bounds.max.y, z)).sub(from).normalize()
    ray.set(from, down)
    const hit = ray.intersectObjects(painted, false)[0]
    return hit ? model.body.worldToLocal(hit.point.clone()).y : null
  }
  const width = bounds.max.x - bounds.min.x
  const group = new Group()
  group.name = FITTED
  if (looks.spoiler === 'lip') {
    const z = bounds.min.z + 0.1
    const y = deckAt(z)
    if (y === null) return
    const wedge = new Outline()
    wedge.moveTo(0.03, -0.006)
    wedge.lineTo(-0.08, 0.034)
    wedge.lineTo(-0.095, 0.03)
    wedge.lineTo(-0.02, -0.01)
    wedge.closePath()
    const span = width * 0.74
    const g = new ExtrudeGeometry(wedge, { depth: span, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 2 })
    g.rotateY(-Math.PI / 2).translate(span / 2, 0, 0)
    const lip = new Mesh(g, paint)
    lip.position.set(0, y, z)
    lip.castShadow = true
    group.add(lip)
  } else {
    const z = bounds.min.z + 0.24
    const y = deckAt(z) ?? deckAt(bounds.min.z + 0.4)
    if (y === null) return
    const carbon = new Physical({ color: '#121316', roughness: 0.35, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 })
    const height = 0.24
    for (const k of [-1, 1]) {
      const strut = new Mesh(new RoundedBoxGeometry(0.018, height, 0.09, 2, 0.006), carbon)
      strut.position.set(k * width * 0.28, y + height / 2, z - 0.02)
      strut.rotation.x = -0.15
      group.add(strut)
    }
    const foil = new Outline()
    foil.moveTo(0.13, 0)
    foil.quadraticCurveTo(0.02, 0.035, -0.13, 0.018)
    foil.lineTo(-0.135, 0.008)
    foil.quadraticCurveTo(0.0, 0.002, 0.13, -0.008)
    foil.closePath()
    const span = width * 0.9
    const g = new ExtrudeGeometry(foil, { depth: span, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 })
    g.rotateY(-Math.PI / 2).translate(span / 2, 0, 0)
    const wing = new Mesh(g, carbon)
    wing.position.set(0, y + height, z - 0.05)
    wing.rotation.x = 0.12
    group.add(wing)
    for (const k of [-1, 1]) {
      const plate = new Mesh(new RoundedBoxGeometry(0.008, 0.12, 0.32, 2, 0.003), carbon)
      plate.position.set(k * (span / 2 + 0.004), y + height - 0.02, z - 0.05)
      group.add(plate)
    }
  }
  group.traverse((o) => {
    o.userData.fitted = true
    ;(o as Mesh).castShadow = true
  })
  group.position.y = 0
  model.body.add(group)
}
