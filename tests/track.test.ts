import { describe, expect, it } from 'vitest'
import { buildTrack, locate, MIN_RADIUS, pointAt, problem, SPACING } from '../src/sim/track'

const seeds = Array.from({ length: 30 }, (_, k) => `test-${k}`)

describe('track generator', () => {
  it.each(seeds)('%s builds a valid closed circuit', (seed) => {
    const track = buildTrack(seed)
    expect(problem(track)).toBeNull()
    for (let i = 0; i < track.n; i++) {
      const j = (i + 1) % track.n
      // Evenly spaced samples, the last one leading back to the first.
      expect(Math.hypot(track.x[j] - track.x[i], track.z[j] - track.z[i])).toBeCloseTo(SPACING, 0)
      expect(Math.abs(track.curvature[i])).toBeLessThanOrEqual(1 / MIN_RADIUS)
      expect(Math.hypot(track.tx[i], track.tz[i])).toBeCloseTo(1, 6)
    }
  })

  it('the same seed gives the same track, a different one does not', () => {
    const a = buildTrack('repeat')
    expect(Array.from(buildTrack('repeat').x)).toEqual(Array.from(a.x))
    expect(buildTrack('other').length).not.toBe(a.length)
  })

  it('the start line sits on a straight', () => {
    for (const seed of seeds.slice(0, 10)) {
      const track = buildTrack(seed)
      for (let k = -15; k <= 15; k++) expect(Math.abs(track.curvature[(k + track.n) % track.n])).toBeLessThan(1 / 60)
    }
  })

  it('locate finds a point placed with pointAt', () => {
    const track = buildTrack('locate')
    for (const s of [0, 101, 777.5, track.length - 3]) {
      for (const d of [-6, 0, 4.5]) {
        const p = pointAt(track, s, d)
        const found = locate(track, p.x, p.z)
        const gap = Math.min(Math.abs(found.s - s), track.length - Math.abs(found.s - s))
        expect(gap).toBeLessThan(0.5)
        expect(found.d).toBeCloseTo(d, 0)
      }
    }
  })
})
