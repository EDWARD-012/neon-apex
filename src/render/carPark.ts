import { BufferAttribute, type BufferGeometry, Group, type Material, Matrix4, Mesh, MeshBasicMaterial, type Texture } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { barrierOffset } from '../sim/car'
import { createRng } from '../sim/rng'
import type { Track } from '../sim/track'
import { contactShadow, makeAssetCar } from './carAssets'
import { distanceField } from './city'

// Spectators' cars parked along the verges of the mountain road either
// side of the start, beyond the crowd: the traffic's saloons, hatchbacks,
// estates and vans in everyday colours, nose to tail behind the barrier
// with gaps between. Every part that shares a material is merged into one
// mesh across all the cars, so a dozen cars cost a couple of dozen draws.

export interface ParkedSpot {
  x: number
  z: number
  heading: number
  van: boolean
  color: string
  variant: number
}

const COLORS = ['#c9ccd6', '#7d8597', '#a33c3c', '#2f4f7a', '#d9c7a3', '#3c6b52', '#e0e0e0', '#565b66', '#1d1f24']

// Off the barrier by this much, centre to barrier.
const OUT = 3.4

export function carParkSpots(track: Track, seed: string, count: number): ParkedSpot[] {
  const rng = createRng(`park/${seed}`)
  const wall = barrierOffset(track)
  const near = distanceField(track)
  const n = track.n
  const slots: { i: number; side: number; facing: number }[] = []
  for (const side of [-1, 1]) {
    // Cars on one verge mostly face the same way.
    const facing = rng() < 0.5 ? 0 : Math.PI
    for (const dir of [-1, 1]) {
      for (let along = 30; along <= 80; along += 5.8) slots.push({ i: (Math.round((dir * along) / track.spacing) + n) % n, side, facing })
    }
  }
  // Shuffled, so the cars that are there leave gaps here and there.
  for (let k = slots.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1))
    ;[slots[k], slots[j]] = [slots[j], slots[k]]
  }
  const spots: ParkedSpot[] = []
  for (const s of slots) {
    if (spots.length >= count) break
    const d = s.side * (wall + OUT)
    const x = track.x[s.i] + track.nx[s.i] * d
    const z = track.z[s.i] + track.nz[s.i] * d
    // Not where another part of the road comes close.
    if (near(x, z, 60) < wall + OUT - 1) continue
    const odd = rng() < 0.15 ? Math.PI : 0
    spots.push({
      x,
      z,
      heading: Math.atan2(track.tx[s.i], track.tz[s.i]) + s.facing + odd + (rng() - 0.5) * 0.06,
      van: rng() < 0.25,
      color: COLORS[Math.floor(rng() * COLORS.length)],
      variant: Math.floor(rng() * 8),
    })
  }
  return spots
}

// The car models store positions, normals and UVs as small integers
// scaled by the node's matrix. Moving them into the world would clamp them
// to -1..1, so each part is copied out to plain floats first.
function floats(geo: BufferGeometry): BufferGeometry {
  const out = geo.clone()
  for (const [name, attr] of Object.entries(geo.attributes)) {
    if (attr instanceof BufferAttribute && attr.array instanceof Float32Array && !attr.normalized) continue
    const size = attr.itemSize
    const values = new Float32Array(attr.count * size)
    for (let k = 0; k < attr.count; k++) {
      for (let c = 0; c < size; c++) values[k * size + c] = attr.getComponent(k, c)
    }
    out.setAttribute(name, new BufferAttribute(values, size))
  }
  return out
}

export interface CarPark {
  group: Group
  // False if some car models weren't loaded yet, so it should be built
  // again later.
  complete: boolean
  dispose(): void
}

export function buildCarPark(track: Track, seed: string, count: number, spot: Texture): CarPark {
  const group = new Group()
  // Parked, so the lamps are just glass.
  const tail = new MeshBasicMaterial({ color: '#5a1016' })
  const lamp = new MeshBasicMaterial({ color: '#b9bfc7' })
  const sets = new Map<string, { material: Material; parts: BufferGeometry[] }>()
  const add = (material: Material, geo: BufferGeometry) => {
    const key = `${material.uuid}|${Object.keys(geo.attributes).sort().join(',')}|${geo.index ? 'i' : 'n'}|${Object.keys(geo.morphAttributes).length}`
    const set = sets.get(key)
    if (set) set.parts.push(geo)
    else sets.set(key, { material, parts: [geo] })
  }
  let complete = true
  let shadowMaterial: Material | null = null
  const shadows: BufferGeometry[] = []
  const place = new Matrix4()
  for (const p of carParkSpots(track, seed, count)) {
    const car = makeAssetCar(p.van ? 'van' : 'sedan', p.color, p.variant)
    if (!car) {
      complete = false
      continue
    }
    place.makeRotationY(p.heading).setPosition(p.x, 0, p.z)
    car.root.updateMatrixWorld(true)
    car.root.traverseVisible((o) => {
      if (!(o instanceof Mesh) || Array.isArray(o.material)) return
      let material = o.material as Material
      if (material === car.tail) material = tail
      else if ((car.heads as Material[]).includes(material)) material = lamp
      add(material, floats(o.geometry).applyMatrix4(o.matrixWorld).applyMatrix4(place))
    })
    const shadow = contactShadow(spot, car.half)
    shadow.updateMatrix()
    shadows.push(shadow.geometry.clone().applyMatrix4(shadow.matrix).applyMatrix4(place))
    shadowMaterial ??= shadow.material as Material
  }
  const owned: BufferGeometry[] = []
  for (const { material, parts } of sets.values()) {
    const merged = mergeGeometries(parts)
    for (const geo of merged ? [merged] : parts) {
      const mesh = new Mesh(geo, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
      owned.push(geo)
    }
    if (merged) for (const geo of parts) geo.dispose()
  }
  if (shadowMaterial && shadows.length) {
    const merged = mergeGeometries(shadows)
    if (merged) {
      group.add(new Mesh(merged, shadowMaterial))
      owned.push(merged)
    }
  }
  return {
    group,
    complete,
    dispose() {
      for (const geo of owned) geo.dispose()
      tail.dispose()
      lamp.dispose()
    },
  }
}
