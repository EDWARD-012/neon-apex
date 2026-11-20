import { BufferAttribute, BufferGeometry } from 'three'

// Car bodies lofted from cross-sections. Each car is described by a handful
// of stations along its length (how wide, how tall at the shoulder, how
// tall at the roof); the code interpolates between them, sweeps a rounded
// cross-section along the car, and cuts wheel arches where the wheels sit.
//
// The result is one smooth mesh with three material groups: paint, glass
// and dark trim (sills, wheel wells, window seals). Each car gets its own
// copy, because damage dents the vertices of that copy.

export interface Station {
  // Position along the car, metres, nose at +z.
  z: number
  // Half width at the widest point of the body side.
  w: number
  // Height of the underside, the shoulder line, and the top (roof or deck).
  bottom: number
  shoulder: number
  top: number
  // Half width of the roof. Close to w on the bonnet and boot, narrower
  // over the cabin.
  roof: number
}

export interface BodySpec {
  stations: Station[]
  wheels: { z: number; r: number; x: number }[]
  rings?: number
}

export const PAINT = 0
export const GLASS = 1
export const TRIM = 2

// A smooth curve through the station values, sampled at z.
function sample(stations: Station[], z: number, key: keyof Station): number {
  const n = stations.length
  let i = 0
  while (i < n - 2 && stations[i + 1].z < z) i++
  const p1 = stations[i]
  const p2 = stations[i + 1]
  const p0 = stations[Math.max(0, i - 1)]
  const p3 = stations[Math.min(n - 1, i + 2)]
  const t = Math.max(0, Math.min(1, (z - p1.z) / (p2.z - p1.z || 1)))
  const t2 = t * t
  const t3 = t2 * t
  const a = p0[key]
  const b = p1[key]
  const c = p2[key]
  const d = p3[key]
  // Catmull-Rom, clamped so it never overshoots its neighbours.
  const v = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  return Math.max(Math.min(b, c) - 0.02, Math.min(Math.max(b, c) + 0.02, v))
}

// Half of one cross-section, from the middle of the underside round the
// side to the middle of the top. Returns [x, y, part] triples, where part
// says which region the point belongs to.
type Part = 'under' | 'side' | 'shoulder' | 'glass' | 'roof'
function section(s: { w: number; bottom: number; shoulder: number; top: number; roof: number }): [number, number, Part][] {
  const { w, bottom, shoulder, top, roof } = s
  const h = shoulder - bottom
  const cabin = top - shoulder
  const pts: [number, number, Part][] = [
    [0, bottom, 'under'],
    [w * 0.82, bottom, 'under'],
    [w * 0.94, bottom + 0.04, 'side'],
    [w * 0.985, bottom + h * 0.18, 'side'],
    [w, bottom + h * 0.38, 'side'],
    [w, bottom + h * 0.58, 'side'],
    [w * 0.99, bottom + h * 0.76, 'side'],
    [w * 0.965, bottom + h * 0.92, 'side'],
    [w * 0.93, shoulder, 'shoulder'],
  ]
  // The greenhouse: from the shoulder, in towards the roof edge.
  const g = Math.max(0.0001, cabin)
  const inner = Math.min(w * 0.93, Math.max(roof, w * 0.5))
  pts.push([inner + (w * 0.9 - inner) * 0.55, shoulder + g * 0.08, 'glass'])
  pts.push([inner + (w * 0.9 - inner) * 0.25, shoulder + g * 0.45, 'glass'])
  pts.push([roof * 1.0, shoulder + g * 0.86, 'glass'])
  pts.push([roof * 0.82, top - 0.005, 'roof'])
  pts.push([roof * 0.45, top + 0.012, 'roof'])
  pts.push([0, top + 0.018, 'roof'])
  return pts
}

