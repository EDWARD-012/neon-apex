import { describe, expect, it } from 'vitest'
import { CRASH_BEHIND, CRASH_HEAT, Race, type RaceEvent, STEP } from '../src/sim/race'
import { locate, pointAt } from '../src/sim/track'

const run = (race: Race, seconds: number, events: RaceEvent[] = []) => {
  for (let t = 0; t < seconds && race.phase !== 'finished'; t += STEP) {
    race.step()
    events.push(...race.events)
    race.events = []
  }
  return events
}

const race = (seed: string, patrols = 2) => {
  const r = new Race({ seed, laps: 3, rivals: 0, patrols })
  run(r, 3.1)
  return r
}

// Points the player's car square at the right-hand barrier at a speed.
const intoWall = (r: Race, speed: number) => {
  const at = pointAt(r.track, 120, 0)
  const heading = at.heading + Math.PI / 2
  Object.assign(r.player.car, { x: at.x, z: at.z, heading, vx: Math.sin(heading) * speed, vz: Math.cos(heading) * speed, yawRate: 0, hint: locate(r.track, at.x, at.z).i })
}

describe('police after a crash', () => {
  it('a hard wall hit in a race with police sends a patrol car in from behind', () => {
    const r = race('crash-wall')
    intoWall(r, 30)
    const events = run(r, 0.6)
    expect(events).toContainEqual({ type: 'crashReported', sent: true })
    expect(r.chasing).toBe(true)
    const cop = r.activeCops[0]
    expect(cop).toBeDefined()
    const me = locate(r.track, r.player.car.x, r.player.car.z).s
    const behind = (me - locate(r.track, cop.x, cop.z).s + r.track.length) % r.track.length
    expect(behind).toBeGreaterThan(CRASH_BEHIND - 40)
    expect(behind).toBeLessThan(CRASH_BEHIND + 40)
  })

  it('ramming a traffic car is reported too', () => {
    const r = new Race({ seed: 'crash-traffic', laps: 3, rivals: 0, patrols: 2, traffic: 4 })
    run(r, 3.1)
    const t = r.traffic[0]
    const s = locate(r.track, t.car.x, t.car.z).s
    const behind = pointAt(r.track, s - 6, t.lane)
    const v = 45
    Object.assign(r.player.car, { x: behind.x, z: behind.z, heading: behind.heading, vx: Math.sin(behind.heading) * v, vz: Math.cos(behind.heading) * v, yawRate: 0, hint: locate(r.track, behind.x, behind.z).i })
    const events = run(r, 0.5)
    expect(events).toContainEqual({ type: 'crashReported', sent: true })
  })

  it('a light touch on a wall is not reported', () => {
    const r = race('crash-light')
    intoWall(r, 5)
    const events = run(r, 1.5)
    expect(events.some((e) => e.type === 'crashReported')).toBe(false)
    expect(r.chasing).toBe(false)
  })

  it('a crash during a chase brings the next heat level sooner', () => {
    const r = race('crash-heat')
    intoWall(r, 30)
    run(r, 0.6)
    expect(r.chasing).toBe(true)
    run(r, 1.2)
    const before = r.pursuit.sinceJoin
    intoWall(r, 30)
    const events = run(r, 0.6)
    expect(events).toContainEqual({ type: 'crashReported', sent: false })
    expect(r.pursuit.sinceJoin).toBeGreaterThan(before + CRASH_HEAT - 1)
  })

  it('with the police off, a crash brings nobody', () => {
    const r = race('crash-off', 0)
    intoWall(r, 30)
    const events = run(r, 0.6)
    expect(events.some((e) => e.type === 'crashReported')).toBe(false)
    expect(r.police).toHaveLength(0)
  })
})

describe('a gentle bump in traffic', () => {
  it('is not a crash', () => {
    const r = new Race({ seed: 'crash-bump', laps: 3, rivals: 0, patrols: 2, traffic: 4 })
    for (let t = 0; t < 3.1; t += STEP) r.step()
    const t0 = r.traffic[0]
    const s = locate(r.track, t0.car.x, t0.car.z).s
    const behind = pointAt(r.track, s - 4.6, t0.lane)
    const v = Math.hypot(t0.car.vx, t0.car.vz) + 3
    Object.assign(r.player.car, { x: behind.x, z: behind.z, heading: behind.heading, vx: Math.sin(behind.heading) * v, vz: Math.cos(behind.heading) * v, yawRate: 0, hint: locate(r.track, behind.x, behind.z).i })
    const events: RaceEvent[] = []
    for (let t = 0; t < 0.5; t += STEP) {
      r.step()
      events.push(...r.events)
      r.events = []
    }
    expect(events.some((e) => e.type === 'crashReported')).toBe(false)
  })
})
