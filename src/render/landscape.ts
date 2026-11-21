import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { barrierOffset } from '../sim/car'
import { createRng } from '../sim/rng'
import type { Track } from '../sim/track'
import { pbr } from './assets'
import { misty } from './mist'
import { distanceField } from './city'

// The daytime setting: the circuit runs through a forested valley with a
// ring of rocky, snow-capped mountains round it. The ground, the rock and
// the road use photo textures; the shapes are generated from the track's
// seed, so every track gets its own skyline of peaks.

export interface Landscape {
  group: Group
  ground: MeshStandardMaterial
}

// Ridged noise round a circle: a few sine waves with random phases, folded
// so the tops come to sharp crests instead of round humps.
function ridges(rng: () => number) {
  const waves = Array.from({ length: 10 }, (_, k) => ({
    f: 2 + k * 4 + Math.floor(rng() * 5),
    p: rng() * Math.PI * 2,
    g: 1.5 + rng() * 4,
    a: 1 / (1 + k * 0.7),
  }))
  const total = waves.reduce((s, w) => s + w.a, 0)
  return (angle: number, t: number) => {
    let v = 0
    for (const w of waves) v += w.a * (1 - Math.abs(Math.sin(angle * w.f + w.p + t * w.g)))
    return (v / total) ** 1.8
  }
}

function mountains(cx: number, cz: number, inner: number, rng: () => number) {
  const around = 540
  const rings = 60
  const depth = 2100
  const ridge = ridges(rng)
  const pos = new Float32Array((around + 1) * (rings + 1) * 3)
  const col = new Float32Array((around + 1) * (rings + 1) * 3)
  const uv = new Float32Array((around + 1) * (rings + 1) * 2)
  const snow = new Color('#f4f7fb')
  const rock = new Color('#8d8a86')
  const grass = new Color('#56663a')
  const c = new Color()
  for (let j = 0; j <= rings; j++) {
    const t = j / rings
    const r = inner + depth * t ** 1.25
    // Rises from the valley floor, highest towards the back.
    const rise = Math.min(1, t / 0.32) ** 1.6
    for (let i = 0; i <= around; i++) {
      const angle = (i / around) * Math.PI * 2
      const crest = ridge(angle, t * 3)
      const h = rise * (40 + 1050 * crest * (0.4 + 0.6 * t))
      const k = (j * (around + 1) + i) * 3
      pos[k] = cx + Math.cos(angle) * r
      pos[k + 1] = h - 2
      pos[k + 2] = cz + Math.sin(angle) * r
      // Grass low down, rock above, snow on the high crests.
      const snowLine = 300 + 70 * Math.sin(angle * 9 + t * 5)
      if (h > snowLine) c.copy(rock).lerp(snow, Math.min(1, (h - snowLine) / 70))
      else c.copy(grass).lerp(rock, Math.min(1, Math.max(0, (h - 25) / 120)))
      col.set([c.r, c.g, c.b], k)
      uv[(j * (around + 1) + i) * 2] = (angle * r) / 60
      uv[(j * (around + 1) + i) * 2 + 1] = (h + r * 0.2) / 60
    }
  }
  const index: number[] = []
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < around; i++) {
      const a = j * (around + 1) + i
      const b = a + around + 1
      index.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('color', new BufferAttribute(col, 3))
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  const material = misty(new MeshStandardMaterial({ ...pbr('rock', 1), vertexColors: true, roughness: 1, envMapIntensity: 0.6 }))
  const mesh = new Mesh(geo, material)
  mesh.receiveShadow = true
  return mesh
}

