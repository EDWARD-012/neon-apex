import { describe, expect, it } from 'vitest'
import { idle } from '../src/sim/car'
import { CARS, ratings } from '../src/sim/cars'
import { ESCAPE_DISTANCE, MAX_POLICE, Race, type RaceEvent, STEP } from '../src/sim/race'
import { pointAt } from '../src/sim/track'

const run = (race: Race, seconds: number, events: RaceEvent[] = []) => {
  for (let t = 0; t < seconds && race.phase !== 'finished'; t += STEP) {
    race.step()
    events.push(...race.events)
    race.events = []
  }
  return events
}

describe('elimination', () => {
  it('knocks out one car per lap until one is left', () => {
    // A quick car for the player against a slow field, so the player is not
    // the one knocked out and the race runs to the end.
    const race = new Race({ seed: 'elim', laps: 99, rivals: 4, autopilot: true, mode: 'elimination', skill: 0.8, playerSpec: CARS[3].spec })
    const events = run(race, 600)
    expect(race.phase).toBe('finished')
    const out = events.filter((e) => e.type === 'eliminated')
    expect(out).toHaveLength(4)
    expect(race.racers.filter((r) => !r.out)).toHaveLength(1)
    const winner = race.standings()[0]
    expect(winner.out).toBe(false)
    expect(winner.finishTime).not.toBeNull()
    // The last car knocked out is second, the first one out is last.
    const ids = race.standings().map((r) => r.id)
    expect(ids.slice(1)).toEqual(race.eliminated.slice().reverse())
  })

  it('a player who stops is knocked out and the event ends', () => {
    const race = new Race({ seed: 'elim-stop', laps: 99, rivals: 3, mode: 'elimination' })
    run(race, 200)
    expect(race.player.out).toBe(true)
    expect(race.phase).toBe('finished')
  })
})

describe('pursuit', () => {
  it('a player who sits still next to the police is busted', () => {
    const race = new Race({ seed: 'busted', laps: 99, rivals: 0, mode: 'pursuit', police: 2 })
    const events = run(race, 60)
    expect(race.pursuit.outcome).toBe('busted')
    expect(events.some((e) => e.type === 'busted')).toBe(true)
    expect(race.phase).toBe('finished')
  })

  it('getting far enough away from every patrol car is an escape', () => {
    const race = new Race({ seed: 'escape', laps: 99, rivals: 0, mode: 'pursuit', police: 2 })
    run(race, 3.1)
    // Hold the police in place far behind and let the player drive off.
    for (const cop of race.police) {
      const p = pointAt(race.track, race.track.length - 400, 0)
      Object.assign(cop, { x: p.x, z: p.z, vx: 0, vz: 0, heading: p.heading, hint: Math.floor((race.track.length - 400) / race.track.spacing) })
    }
    race.police.forEach((c) => (c.spec = { ...c.spec, topSpeed: 0.001, engine: 0 }))
    race.playerInput = { ...idle, throttle: 1 }
    const events = run(race, 60)
    expect(race.pursuit.outcome).toBe('escaped')
    expect(events.some((e) => e.type === 'escaped')).toBe(true)
    expect(ESCAPE_DISTANCE).toBeGreaterThan(100)
  })

  it('more police join as the chase goes on, up to a limit', () => {
    const race = new Race({ seed: 'heat', laps: 99, rivals: 0, mode: 'pursuit', police: 1, autopilot: true })
    const events = run(race, 300)
    const joined = events.filter((e) => e.type === 'copJoined').length
    expect(race.police.length).toBe(1 + joined)
    expect(race.police.length).toBeLessThanOrEqual(MAX_POLICE)
  })

  it('patrol cars catch up with a player on autopilot', () => {
    const race = new Race({ seed: 'catch', laps: 99, rivals: 0, mode: 'pursuit', police: 2, autopilot: true })
    let closest = Infinity
    for (let t = 0; t < 60 && race.phase !== 'finished'; t += STEP) {
      race.step()
      for (const cop of race.police) closest = Math.min(closest, Math.hypot(cop.x - race.player.car.x, cop.z - race.player.car.z))
    }
    expect(closest).toBeLessThan(12)
  })
})

describe('drift and near misses', () => {
  it('a handbrake slide banks drift points', () => {
    const race = new Race({ seed: 'drift', laps: 3, rivals: 0 })
    run(race, 3.1)
    race.playerInput = { ...idle, throttle: 1 }
    run(race, 3)
    race.playerInput = { ...idle, throttle: 1, steer: 1, handbrake: true }
    run(race, 0.4)
    race.playerInput = { ...idle, throttle: 1, steer: 0.6 }
    run(race, 0.3)
    race.playerInput = { ...idle, throttle: 1 }
    const events = run(race, 2)
    expect(events.some((e) => e.type === 'driftBank')).toBe(true)
    expect(race.drift.total).toBeGreaterThan(0)
  })

  it('passing a traffic car close and fast is a near miss', () => {
    const race = new Race({ seed: 'near', laps: 3, rivals: 0, traffic: 1 })
    run(race, 3.1)
    // Both cars on the straight after the start line: the traffic car 18 m
    // ahead in its lane, the player one lane over and much faster.
    const place = (car: typeof race.player.car, s: number, d: number, v: number) => {
      const p = pointAt(race.track, s, d)
      Object.assign(car, { x: p.x, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * v, vz: Math.cos(p.heading) * v, yawRate: 0, hint: Math.round(s / race.track.spacing) })
    }
    const t = race.traffic[0]
    place(t.car, 30, t.lane, 20)
    place(race.player.car, 12, t.lane - 3.2 * Math.sign(t.lane), 45)
    race.player.lastS = 12
    race.playerInput = { ...idle, throttle: 1 }
    const events = run(race, 1.5)
    expect(events.filter((e) => e.type === 'nearMiss')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'contact')).toHaveLength(0)
  })

  it('no near miss when the player is touching the traffic car', () => {
    const race = new Race({ seed: 'near', laps: 3, rivals: 0, traffic: 1 })
    run(race, 3.1)
    const t = race.traffic[0]
    const place = (car: typeof race.player.car, s: number, d: number, v: number) => {
      const p = pointAt(race.track, s, d)
      Object.assign(car, { x: p.x, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * v, vz: Math.cos(p.heading) * v, yawRate: 0, hint: Math.round(s / race.track.spacing) })
    }
    place(t.car, 30, t.lane, 20)
    // Same lane: the player runs into the back of it.
    place(race.player.car, 12, t.lane, 45)
    race.player.lastS = 12
    race.playerInput = { ...idle, throttle: 1 }
    const events = run(race, 1.5)
    expect(events.some((e) => e.type === 'contact')).toBe(true)
    expect(events.filter((e) => e.type === 'nearMiss')).toHaveLength(0)
  })
})

describe('cars', () => {
  it('every car rates between 0 and 1 and they differ', () => {
    const all = CARS.map((c) => ratings(c.spec))
    for (const r of all) {
      for (const v of Object.values(r)) {
        expect(v).toBeGreaterThan(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
    expect(new Set(all.map((r) => JSON.stringify(r))).size).toBe(CARS.length)
  })

  it.each(CARS.map((c) => [c.name, c] as const))('%s can be driven round a full lap by the AI', (_name, def) => {
    const race = new Race({ seed: `car-${def.id}`, laps: 1, rivals: 0, autopilot: true, playerSpec: def.spec })
    run(race, 200)
    expect(race.player.lapTimes).toHaveLength(1)
  })
})
