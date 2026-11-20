import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  AdditiveBlending,
  ConeGeometry,
  DoubleSide,
  PlaneGeometry,
  SphereGeometry,
  type Texture,
} from 'three'
import { between, createRng, pick } from '../sim/rng'
import type { Track } from '../sim/track'
import { facade, fade, sign, sky, spot, ticker } from './textures'

// The city around the circuit: blocks of towers with lit windows, neon signs
// facing the road, red beacons on the tallest roofs, and a sky.

const WORDS = ['RAMEN', 'KARAOKE', 'HOTEL', 'ARCADE', 'OPEN 24H', 'NOODLES', 'PARKING', 'LIVE MUSIC', 'TAXI', 'CAFE', 'GARAGE', 'SUSHI BAR', 'DINER', 'TATTOO', 'LAUNDRY']
const SIGN_COLORS = ['#ff2d95', '#3df5ff', '#ffb52e', '#a66bff', '#5dff7a', '#ff6a3d']

interface Box {
  x: number
  z: number
  w: number
  d: number
  h: number
  angle: number
}

// Distance from a point to the nearest centre-line sample, using a coarse
// grid of the samples so the city can be laid out quickly.
export function distanceField(track: Track) {
  const cell = 40
  const grid = new Map<string, number[]>()
  for (let i = 0; i < track.n; i += 2) {
    const key = `${Math.floor(track.x[i] / cell)},${Math.floor(track.z[i] / cell)}`
    const list = grid.get(key)
    if (list) list.push(i)
    else grid.set(key, [i])
  }
  return (x: number, z: number, reach: number) => {
    let best = Infinity
    const span = Math.ceil(reach / cell)
    const gx = Math.floor(x / cell)
    const gz = Math.floor(z / cell)
    for (let ox = -span; ox <= span; ox++) {
      for (let oz = -span; oz <= span; oz++) {
        for (const i of grid.get(`${gx + ox},${gz + oz}`) ?? []) {
          best = Math.min(best, Math.hypot(track.x[i] - x, track.z[i] - z))
        }
      }
    }
    return best
  }
}

