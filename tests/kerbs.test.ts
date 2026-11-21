import { describe, expect, it } from 'vitest'
import { KERB_RADIUS, kerbSide, onKerb } from '../src/sim/kerbs'
import { Race, STEP } from '../src/sim/race'
import { buildTrack, locate } from '../src/sim/track'

const track = buildTrack('kerbs')
const half = track.width / 2

describe('kerbs', () => {
  it('sit on the inside of corners tighter than the kerb radius, in blocks of two samples', () => {
    let kerbed = 0
    for (let i = 0; i < track.n; i++) {
      const at = i - (i % 2)
      const k = track.curvature[at]
      const side = kerbSide(track, i)
      if (Math.abs(k) < 1 / KERB_RADIUS) expect(side).toBe(0)
      else {
        // Bending left (positive curvature) puts the kerb on the left.
        expect(side).toBe(k > 0 ? -1 : 1)
        kerbed++
      }
    }
    expect(kerbed).toBeGreaterThan(0)
  })

  it('a car on the centre line or on the far side of the road is not on the kerb', () => {
    const i = Array.from({ length: track.n }, (_, k) => k).find((k) => kerbSide(track, k) !== 0) as number
    const side = kerbSide(track, i)
    expect(onKerb(track, i, 0)).toBe(0)
    expect(onKerb(track, i, -side * (half - 0.5))).toBe(0)
  })

  it('a car with its wheels over the edge on the kerb side is on it', () => {
    const i = Array.from({ length: track.n }, (_, k) => k).find((k) => kerbSide(track, k) !== 0) as number
    const side = kerbSide(track, i)
    // Half the car over the edge.
    expect(onKerb(track, i, side * half)).toBeGreaterThan(0.5)
    // Just touching it with the outer tyres.
    const touching = onKerb(track, i, side * (half - 0.9))
    expect(touching).toBeGreaterThan(0)
    expect(touching).toBeLessThan(0.5)
  })

  it('a straight has no kerbs', () => {
    const i = Array.from({ length: track.n }, (_, k) => k).find((k) => kerbSide(track, k) === 0) as number
    expect(onKerb(track, i, half)).toBe(0)
  })

  it('a car driving the racing line runs over kerbs now and then', () => {
    const race = new Race({ seed: 'kerbs', laps: 1, rivals: 0, autopilot: true })
    let frames = 0
    for (let t = 0; t < 60; t += STEP) {
      race.step()
      const car = race.player.car
      const at = locate(race.track, car.x, car.z, car.hint)
      if (onKerb(race.track, at.i, at.d) > 0) frames++
    }
    expect(frames).toBeGreaterThan(0)
  })
})
