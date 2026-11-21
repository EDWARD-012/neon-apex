import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture, TextureLoader } from 'three'

// Surface detail for the cockpit. Most of it is drawn once in the browser:
// height fields for leather grain, suede, perforated grips, carbon weave,
// brushed metal and soft-touch plastic, turned into normal and roughness
// maps, plus the carbon weave's colour and the windscreen's dust. The
// leather and the suede also have photographed maps (photoTextures, below)
// that replace the drawn ones once they have loaded. All of them tile.

let seed = 1
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647

const at = (n: number, x: number, y: number) => ((y + n) % n) * n + ((x + n) % n)

// A normal map from a height field: the slope across and down each texel.
function normals(h: Float32Array, n: number, strength: number) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = n
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  const image = g.createImageData(n, n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (h[at(n, x + 1, y)] - h[at(n, x - 1, y)]) * strength
      // Canvas rows run down while texture v runs up.
      const dy = (h[at(n, x, y - 1)] - h[at(n, x, y + 1)]) * strength
      const len = Math.hypot(dx, dy, 1)
      const i = (y * n + x) * 4
      image.data[i] = ((-dx / len) * 0.5 + 0.5) * 255
      image.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255
      image.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255
      image.data[i + 3] = 255
    }
  }
  g.putImageData(image, 0, 0)
  return tiled(new CanvasTexture(canvas))
}

// A grey map (roughness, or anything read as a single channel) from values
// between 0 and 1.
function grey(v: Float32Array, n: number) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = n
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  const image = g.createImageData(n, n)
  for (let i = 0; i < n * n; i++) {
    const c = Math.max(0, Math.min(255, v[i] * 255))
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = c
    image.data[i * 4 + 3] = 255
  }
  g.putImageData(image, 0, 0)
  return tiled(new CanvasTexture(canvas))
}

function tiled(t: Texture) {
  t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = 4
  return t
}

// Smooth tiling value noise, for soft variation.
function noise(n: number, cells: number) {
  const grid = Array.from({ length: cells * cells }, () => random())
  const out = new Float32Array(n * n)
  const s = (t: number) => t * t * (3 - 2 * t)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const gx = (x / n) * cells
      const gy = (y / n) * cells
      const x0 = Math.floor(gx)
      const y0 = Math.floor(gy)
      const tx = s(gx - x0)
      const ty = s(gy - y0)
      const v = (i: number, j: number) => grid[((j + cells) % cells) * cells + ((i + cells) % cells)]
      const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx
      const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx
      out[y * n + x] = a + (b - a) * ty
    }
  }
  return out
}

// Leather: small irregular pebbles with creases between them (the gap
// between the nearest and the second-nearest of scattered points), and a
// gentle unevenness over the top.
function leatherHeight(n: number, cells: number) {
  const pts: number[][][] = []
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const list: number[][] = []
      const count = 1 + Math.floor(random() * 2)
      for (let k = 0; k < count; k++) list.push([(i + random()) / cells, (j + random()) / cells])
      pts.push(list)
    }
  }
  const soft = noise(n, 8)
  const h = new Float32Array(n * n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n
      const v = y / n
      const ci = Math.floor(u * cells)
      const cj = Math.floor(v * cells)
      let f1 = 9
      let f2 = 9
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = (ci + di + cells) % cells
          const jj = (cj + dj + cells) % cells
          for (const [px, py] of pts[jj * cells + ii]) {
            // Wrap the point next to this cell so the pattern tiles.
            const wx = px + Math.round(u - px)
            const wy = py + Math.round(v - py)
            const d = Math.hypot(u - wx, v - wy)
            if (d < f1) {
              f2 = f1
              f1 = d
            } else if (d < f2) f2 = d
          }
        }
      }
      const edge = Math.min(1, ((f2 - f1) * cells) / 0.35)
      h[y * n + x] = Math.sqrt(edge) * 0.85 + soft[y * n + x] * 0.15
    }
  }
  return h
}

// Normal and roughness maps scanned from real leather and suede: CC0 from
// Poly Haven, shrunk to 512 px (about 310 KB for the four). They load only
// when a cockpit is first built; until then, or if they never arrive, the
// drawn grain stays.
export interface PhotoTextures {
  leatherNormal: Texture
  leatherRough: Texture
  suedeNormal: Texture
  suedeRough: Texture
}

// How big one tile of each scan is on the real material, in metres.
export const PHOTO_TILE = { leather: 0.3, suede: 0.285 }

let photos: Promise<PhotoTextures | null> | null = null

export function photoTextures(): Promise<PhotoTextures | null> {
  photos ??= Promise.all(['leather-normal', 'leather-rough', 'suede-normal', 'suede-rough'].map((name) => new TextureLoader().loadAsync(`${import.meta.env.BASE_URL}textures/cabin-${name}.jpg`).then(tiled)))
    .then(([leatherNormal, leatherRough, suedeNormal, suedeRough]) => ({ leatherNormal, leatherRough, suedeNormal, suedeRough }))
    .catch(() => null)
  return photos
}

export interface CabinTextures {
  leatherNormal: Texture
  leatherRough: Texture
  suedeNormal: Texture
  perforatedNormal: Texture
  perforatedRough: Texture
  carbonColor: Texture
  carbonNormal: Texture
  brushedNormal: Texture
  brushedRough: Texture
  plasticNormal: Texture
  dust: Texture
}

let made: CabinTextures | null = null

