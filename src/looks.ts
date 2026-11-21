import { Color, type Material, type Mesh, type MeshBasicMaterial, type MeshPhysicalMaterial } from 'three'
import type { CarModel } from './render/carModel'

// Looks bought with coins: a paint finish and an underglow colour. Each is
// bought once and can then go on any car the player owns. The paint
// colour itself stays free, as it always was.

export type Finish = 'gloss' | 'matte' | 'pearl' | 'chrome'
export type Glow = 'paint' | 'off' | 'cyan' | 'pink' | 'green' | 'orange' | 'white'

export interface Looks {
  finish: Finish
  glow: Glow
}

export const STOCK_LOOKS: Looks = { finish: 'gloss', glow: 'paint' }

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

// The key a look is saved under once bought, like "finish:matte".
export const lookKey = (kind: 'finish' | 'glow', id: string) => `${kind}:${id}`
export const priceOfLook = (kind: 'finish' | 'glow', id: string) => (kind === 'finish' ? FINISHES : GLOWS).find((l) => l.id === id)?.price ?? 0
export const isFree = (kind: 'finish' | 'glow', id: string) => priceOfLook(kind, id) === 0

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
