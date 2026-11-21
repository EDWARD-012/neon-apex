import { Color, type Material, type Mesh, type MeshBasicMaterial, type MeshPhysicalMaterial } from 'three'
import type { CarModel } from './render/carModel'

// Looks bought with coins: a paint finish, an underglow colour and a
// livery. Each is bought once and can then go on any car the player owns.
// The paint colour, the livery's colour and the race number stay free.

export type Finish = 'gloss' | 'matte' | 'pearl' | 'chrome'
export type Glow = 'paint' | 'off' | 'cyan' | 'pink' | 'green' | 'orange' | 'white'
export type Livery = 'none' | 'twin' | 'centre' | 'flash' | 'number' | 'chequer'
export type Trim = 'white' | 'black' | 'red' | 'yellow' | 'cyan'
export type Rims = 'stock' | 'split' | 'mesh' | 'deep' | 'turbine'
export type Ride = 'stock' | 'lowered' | 'slammed'
export type Tint = 'stock' | 'dark' | 'limo'
export type Spoiler = 'stock' | 'lip' | 'wing'
export type LookKind = 'finish' | 'glow' | 'livery' | 'rims' | 'ride' | 'tint' | 'spoiler'

export interface Looks {
  finish: Finish
  glow: Glow
  livery: Livery
  trim: Trim
  number: number
  rims: Rims
  ride: Ride
  tint: Tint
  spoiler: Spoiler
}

export const STOCK_LOOKS: Looks = { finish: 'gloss', glow: 'paint', livery: 'none', trim: 'white', number: 7, rims: 'stock', ride: 'stock', tint: 'stock', spoiler: 'stock' }

export const FINISHES: { id: Finish; name: string; price: number }[] = [
  { id: 'gloss', name: 'Gloss', price: 0 },
  { id: 'matte', name: 'Matte', price: 1500 },
  { id: 'pearl', name: 'Pearl', price: 3000 },
  { id: 'chrome', name: 'Chrome', price: 6000 },
]

export const GLOWS: { id: Glow; name: string; color: string | null; price: number }[] = [
  { id: 'paint', name: 'Match paint', color: null, price: 0 },
  { id: 'off', name: 'Off', color: null, price: 0 },
  { id: 'cyan', name: 'Cyan', color: '#3df5ff', price: 1500 },
  { id: 'pink', name: 'Pink', color: '#ff2d95', price: 1500 },
  { id: 'green', name: 'Green', color: '#5dff7a', price: 1500 },
  { id: 'orange', name: 'Orange', color: '#ff8a2e', price: 1500 },
  { id: 'white', name: 'White', color: '#f2f4ff', price: 1500 },
]

export const LIVERIES: { id: Livery; name: string; price: number }[] = [
  { id: 'none', name: 'None', price: 0 },
  { id: 'twin', name: 'Twin stripes', price: 2000 },
  { id: 'centre', name: 'Centre stripe', price: 2000 },
  { id: 'flash', name: 'Side flash', price: 2500 },
  { id: 'chequer', name: 'Chequer band', price: 2500 },
  { id: 'number', name: 'Race number', price: 3000 },
]

export const TRIMS: { id: Trim; name: string; color: string }[] = [
  { id: 'white', name: 'White', color: '#f2f2ee' },
  { id: 'black', name: 'Black', color: '#141416' },
  { id: 'red', name: 'Red', color: '#d81e2a' },
  { id: 'yellow', name: 'Yellow', color: '#f4c20d' },
  { id: 'cyan', name: 'Cyan', color: '#2fd8f0' },
]

export const RIMS: { id: Rims; name: string; price: number }[] = [
  { id: 'stock', name: 'Stock', price: 0 },
  { id: 'split', name: 'Split five', price: 2000 },
  { id: 'mesh', name: 'Mesh', price: 2500 },
  { id: 'turbine', name: 'Turbine', price: 2500 },
  { id: 'deep', name: 'Deep dish', price: 3000 },
]

export const RIDES: { id: Ride; name: string; price: number }[] = [
  { id: 'stock', name: 'Stock', price: 0 },
  { id: 'lowered', name: 'Lowered', price: 1000 },
  { id: 'slammed', name: 'Slammed', price: 2000 },
]

