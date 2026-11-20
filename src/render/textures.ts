import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
import { createRng, type Rng } from '../sim/rng'

// Every texture in the game is drawn on a canvas at load time, so the repo
// ships no image files for the world.

function canvas(width: number, height: number) {
  const el = document.createElement('canvas')
  el.width = width
  el.height = height
  return { el, g: el.getContext('2d') as CanvasRenderingContext2D }
}

function texture(el: HTMLCanvasElement, color = true): CanvasTexture {
  const t = new CanvasTexture(el)
  if (color) t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  return t
}

function repeat<T extends Texture>(t: T): T {
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  return t
}

// Asphalt and a matching roughness map. Dark low-roughness patches read as
// puddles, which is where the neon gets reflected.
export function asphalt(): { map: CanvasTexture; roughness: CanvasTexture } {
  const rng = createRng('asphalt')
  const size = 512
  const base = canvas(size, size)
  const rough = canvas(size, size)
  base.g.fillStyle = '#26272d'
  base.g.fillRect(0, 0, size, size)
  rough.g.fillStyle = '#b0b0b0'
  rough.g.fillRect(0, 0, size, size)
  for (let k = 0; k < 9000; k++) {
    const v = 25 + Math.floor(rng() * 40)
    base.g.fillStyle = `rgb(${v},${v},${v + 4})`
    base.g.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2)
  }
  for (let k = 0; k < 14; k++) {
    const x = rng() * size
    const y = rng() * size
    const r = 20 + rng() * 70
    const puddle = rough.g.createRadialGradient(x, y, 0, x, y, r)
    puddle.addColorStop(0, 'rgba(25,25,25,0.95)')
    puddle.addColorStop(1, 'rgba(25,25,25,0)')
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        rough.g.save()
        rough.g.translate(ox, oy)
        rough.g.fillStyle = puddle
        rough.g.fillRect(x - r, y - r, r * 2, r * 2)
        rough.g.restore()
      }
    }
  }
  return { map: repeat(texture(base.el)), roughness: repeat(texture(rough.el, false)) }
}

// A tower facade: rows of windows, some lit. Returned as a colour map and an
// emissive map. The top-left corner is left dark so roofs can use it.
export function facade(seed: string): { map: CanvasTexture; glow: CanvasTexture } {
  const rng = createRng(`facade/${seed}`)
  const w = 512
  const h = 1024
  const base = canvas(w, h)
  const glow = canvas(w, h)
  base.g.fillStyle = '#12141c'
  base.g.fillRect(0, 0, w, h)
  glow.g.fillStyle = '#000'
  glow.g.fillRect(0, 0, w, h)
  const cols = 16
  const rows = 32
  const cw = w / cols
  const ch = h / rows
  const tints = ['#ffd49a', '#ffe7c2', '#a8dcff', '#ffb36b', '#ff8fd0', '#c9f1ff']
  for (let r = 0; r < rows; r++) {
    // Whole floors tend to be lit or dark together.
    const floor = rng()
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c < 2) continue
      const x = c * cw + cw * 0.18
      const y = r * ch + ch * 0.22
      const ww = cw * 0.64
      const wh = ch * 0.5
      base.g.fillStyle = '#1b1f2b'
      base.g.fillRect(x, y, ww, wh)
      if (rng() < 0.18 + floor * 0.35) {
        const tint = tints[Math.floor(rng() * (rng() < 0.8 ? 3 : tints.length))]
        glow.g.fillStyle = tint
        glow.g.globalAlpha = 0.45 + rng() * 0.55
        glow.g.fillRect(x, y, ww, wh)
        glow.g.globalAlpha = 1
      }
    }
  }
  return { map: repeat(texture(base.el)), glow: repeat(texture(glow.el)) }
}

// Soft round spot, white in the middle and clear at the edge. Used for light
// pools, underglow, smoke and the shadow under each car.
export function spot(): CanvasTexture {
  const { el, g } = canvas(128, 128)
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return texture(el, false)
}

export function checker(): CanvasTexture {
  const { el, g } = canvas(256, 32)
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#f2f2f2' : '#111'
      g.fillRect(x * 16, y * 16, 16, 16)
    }
  }
  const t = texture(el)
  t.magFilter = 1003 // NearestFilter keeps the squares crisp
  return t
}

