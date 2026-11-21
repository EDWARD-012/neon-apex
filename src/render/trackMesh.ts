import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
} from 'three'
import { barrierOffset } from '../sim/car'
import { createRng } from '../sim/rng'
import type { Track } from '../sim/track'
import { pbr } from './assets'
import { misty } from './mist'
import { asphalt, banner, checker, spot } from './textures'
import { KERB_IN, KERB_OUT, kerbSide } from '../sim/kerbs'

// A ribbon along the track between two lateral offsets, at a height, with
// one row of vertices per sample and a closing row back at the start.
function ribbon(track: Track, inner: number, outer: number, y: number, vScale = 1, uSpan = 1) {
  const rows = track.n + 1
  const pos = new Float32Array(rows * 2 * 3)
  const uv = new Float32Array(rows * 2 * 2)
  for (let r = 0; r < rows; r++) {
    const i = r % track.n
    for (let side = 0; side < 2; side++) {
      const d = side === 0 ? inner : outer
      const k = (r * 2 + side) * 3
      pos[k] = track.x[i] + d * track.nx[i]
      pos[k + 1] = y
      pos[k + 2] = track.z[i] + d * track.nz[i]
      uv[(r * 2 + side) * 2] = side * uSpan
      uv[(r * 2 + side) * 2 + 1] = (r * track.spacing) / vScale
    }
  }
  const index: number[] = []
  // Wound so the faces point up. The offset runs to the right of the
  // direction of travel, so (along) x (across) points down; swapping the
  // order turns the face over.
  for (let r = 0; r < track.n; r++) {
    const a = r * 2
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

// Separate quads laid along the track, e.g. dashes or kerb blocks.
function quads(track: Track, pieces: { from: number; to: number; inner: number; outer: number; y: number; color?: Color }[]) {
  const pos: number[] = []
  const col: number[] = []
  const index: number[] = []
  for (const p of pieces) {
    const base = pos.length / 3
    for (const i of [p.from % track.n, p.to % track.n]) {
      for (const d of [p.inner, p.outer]) {
        pos.push(track.x[i] + d * track.nx[i], p.y, track.z[i] + d * track.nz[i])
        if (p.color) col.push(p.color.r, p.color.g, p.color.b)
      }
    }
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  if (col.length) geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

const NEON = ['#3df5ff', '#ff2d95', '#a66bff', '#3df5ff', '#ffb52e']

// `day` builds the mountain road: photo asphalt and steel guard rails. At
// night it is the city circuit with neon-topped walls and street lights.
export function buildTrackMeshes(track: Track, day = false): Group {
  const group = new Group()
  const half = track.width / 2
  const wall = barrierOffset(track)

  // Road with a narrow shoulder out to the barriers.
  let roadMaterial: MeshStandardMaterial
  if (day) {
    roadMaterial = misty(new MeshStandardMaterial({ ...pbr('road', 3, 3), roughness: 1, metalness: 0, envMapIntensity: 0.5 }))
    roadMaterial.normalScale.set(0.7, 0.7)
  } else {
    const { map, roughness } = asphalt()
    map.repeat.set(1, 1)
    roadMaterial = new MeshStandardMaterial({ map, roughnessMap: roughness, roughness: 1, metalness: 0.05, envMapIntensity: 1.6 })
  }
  const road = new Mesh(ribbon(track, -wall, wall, 0, 12, 1.4), roadMaterial)
  road.receiveShadow = true
  group.add(road)
  group.userData.road = road.material

  // Painted lines: solid edges and a dashed centre line.
  const lines: Parameters<typeof quads>[1] = []
  const step = Math.round(6 / track.spacing)
  for (let i = 0; i < track.n; i += step) {
    if ((i / step) % 2 === 0) lines.push({ from: i, to: i + step, inner: -0.12, outer: 0.12, y: 0.02 })
  }
  for (let i = 0; i < track.n; i++) {
    for (const d of [-half + 0.3, half - 0.3]) lines.push({ from: i, to: i + 1, inner: d - 0.14, outer: d + 0.14, y: 0.02 })
  }
  const paintMaterial = new MeshStandardMaterial({ color: day ? '#bdbcb4' : '#cfd2da', roughness: day ? 0.85 : 0.6 })
  const paint = new Mesh(quads(track, lines), day ? misty(paintMaterial) : paintMaterial)
  paint.receiveShadow = true
  group.add(paint)

  // Red and white kerbs on the inside of the sharper corners.
  const kerbs: Parameters<typeof quads>[1] = []
  const red = new Color('#e8303a')
  const white = new Color('#f0f0f0')
  for (let i = 0; i < track.n; i += 2) {
    const side = kerbSide(track, i)
    if (side === 0) continue
    const color = (i / 2) % 2 === 0 ? red : white
    kerbs.push({ from: i, to: i + 2, inner: side * (half - KERB_IN), outer: side * (half + KERB_OUT), y: 0.03, color })
  }
  if (kerbs.length) group.add(new Mesh(quads(track, kerbs), new MeshStandardMaterial({ vertexColors: true, roughness: 0.5 })))

  if (day) {
    guardRails(track, wall, group)
    addStart(track, wall, group)
    return group
  }

  // Barriers: a dark wall with a neon strip along the top that changes
  // colour section by section.
  for (const side of [-1, 1]) {
    const d = side * wall
    const wallGeo = new BufferGeometry()
    const rows = track.n + 1
    const pos = new Float32Array(rows * 2 * 3)
    const strip = new Float32Array(rows * 2 * 3)
    const col = new Float32Array(rows * 2 * 3)
    for (let r = 0; r < rows; r++) {
      const i = r % track.n
      const x = track.x[i] + d * track.nx[i]
      const z = track.z[i] + d * track.nz[i]
      pos.set([x, 0, z, x, 0.95, z], r * 6)
      strip.set([x, 0.95, z, x, 1.12, z], r * 6)
      const c = new Color(NEON[Math.floor((i / track.n) * NEON.length * 2) % NEON.length])
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], r * 6)
    }
    const index: number[] = []
    for (let r = 0; r < track.n; r++) index.push(r * 2, r * 2 + 2, r * 2 + 1, r * 2 + 1, r * 2 + 2, r * 2 + 3)
    wallGeo.setAttribute('position', new BufferAttribute(pos, 3))
    wallGeo.setIndex(index)
    wallGeo.computeVertexNormals()
    group.add(new Mesh(wallGeo, new MeshStandardMaterial({ color: '#1a1c24', roughness: 0.4, metalness: 0.6, side: DoubleSide })))
    const stripGeo = new BufferGeometry()
    stripGeo.setAttribute('position', new BufferAttribute(strip, 3))
    stripGeo.setAttribute('color', new BufferAttribute(col, 3))
    stripGeo.setIndex(index)
    group.add(new Mesh(stripGeo, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, toneMapped: false })))
  }

  // Street lights on alternating sides, each with a pool of light on the road.
  const rng = createRng(`lamps/${track.seed}`)
  const every = Math.round(34 / track.spacing)
  const lamps: { x: number; z: number; ax: number; az: number }[] = []
  for (let i = 0; i < track.n; i += every) {
    const side = (i / every) % 2 === 0 ? 1 : -1
    const d = side * (wall + 1.2)
    lamps.push({ x: track.x[i] + d * track.nx[i], z: track.z[i] + d * track.nz[i], ax: -side * track.nx[i], az: -side * track.nz[i] })
  }
  const pole = new InstancedMesh(new CylinderGeometry(0.1, 0.14, 8, 6), new MeshStandardMaterial({ color: '#2a2d36', metalness: 0.7, roughness: 0.4 }), lamps.length)
  const head = new InstancedMesh(new BoxGeometry(0.5, 0.18, 1.6), new MeshBasicMaterial({ color: new Color('#ffe2b0').multiplyScalar(3), toneMapped: false }), lamps.length)
  const pool = new InstancedMesh(
    new PlaneGeometry(13, 13).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ map: spot(), color: '#ffb06a', transparent: true, opacity: 0.2, blending: AdditiveBlending, depthWrite: false }),
    lamps.length,
  )
  const m = new Matrix4()
  const o = new Object3D()
  lamps.forEach((lamp, k) => {
    m.makeTranslation(lamp.x, 4, lamp.z)
    pole.setMatrixAt(k, m)
    o.position.set(lamp.x + lamp.ax * 1.4, 8, lamp.z + lamp.az * 1.4)
    o.rotation.set(0, Math.atan2(lamp.ax, lamp.az), 0)
    o.updateMatrix()
    head.setMatrixAt(k, o.matrix)
    m.makeTranslation(lamp.x + lamp.ax * 4.5, 0.05 + rng() * 0.01, lamp.z + lamp.az * 4.5)
    pool.setMatrixAt(k, m)
  })
  pool.renderOrder = 1
  // Every lamp starts lit. A dusk race turns them off and on one by one
  // through these colours.
  const lit = new Color('#ffffff')
  for (let k = 0; k < lamps.length; k++) {
    head.setColorAt(k, lit)
    pool.setColorAt(k, lit)
  }
  group.userData.lamps = { head, pool }
  group.add(pole, head, pool)

  addStart(track, wall, group)
  return group
}

