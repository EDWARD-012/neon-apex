import { describe, expect, it } from 'vitest'
import { TV_EVERY } from '../src/cinema'
import { bridgeSpot } from '../src/render/bridge'
import { carParkSpots } from '../src/render/carPark'
import { distanceField } from '../src/render/city'
import { barrierOffset } from '../src/sim/car'
import { buildTrack, locate } from '../src/sim/track'

describe('the overpass and the parked cars', () => {
  it('puts the overpass on a straight, away from the start and the TV cameras, clear of other roads', () => {
    let found = 0
    for (const seed of ['gfx', 'r1', 'r2', 'r3', 'r4', 'r5']) {
      const track = buildTrack(seed)
      const place = bridgeSpot(track)
      if (!place) continue
      found++
      const along = Math.min(place.i, track.n - place.i) * track.spacing
      expect(along).toBeGreaterThan(150)
      expect(Math.abs(track.curvature[place.i])).toBeLessThanOrEqual(1 / 300)
      const gap = (place.i * track.spacing) % TV_EVERY
      expect(Math.min(gap, TV_EVERY - gap)).toBeGreaterThanOrEqual(22)
      // The abutments stand off the barriers.
      expect(place.inner).toBeGreaterThan(barrierOffset(track) + 2)
      // Out along the embankments, nothing is nearer than this road.
      const near = distanceField(track)
      for (const side of [-1, 1]) {
        for (let u = place.outer; u < place.outer + 45; u += 5) {
          const x = track.x[place.i] + track.nx[place.i] * side * u
          const z = track.z[place.i] + track.nz[place.i] * side * u
          expect(near(x, z, 120)).toBeGreaterThan(Math.min(u, barrierOffset(track) + 14) - 2)
        }
      }
    }
    // Every one of these has room for one.
    expect(found).toBe(6)
  })

  it('parks cars on the verges either side of the start, past the crowd, the same every time', () => {
    const track = buildTrack('gfx')
    const spots = carParkSpots(track, 'gfx', 12)
    expect(spots.length).toBe(12)
    expect(carParkSpots(track, 'gfx', 12)).toEqual(spots)
    // Fewer asked for are the first of the same cars.
    expect(carParkSpots(track, 'gfx', 7)).toEqual(spots.slice(0, 7))
    const wall = barrierOffset(track)
    for (const s of spots) {
      const at = locate(track, s.x, s.z)
      expect(Math.abs(at.d)).toBeGreaterThan(wall + 2.5)
      expect(Math.abs(at.d)).toBeLessThan(wall + 4.5)
      const along = Math.min(at.i, track.n - at.i) * track.spacing
      expect(along).toBeGreaterThanOrEqual(28)
      expect(along).toBeLessThanOrEqual(82)
    }
    // No two cars in the same place.
    for (let a = 0; a < spots.length; a++) {
      for (let b = a + 1; b < spots.length; b++) expect(Math.hypot(spots[a].x - spots[b].x, spots[a].z - spots[b].z)).toBeGreaterThan(5)
    }
  })
})
