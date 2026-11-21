import { describe, expect, it } from 'vitest'
import { barrierContact } from '../src/render/marks'
import { barrierOffset } from '../src/sim/car'
import { buildTrack, locate } from '../src/sim/track'

describe('barrier scrapes', () => {
  const track = buildTrack('marks')
  const wall = barrierOffset(track)
  const at = (d: number) => ({ x: track.x[40] + track.nx[40] * d, z: track.z[40] + track.nz[40] * d })

  it('mark a car touching either barrier, on the barrier face beside it', () => {
    for (const side of [-1, 1]) {
      const car = at(side * (wall - 1))
      const hit = barrierContact(track, car.x, car.z, 40, 1, 20)
      expect(hit).not.toBeNull()
      const where = locate(track, hit!.x, hit!.z, 40)
      // Just in front of the face, on the side the car is on.
      expect(Math.sign(where.d)).toBe(side)
      expect(Math.abs(where.d)).toBeGreaterThan(wall - 0.05)
      expect(Math.abs(where.d)).toBeLessThan(wall)
    }
  })

  it('leave a car in the lane, or one barely moving, unmarked', () => {
    const middle = at(0)
    expect(barrierContact(track, middle.x, middle.z, 40, 1, 30)).toBeNull()
    const touching = at(wall - 1)
    expect(barrierContact(track, touching.x, touching.z, 40, 1, 2)).toBeNull()
  })
})