// One merged geometry for every tower. UVs scale with the size of each face
// so windows stay the same size on short and tall buildings, and roofs map
// onto the dark corner of the facade texture.
function towers(boxes: Box[], rng: () => number) {
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const index: number[] = []
  const quad = (corners: number[][], normal: number[], u0: number, v0: number, uw: number, vh: number) => {
    const base = pos.length / 3
    corners.forEach((c, k) => {
      pos.push(c[0], c[1], c[2])
      nor.push(normal[0], normal[1], normal[2])
      uv.push(u0 + (k === 1 || k === 2 ? uw : 0), v0 + (k >= 2 ? vh : 0))
    })
    index.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  for (const b of boxes) {
    const c = Math.cos(b.angle)
    const s = Math.sin(b.angle)
    const corner = (px: number, pz: number, y: number) => [b.x + px * c + pz * s, y, b.z - px * s + pz * c]
    const hw = b.w / 2
    const hd = b.d / 2
    const faces: [number, number, number, number, number][] = [
      [-hw, hd, hw, hd, b.w],
      [hw, hd, hw, -hd, b.d],
      [hw, -hd, -hw, -hd, b.w],
      [-hw, -hd, -hw, hd, b.d],
    ]
    const u0 = Math.floor(rng() * 16) / 16
    const v0 = Math.floor(rng() * 8) / 32
    for (const [ax, az, bx, bz, len] of faces) {
      // The middle of a face points straight out from the box centre.
      const nx = (ax + bx) / 2
      const nz = (az + bz) / 2
      const nl = Math.hypot(nx, nz) || 1
      // The facade texture is 16 windows of 2 m across and 32 floors of 2.5 m.
      quad(
        [corner(ax, az, 0), corner(bx, bz, 0), corner(bx, bz, b.h), corner(ax, az, b.h)],
        [(nx * c + nz * s) / nl, 0, (-nx * s + nz * c) / nl],
        u0,
        v0,
        len / 32,
        b.h / 80,
      )
    }
    quad([corner(-hw, hd, b.h), corner(hw, hd, b.h), corner(hw, -hd, b.h), corner(-hw, -hd, b.h)], [0, 1, 0], 0.001, 0.001, 0.01, 0.01)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geo.setIndex(index)
  return geo
}

export interface City {
  group: Group
  beacons: MeshBasicMaterial
  facade: MeshStandardMaterial
  dome: MeshBasicMaterial
  ground: MeshStandardMaterial
  // Moon in a clear sky, low sun at dusk.
  moon: Mesh
  sun: Mesh
  // Searchlight beams sweeping the sky, and billboard textures that scroll.
  beams: Mesh[]
  tickers: Texture[]
}

const TICKERS: [string, string][] = [
  ['RACE TONIGHT   OPEN ALL NIGHT   NOODLES 24H', '#ff4fa8'],
  ['SKIDLINE   DRIFT CITY   NO SPEED LIMIT ON THE SCREEN', '#3df5ff'],
  ['KARAOKE   ARCADE   LIVE MUSIC   LATE BAR', '#ffb52e'],
]

export function buildCity(track: Track): City {
  const rng = createRng(`city/${track.seed}`)
  const group = new Group()
  const distance = distanceField(track)
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < track.n; i++) {
    minX = Math.min(minX, track.x[i])
    maxX = Math.max(maxX, track.x[i])
    minZ = Math.min(minZ, track.z[i])
    maxZ = Math.max(maxZ, track.z[i])
  }
  const pad = 260
  const cell = 30
  const clear = track.width / 2 + 13
  const boxes: Box[] = []
  const near: Box[] = []
  for (let x = minX - pad; x <= maxX + pad; x += cell) {
    for (let z = minZ - pad; z <= maxZ + pad; z += cell) {
      if (rng() < 0.12) continue
      const w = between(rng, 12, 24)
      const d = between(rng, 12, 24)
      const bx = x + between(rng, -4, 4)
      const bz = z + between(rng, -4, 4)
      const gap = distance(bx, bz, 80)
      if (gap < clear + Math.max(w, d) / 2) continue
      // Lower blocks by the road, towers further back.
      const tall = gap < 60 ? between(rng, 10, 32) : between(rng, 18, 30) * (1 + rng() * rng() * 4)
      const box = { x: bx, z: bz, w, d, h: tall, angle: 0 }
      boxes.push(box)
      if (gap < clear + 26) near.push(box)
    }
  }
  const { map, glow } = facade(track.seed)
  const facadeMaterial = new MeshStandardMaterial({ map, emissiveMap: glow, emissive: '#ffffff', emissiveIntensity: 1.05, roughness: 0.75, metalness: 0.25 })
  const buildings = new Mesh(towers(boxes, rng), facadeMaterial)
  group.add(buildings)

  // Neon signs on the faces of buildings close to the road, turned to face
  // the nearest bit of track.
  const signs = near.filter(() => rng() < 0.45).slice(0, 40)
  for (const b of signs) {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < track.n; i += 3) {
      const dd = Math.hypot(track.x[i] - b.x, track.z[i] - b.z)
      if (dd < bestD) {
        bestD = dd
        best = i
      }
    }
    const dx = track.x[best] - b.x
    const dz = track.z[best] - b.z
    const len = Math.hypot(dx, dz) || 1
    const color = pick(rng, SIGN_COLORS)
    const width = between(rng, 7, 11)
    const plate = new Mesh(new PlaneGeometry(width, width / 3.2), new MeshBasicMaterial({ map: sign(pick(rng, WORDS), color), toneMapped: false, transparent: true }))
    const reach = Math.min(b.w, b.d) / 2 + 0.4
    plate.position.set(b.x + (dx / len) * reach, Math.min(b.h - 3, between(rng, 7, 14)), b.z + (dz / len) * reach)
    plate.rotation.y = Math.atan2(dx, dz)
    group.add(plate)
  }

  // Blinking red beacons on top of the tall towers.
  const tall = boxes.filter((b) => b.h > 60)
  const beacons = new MeshBasicMaterial({ color: new Color('#ff2020').multiplyScalar(4), toneMapped: false, transparent: true })
  if (tall.length) {
    const lights = new InstancedMesh(new SphereGeometry(0.6, 8, 6), beacons, tall.length)
    tall.forEach((b, k) => lights.setMatrixAt(k, new Matrix4().makeTranslation(b.x, b.h + 1, b.z)))
    group.add(lights)
  }

  // Ground and sky.
  const groundMaterial = new MeshStandardMaterial({ color: '#0d0e13', roughness: 0.95 })
  const ground = new Mesh(new PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), groundMaterial)
  ground.position.y = -0.02
  group.add(ground)

  // Big scrolling screens on a few of the towers by the road.
  const tickers: Texture[] = []
  const screens = near.filter((b) => b.h > 22).slice(0, 6)
  screens.forEach((b, k) => {
    const [text, color] = TICKERS[k % TICKERS.length]
    const map = ticker(text, color)
    map.repeat.set(0.35, 1)
    tickers.push(map)
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < track.n; i += 3) {
      const dd = Math.hypot(track.x[i] - b.x, track.z[i] - b.z)
      if (dd < bestD) {
        bestD = dd
        best = i
      }
    }
    const dx = track.x[best] - b.x
    const dz = track.z[best] - b.z
    const len = Math.hypot(dx, dz) || 1
    const reach = Math.min(b.w, b.d) / 2 + 0.5
    const screen = new Mesh(new PlaneGeometry(14, 2.4), new MeshBasicMaterial({ map, toneMapped: false }))
    screen.position.set(b.x + (dx / len) * reach, b.h - 3, b.z + (dz / len) * reach)
    screen.rotation.y = Math.atan2(dx, dz)
    group.add(screen)
  })

  // Moon and low sun, far off in the sky; the weather picks which shows.
  const soft = spot()
  const centreX = (minX + maxX) / 2
  const centreZ = (minZ + maxZ) / 2
  const moon = new Mesh(new PlaneGeometry(260, 260), new MeshBasicMaterial({ map: soft, color: new Color('#cfe0ff').multiplyScalar(2.2), transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }))
  moon.position.set(centreX - 900, 700, centreZ - 1500)
  moon.lookAt(centreX, 0, centreZ)
  const sun = new Mesh(new PlaneGeometry(900, 900), new MeshBasicMaterial({ map: soft, color: new Color('#ff8a4a').multiplyScalar(1.6), transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }))
  sun.position.set(centreX + 600, 60, centreZ - 2000)
  sun.lookAt(centreX, 60, centreZ)
  group.add(moon, sun)

  // Searchlights: long faint cones from behind the skyline.
  const beams: Mesh[] = []
  const beamMat = new MeshBasicMaterial({ color: new Color('#9fb4ff').multiplyScalar(0.5), alphaMap: fade(), transparent: true, opacity: 0.07, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false })
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4
    // Point at the ground, opening upwards, and fading out with height.
    const cone = new Mesh(new ConeGeometry(60, 1400, 24, 1, true).rotateX(Math.PI).translate(0, 700, 0), beamMat)
    cone.position.set(centreX + Math.cos(a) * 900, 0, centreZ + Math.sin(a) * 900)
    cone.userData.phase = k * 2.1
    group.add(cone)
    beams.push(cone)
  }
  const domeMaterial = new MeshBasicMaterial({ map: sky(), side: BackSide, fog: false, depthWrite: false })
  group.add(new Mesh(new SphereGeometry(2400, 32, 16), domeMaterial))
  return { group, beacons, facade: facadeMaterial, dome: domeMaterial, ground: groundMaterial, moon, sun, beams, tickers }
}
