import { describe, expect, it } from 'vitest'
import { CAR, type CarInput, collideCars, createCar, forwardSpeed, idle, speedOf, stepCar } from '../src/sim/car'
import { STEP } from '../src/sim/race'
import { buildTrack, locate, pointAt } from '../src/sim/track'

const track = buildTrack('physics')
const start = () => {
  const p = pointAt(track, 20, 0)
  return createCar(p.x, p.z, p.heading, track)
}
const run = (car = start(), input: CarInput, seconds: number) => {
  for (let t = 0; t < seconds; t += STEP) stepCar(car, input, STEP, track)
  return car
}
const full = { ...idle, throttle: 1 }

describe('car physics', () => {
  it('accelerates, and never past top speed without nitro', () => {
    const car = start()
    run(car, full, 1)
    expect(forwardSpeed(car)).toBeGreaterThan(10)
    // A straight line long enough to max out does not exist on every track,
    // so this one runs on a track with no barriers in the way.
    const open = { ...track, width: 1e6 }
    for (let t = 0; t < 40; t += STEP) stepCar(car, full, STEP, open)
    expect(speedOf(car)).toBeLessThanOrEqual(CAR.topSpeed + 0.01)
    expect(speedOf(car)).toBeGreaterThan(CAR.topSpeed * 0.9)
  })

  it('nitro adds speed and drains the tank', () => {
    const plain = run(start(), full, 2)
    const boosted = start()
    boosted.nitro = 1
    run(boosted, { ...full, nitro: true }, 2)
    expect(forwardSpeed(boosted)).toBeGreaterThan(forwardSpeed(plain) + 2)
    expect(boosted.nitro).toBeLessThan(0.5)
  })

  it('brakes to a stop and then reverses slowly', () => {
    const car = run(start(), full, 2)
    run(car, { ...idle, brake: 1 }, 1.5)
    expect(forwardSpeed(car)).toBeLessThanOrEqual(0.5)
    run(car, { ...idle, brake: 1 }, 6)
    expect(forwardSpeed(car)).toBeLessThan(0)
    expect(forwardSpeed(car)).toBeGreaterThanOrEqual(-CAR.reverseTop - 0.01)
  })

  it('steering right turns the car right', () => {
    const car = run(start(), full, 1.5)
    const before = car.heading
    run(car, { ...full, steer: 1 }, 0.4)
    // Facing +z, right is -x, which is the negative heading direction.
    expect(car.heading).toBeLessThan(before)
  })

  it('the handbrake makes the car slide', () => {
    const grip = run(start(), full, 2.5)
    run(grip, { ...full, steer: 1 }, 0.5)
    const slide = run(start(), full, 2.5)
    run(slide, { ...full, steer: 1, handbrake: true }, 0.5)
    expect(slide.slip).toBeGreaterThan(grip.slip + 0.1)
    expect(slide.drifting).toBe(true)
  })

  it('corners at the tyres\' grip limit, not past it', () => {
    // Open ground, so the barriers stay out of the way.
    const open = { ...track, width: 1e6 }
    const car = createCar(0, 0, 0, open)
    car.vz = 40
    for (let t = 0; t < 3; t += STEP) stepCar(car, { ...idle, throttle: 0.4, steer: 1 }, STEP, open)
    const lateral = speedOf(car) * Math.abs(car.yawRate)
    expect(lateral).toBeGreaterThan(CAR.lateralLimit * 0.85)
    expect(lateral).toBeLessThan(CAR.lateralLimit * 1.15)
  })

  it('a handbrake drift held on throttle and countersteer lasts, without spinning', () => {
    const open = { ...track, width: 1e6 }
    const car = createCar(0, 0, 0, open)
    car.vz = 30
    let sliding = 0
    let worst = 0
    for (let t = 0; t < 3.5; t += STEP) {
      const handbrake = t < 0.45
      const steer = handbrake ? 0.8 : car.slip > 0.5 ? -0.45 : 0.45
      stepCar(car, { ...idle, throttle: handbrake ? 0.3 : 1, steer, handbrake }, STEP, open)
      if (car.drifting) sliding += STEP
      worst = Math.max(worst, car.slip)
    }
    expect(sliding).toBeGreaterThan(2)
    expect(worst).toBeLessThan(1.1)
    expect(speedOf(car)).toBeGreaterThan(20)
  })

  it('a brake tap while steering at speed throws the car into a drift that holds and then straightens', () => {
    const open = { ...track, width: 1e6 }
    const car = createCar(0, 0, 0, open)
    car.vz = 32
    const play = (input: Partial<CarInput>, seconds: number) => {
      for (let t = 0; t < seconds; t += STEP) stepCar(car, { ...idle, assist: true, ...input }, STEP, open)
    }
    play({ throttle: 1, steer: 0.8, brake: 1 }, 0.1)
    play({ throttle: 1, steer: 0.8 }, 1.6)
    expect(car.driftDir).toBe(1)
    expect(car.drifting).toBe(true)
    expect(car.slip).toBeGreaterThan(0.4)
    expect(car.slip).toBeLessThan(0.8)
    expect(speedOf(car)).toBeGreaterThan(24)
    play({ throttle: 1, steer: -0.6 }, 1.2)
    expect(car.driftDir).toBe(0)
  })

  it('the AI, without driving aids, does not drift from braking into a corner', () => {
    const open = { ...track, width: 1e6 }
    const car = createCar(0, 0, 0, open)
    car.vz = 32
    for (let t = 0; t < 0.6; t += STEP) stepCar(car, { ...idle, steer: 0.8, brake: 1 }, STEP, open)
    expect(car.driftDir).toBe(0)
  })

  it('barriers keep the car on the track', () => {
    const car = start()
    for (let t = 0; t < 8; t += STEP) stepCar(car, { ...full, steer: 1 }, STEP, track)
    const where = locate(track, car.x, car.z)
    expect(Math.abs(where.d)).toBeLessThanOrEqual(track.width / 2 + 0.8)
  })

  it('is deterministic', () => {
    const a = run(start(), { ...full, steer: 0.3 }, 3)
    const b = run(start(), { ...full, steer: 0.3 }, 3)
    expect(b).toEqual(a)
  })

  it('a car running into the back of another pushes it on', () => {
    const a = start()
    const b = start()
    // b is 3 m straight ahead of a, so a's front circle overlaps b's rear one.
    b.x += Math.sin(b.heading) * 3
    b.z += Math.cos(b.heading) * 3
    a.vx = Math.sin(a.heading) * 10
    a.vz = Math.cos(a.heading) * 10
    expect(collideCars(a, b)).toBeGreaterThan(0)
    expect(b.vx * Math.sin(b.heading) + b.vz * Math.cos(b.heading)).toBeGreaterThan(0)
  })

  it('two cars side by side a metre apart do not touch', () => {
    const a = start()
    const b = start()
    // 2.9 m apart sideways: 1 m of air between two 1.9 m wide cars.
    b.x += -Math.cos(b.heading) * 2.9
    b.z += Math.sin(b.heading) * 2.9
    expect(collideCars(a, b)).toBe(0)
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(2.9, 6)
  })
})

