import { describe, expect, it } from 'vitest'
import { arrowSpots, buildPuddles, Crowd, signSpots } from '../src/render/roadside'
import { barrierOffset } from '../src/sim/car'
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

  it('paints four arrows on the road before each corner with chevrons, bending its way', () => {
    const track = buildTrack('roadside-arrows')
    const corners = signSpots(track).length / 3
    const arrows = arrowSpots(track)
    expect(arrows.length).toBe(corners * 4)
    for (const a of arrows) {
      const where = locate(track, a.x, a.z)
      expect(Math.abs(where.d)).toBeLessThan(track.width / 2)
    }
    // A corner's arrows bend the same way as its chevrons.
    const turns = new Set(signSpots(track).map((s) => s.right))
    for (const a of arrows) expect(turns.has(a.right)).toBe(true)
  })

  it('stands the crowd behind the barriers by the start line, never on the road', () => {
    const track = buildTrack('roadside-crowd')
    const wall = barrierOffset(track)
    const crowd = new Crowd(track, wall, 'roadside-crowd', true)
    const people = (crowd as unknown as { people: { x: number; z: number; marshal: boolean }[] }).people
    expect(people.length).toBeGreaterThan(40)
    expect(people.filter((p) => p.marshal)).toHaveLength(4)
    for (const p of people) {
      const where = locate(track, p.x, p.z)
      expect(Math.abs(where.d)).toBeGreaterThan(wall)
      expect(Math.hypot(p.x - track.x[0], p.z - track.z[0])).toBeLessThan(40)
    }
    // Half as many on low graphics.
    const few = (new Crowd(track, wall, 'roadside-crowd', false) as unknown as { people: unknown[] }).people
    expect(few.length).toBeLessThan(people.length * 0.65)
  })
})
