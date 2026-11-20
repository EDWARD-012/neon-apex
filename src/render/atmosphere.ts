import type { MeshBasicMaterial, MeshStandardMaterial } from 'three'
import { hashSeed } from '../sim/rng'
import { sky } from './textures'
import type { World } from './world'

// Weather and time of day. Each preset sets the fog, the light, how wet and
// mirror-like the road is, how many windows are lit, and whether it rains.

export type Weather = 'clear' | 'rain' | 'dusk'
export const WEATHERS: Weather[] = ['clear', 'rain', 'dusk']

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
  clear: { fog: '#0b0c1d', density: 0.0026, sky: '#4a5cb0', ground: '#120f18', ambient: 0.7, moon: 0.55, exposure: 1.15, roadRoughness: 1, roadReflection: 1.6, roadTint: '#ffffff', windows: 1.05, rain: false, roadOpacity: 0.86, groundOpacity: 0.9 },
  rain: { fog: '#11121c', density: 0.0048, sky: '#5a5f80', ground: '#141218', ambient: 0.6, moon: 0.25, exposure: 1.1, roadRoughness: 0.32, roadReflection: 3.4, roadTint: '#9a9aa6', windows: 1.15, rain: true, roadOpacity: 0.55, groundOpacity: 0.62 },
  dusk: { fog: '#3b2440', density: 0.0021, sky: '#ff9a7a', ground: '#2a1a2a', ambient: 1.1, moon: 0.9, exposure: 1.0, roadRoughness: 0.85, roadReflection: 2.0, roadTint: '#ffffff', windows: 0.55, rain: false, roadOpacity: 0.8, groundOpacity: 0.85 },
}

export function applyWeather(world: World, weather: Weather, road: MeshStandardMaterial, facade: MeshStandardMaterial, dome: MeshBasicMaterial, ground?: MeshStandardMaterial, mirror = false) {
  const p = PRESETS[weather]
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
  world.setFog(p.fog, p.density)
  world.setLight(p.sky, p.ground, p.ambient, p.moon)
  world.renderer.toneMappingExposure = p.exposure
  road.roughness = p.roadRoughness
  road.envMapIntensity = p.roadReflection
  road.color.set(p.roadTint)
  facade.emissiveIntensity = p.windows
  dome.map?.dispose()
  dome.map = sky(weather)
  dome.needsUpdate = true
  return p.rain
}

// The weather for a track when the player leaves it on automatic. Tonight's
// track gets tonight's weather, the same for everyone.
export function weatherFor(seed: string): Weather {
  const roll = hashSeed(`weather/${seed}`) % 10
  return roll < 5 ? 'clear' : roll < 8 ? 'rain' : 'dusk'
}
