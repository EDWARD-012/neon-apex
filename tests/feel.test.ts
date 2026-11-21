import { describe, expect, it } from 'vitest'
import { fresh, settle } from '../src/career'
import { BOOST_TIME, type CarInput, createCar, idle, speedOf, stepCar } from '../src/sim/car'
import { brakingAid } from '../src/sim/ai'
import { racingLine } from '../src/sim/line'
import { Race, SLIP_NITRO, STEP, TAKEDOWN_HIT } from '../src/sim/race'
import { buildTrack, locate, pointAt } from '../src/sim/track'

const track = buildTrack('feel')
const open = { ...track, width: 1e6 }
const start = (speed: number, onTrack = open) => {
  const p = pointAt(track, 20, 0)
  const car = createCar(p.x, p.z, p.heading, onTrack)
  car.vx = Math.sin(p.heading) * speed
  car.vz = Math.cos(p.heading) * speed
  return car
}
const drive = (car: ReturnType<typeof start>, input: CarInput, seconds: number, onTrack = open) => {
  let most = 0
  for (let t = 0; t < seconds; t += STEP) {
    stepCar(car, input, STEP, onTrack)
    most = Math.max(most, car.boost)
  }
  return most
}

// A brake-tap drift held for some seconds, then let go by straightening up.
const driftFor = (seconds: number) => {
  const car = start(32)
  drive(car, { ...idle, throttle: 1, steer: 1, brake: 1, assist: true }, STEP)
  drive(car, { ...idle, throttle: 1, steer: 0.7, assist: true }, seconds)
  expect(car.driftDir).not.toBe(0)
  return drive(car, { ...idle, throttle: 1, steer: 0, assist: true }, 1.5)
}

describe('drift boost', () => {
  it('a short drift gives nothing, 1 s a small boost and 3 s a big one', () => {
    expect(driftFor(0.5)).toBe(0)
    expect(driftFor(1.4)).toBeCloseTo(BOOST_TIME[1], 1)
    expect(driftFor(3.5)).toBeCloseTo(BOOST_TIME[2], 1)
  })

  it('the boost pushes the car faster', () => {
    const plain = start(30)
    const boosted = start(30)
    boosted.boost = BOOST_TIME[2]
    for (let t = 0; t < 1.2; t += STEP) {
      stepCar(plain, { ...idle, throttle: 1 }, STEP, open)
      stepCar(boosted, { ...idle, throttle: 1 }, STEP, open)
    }
    expect(speedOf(boosted)).toBeGreaterThan(speedOf(plain) + 3)
  })
})

describe('walls', () => {
  // A car aimed at the right-hand barrier at some angle off the road's line.
  const intoWall = (speed: number, angle: number) => {
    const p = pointAt(track, 40, 5)
    const car = createCar(p.x, p.z, p.heading, track)
    // Turn towards the right-hand side of the road: +d is to the right.
    const i = locate(track, p.x, p.z).i
    const toWall = Math.atan2(track.nx[i], track.nz[i])
    const h = p.heading + Math.sign(Math.sin(toWall - p.heading)) * angle
    Object.assign(car, { heading: h, vx: Math.sin(h) * speed, vz: Math.cos(h) * speed })
    for (let t = 0; t < 1; t += STEP) stepCar(car, idle, STEP, track)
    return speedOf(car)
  }

  it('a glancing touch keeps most of the speed', () => {
    expect(intoWall(40, 0.12)).toBeGreaterThan(40 * 0.85)
  })

  it('a head-on hit stops the car', () => {
    expect(intoWall(30, Math.PI / 2)).toBeLessThan(12)
  })
})

