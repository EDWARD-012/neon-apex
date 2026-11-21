import { BoxGeometry, CanvasTexture, CircleGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from 'three'
import { createRng } from '../sim/rng'
import type { Track } from '../sim/track'

// Things by the road that are not the road: chevron signs on the outside of
// sharp corners, and puddles that only show in the rain.

// A corner tighter than this radius gets chevrons.
const SHARP = 70

// The signed curvature of the centre line at each sample: positive bends
// to the right.
function curvature(track: Track): Float32Array {
  const n = track.n
  const k = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = (i - 3 + n) % n
    const b = (i + 3) % n
    const turn = Math.atan2(track.tx[a] * track.tz[b] - track.tz[a] * track.tx[b], track.tx[a] * track.tx[b] + track.tz[a] * track.tz[b])
    k[i] = turn / (6 * track.spacing)
  }
  return k
}

function chevronTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 96
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#111317'
  g.fillRect(0, 0, 128, 96)
  g.fillStyle = '#f3c21b'
  for (const x of [20, 62]) {
    g.beginPath()
    g.moveTo(x, 14)
    g.lineTo(x + 30, 48)
    g.lineTo(x, 82)
    g.lineTo(x + 16, 82)
    g.lineTo(x + 46, 48)
    g.lineTo(x + 16, 14)
    g.closePath()
    g.fill()
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

let chevrons: CanvasTexture | null = null

export interface SignSpot {
  x: number
  z: number
  // Which way the board faces (towards the cars coming in), and whether the
  // corner turns right.
  facing: number
  right: boolean
}

// Where the chevrons go: three on the outside of the tightest point of each
// sharp corner, one at the apex and one 12 m either side of it.
export function signSpots(track: Track): SignSpot[] {
  const k = curvature(track)
  const n = track.n
  const gap = Math.round(40 / track.spacing)
  const spots: SignSpot[] = []
  let last = -Infinity
  for (let i = 0; i < n; i++) {
    const r = Math.abs(k[i]) > 1e-6 ? 1 / Math.abs(k[i]) : Infinity
    if (r > SHARP || Math.abs(k[i]) < Math.abs(k[(i + 1) % n]) || Math.abs(k[i]) < Math.abs(k[(i - 1 + n) % n]) || i - last < gap) continue
    last = i
    const right = k[i] > 0
    // Outside of the corner: the left of the road for a right-hander.
    const side = right ? -1 : 1
    for (const back of [-12, 0, 12]) {
      const j = (i + Math.round(back / track.spacing) + n) % n
      const off = side * (track.width / 2 + 2.2)
      spots.push({ x: track.x[j] + track.nx[j] * off, z: track.z[j] + track.nz[j] * off, facing: Math.atan2(-track.tx[j], -track.tz[j]), right })
    }
  }
  return spots
}

// The chevron boards on their posts, facing the cars coming into each
// corner and pointing the way it turns.
export function buildSigns(track: Track): Group {
  const group = new Group()
  chevrons ??= chevronTexture()
  const face = new MeshStandardMaterial({ map: chevrons, roughness: 0.6, side: DoubleSide })
  const post = new MeshStandardMaterial({ color: '#6b7079', roughness: 0.5, metalness: 0.6 })
  const board = new PlaneGeometry(1.3, 0.95)
  const pole = new BoxGeometry(0.08, 1.2, 0.08)
  for (const spot of signSpots(track)) {
    const sign = new Group()
    sign.position.set(spot.x, 0, spot.z)
    sign.rotation.y = spot.facing
    const p = new Mesh(pole, post)
    p.position.y = 0.6
    const b = new Mesh(board, face)
    b.position.y = 1.45
    // Facing the driver, the board's own x axis is the driver's right, so
    // a left-hander flips it.
    b.scale.x = spot.right ? 1 : -1
    sign.add(p, b)
    group.add(sign)
  }
  return group
}

export interface Puddle {
  x: number
  z: number
  i: number
}

// Standing water on the road, spread round the lap, the same for every
// race on the track. Shown only in the rain.
export function buildPuddles(track: Track, seed: string): { group: Group; puddles: Puddle[] } {
  const rng = createRng(`puddles/${seed}`)
  const group = new Group()
  const water = new MeshStandardMaterial({ color: '#0a0d14', roughness: 0.04, metalness: 0.7, transparent: true, opacity: 0.85 })
  const shape = new CircleGeometry(1, 28).rotateX(-Math.PI / 2)
  const puddles: Puddle[] = []
  const count = Math.round(track.length / 90)
  for (let k = 0; k < count; k++) {
    const i = Math.floor(rng() * track.n)
    const off = (rng() - 0.5) * (track.width - 3)
    const x = track.x[i] + track.nx[i] * off
    const z = track.z[i] + track.nz[i] * off
    const m = new Mesh(shape, water)
    m.position.set(x, 0.025, z)
    m.scale.set(1.2 + rng() * 1.2, 1, 0.7 + rng() * 0.6)
    m.rotation.y = rng() * Math.PI
    group.add(m)
    puddles.push({ x, z, i })
  }
  return { group, puddles }
}
