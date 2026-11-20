import { describe, expect, it } from 'vitest'
import { fresh, type Run, settle, TIERS } from '../src/career'
import { idle } from '../src/sim/car'
import { Race, type RaceEvent, SPOT_RANGE, STEP } from '../src/sim/race'
import { locate, pointAt } from '../src/sim/track'

const run = (race: Race, seconds: number, events: RaceEvent[] = []) => {
  for (let t = 0; t < seconds && race.phase !== 'finished'; t += STEP) {
    race.step()
    events.push(...race.events)
    race.events = []
  }
  return events
}

// A race with one patrol car waiting, run past the countdown.
const patrolRace = (seed: string) => {
  const race = new Race({ seed, laps: 3, rivals: 0, patrols: 2 })
  run(race, 3.1)
  return race
}

// Puts the player on the centre line at a distance along the lap, moving.
const place = (race: Race, s: number, speed: number) => {
  const at = pointAt(race.track, s, 0)
  Object.assign(race.player.car, { x: at.x, z: at.z, heading: at.heading, vx: Math.sin(at.heading) * speed, vz: Math.cos(at.heading) * speed, yawRate: 0 })
  race.player.car.hint = locate(race.track, at.x, at.z).i
}

const copAt = (race: Race) => {
  const cop = race.police[0]
  return locate(race.track, cop.x, cop.z, cop.hint)
}

describe('police in a race', () => {
  it('a patrol car waits at the edge of the road, outside the traffic lanes', () => {
    const race = patrolRace('patrol-park')
    expect(race.police).toHaveLength(1)
    expect(race.parked.has(race.police[0])).toBe(true)
    expect(Math.abs(copAt(race).d)).toBeGreaterThan(5.8)
    expect(race.chasing).toBe(false)
  })

  it('it gives chase when the player goes past fast', () => {
    const race = patrolRace('patrol-spot')
    place(race, copAt(race).s - SPOT_RANGE - 15, 40)
    race.playerInput = { ...idle, throttle: 1 }
    const events = run(race, 1.5)
    expect(events.some((e) => e.type === 'spotted')).toBe(true)
    expect(race.chasing).toBe(true)
    expect(race.parked.size).toBe(0)
  })

  it('a slow car goes past unseen', () => {
    const race = patrolRace('patrol-slow')
    place(race, copAt(race).s - 20, 10)
    race.playerInput = { ...idle, throttle: 0.2 }
    run(race, 4)
    expect(race.chasing).toBe(false)
  })

  it('stopping with the police close is busted, and that ends the race', () => {
    const race = patrolRace('patrol-bust')
    place(race, copAt(race).s - SPOT_RANGE - 15, 40)
    race.playerInput = { ...idle, throttle: 1 }
    run(race, 1.5)
    expect(race.chasing).toBe(true)
    // Brake to a stop, then let go: holding the brake at a standstill would
    // reverse.
    race.playerInput = { ...idle, brake: 1 }
    const events = run(race, 1.8)
    race.playerInput = idle
    run(race, 12, events)
    expect(events.some((e) => e.type === 'busted')).toBe(true)
    expect(race.player.out).toBe(true)
    expect(race.player.fate).toBe('busted')
    expect(race.phase).toBe('finished')
  })

  it('getting clear loses them, and they go back to waiting further on', () => {
    const race = patrolRace('patrol-lose')
    place(race, copAt(race).s - SPOT_RANGE - 15, 40)
    race.playerInput = { ...idle, throttle: 1 }
    run(race, 1.5)
    expect(race.chasing).toBe(true)
    // Put the patrol car half a lap away and take its engine out.
    const cop = race.police[0]
    const me = locate(race.track, race.player.car.x, race.player.car.z, race.player.car.hint)
    const far = pointAt(race.track, me.s + race.track.length / 2, 3)
    Object.assign(cop, { x: far.x, z: far.z, heading: far.heading, vx: 0, vz: 0, spec: { ...cop.spec, engine: 0.01 } })
    cop.hint = locate(race.track, far.x, far.z).i
    race.playerInput = idle
    const events = run(race, 8)
    expect(events.some((e) => e.type === 'lostPolice')).toBe(true)
    expect(race.escapes).toEqual([1])
    expect(race.chasing).toBe(false)
    expect(race.parked.has(cop)).toBe(true)
    // Back to a stock patrol car.
    expect(cop.spec.engine).toBeGreaterThan(1)
  })

  it('a pursuit has no waiting patrol cars, and a race without patrols has no police', () => {
    expect(new Race({ seed: 'p', laps: 99, rivals: 0, mode: 'pursuit', police: 2, patrols: 3 }).parked.size).toBe(0)
    expect(new Race({ seed: 'p', laps: 3, rivals: 3 }).police).toHaveLength(0)
  })
})

describe('wrecks', () => {
  it('a car at full damage is wrecked: out of the race but still on the road', () => {
    const race = new Race({ seed: 'wreck-race', laps: 3, rivals: 3 })
    run(race, 4)
    race.player.car.damage = 1
    const events = run(race, 0.5)
    expect(events).toContainEqual({ type: 'wrecked', id: race.player.id })
    expect(race.player.out).toBe(true)
    expect(race.player.fate).toBe('wrecked')
    expect(race.phase).toBe('finished')
    expect(race.cars).toContain(race.player.car)
  })

  it('the title screen car and the rivals are never wrecked', () => {
    const race = new Race({ seed: 'wreck-ai', laps: 3, rivals: 3, autopilot: true })
    run(race, 4)
    for (const r of race.racers) r.car.damage = 1
    run(race, 1)
    expect(race.racers.every((r) => !r.out)).toBe(true)
  })
})

describe('coins for police and wrecks', () => {
  const base: Run = { kind: 'race', laps: 3, finished: false, place: 6, heat: 1, nearMisses: 4, cleanLaps: 1, closeWin: false, daily: false }
  const today = '2026-11-21'

  it('busted in a race pays nothing at all', () => {
    expect(settle(fresh(), { ...base, fate: 'busted' }, today).total).toBe(0)
  })

  it('a wrecked car keeps its skills but gets nothing for its place', () => {
    const paid = settle(fresh(), { ...base, fate: 'wrecked' }, today)
    expect(paid.total).toBe(4 * 50 + 100)
    const event = TIERS[0].events[0]
    const career = settle(fresh(), { ...base, place: 1, fate: 'wrecked' }, today, event)
    expect(career.result?.won).toBe(false)
    expect(career.progress.won[event.id]).toBeFalsy()
    expect(career.total).toBe(4 * 50 + 100)
  })

  it('losing the police pays 1,000 for each heat level', () => {
    const paid = settle(fresh(), { ...base, finished: true, place: 1, nearMisses: 0, cleanLaps: 0, escapes: [1, 2] }, today)
    expect(paid.total).toBe(1000 + 3000)
    expect(paid.lines.at(-1)?.label).toBe('Lost the police 2 times')
  })

  it('every career race and elimination has police, and the other events do not', () => {
    for (const e of TIERS.flatMap((t) => t.events)) {
      if (e.kind === 'race' || e.kind === 'elimination') expect(e.patrols).toBeGreaterThan(0)
      else expect(e.patrols ?? 0).toBe(0)
    }
  })
})
