import { EquirectangularReflectionMapping, FloatType, PMREMGenerator, RepeatWrapping, SRGBColorSpace, type Texture, TextureLoader, type WebGLRenderer } from 'three'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'

// Photo textures and the daytime sky. They come from Poly Haven (CC0) and
// sit in public/textures. Everything else in the game is drawn in code.

const loader = new TextureLoader()
const base = `${import.meta.env.BASE_URL}textures/`

export interface Pbr {
  map: Texture
  normalMap: Texture
  roughnessMap: Texture
}

const cache = new Map<string, Pbr>()

// Low quality, which phones start on, loads half-size colour and normal
// maps from textures/small (made by scripts/small-textures.mjs): about
// 360 KB for the three materials instead of about 5 MB. It applies to
// textures loaded after it is set; ones already loaded stay as they are.
let small = false
export function useSmallTextures(on: boolean) {
  small = on
}

// A material's colour, normal and roughness maps, tiled `repeat` times.
// The textures are returned at once and fill in when they arrive.
export function pbr(name: 'road' | 'rock' | 'ground', repeatU: number, repeatV = repeatU): Pbr {
  const key = `${name}/${repeatU}/${repeatV}`
  const hit = cache.get(key)
  if (hit) return hit
  const one = (suffix: string, color: boolean) => {
    const t = loader.load(`${base}${small && suffix !== 'rough' ? 'small/' : ''}${name}-${suffix}.jpg`)
    t.wrapS = RepeatWrapping
    t.wrapT = RepeatWrapping
    t.repeat.set(repeatU, repeatV)
    t.anisotropy = 8
    if (color) t.colorSpace = SRGBColorSpace
    return t
  }
  const set = { map: one('color', true), normalMap: one('normal', false), roughnessMap: one('rough', false) }
  cache.set(key, set)
  return set
}

// The sky photo, as a background and as a blurred environment map for
// reflections on paint, glass and chrome.
let sky: Promise<{ background: Texture; environment: Texture }> | null = null
export function daySky(renderer: WebGLRenderer) {
  sky ??= new HDRLoader().setDataType(FloatType).loadAsync(`${base}sky.hdr`).then((hdr) => {
    hdr.mapping = EquirectangularReflectionMapping
    // The sun in the photo is tens of thousands of times brighter than the
    // sky. Mirror-smooth clear coat reflects it straight back, and values
    // that large overflow the half-float image the bloom works on and turn
    // the whole frame black. The scene has its own sun light for highlights,
    // so the photo's peak is capped.
    const data = hdr.image.data as Float32Array
    for (let i = 0; i < data.length; i++) if (data[i] > 48) data[i] = 48
    hdr.needsUpdate = true
    const pmrem = new PMREMGenerator(renderer)
    const environment = pmrem.fromEquirectangular(hdr).texture
    pmrem.dispose()
    return { background: hdr, environment }
  })
  return sky
}
