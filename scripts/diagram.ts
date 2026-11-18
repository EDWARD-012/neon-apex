// Draws docs/racing-line.svg: on the left the whole track from above, on the
// right a close-up of its tightest corner with the road edges, the centre
// line dashed, and the racing line coloured by the speed the profile plans.
// Run with: npm run diagram
import { writeFileSync } from 'node:fs'
import { CAR } from '../src/sim/car'
import { racingLine } from '../src/sim/line'
import { buildTrack } from '../src/sim/track'

// Slow is cyan, flat out is pink.
function color(v: number) {
  const t = Math.max(0, Math.min(1, (v - 15) / (CAR.topSpeed - 15)))
  const a = [61, 245, 255]
  const b = [255, 45, 149]
  return `rgb(${a.map((c, k) => Math.round(c + (b[k] - c) * t)).join(',')})`
}

export function diagram(seed = 'random-K2Q7M'): string {
  const track = buildTrack(seed)
  const line = racingLine(track)
  const n = track.n
  const half = track.width / 2
  let tight = 0
  for (let i = 0; i < n; i++) if (Math.abs(track.curvature[i]) > Math.abs(track.curvature[tight])) tight = i
  const span = 75
  const window = Array.from({ length: span * 2 + 1 }, (_, k) => (tight - span + k + n) % n)

  const W = 1000
  const H = 600
  const map = { x: 20, y: 60, size: 300 }
  const zoom = { x: 360, y: 60, w: 620, h: 500 }

  // Whole track, fitted into the left square.
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, track.x[i])
    maxX = Math.max(maxX, track.x[i])
    minZ = Math.min(minZ, track.z[i])
    maxZ = Math.max(maxZ, track.z[i])
  }
  const ms = map.size / Math.max(maxX - minX, maxZ - minZ)
  const mx = (x: number) => (map.x + (x - minX) * ms).toFixed(1)
  const mz = (z: number) => (map.y + (z - minZ) * ms).toFixed(1)
  let outline = ''
  for (let i = 0; i <= n; i += 2) outline += `${i ? 'L' : 'M'}${mx(track.x[i % n])} ${mz(track.z[i % n])}`

  // Close-up of the tightest corner.
  const edge = (i: number, d: number): [number, number] => [track.x[i] + d * track.nx[i], track.z[i] + d * track.nz[i]]
  let zx0 = Infinity
  let zx1 = -Infinity
  let zz0 = Infinity
  let zz1 = -Infinity
  for (const i of window) {
    for (const d of [-half, half]) {
      const [x, z] = edge(i, d)
      zx0 = Math.min(zx0, x)
      zx1 = Math.max(zx1, x)
      zz0 = Math.min(zz0, z)
      zz1 = Math.max(zz1, z)
    }
  }
  const zs = Math.min(zoom.w / (zx1 - zx0), zoom.h / (zz1 - zz0))
  const ox = zoom.x + (zoom.w - (zx1 - zx0) * zs) / 2
  const oz = zoom.y + (zoom.h - (zz1 - zz0) * zs) / 2
  const zxp = (x: number) => (ox + (x - zx0) * zs).toFixed(1)
  const zzp = (z: number) => (oz + (z - zz0) * zs).toFixed(1)
  const road = [...window.map((i) => edge(i, -half)), ...window.slice().reverse().map((i) => edge(i, half))]
  const roadPath = road.map(([x, z], k) => `${k ? 'L' : 'M'}${zxp(x)} ${zzp(z)}`).join('') + 'Z'
  const centre = window.map((i, k) => `${k ? 'L' : 'M'}${zxp(track.x[i])} ${zzp(track.z[i])}`).join('')
  let racing = ''
  for (let k = 0; k + 1 < window.length; k++) {
    const i = window[k]
    const j = window[k + 1]
    racing += `<line x1="${zxp(line.x[i])}" y1="${zzp(line.z[i])}" x2="${zxp(line.x[j])}" y2="${zzp(line.z[j])}" stroke="${color(line.speed[i])}"/>`
  }
  const slowest = window.reduce((a, i) => (line.speed[i] < line.speed[a] ? i : a), window[0])
  // The zoomed stretch, marked on the map.
  const marked = window.map((i, k) => `${k ? 'L' : 'M'}${mx(track.x[i])} ${mz(track.z[i])}`).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif">
<rect width="100%" height="100%" fill="#07080f"/>
<text x="20" y="34" fill="#eef0ff" font-size="20" font-weight="bold">Racing line on track "${seed}" (${track.length} m)</text>
<path d="${outline}" fill="none" stroke="#3a3e55" stroke-width="5" stroke-linejoin="round"/>
<path d="${marked}" fill="none" stroke="#ffd23d" stroke-width="5" stroke-linecap="round"/>
<circle cx="${mx(track.x[0])}" cy="${mz(track.z[0])}" r="5" fill="#fff"/>
<text x="${map.x}" y="${map.y + map.size + 28}" fill="#8e93b4" font-size="14">Whole track. White dot: start.</text>
<text x="${map.x}" y="${map.y + map.size + 48}" fill="#8e93b4" font-size="14">Yellow: the corner on the right.</text>
<path d="${roadPath}" fill="#23263a" stroke="#555a78" stroke-width="1.5"/>
<path d="${centre}" fill="none" stroke="#8e93b4" stroke-width="1.5" stroke-dasharray="6 7"/>
<g stroke-width="6" stroke-linecap="round">${racing}</g>
<circle cx="${zxp(line.x[slowest])}" cy="${zzp(line.z[slowest])}" r="7" fill="none" stroke="#fff" stroke-width="2"/>
<text x="${zoom.x}" y="${H - 34}" fill="#c7cbe6" font-size="14">Dashed: centre line. Coloured: the racing line, cyan where the planned speed is</text>
<text x="${zoom.x}" y="${H - 14}" fill="#c7cbe6" font-size="14">lowest (${(line.speed[slowest] * 3.6).toFixed(0)} km/h at the circle) and pink at top speed.</text>
</svg>
`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync('docs/racing-line.svg', diagram())
  console.log('docs/racing-line.svg')
}
