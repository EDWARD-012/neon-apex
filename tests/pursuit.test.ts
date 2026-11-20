import { describe, expect, it } from 'vitest'
import { collideCars, createCar, idle } from '../src/sim/car'
import { HEAVY_SPEC, POLICE_SPEC } from '../src/sim/cars'
import { racingLine } from '../src/sim/line'
import { chase } from '../src/sim/police'
import { HEAT_STEP, MAX_HEAT, Race, type RaceEvent, STEP } from '../src/sim/race'
import { buildTrack, pointAt } from '../src/sim/track'

describe('heat levels', () => {
  it('each level brings its own units: a pair, a heavy unit, a blocker, then interceptors', () => {
    const race = new Race({ seed: 'heat-levels', laps: 99, rivals: 0, mode: 'pursuit', police: 1 })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    const events: RaceEvent[] = []
    for (let heat = 2; heat <= MAX_HEAT; heat++) {
      race.pursuit.sinceJoin = HEAT_STEP + 1
      race.player.car.vx = 30
      race.step()
      events.push(...race.events)
      race.events = []
    }
    expect(race.pursuit.heat).toBe(MAX_HEAT)
    expect(events.filter((e) => e.type === 'heatUp').map((e) => (e as { heat: number }).heat)).toEqual([2, 3, 4, 5])
    const kinds = race.police.map((c) => race.copKind.get(c))
    expect(kinds.filter((k) => k === 'heavy')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'interceptor')).toHaveLength(2)
    expect(race.police.filter((c) => race.copRole.get(c) === 'block')).toHaveLength(2)
    expect(events.filter((e) => e.type === 'copJoined')).toHaveLength(race.police.length - 1)
  })

  it('a race never has more police after the player than its limit', () => {
    const race = new Race({ seed: 'heat-race', laps: 3, rivals: 0, patrols: 2 })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    race.parked.clear()
    race.chasing = true
    for (let heat = 2; heat <= MAX_HEAT; heat++) {
      race.pursuit.sinceJoin = HEAT_STEP + 1
      race.step()
    }
    expect(race.activeCops.length).toBeLessThanOrEqual(2)
  })
})

describe('weight in collisions', () => {
  it('a heavy unit moves half as much as the patrol car it hits', () => {
    const track = buildTrack('mass')
    const p = pointAt(track, 30, 0)
    const heavy = createCar(p.x, p.z, p.heading, track, HEAVY_SPEC)
    const light = createCar(p.x + Math.sin(p.heading) * 3, p.z + Math.cos(p.heading) * 3, p.heading, track, POLICE_SPEC)
    heavy.vx = Math.sin(p.heading) * 20
    heavy.vz = Math.cos(p.heading) * 20
    collideCars(heavy, light)
    const heavyLoss = 20 - Math.hypot(heavy.vx, heavy.vz)
    const lightGain = Math.hypot(light.vx, light.vz)
    expect(lightGain).toBeCloseTo(heavyLoss * 2, 5)
    expect(light.damage).toBeGreaterThan(heavy.damage)
  })
})

describe('blockers', () => {
  it('a blocker just ahead of the player slows down in its path', () => {
    const track = buildTrack('block')
    const line = racingLine(track)
    const at = (s: number) => pointAt(track, s, 0)
    const me = createCar(at(100).x, at(100).z, at(100).heading, track)
    const cop = createCar(at(120).x, at(120).z, at(120).heading, track, POLICE_SPEC)
    for (const [car, v] of [
      [me, 35],
      [cop, 35],
    ] as const) {
      car.vx = Math.sin(car.heading) * v
      car.vz = Math.cos(car.heading) * v
    }
    const block = chase(cop, me, track, line, 'block')
    const ram = chase(cop, me, track, line, 'ram')
    expect(block.throttle).toBe(0)
    expect(block.brake).toBeGreaterThan(0)
    expect(block).not.toEqual(ram)
    expect(idle.throttle).toBe(0)
  })
})