// A neon sign: glowing letters in a thin frame on a dark panel.
export function sign(text: string, color: string): CanvasTexture {
  const { el, g } = canvas(512, 160)
  g.fillStyle = 'rgba(8,8,14,0.85)'
  g.fillRect(0, 0, 512, 160)
  g.strokeStyle = color
  g.lineWidth = 5
  g.shadowColor = color
  g.shadowBlur = 18
  g.strokeRect(14, 14, 484, 132)
  g.font = `700 ${text.length > 9 ? 64 : 84}px "Chakra Petch", sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#fff'
  g.shadowBlur = 26
  g.fillText(text, 256, 84)
  g.fillStyle = color
  g.shadowBlur = 8
  g.fillText(text, 256, 84)
  return texture(el)
}

// The night sky behind everything: a gradient with a purple city glow on the
// horizon and a scatter of faint stars.
export function sky(kind: 'clear' | 'rain' | 'dusk' | 'day' = 'clear'): CanvasTexture {
  const rng: Rng = createRng('sky')
  const { el, g } = canvas(64, 512)
  const grad = g.createLinearGradient(0, 0, 0, 512)
  const stops: Record<string, [number, string][]> = {
    clear: [[0, '#02030a'], [0.42, '#070a1e'], [0.5, '#2a1240'], [0.53, '#3b1446'], [0.6, '#0b0b16'], [1, '#050508']],
    // Low cloud lit orange from below by the city.
    rain: [[0, '#07080d'], [0.38, '#151622'], [0.5, '#3a2a30'], [0.54, '#3d2d2c'], [0.6, '#0e0e14'], [1, '#050508']],
    // Last light: deep violet overhead, hot pink and orange at the horizon.
    dusk: [[0, '#14103a'], [0.3, '#3a1e5c'], [0.44, '#a83d6e'], [0.5, '#ff7a4d'], [0.53, '#ffb067'], [0.6, '#2b1630'], [1, '#0a0710']],
    // A plain daylight sky for low graphics, where the sky photo is not used.
    day: [[0, '#2c64b0'], [0.3, '#5d93d4'], [0.47, '#b7d1ec'], [0.5, '#d8e6f2'], [0.52, '#9fae8c'], [1, '#56603f']],
  }
  for (const [at, color] of stops[kind]) grad.addColorStop(at, color)
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 512)
  if (kind === 'clear') {
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + rng() * 0.5})`
      g.fillRect(rng() * 64, rng() * 200, 1, 1)
    }
  }
  return texture(el)
}

// A long strip of text for the scrolling billboards. The texture repeats
// sideways, so moving its offset makes the text run.
export function ticker(text: string, color: string): CanvasTexture {
  const { el, g } = canvas(2048, 128)
  g.fillStyle = '#05050a'
  g.fillRect(0, 0, 2048, 128)
  g.font = 'italic 700 84px "Chakra Petch", sans-serif'
  g.textBaseline = 'middle'
  g.shadowColor = color
  g.shadowBlur = 22
  g.fillStyle = color
  let x = 20
  while (x < 2048) {
    g.fillText(text, x, 68)
    x += g.measureText(text).width + 80
  }
  const t = texture(el)
  t.wrapS = RepeatWrapping
  return t
}

// A vertical fade for alpha maps: solid at the top of the texture, clear at
// the bottom.
export function fade(): CanvasTexture {
  const { el, g } = canvas(4, 256)
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#000')
  grad.addColorStop(0.02, '#fff')
  grad.addColorStop(0.3, '#777')
  grad.addColorStop(1, '#000')
  g.fillStyle = grad
  g.fillRect(0, 0, 4, 256)
  return texture(el, false)
}

// The banner over the start line.
export function banner(): CanvasTexture {
  const { el, g } = canvas(1024, 128)
  g.fillStyle = '#07070d'
  g.fillRect(0, 0, 1024, 128)
  g.font = 'italic 700 92px "Chakra Petch", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.shadowColor = '#ff2d95'
  g.shadowBlur = 30
  g.fillStyle = '#ff5fb0'
  g.fillText('NEON APEX', 512, 68)
  g.shadowColor = '#3df5ff'
  g.shadowBlur = 0
  g.fillStyle = '#ffffff'
  g.globalAlpha = 0.6
  g.fillText('NEON APEX', 512, 68)
  return texture(el)
}