describe('takedowns', () => {
  // Lines the player's car up 3.5 m behind another car, both aimed at the
  // barrier, the other car about 2 m from it, the player a little faster.
  const shove = (race: Race, other: ReturnType<typeof start>) => {
    const t = race.track
    const at = pointAt(t, 60, 5)
    const i = locate(t, at.x, at.z).i
    const h = Math.atan2(t.nx[i], t.nz[i])
    const fx = Math.sin(h)
    const fz = Math.cos(h)
    Object.assign(other, { x: at.x, z: at.z, heading: h, vx: fx * 28, vz: fz * 28, yawRate: 0, hint: i })
    const me = race.player.car
    Object.assign(me, { x: at.x - fx * 3.5, z: at.z - fz * 3.5, heading: h, vx: fx * 34, vz: fz * 34, yawRate: 0, hint: i })
    race.playerInput = { ...idle, throttle: 1 }
    for (let k = 0; k < 60; k++) race.step()
  }

  it('shoving a rival into a wall wrecks it', () => {
    const race = new Race({ seed: 'takedown', laps: 3, rivals: 1 })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    const rival = race.racers[0]
    shove(race, rival.car)
    expect(rival.out).toBe(true)
    expect(rival.fate).toBe('wrecked')
    expect(race.takedowns.rivals).toBe(1)
    expect(race.events.some((e) => e.type === 'takedown' && e.id === rival.id)).toBe(true)
  })

  it('shoving a patrol car into a wall takes it out of the chase', () => {
    const race = new Race({ seed: 'takedown-cop', laps: 99, rivals: 0, mode: 'pursuit', police: 1 })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    const cop = race.police[0]
    shove(race, cop)
    expect(race.wreckedCops.has(cop)).toBe(true)
    expect(race.activeCops).toHaveLength(0)
    expect(race.takedowns.cops).toEqual([1])
  })

  it('a car that hits a wall on its own is not a takedown', () => {
    const race = new Race({ seed: 'takedown-alone', laps: 3, rivals: 1 })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    const car = race.racers[0].car
    car.wallHit = TAKEDOWN_HIT + 5
    race.step()
    expect(race.racers[0].out).toBe(false)
  })

  it('takedowns pay 300 a rival and 500 a heat level for a patrol car', () => {
    const run = { kind: 'race' as const, laps: 3, finished: true, place: 4, heat: 1, nearMisses: 0, cleanLaps: 0, closeWin: false, daily: false }
    const paid = settle(fresh(), { ...run, takedowns: { rivals: 2, cops: [1, 2] } }, '2026-11-21')
    expect(paid.total).toBe(200 + 600 + 1500)
  })
})

describe('driving aids', () => {
  it('braking assist brakes when the car is too fast for the road ahead, and leaves it alone otherwise', () => {
    const line = racingLine(track)
    // The slowest point of the racing line, and a car 40 m before it.
    let slow = 0
    for (let i = 0; i < track.n; i++) if (line.speed[i] < line.speed[slow]) slow = i
    const at = pointAt(track, (slow - 20) * track.spacing, 0)
    const car = createCar(at.x, at.z, at.heading, track)
    const flat = { ...idle, throttle: 1 }
    car.vx = Math.sin(at.heading) * (line.speed[slow] + 15)
    car.vz = Math.cos(at.heading) * (line.speed[slow] + 15)
    const fast = brakingAid(car, flat, track, line)
    expect(fast.brake).toBeGreaterThan(0.25)
    expect(fast.throttle).toBe(0)
    car.vx = Math.sin(at.heading) * (line.speed[slow] * 0.8)
    car.vz = Math.cos(at.heading) * (line.speed[slow] * 0.8)
    expect(brakingAid(car, flat, track, line)).toBe(flat)
  })

  it('with stability off, a car that starts to rotate keeps rotating for longer', () => {
    const spin = (raw: boolean) => {
      const car = start(35)
      car.yawRate = 0.8
      for (let t = 0; t < 0.5; t += STEP) stepCar(car, { ...idle, throttle: 1, raw }, STEP, open)
      return Math.abs(car.yawRate)
    }
    expect(spin(true)).toBeGreaterThan(spin(false))
  })
})

describe('slipstream', () => {
  // The player's car at 30 m/s, `behind` metres behind a rival going the
  // same way and `side` metres to its right, for one second.
  const follow = (behind: number, side: number) => {
    const race = new Race({ seed: 'slipstream', laps: 3, rivals: 1 })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    const t = race.track
    const at = pointAt(t, 200, 0)
    const h = at.heading
    const fx = Math.sin(h)
    const fz = Math.cos(h)
    const i = locate(t, at.x, at.z).i
    const rival = race.racers[0].car
    Object.assign(rival, { x: at.x, z: at.z, heading: h, vx: fx * 30, vz: fz * 30, yawRate: 0, hint: i })
    const me = race.player.car
    Object.assign(me, { x: at.x - fx * behind + fz * side, z: at.z - fz * behind - fx * side, heading: h, vx: fx * 30, vz: fz * 30, yawRate: 0, hint: i, nitro: 0 })
    race.playerInput = { ...idle, throttle: 0.6 }
    // The game empties the event list each frame; here it only grows.
    race.events.length = 0
    for (let k = 0; k < 120; k++) race.step()
    return { nitro: me.nitro, events: race.events.filter((e) => e.type === 'slipstream').length }
  }

  it('close behind a rival fills the nitro, and says so once', () => {
    const tucked = follow(8, 0)
    const wide = follow(8, 4)
    expect(tucked.nitro - wide.nitro).toBeGreaterThan(SLIP_NITRO * 0.5)
    expect(tucked.events).toBe(1)
    expect(wide.events).toBe(0)
  })

  it('too far back gets nothing', () => {
    expect(follow(40, 0).events).toBe(0)
  })
})