describe('damage', () => {
  it('a hard barrier hit damages the car and records where it landed', () => {
    const car = start()
    // Drive straight at the right-hand barrier.
    car.heading -= Math.PI / 2
    car.vx = Math.sin(car.heading) * 30
    car.vz = Math.cos(car.heading) * 30
    for (let t = 0; t < 2; t += STEP) stepCar(car, { ...idle, throttle: 1 }, STEP, track)
    expect(car.damage).toBeGreaterThan(0.1)
    expect(car.hits.length).toBeGreaterThanOrEqual(4)
    // Head first into the wall: the first hit is on the nose.
    expect(car.hits[2]).toBeGreaterThan(1.5)
  })

  it('a light touch does no damage', () => {
    const a = start()
    const b = start()
    b.x += Math.sin(b.heading) * 3.5
    b.z += Math.cos(b.heading) * 3.5
    a.vx = Math.sin(a.heading) * 2
    a.vz = Math.cos(a.heading) * 2
    collideCars(a, b)
    expect(a.damage).toBe(0)
    expect(a.hits).toHaveLength(0)
  })

  it('a rear-end shunt marks the front of one car and the back of the other', () => {
    const a = start()
    const b = start()
    b.x += Math.sin(b.heading) * 3
    b.z += Math.cos(b.heading) * 3
    a.vx = Math.sin(a.heading) * 20
    a.vz = Math.cos(a.heading) * 20
    collideCars(a, b)
    expect(a.hits[2]).toBeGreaterThan(0)
    expect(b.hits[2]).toBeLessThan(0)
    expect(a.damage).toBeGreaterThan(0)
  })

  it('a damaged car is slower', () => {
    const open = { ...track, width: 1e6 }
    const fresh = start()
    const wrecked = start()
    wrecked.damage = 1
    for (let t = 0; t < 30; t += STEP) {
      stepCar(fresh, full, STEP, open)
      stepCar(wrecked, full, STEP, open)
    }
    expect(speedOf(wrecked)).toBeLessThan(speedOf(fresh) * 0.92)
  })
})