// Steel crash barrier on posts, like a mountain road: a galvanised rail on
// each side, with the post every 2.5 m.
function guardRails(track: Track, wall: number, group: Group) {
  const metal = misty(new MeshStandardMaterial({ color: '#c3c8cc', metalness: 0.85, roughness: 0.32, side: DoubleSide }))
  for (const side of [-1, 1]) {
    for (const [y0, y1] of [
      [0.52, 0.86],
      [0.86, 0.9],
    ]) {
      const rows = track.n + 1
      const pos = new Float32Array(rows * 2 * 3)
      for (let r = 0; r < rows; r++) {
        const i = r % track.n
        // The lip leans out a little, like the fold of a W-beam rail.
        const d = side * (wall + (y0 > 0.8 ? 0.06 : 0))
        const x = track.x[i] + d * track.nx[i]
        const z = track.z[i] + d * track.nz[i]
        pos.set([x, y0, z, x, y1, z], r * 6)
      }
      const index: number[] = []
      for (let r = 0; r < track.n; r++) index.push(r * 2, r * 2 + 2, r * 2 + 1, r * 2 + 1, r * 2 + 2, r * 2 + 3)
      const geo = new BufferGeometry()
      geo.setAttribute('position', new BufferAttribute(pos, 3))
      geo.setIndex(index)
      geo.computeVertexNormals()
      const rail = new Mesh(geo, metal)
      rail.castShadow = true
      rail.receiveShadow = true
      group.add(rail)
    }
  }
  const every = Math.max(1, Math.round(2.5 / track.spacing))
  const count = Math.ceil(track.n / every) * 2
  const posts = new InstancedMesh(new BoxGeometry(0.14, 0.9, 0.14), misty(new MeshStandardMaterial({ color: '#8f969c', metalness: 0.7, roughness: 0.45 })), count)
  const m = new Matrix4()
  let k = 0
  for (let i = 0; i < track.n; i += every) {
    for (const side of [-1, 1]) {
      const d = side * (wall + 0.12)
      m.makeTranslation(track.x[i] + d * track.nx[i], 0.45, track.z[i] + d * track.nz[i])
      posts.setMatrixAt(k++, m)
    }
  }
  posts.count = k
  posts.castShadow = true
  group.add(posts)
}

