import { describe, expect, it } from 'vitest'
import { Birds, birdSpots } from '../src/render/birds'
import { buildTrack, locate } from '../src/sim/track'

describe('birds by the road', () => {
  it('sit on gentle stretches away from the start, the same places every time', () => {
    for (const seed of ['gfx', 'r1', 'r2']) {
      const track = buildTrack(seed)
      const spots = birdSpots(track, 5, seed)
      expect(spots.length).toBeGreaterThan(2)
      expect(birdSpots(track, 5, seed)).toEqual(spots)
      for (const s of spots) {
        const along = Math.min(s.i, track.n - s.i) * track.spacing
        expect(along).toBeGreaterThan(80)
        expect(Math.abs(track.curvature[s.i])).toBeLessThanOrEqual(1 / 160)
      }
    }
  })

  it('a flock sits by the edge of the road until a car comes, then flies off and comes back later', () => {
    const track = buildTrack('gfx')
    const birds = new Birds(track, 'gfx', true)
    const flock = birds.spots[0]
    const at = locate(track, flock.x, flock.z)
    expect(Math.abs(at.d)).toBeGreaterThan(track.width / 2 - 3)
    expect(Math.abs(at.d)).toBeLessThan(track.width / 2 + 0.8)

    // A car far off leaves them be.
    const car = { x: flock.x + 10000, z: flock.z, vx: -30, vz: 0 }
    birds.update(1 / 60, 0, [car], car.x, car.z)
    expect(birds.flying).toBe(0)

    // One close by at speed sends them up.
    car.x = flock.x + 20
    let time = 0
    for (let k = 0; k < 90; k++) birds.update(1 / 60, (time += 1 / 60), [car], car.x, car.z)
    expect(birds.flying).toBeGreaterThan(5)

    // Once the road has been empty for a while they are back down.
    car.x = flock.x + 10000
    for (let k = 0; k < 60 * 14; k++) birds.update(1 / 60, (time += 1 / 60), [car], car.x, car.z)
    expect(birds.flying).toBe(0)
  })
})