export const TINTS: { id: Tint; name: string; price: number }[] = [
  { id: 'stock', name: 'Stock', price: 0 },
  { id: 'dark', name: 'Dark', price: 800 },
  { id: 'limo', name: 'Limo', price: 1500 },
]

export const SPOILERS: { id: Spoiler; name: string; price: number }[] = [
  { id: 'stock', name: 'Stock', price: 0 },
  { id: 'lip', name: 'Ducktail lip', price: 1500 },
  { id: 'wing', name: 'GT wing', price: 3500 },
]

export const LOOK_LISTS: Record<LookKind, { id: string; name: string; price: number }[]> = { finish: FINISHES, glow: GLOWS, livery: LIVERIES, rims: RIMS, ride: RIDES, tint: TINTS, spoiler: SPOILERS }
const LISTS = LOOK_LISTS

// The key a look is saved under once bought, like "finish:matte".
export const lookKey = (kind: LookKind, id: string) => `${kind}:${id}`
export const lookName = (kind: LookKind, id: string) => LISTS[kind].find((l) => l.id === id)?.name ?? id
export const priceOfLook = (kind: LookKind, id: string) => LISTS[kind].find((l) => l.id === id)?.price ?? 0
export const isFree = (kind: LookKind, id: string) => priceOfLook(kind, id) === 0
export const isLook = (kind: LookKind, id: string) => LISTS[kind].some((l) => l.id === id)

// A car's looks with every field present and valid, for saves made before
// liveries or edited by hand.
export function fullLooks(saved?: Partial<Looks> | null): Looks {
  const s = saved ?? {}
  const number = Math.round(Number(s.number))
  return {
    finish: s.finish && isLook('finish', s.finish) ? s.finish : STOCK_LOOKS.finish,
    glow: s.glow && isLook('glow', s.glow) ? s.glow : STOCK_LOOKS.glow,
    livery: s.livery && isLook('livery', s.livery) ? s.livery : STOCK_LOOKS.livery,
    trim: TRIMS.some((t) => t.id === s.trim) ? (s.trim as Trim) : STOCK_LOOKS.trim,
    number: number >= 1 && number <= 99 ? number : STOCK_LOOKS.number,
    rims: s.rims && isLook('rims', s.rims) ? s.rims : STOCK_LOOKS.rims,
    ride: s.ride && isLook('ride', s.ride) ? s.ride : STOCK_LOOKS.ride,
    tint: s.tint && isLook('tint', s.tint) ? s.tint : STOCK_LOOKS.tint,
    spoiler: s.spoiler && isLook('spoiler', s.spoiler) ? s.spoiler : STOCK_LOOKS.spoiler,
  }
}

// Puts the looks on a model: the finish on every paint material, and the
// underglow in its colour, the paint's, or off.
export function styleCar(model: CarModel, looks: Looks, paint: string) {
  model.group.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    for (const m of ([] as Material[]).concat(mesh.material)) {
      if (!m.userData.paint) continue
      const p = m as MeshPhysicalMaterial
      const base = (p.userData.stock ??= { metalness: p.metalness, roughness: p.roughness, clearcoat: p.clearcoat, clearcoatRoughness: p.clearcoatRoughness })
      Object.assign(p, base, { iridescence: 0 })
      if (looks.finish === 'matte') Object.assign(p, { metalness: 0.08, roughness: 0.78, clearcoat: 0 })
      else if (looks.finish === 'pearl') Object.assign(p, { metalness: 0.35, roughness: 0.22, iridescence: 0.9, iridescenceIOR: 1.45, iridescenceThicknessRange: [200, 600] })
      else if (looks.finish === 'chrome') Object.assign(p, { metalness: 1, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02 })
      p.needsUpdate = true
    }
  })
  const glow = model.glow
  if (!glow) return
  const def = GLOWS.find((g) => g.id === looks.glow)
  glow.visible = looks.glow !== 'off'
  // The glow is drawn at half strength, as the model does.
  ;(glow.material as MeshBasicMaterial).color.copy(new Color(def?.color ?? paint)).multiplyScalar(0.5)
}
