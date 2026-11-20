import { describe, expect, it } from 'vitest'
import { collideCars, createCar, idle } from '../src/sim/car'
import { HEAVY_SPEC, POLICE_SPEC } from '../src/sim/cars'
import { racingLine } from '../src/sim/line'
import { chase } from '../src/sim/police'
import { HEAT_STEP, MAX_HEAT, PUNCTURED, Race, type RaceEvent, ROADBLOCK_GAP, SETUP_AHEAD, SETUP_EVERY, SETUP_HEAT, STEP } from '../src/sim/race'
import { buildTrack, locate, pointAt } from '../src/sim/track'

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

describe('roadblocks and spike strips', () => {
  const start = (seed: string, traffic = 0) => {
    const race = new Race({ seed, laps: 99, rivals: 0, mode: 'pursuit', police: 1, traffic })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    return race
  }
  const along = (race: Race, x: number, z: number, from: number) => {
    const L = race.track.length
    let ds = locate(race.track, x, z).s - from
    if (ds > L / 2) ds -= L
    if (ds < -L / 2) ds += L
    return ds
  }

  it('from heat 3 a roadblock goes up out of sight ahead, with a gap left open', () => {
    const race = start('roadblock', 8)
    const me = race.player.car
    const from = locate(race.track, me.x, me.z).s
    race.pursuit.heat = SETUP_HEAT
    race.pursuit.sinceJoin = 0
    for (let t = 0; t < SETUP_EVERY + 0.1; t += STEP) {
      race.pursuit.busted = 0
      race.step()
    }
    const events = race.events.map((e) => e.type)
    expect(events).toContain('roadblock')
    expect(race.blockade.length).toBe(2)
    const w = race.track.width
    const across = race.blockade.map((c) => locate(race.track, c.x, c.z).d).sort((a, b) => a - b)
    for (const c of race.blockade) {
      expect(along(race, c.x, c.z, from)).toBeGreaterThan(SETUP_AHEAD - 20)
      expect(race.activeCops).not.toContain(c)
    }
    // The open road left beside the parked cars, which cover about 2.3 m
    // either side of their centres.
    const open = Math.max(across[0] - 2.3 + w / 2, w / 2 - (across[across.length - 1] + 2.3))
    expect(open).toBeGreaterThanOrEqual(ROADBLOCK_GAP - 0.5)
    // Nobody hits them, so they stay where they were put.
    const before = race.blockade.map((c) => [c.x, c.z])
    for (let t = 0; t < 1; t += STEP) race.step()
    race.blockade.forEach((c, k) => expect(Math.hypot(c.x - before[k][0], c.z - before[k][1])).toBeLessThan(0.05))
    // Traffic is moved on rather than left to queue in the gap.
    const at = locate(race.track, race.blockade[0].x, race.blockade[0].z).s
    for (const t of race.traffic) expect(Math.abs(along(race, t.car.x, t.car.z, at))).toBeGreaterThan(40)
  })

  it('a spike strip blows the tyres of a car that crosses it, and only that half of the road', () => {
    const drive = (offset: number) => {
      const race = start('spikes')
      const strip = { s: 200, offset: race.track.width / 4, half: race.track.width / 4 + 0.6 }
      race.spikes.push(strip)
      const me = race.player.car
      const top = me.spec.topSpeed
      const p = pointAt(race.track, 192, offset)
      Object.assign(me, { x: p.x, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * 20, vz: Math.cos(p.heading) * 20, yawRate: 0, hint: locate(race.track, p.x, p.z).i })
      race.playerInput = { ...idle, throttle: 1 }
      for (let t = 0; t < 0.8; t += STEP) race.step()
      return { race, top }
    }
    const clean = drive(-quarter())
    expect(clean.race.punctured).toBe(false)
    const hit = drive(quarter())
    expect(hit.race.punctured).toBe(true)
    expect(hit.race.events.map((e) => e.type)).toContain('punctured')
    expect(hit.race.player.car.spec.topSpeed).toBeCloseTo(hit.top * PUNCTURED.topSpeed, 5)
  })
})

// A lane's width in from the centre line, on the strip's side or the other.
const quarter = () => buildTrack('spikes').width / 4
