import { describe, expect, it } from 'vitest'
import { CHECKPOINTS, Race, STEP } from '../src/sim/race'
import { pointAt } from '../src/sim/track'

const finish = (race: Race, seconds = 400) => {
  for (let t = 0; t < seconds && race.phase !== 'finished'; t += STEP) race.step()
  return race
}

describe('race', () => {
  it.each(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'])('%s: every AI car finishes two laps', (seed) => {
    const race = finish(new Race({ seed, laps: 2, rivals: 5, autopilot: true }))
    expect(race.phase).toBe('finished')
    for (const racer of race.racers) {
      expect(racer.finishTime).not.toBeNull()
      expect(racer.lapTimes).toHaveLength(2)
      // Within reach of the reference lap, and never faster than physics
      // could plausibly allow.
      for (const lap of racer.lapTimes) {
        expect(lap).toBeGreaterThan(race.line.lapTime * 0.95)
        expect(lap).toBeLessThan(race.line.lapTime * 1.3)
      }
    }
  })

  it('nobody moves during the countdown', () => {
    const race = new Race({ seed: 'count', laps: 1, rivals: 3, autopilot: true })
    const before = race.racers.map((r) => [r.car.x, r.car.z])
    for (let t = 0; t < 2.9; t += STEP) race.step()
    expect(race.phase).toBe('countdown')
    expect(race.racers.map((r) => [r.car.x, r.car.z])).toEqual(before)
  })

  it('standings follow distance, and finishers keep their order', () => {
    const race = finish(new Race({ seed: 'order', laps: 1, rivals: 4, autopilot: true }))
    const standings = race.standings()
    expect(standings.map((r) => r.id)).toEqual(race.finishOrder)
  })

  it('a lap needs every checkpoint: a car moved across the infield earns nothing', () => {
    const race = new Race({ seed: 'cheat', laps: 1, rivals: 0 })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    const player = race.player
    // Put the car just short of the finish line, as if it had cut the lap.
    const p = pointAt(race.track, race.track.length - 5, 0)
    Object.assign(player.car, { x: p.x, z: p.z, heading: p.heading })
    race.playerInput = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }
    for (let t = 0; t < 4; t += STEP) race.step()
    expect(player.lapTimes).toHaveLength(0)
    expect(player.checkpoints).toBeLessThanOrEqual(2)
  })

  it('driving backwards over the line does not count, and is flagged as wrong way', () => {
    const race = new Race({ seed: 'back', laps: 1, rivals: 0 })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    const player = race.player
    player.car.heading += Math.PI
    race.playerInput = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }
    for (let t = 0; t < 4; t += STEP) race.step()
    expect(player.checkpoints).toBe(0)
    expect(player.wrongWay).toBeGreaterThan(1)
  })

  it('a full lap by the player passes every checkpoint once', () => {
    const race = finish(new Race({ seed: 'full', laps: 1, rivals: 0, autopilot: true }))
    expect(race.player.checkpoints).toBe(CHECKPOINTS + 1)
    expect(race.player.lapTimes).toHaveLength(1)
  })
})
