import { BoxGeometry, Color, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { NIGHTFALL } from '../src/render/atmosphere'
import { Nightfall } from '../src/render/nightfall'
import type { World } from '../src/render/world'

function setup() {
  const geo = new BoxGeometry()
  const count = 40
  const lamps = { head: new InstancedMesh(geo, new MeshBasicMaterial(), count), pool: new InstancedMesh(geo, new MeshBasicMaterial(), count) }
  for (let k = 0; k < count; k++) {
    lamps.head.setColorAt(k, new Color('#ffffff'))
    lamps.pool.setColorAt(k, new Color('#ffffff'))
  }
  const sun = new Mesh(geo, new MeshBasicMaterial({ color: '#ff8a4a' }))
  sun.position.y = 60
  const moon = new Mesh(geo, new MeshBasicMaterial({ color: '#cfe0ff' }))
  const beams = [new Object3D()]
  const calls: { exposure: number[] } = { exposure: [] }
  const world = {
    renderer: {
      set toneMappingExposure(v: number) {
        calls.exposure.push(v)
      },
    },
    setFog() {},
    setLight() {},
  } as unknown as World
  return { lamps, sky: { sun, moon, beams }, world, calls, road: new MeshStandardMaterial() }
}

const lit = (mesh: InstancedMesh) => {
  const c = new Color()
  let n = 0
  for (let k = 0; k < mesh.count; k++) {
    mesh.getColorAt(k, c)
    if (c.r > 0.99) n++
  }
  return n
}

describe('a dusk race falling to night', () => {
  it('starts with the street lights off and strikes them one after another as it gets dark', () => {
    const { lamps, sky, world, road } = setup()
    const night = new Nightfall(lamps, sky, 'seed')
    night.update(0, world, road, null, null)
    expect(lit(lamps.pool)).toBe(0)
    const counts = [0.25, 0.35, 0.45, 0.55].map((t) => {
      night.update(t * NIGHTFALL, world, road, null, null)
      return lit(lamps.pool)
    })
    for (let k = 1; k < counts.length; k++) expect(counts[k]).toBeGreaterThanOrEqual(counts[k - 1])
    expect(counts[0]).toBeLessThan(lamps.pool.count)
    expect(counts[3]).toBe(lamps.pool.count)
    // Back at the start (a replay), they are off again.
    night.update(0, world, road, null, null)
    expect(lit(lamps.pool)).toBe(0)
  })

  it('switches each car on at its own moment, sinks the sun and brings up the moon', () => {
    const { lamps, sky, world, road } = setup()
    const night = new Nightfall(lamps, sky, 'seed')
    const cars = Array.from({ length: 8 }, () => [new Object3D(), new Object3D()])
    for (const parts of cars) night.addCar(parts)
    night.update(0, world, road, null, null)
    expect(cars.every((parts) => parts.every((p) => !p.visible))).toBe(true)
    expect(sky.moon.visible).toBe(false)
    night.update(0.35 * NIGHTFALL, world, road, null, null)
    const on = cars.filter((parts) => parts[0].visible).length
    expect(on).toBeGreaterThan(0)
    expect(on).toBeLessThan(cars.length)
    night.update(NIGHTFALL, world, road, null, null)
    expect(cars.every((parts) => parts.every((p) => p.visible))).toBe(true)
    expect(sky.sun.position.y).toBeLessThan(0)
    expect(sky.moon.visible).toBe(true)
    expect(sky.beams[0].visible).toBe(true)
  })

  it('puts the sun back for the next race, and lights every lamp for an ordinary night', () => {
    const { lamps, sky, world, road } = setup()
    new Nightfall(lamps, sky, 'seed').update(NIGHTFALL, world, road, null, null)
    Nightfall.restore(sky)
    expect(sky.sun.position.y).toBe(60)
    expect((sky.sun.material as MeshBasicMaterial).color.getHexString()).toBe('ff8a4a')
    new Nightfall(lamps, sky, 'seed').update(0, world, road, null, null)
    expect(lit(lamps.pool)).toBe(0)
    Nightfall.allLit(lamps)
    expect(lit(lamps.pool)).toBe(lamps.pool.count)
  })
})
