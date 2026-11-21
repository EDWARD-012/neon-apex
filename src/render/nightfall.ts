import { Color, type InstancedMesh, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial, type Object3D } from 'three'
import { createRng } from '../sim/rng'
import { NIGHTFALL, nightfall } from './atmosphere'
import type { World } from './world'

// A dusk race in the city falls to night as it goes. The light drops from
// the dusk preset to the clear night's over NIGHTFALL seconds, the low sun
// sinks behind the skyline and the moon comes up, and as it gets dark the
// street lights strike one after another, flickering as they catch, and
// each car's headlights come on, each at its own moment.

export interface Lamps {
  head: InstancedMesh
  pool: InstancedMesh
}

export interface Sky {
  sun: Mesh
  moon: Mesh
  beams: Object3D[]
}

// How far into the nightfall, 0 to 1, the first and the last street light
// strike, and the first and last car switch its lights on.
const LAMPS = [0.2, 0.5]
const CARS = [0.28, 0.42]
// Seconds a lamp flickers as it strikes.
const STRIKE = 0.9
// An unlit lamp's glass.
const DARK = 0.05

export class Nightfall {
  private readonly lampAt: number[]
  private readonly lampLevel: number[]
  private readonly cars: { at: number; parts: Object3D[]; on: boolean | null }[] = []
  private readonly rng: () => number
  private readonly c = new Color()
  private shown = -1

  constructor(
    private readonly lamps: Lamps | null,
    private readonly sky: Sky | null,
    seed: string,
  ) {
    this.rng = createRng(`nightfall/${seed}`)
    const count = lamps?.head.count ?? 0
    this.lampAt = Array.from({ length: count }, () => LAMPS[0] + this.rng() * (LAMPS[1] - LAMPS[0]))
    this.lampLevel = Array.from({ length: count }, () => -1)
    if (sky) Nightfall.restore(sky)
  }

  // The sun and moon as the city built them, remembered the first time
  // and put back before every night race.
  static restore(sky: Sky) {
    for (const body of [sky.sun, sky.moon]) {
      const material = body.material as MeshBasicMaterial
      const base = (body.userData.base ??= { y: body.position.y, color: material.color.clone() }) as { y: number; color: Color }
      body.position.y = base.y
      material.color.copy(base.color)
    }
  }

  // A car's lights: everything that only shows with its headlights on.
  addCar(parts: Object3D[]) {
    this.cars.push({ at: CARS[0] + this.rng() * (CARS[1] - CARS[0]), parts, on: null })
  }

  update(clock: number, world: World, road: MeshStandardMaterial, facade: MeshStandardMaterial | null, dome: MeshBasicMaterial | null) {
    // How dark it is, 0 at the start, 1 at night.
    const t = Math.min(1, Math.max(0, clock / NIGHTFALL))
    // The sky moves slowly; only redo it when it has changed visibly.
    if (Math.abs(t - this.shown) > 0.002) {
      this.shown = t
      nightfall(world, t, road, facade, dome)
      if (this.sky) {
        const { sun, moon, beams } = this.sky
        const base = (body: Object3D) => body.userData.base as { y: number; color: Color }
        sun.position.y = base(sun).y - t * 170
        ;(sun.material as MeshBasicMaterial).color.copy(base(sun).color).multiplyScalar((1 - t) ** 1.5)
        sun.visible = t < 1
        const rise = Math.min(1, Math.max(0, (t - 0.55) / 0.35))
        moon.visible = rise > 0
        ;(moon.material as MeshBasicMaterial).color.copy(base(moon).color).multiplyScalar(rise)
        for (const beam of beams) beam.visible = t > 0.75
      }
    }
    if (this.lamps) {
      const { head, pool } = this.lamps
      let changed = false
      for (let k = 0; k < this.lampAt.length; k++) {
        const since = (t - this.lampAt[k]) * NIGHTFALL
        let level = 0
        if (since >= STRIKE) level = 1
        else if (since > 0) {
          // Catching: on and off a few times, brighter as it goes.
          const flick = Math.sin(since * 47 + k * 1.7) + Math.sin(since * 23 + k)
          level = flick > 0.4 - since ? 0.35 + 0.65 * (since / STRIKE) : 0
        }
        if (level === this.lampLevel[k]) continue
        this.lampLevel[k] = level
        head.setColorAt(k, this.c.setScalar(DARK + (1 - DARK) * level))
        pool.setColorAt(k, this.c.setScalar(level))
        changed = true
      }
      if (changed) {
        if (head.instanceColor) head.instanceColor.needsUpdate = true
        if (pool.instanceColor) pool.instanceColor.needsUpdate = true
      }
    }
    for (const car of this.cars) {
      const on = t >= car.at
      if (on === car.on) continue
      car.on = on
      for (const part of car.parts) part.visible = on
    }
  }

  // Every lamp back on, as a night track normally has them.
  static allLit(lamps: Lamps) {
    const white = new Color('#ffffff')
    for (let k = 0; k < lamps.head.count; k++) {
      lamps.head.setColorAt(k, white)
      lamps.pool.setColorAt(k, white)
    }
    if (lamps.head.instanceColor) lamps.head.instanceColor.needsUpdate = true
    if (lamps.pool.instanceColor) lamps.pool.instanceColor.needsUpdate = true
  }
}