// Conifers and boulders on the valley floor, kept clear of the road.
function forest(track: Track, cx: number, cz: number, radius: number, rng: () => number) {
  const near = distanceField(track)
  const wall = barrierOffset(track)
  const spots: { x: number; z: number; s: number }[] = []
  let tries = 0
  while (spots.length < 2600 && tries < 40000) {
    tries++
    const a = rng() * Math.PI * 2
    const r = Math.sqrt(rng()) * (radius + 420)
    const x = cx + Math.cos(a) * r
    const z = cz + Math.sin(a) * r
    const d = near(x, z, 90)
    // Thick near the road, thinning out further away, never on it.
    if (d < wall + 7) continue
    if (d < 90 && rng() > 0.85) continue
    if (d >= 90 && rng() > 0.35) continue
    spots.push({ x, z, s: 0.7 + rng() * 0.9 })
  }
  // Five tiers of branches, each a cone, narrowing to the tip.
  const crown = mergeGeometries([
    new ConeGeometry(2.4, 3.4, 11, 1, true).translate(0, 3.6, 0),
    new ConeGeometry(2.0, 3.2, 11, 1, true).translate(0, 5.2, 0),
    new ConeGeometry(1.6, 3.0, 11, 1, true).translate(0, 6.7, 0),
    new ConeGeometry(1.15, 2.7, 10, 1, true).translate(0, 8.1, 0),
    new ConeGeometry(0.7, 2.4, 9).translate(0, 9.4, 0),
  ])
  const trunk = new CylinderGeometry(0.22, 0.32, 2.8, 6).translate(0, 1.4, 0)
  const leaves = new InstancedMesh(crown, misty(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, side: DoubleSide })), spots.length)
  const bark = new InstancedMesh(trunk, misty(new MeshStandardMaterial({ color: '#4a3526', roughness: 1 })), spots.length)
  const o = new Object3D()
  const tint = new Color()
  spots.forEach((p, k) => {
    o.position.set(p.x, 0, p.z)
    o.rotation.set(0, rng() * Math.PI * 2, 0)
    o.scale.setScalar(p.s)
    o.updateMatrix()
    leaves.setMatrixAt(k, o.matrix)
    bark.setMatrixAt(k, o.matrix)
    tint.setHSL(0.27 + rng() * 0.07, 0.32 + rng() * 0.2, 0.12 + rng() * 0.08, SRGBColorSpace)
    leaves.setColorAt(k, tint)
  })
  // Boulders scattered among the trees and along the verges.
  const rocks: { x: number; z: number; s: number }[] = []
  tries = 0
  while (rocks.length < 260 && tries < 8000) {
    tries++
    const a = rng() * Math.PI * 2
    const r = Math.sqrt(rng()) * (radius + 300)
    const x = cx + Math.cos(a) * r
    const z = cz + Math.sin(a) * r
    const d = near(x, z, 60)
    if (d < wall + 4 || d > 60) continue
    rocks.push({ x, z, s: 0.6 + rng() * 2.2 })
  }
  const stones = new InstancedMesh(new DodecahedronGeometry(1, 1), misty(new MeshStandardMaterial({ ...pbr('rock', 0.5), color: '#b8b2aa', roughness: 1 })), rocks.length)
  rocks.forEach((p, k) => {
    o.position.set(p.x, p.s * 0.25, p.z)
    o.rotation.set(rng() * 3, rng() * 3, rng() * 3)
    o.scale.set(p.s * (0.8 + rng() * 0.6), p.s * (0.5 + rng() * 0.4), p.s * (0.8 + rng() * 0.6))
    o.updateMatrix()
    stones.setMatrixAt(k, o.matrix)
  })
  for (const m of [leaves, bark, stones]) {
    m.castShadow = true
    m.receiveShadow = true
  }
  return [leaves, bark, stones]
}

export function buildLandscape(track: Track): Landscape {
  const rng = createRng(`landscape/${track.seed}`)
  const group = new Group()
  let cx = 0
  let cz = 0
  for (let i = 0; i < track.n; i++) {
    cx += track.x[i]
    cz += track.z[i]
  }
  cx /= track.n
  cz /= track.n
  let radius = 0
  for (let i = 0; i < track.n; i++) radius = Math.max(radius, Math.hypot(track.x[i] - cx, track.z[i] - cz))

  // The valley floor: forest soil and grass, tiled about every 6 m.
  // Tinted towards green, so the valley reads as grass and needles rather
  // than bare soil.
  const ground = misty(new MeshStandardMaterial({ ...pbr('ground', 1500), color: '#8fa56a', roughness: 1, envMapIntensity: 0.35 }))
  const floor = new Mesh(new PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), ground)
  floor.position.set(cx, -0.04, cz)
  floor.receiveShadow = true
  group.add(floor)
  group.add(mountains(cx, cz, radius + 360, rng))
  group.add(...forest(track, cx, cz, radius, rng))
  return { group, ground }
}
