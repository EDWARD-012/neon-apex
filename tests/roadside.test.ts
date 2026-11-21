import { describe, expect, it } from 'vitest'
import { buildPuddles, signSpots } from '../src/render/roadside'
import { buildTrack, locate } from '../src/sim/track'

describe('things by the road', () => {
  it('chevrons stand off the road on the outside of sharp corners, three at a time', () => {
    for (const seed of ['gfx', 'r1', 'r2', 'r3']) {
      const track = buildTrack(seed)
      const spots = signSpots(track)
      expect(spots.length % 3).toBe(0)
      for (const s of spots) {
        const at = locate(track, s.x, s.z)
        // Beyond the edge of the road, on the outside of the turn.
        expect(Math.abs(at.d)).toBeGreaterThan(track.width / 2 + 1)
        expect(Math.sign(at.d)).toBe(s.right ? -1 : 1)
      }
    }
  })

  it('puddles lie on the road, the same ones every time for a track', () => {
    const track = buildTrack('wet')
    const a = buildPuddles(track, 'wet').puddles
    const b = buildPuddles(track, 'wet').puddles
    expect(a.length).toBeGreaterThan(3)
    expect(a).toEqual(b)
    for (const p of a) expect(Math.abs(locate(track, p.x, p.z).d)).toBeLessThan(track.width / 2)
  })
})