function addStart(track: Track, wall: number, group: Group) {
  // Start line and the gantry over it.
  const sx = track.x[0]
  const sz = track.z[0]
  const angle = Math.atan2(track.tx[0], track.tz[0])
  const line = new Mesh(new PlaneGeometry(track.width, 2).rotateX(-Math.PI / 2), new MeshStandardMaterial({ map: checker(), roughness: 0.5 }))
  line.position.set(sx, 0.025, sz)
  line.rotation.y = angle
  group.add(line)
  const gantry = new Group()
  const legGeo = new BoxGeometry(0.8, 9, 0.8)
  const legMat = new MeshStandardMaterial({ color: '#1d2029', metalness: 0.8, roughness: 0.3 })
  for (const side of [-1, 1]) {
    const leg = new Mesh(legGeo, legMat)
    leg.position.set(side * (wall + 0.8), 4.5, 0)
    gantry.add(leg)
  }
  const beam = new Mesh(new BoxGeometry(wall * 2 + 2.4, 1.6, 0.9), legMat)
  beam.position.y = 8.6
  const face = new Mesh(new PlaneGeometry(track.width + 2, (track.width + 2) / 8), new MeshBasicMaterial({ map: banner(), toneMapped: false }))
  face.position.set(0, 8.6, -0.46)
  face.rotation.y = Math.PI
  const back = face.clone()
  back.position.z = 0.46
  back.rotation.y = 0
  gantry.add(beam, face, back)
  gantry.position.set(sx, 0, sz)
  gantry.rotation.y = angle
  group.add(gantry)
}