export function cabinTextures(): CabinTextures {
  if (made) return made
  seed = 7

  // Leather: pebbles about a millimetre across at the repeat the cockpit
  // uses, creases a little rougher than the tops.
  const n = 256
  const leather = leatherHeight(n, 40)
  const leatherRough = new Float32Array(n * n)
  for (let i = 0; i < n * n; i++) leatherRough[i] = 0.62 + (1 - leather[i]) * 0.25

  // Suede (the steering wheel's top and the pillars): fine fibres with no
  // pattern, only a short soft noise.
  const suede = new Float32Array(n * n)
  const fibres = noise(n, 64)
  for (let i = 0; i < n * n; i++) suede[i] = fibres[i] * 0.6 + random() * 0.4

  // Perforated leather on the grips: a staggered grid of small holes in
  // the grain.
  const perforated = new Float32Array(n * n)
  const perforatedRough = new Float32Array(n * n)
  const step = n / 16
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const row = Math.floor(y / step)
      const ox = row % 2 ? step / 2 : 0
      const cx = (Math.floor((x - ox) / step) + 0.5) * step + ox
      const cy = (row + 0.5) * step
      const d = Math.hypot(x - cx, y - cy) / (step * 0.22)
      const hole = d < 1 ? 1 - Math.min(1, (1 - d) * 3) : 1
      perforated[y * n + x] = leather[y * n + x] * 0.4 + hole * 0.6
      perforatedRough[y * n + x] = d < 1 ? 1 : 0.6 + (1 - leather[y * n + x]) * 0.25
    }
  }

  // Carbon: a 2x2 twill of tows, each tow rounded across its width, with
  // the two directions catching the light differently.
  const c = 256
  const tows = 16
  const carbonHeight = new Float32Array(c * c)
  const carbon = document.createElement('canvas')
  carbon.width = carbon.height = c
  const cg = carbon.getContext('2d') as CanvasRenderingContext2D
  const image = cg.createImageData(c, c)
  const size = c / tows
  for (let y = 0; y < c; y++) {
    for (let x = 0; x < c; x++) {
      const i = Math.floor(x / size)
      const j = Math.floor(y / size)
      const across = (i + (j % 4 < 2 ? 0 : 2) + j) % 4 < 2
      const t = across ? (y % size) / size : (x % size) / size
      const along = across ? (x % size) / size : (y % size) / size
      const bulge = Math.sin(t * Math.PI)
      carbonHeight[y * c + x] = bulge * (0.85 + 0.15 * Math.sin(along * Math.PI))
      const base = across ? 26 : 40
      const shade = base + bulge * (across ? 22 : 30) + random() * 4
      const k = (y * c + x) * 4
      image.data[k] = shade
      image.data[k + 1] = shade + 2
      image.data[k + 2] = shade + 6
      image.data[k + 3] = 255
    }
  }
  cg.putImageData(image, 0, 0)
  const carbonColor = tiled(new CanvasTexture(carbon))
  carbonColor.colorSpace = SRGBColorSpace

  // Brushed metal: long fine streaks running one way.
  const brushed = new Float32Array(n * n)
  const brushedRough = new Float32Array(n * n)
  const lines = Array.from({ length: n }, () => random())
  const lines2 = Array.from({ length: n }, () => random())
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = lines[y] * 0.7 + lines2[(y * 7) % n] * 0.3
      brushed[y * n + x] = v
      brushedRough[y * n + x] = 0.22 + v * 0.16
    }
  }

  // Soft-touch plastic: a fine stipple.
  const stipple = noise(n, 96)
  for (let i = 0; i < n * n; i++) stipple[i] = stipple[i] * 0.7 + random() * 0.3

  // Windscreen dust: faint smears and specks that show against the light.
  const d = 512
  const dust = document.createElement('canvas')
  dust.width = dust.height = d
  const dg = dust.getContext('2d') as CanvasRenderingContext2D
  dg.fillStyle = '#000'
  dg.fillRect(0, 0, d, d)
  for (let i = 0; i < 70; i++) {
    const x = random() * d
    const y = d * (0.35 + random() * 0.65)
    const r = 20 + random() * 70
    const grad = dg.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `rgba(255,255,255,${0.05 + random() * 0.08})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    dg.fillStyle = grad
    dg.fillRect(x - r, y - r, r * 2, r * 2)
  }
  for (let i = 0; i < 900; i++) {
    dg.fillStyle = `rgba(255,255,255,${0.15 + random() * 0.35})`
    dg.fillRect(random() * d, random() * d, 1 + random(), 1 + random())
  }
  // Two wiper arcs at the bottom.
  dg.strokeStyle = 'rgba(255,255,255,0.08)'
  dg.lineWidth = 14
  for (const cx of [d * 0.3, d * 0.72]) {
    dg.beginPath()
    dg.arc(cx, d * 1.05, d * 0.36, Math.PI * 1.08, Math.PI * 1.92)
    dg.stroke()
  }
  const dustTexture = new CanvasTexture(dust)
  dustTexture.colorSpace = SRGBColorSpace

  made = {
    leatherNormal: normals(leather, n, 2.2),
    leatherRough: grey(leatherRough, n),
    suedeNormal: normals(suede, n, 1.4),
    perforatedNormal: normals(perforated, n, 3),
    perforatedRough: grey(perforatedRough, n),
    carbonColor,
    carbonNormal: normals(carbonHeight, c, 3.5),
    brushedNormal: normals(brushed, n, 0.8),
    brushedRough: grey(brushedRough, n),
    plasticNormal: normals(stipple, n, 1.2),
    dust: dustTexture,
  }
  return made
}
