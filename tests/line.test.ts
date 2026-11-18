import { describe, expect, it } from 'vitest'
import { CAR } from '../src/sim/car'
import { bendiness, PLAN_GRIP, racingLine, speedProfile } from '../src/sim/line'
import { buildTrack } from '../src/sim/track'

describe('racing line', () => {
  const seeds = Array.from({ length: 40 }, (_, k) => `s${k}`)

  it.each(seeds)('%s stays on the road and bends less than the centre line', (seed) => {
    const track = buildTrack(seed)
    const line = racingLine(track)
    for (let i = 0; i < track.n; i++) expect(Math.abs(line.offset[i])).toBeLessThanOrEqual(track.width / 2 - 2.2 + 1e-9)
    expect(bendiness(line.curvature, track.spacing)).toBeLessThan(bendiness(track.curvature, track.spacing))
  })

  it('uses the width of the road in corners', () => {
    const track = buildTrack('s3')
    const line = racingLine(track)
    const widest = Math.max(...Array.from(line.offset, Math.abs))
    expect(widest).toBeGreaterThan(track.width / 2 - 2.2 - 0.5)
  })
})

describe('speed profile', () => {
  it('never asks for more grip, acceleration or braking than allowed', () => {
    const track = buildTrack('s5')
    const line = racingLine(track)
    const n = track.n
    for (let i = 0; i < n; i++) {
      const v = line.speed[i]
      const j = (i + 1) % n
      const ds = Math.hypot(line.x[j] - line.x[i], line.z[j] - line.z[i])
      expect(v).toBeLessThanOrEqual(CAR.topSpeed + 1e-9)
      expect(v * v * Math.abs(line.curvature[i])).toBeLessThanOrEqual(PLAN_GRIP + 1e-6)
      // v² - u² = 2as between neighbours, for both directions.
      const w = line.speed[j]
      expect(w * w - v * v).toBeLessThanOrEqual(2 * CAR.engine * ds + 1e-6)
      expect(v * v - w * w).toBeLessThanOrEqual(2 * CAR.brake * ds + 1e-6)
    }
  })

  it('goes flat out on a straight and gives a lap time of distance over speed', () => {
    const n = 500
    const { speed, lapTime } = speedProfile(new Float64Array(n), new Float64Array(n).fill(2))
    expect(Math.min(...speed)).toBeGreaterThan(CAR.topSpeed * 0.95)
    expect(lapTime).toBeGreaterThan(1000 / CAR.topSpeed - 1e-6)
    expect(lapTime).toBeLessThan(1000 / (CAR.topSpeed * 0.95))
  })
})
