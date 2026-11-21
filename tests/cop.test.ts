import { describe, expect, it } from 'vitest'
import { fresh, settle, type Run } from '../src/career'
import { idle, speedOf } from '../src/sim/car'
import { INTERCEPTOR_SPEC } from '../src/sim/cars'
import { BACKUP_EVERY, BACKUP_MAX, BOX_TIME, COP_HOLD, COP_PULSE_STUN, Race, type RaceEvent, STEP } from '../src/sim/race'
import { locate, pointAt } from '../src/sim/track'

const start = (seed: string, tools: Race['tools'][number]['id'][] = []) => {
  const race = new Race({ seed, laps: 3, rivals: 4, mode: 'cop', playerSpec: INTERCEPTOR_SPEC, tools: tools as never })
  for (let t = 0; t < 3.1; t += STEP) race.step()
  return race
}
const run = (race: Race, seconds: number, events: RaceEvent[] = []) => {
  for (let t = 0; t < seconds && race.phase !== 'finished'; t += STEP) {
    race.step()
    events.push(...race.events)
    race.events = []
  }
  return events
}

describe('playing the cop', () => {
  it('the racers get a head start while the police car waits', () => {
    const race = start('cop-hold')
    race.playerInput = { ...idle, throttle: 1 }
    run(race, COP_HOLD - 0.2)
    expect(speedOf(race.player.car)).toBeLessThan(0.5)
    expect(race.racers.filter((r) => !r.player).every((r) => speedOf(r.car) > 10)).toBe(true)
    run(race, 1)
    expect(speedOf(race.player.car)).toBeGreaterThan(2)
  })

  it('a racer with full damage is busted', () => {
    const race = start('cop-ram')
    run(race, 1)
    const target = race.racers[0]
    target.car.damage = 1
    const events = run(race, 0.1)
    expect(target.out).toBe(true)
    expect(target.fate).toBe('busted')
    expect(race.busts).toBe(1)
    expect(events).toContainEqual({ type: 'racerBusted', id: 0 })
  })

  it('a racer held still with a police car beside it is busted', () => {
    const race = start('cop-box')
    run(race, 1)
    const target = race.racers[1]
    const me = race.player.car
    // The other racers well away, so none of them knocks it loose.
    const away = pointAt(race.track, locate(race.track, target.car.x, target.car.z).s + 300, 0)
    for (const r of race.racers) if (!r.player && r !== target) Object.assign(r.car, { x: away.x, z: away.z, hint: locate(race.track, away.x, away.z).i })
    for (let t = 0; t < BOX_TIME + 0.2; t += STEP) {
      Object.assign(target.car, { vx: 0, vz: 0 })
      Object.assign(me, { x: target.car.x + 5, z: target.car.z, vx: 0, vz: 0 })
      race.step()
    }
    expect(target.fate).toBe('busted')
  })

  it('the event ends when no racer is left on the road', () => {
    const race = start('cop-end')
    run(race, 1)
    for (const r of race.racers) if (!r.player) r.car.damage = 1
    run(race, 0.1)
    expect(race.busts).toBe(4)
    expect(race.phase).toBe('finished')
  })

  it('backup arrives on the radio and goes after the racers', () => {
    const race = new Race({ seed: 'cop-backup', laps: 99, rivals: 2, mode: 'cop', playerSpec: INTERCEPTOR_SPEC })
    const events = run(race, BACKUP_EVERY * BACKUP_MAX + 6)
    expect(events.filter((e) => e.type === 'backup')).toHaveLength(BACKUP_MAX)
    expect(race.police.length).toBe(BACKUP_MAX)
  })

  it('the pulse cuts the power of the racer ahead, and is not spent with nobody in range', () => {
    const race = start('cop-pulse', ['pulse', 'spikes'])
    const me = race.player.car
    const target = race.racers[0]
    // Nobody close: nothing happens and the use is kept.
    const far = pointAt(race.track, locate(race.track, me.x, me.z).s + 400, 0)
    for (const r of race.racers) if (!r.player) Object.assign(r.car, { x: far.x, z: far.z })
    expect(race.useTool(0)).toBe(false)
    expect(race.tools[0].left).toBe(2)
    const near = pointAt(race.track, locate(race.track, me.x, me.z).s + 30, 0)
    Object.assign(target.car, { x: near.x, z: near.z })
    Object.assign(me, { heading: near.heading })
    expect(race.useTool(0)).toBe(true)
    expect(target.car.stunned).toBe(COP_PULSE_STUN)
  })

  it('a spike strip goes down on the racing line ahead of the leader and blows its tyres', () => {
    const race = start('cop-spikes', ['spikes', 'roadblock'])
    run(race, 2)
    const leader = race.leadingRacer()!
    const top = leader.car.spec.topSpeed
    expect(race.useTool(0)).toBe(true)
    expect(race.spikes).toHaveLength(1)
    const events = run(race, 8)
    expect(events.map((e) => e.type)).toContain('punctured')
    expect(leader.car.spec.topSpeed).toBeLessThan(top)
    // And the roadblock goes up ahead of whoever leads now.
    for (let t = 0; t < 1.1; t += STEP) race.step()
    expect(race.useTool(1)).toBe(true)
    expect(race.blockade.length).toBeGreaterThan(0)
  })
})

describe('coins for playing the cop', () => {
  const run = (busts: number): Run => ({ kind: 'cop', laps: 3, finished: true, heat: 1, nearMisses: 0, cleanLaps: 0, closeWin: false, daily: false, busts, racers: 4 })
  it('pays 1,000 a bust and as much again for all of them', () => {
    expect(settle(fresh(), run(0), '2026-11-21').total).toBe(0)
    expect(settle(fresh(), run(2), '2026-11-21').total).toBe(2000)
    expect(settle(fresh(), run(4), '2026-11-21').total).toBe(5000)
  })
})
