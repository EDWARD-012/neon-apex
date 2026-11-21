import { Color, type MeshBasicMaterial, type MeshStandardMaterial } from 'three'
import { hashSeed } from '../sim/rng'
import { sky } from './textures'
import type { World } from './world'

// Weather and time of day. Each preset sets the fog, the light, how wet and
// mirror-like the road is, how many windows are lit, and whether it rains.
// "day" is the mountain road in sunshine; the others are the city at night.

export type Weather = 'day' | 'clear' | 'rain' | 'dusk'
export const WEATHERS: Weather[] = ['day', 'clear', 'rain', 'dusk']
export const isDay = (w: Weather) => w === 'day'

interface Preset {
  fog: string
  density: number
  sky: string
  ground: string
  ambient: number
  moon: number
  exposure: number
  // Multiplies the road's roughness map. Low means a mirror-wet road.
  roadRoughness: number
  roadReflection: number
  roadTint: string
  windows: number
  rain: boolean
  // How see-through the road and the ground are over the street mirror.
  // Only used on high quality, where the mirror exists.
  roadOpacity: number
  groundOpacity: number
}

const PRESETS: Record<Weather, Preset> = {
  day: { fog: '#b9cbdd', density: 0.00042, sky: '#cfe2ff', ground: '#5b4e3c', ambient: 0.55, moon: 3.1, exposure: 0.82, roadRoughness: 1, roadReflection: 0.5, roadTint: '#ffffff', windows: 0, rain: false, roadOpacity: 1, groundOpacity: 1 },
  clear: { fog: '#0b0c1d', density: 0.0026, sky: '#4a5cb0', ground: '#120f18', ambient: 0.7, moon: 0.55, exposure: 1.15, roadRoughness: 1, roadReflection: 1.6, roadTint: '#ffffff', windows: 1.05, rain: false, roadOpacity: 0.86, groundOpacity: 0.9 },
  rain: { fog: '#11121c', density: 0.0048, sky: '#5a5f80', ground: '#141218', ambient: 0.6, moon: 0.25, exposure: 1.1, roadRoughness: 0.32, roadReflection: 3.4, roadTint: '#9a9aa6', windows: 1.15, rain: true, roadOpacity: 0.55, groundOpacity: 0.62 },
  dusk: { fog: '#3b2440', density: 0.0021, sky: '#ff9a7a', ground: '#2a1a2a', ambient: 1.1, moon: 0.9, exposure: 1.0, roadRoughness: 0.85, roadReflection: 2.0, roadTint: '#ffffff', windows: 0.55, rain: false, roadOpacity: 0.8, groundOpacity: 0.85 },
}

export function applyWeather(world: World, weather: Weather, road: MeshStandardMaterial, facade: MeshStandardMaterial | null, dome: MeshBasicMaterial | null, ground?: MeshStandardMaterial, mirror = false) {
  const p = PRESETS[weather]
  world.setDay(isDay(weather))
  // Over the street mirror the road and ground let some reflection through.
  for (const [m, o] of [
    [road, p.roadOpacity],
    [ground, p.groundOpacity],
  ] as const) {
    if (!m) continue
    m.transparent = mirror
    m.opacity = mirror ? o : 1
    m.needsUpdate = true
  }
  world.setFog(p.fog, p.density, !isDay(weather))
  world.setLight(p.sky, p.ground, p.ambient, p.moon)
  world.renderer.toneMappingExposure = p.exposure
  road.roughness = p.roadRoughness
  road.envMapIntensity = p.roadReflection
  road.color.set(p.roadTint)
  if (facade) facade.emissiveIntensity = p.windows
  if (dome && !isDay(weather)) {
    dome.map?.dispose()
    dome.map = sky(weather as 'clear' | 'rain' | 'dusk')
    // Untinted, in case the last race was a dusk one that fell to night.
    dome.color.set('#ffffff')
    dome.needsUpdate = true
  }
  return p.rain
}

// A dusk race gets darker as it goes: over this many seconds the light
// moves from the dusk preset to the clear night's.
export const NIGHTFALL = 150

const from = new Color()
const to = new Color()
const hex = (a: string, b: string, t: number) => `#${from.set(a).lerp(to.set(b), t).getHexString()}`

// The light part of the way, t from 0 to 1, from dusk to clear night: the
// fog, the sky and ground light, the moon, the exposure, the road's sheen,
// the lit windows, and the painted sky dimming towards night blue.
export function nightfall(world: World, t: number, road: MeshStandardMaterial, facade: MeshStandardMaterial | null, dome: MeshBasicMaterial | null) {
  const p = PRESETS.dusk
  const q = PRESETS.clear
  const mix = (a: number, b: number) => a + (b - a) * t
  world.setFog(hex(p.fog, q.fog, t), mix(p.density, q.density), true)
  world.setLight(hex(p.sky, q.sky, t), hex(p.ground, q.ground, t), mix(p.ambient, q.ambient), mix(p.moon, q.moon))
  world.renderer.toneMappingExposure = mix(p.exposure, q.exposure)
  road.roughness = mix(p.roadRoughness, q.roadRoughness)
  road.envMapIntensity = mix(p.roadReflection, q.roadReflection)
  if (facade) facade.emissiveIntensity = mix(p.windows, q.windows)
  if (dome) dome.color.set(hex('#ffffff', '#3c4678', t))
}

// The weather for a track when the player leaves it on automatic: the same
// for everyone on the same track.
export function weatherFor(seed: string): Weather {
  const roll = hashSeed(`weather/${seed}`) % 10
  return roll < 5 ? 'day' : roll < 7 ? 'clear' : roll < 9 ? 'rain' : 'dusk'
}