export function loft(spec: BodySpec): BufferGeometry {
  const stations = spec.stations
  const rings = spec.rings ?? 96
  const z0 = stations[0].z
  const z1 = stations[stations.length - 1].z
  const half = section({ w: 1, bottom: 0, shoulder: 1, top: 2, roof: 1 }).length
  // Full ring: left half reversed (x negated), then right half. The two
  // ends meet at the middle of the roof and the middle of the underside.
  const perRing = half * 2 - 1
  const pos: number[] = []
  const part: Part[] = []
  const zs: number[] = []
  for (let r = 0; r <= rings; r++) {
    const z = z0 + ((z1 - z0) * r) / rings
    zs.push(z)
    const s = {
      w: sample(stations, z, 'w'),
      bottom: sample(stations, z, 'bottom'),
      shoulder: sample(stations, z, 'shoulder'),
      top: sample(stations, z, 'top'),
      roof: sample(stations, z, 'roof'),
    }
    const pts = section(s)
    const ring: [number, number, Part][] = [...pts.slice(1).reverse().map(([x, y, p]): [number, number, Part] => [-x, y, p]), ...pts]
    for (const [x, y, p] of ring) {
      // Wheel arches: a point on the lower side that falls inside an arch
      // is pulled in to the wheel well, carving the arch out of the side.
      let px = x
      let carved = false
      for (const wheel of spec.wheels) {
        const dz = z - wheel.z
        const reach = wheel.r + 0.07
        if (Math.abs(dz) >= reach) continue
        const archTop = wheel.r + Math.sqrt(reach * reach - dz * dz)
        if (y < archTop && Math.abs(x) > wheel.x - 0.2) {
          px = Math.sign(x) * (wheel.x - 0.2)
          carved = true
        }
      }
      pos.push(px, y, z)
      part.push(carved ? 'under' : p)
    }
  }

  // Which surface does each quad belong to? Glass where the greenhouse is
  // tall enough to be a window, and on the roof where it slopes steeply
  // enough to be a windscreen or rear screen.
  const cabinHeight = (z: number) => sample(stations, z, 'top') - sample(stations, z, 'shoulder')
  const slope = (z: number) => (sample(stations, z + 0.05, 'top') - sample(stations, z - 0.05, 'top')) / 0.1
  const groups: number[][] = [[], [], []]
  for (let r = 0; r < rings; r++) {
    const zm = (zs[r] + zs[r + 1]) / 2
    const tall = cabinHeight(zm) > 0.24
    const steep = Math.abs(slope(zm)) > 0.32
    for (let k = 0; k < perRing - 1; k++) {
      const a = r * perRing + k
      const b = a + 1
      const c = a + perRing
      const d = c + 1
      const pa = part[a]
      const pb = part[b]
      let group = PAINT
      if (pa === 'under' || pb === 'under') group = TRIM
      else if ((pa === 'glass' || pb === 'glass') && tall) group = pa === 'shoulder' || pb === 'shoulder' ? TRIM : GLASS
      else if (pa === 'roof' && pb === 'roof' && tall && steep) group = GLASS
      else if ((pa === 'roof' || pb === 'roof') && (pa === 'glass' || pb === 'glass') && tall && steep) group = GLASS
      groups[group].push(a, b, c, b, d, c)
    }
  }

  // Close the nose and the tail with a fan round the middle of each end.
  const cap = (r: number, flip: boolean) => {
    const start = r * perRing
    let cx = 0
    let cy = 0
    for (let k = 0; k < perRing; k++) {
      cx += pos[(start + k) * 3]
      cy += pos[(start + k) * 3 + 1]
    }
    const centre = pos.length / 3
    pos.push(cx / perRing, cy / perRing, zs[r])
    part.push('side')
    for (let k = 0; k < perRing - 1; k++) {
      const a = start + k
      const b = a + 1
      if (flip) groups[PAINT].push(centre, a, b)
      else groups[PAINT].push(centre, b, a)
    }
  }
  cap(0, true)
  cap(rings, false)

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  // White everywhere to start with. Damage darkens it where the paint is
  // scraped.
  geo.setAttribute('color', new BufferAttribute(new Float32Array(pos.length).fill(1), 3))
  const index: number[] = []
  let start = 0
  groups.forEach((list, g) => {
    index.push(...list)
    geo.addGroup(start, list.length, g)
    start += list.length
  })
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

// Pushes the body in around an impact point given in car space, and scuffs
// the paint there. strength is roughly the impact speed in m/s.
export function dent(geo: BufferGeometry, px: number, py: number, pz: number, strength: number, original: Float32Array) {
  const pos = geo.getAttribute('position') as BufferAttribute
  // Parts without vertex colours (lights, grille) move but never scuff.
  const col = geo.getAttribute('color') as BufferAttribute | undefined
  const radius = 0.55 + Math.min(0.6, strength * 0.03)
  const depth = Math.min(0.22, strength * 0.012)
  // Push towards the middle of the car, the way metal folds in a hit.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const d = Math.hypot(x - px, (y - py) * 1.4, z - pz)
    if (d > radius) continue
    const f = (1 - d / radius) ** 2
    // Slow noise, so a dent folds into a few broad creases rather than a
    // neat bowl or a wrinkled sheet.
    const crumple = 0.8 + 0.4 * Math.sin(x * 6.1 + z * 4.3 + y * 3.7)
    const toX = -x
    const toZ = -z * 0.35
    const len = Math.hypot(toX, toZ) || 1
    const push = depth * f * crumple
    let dx = x + (toX / len) * push - original[i * 3]
    let dy = y - push * 0.25 - original[i * 3 + 1]
    let dz = z + (toZ / len) * push - original[i * 3 + 2]
    // However many hits land in one place, no point moves more than 30 cm
    // from where it started.
    const moved = Math.hypot(dx, dy, dz)
    if (moved > 0.3) {
      dx *= 0.3 / moved
      dy *= 0.3 / moved
      dz *= 0.3 / moved
    }
    pos.setXYZ(i, original[i * 3] + dx, original[i * 3 + 1] + dy, original[i * 3 + 2] + dz)
    if (!col) continue
    // Scrapes: darker, greyer paint.
    const shade = Math.max(0.35, col.getX(i) - f * Math.min(0.5, strength * 0.04))
    col.setXYZ(i, shade, shade, shade * 1.02)
  }
  pos.needsUpdate = true
  if (col) col.needsUpdate = true
  geo.computeVertexNormals()
}
