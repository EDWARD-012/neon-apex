import { describe, expect, it } from 'vitest'
import { fresh, type Progress, type Run, settle, tidy, TIERS, upgrade } from '../src/career'
import { createCar, idle, speedOf, stepCar } from '../src/sim/car'
import { carById, CARS, ratings } from '../src/sim/cars'
import { Race, STEP } from '../src/sim/race'
import { buildTrack, pointAt } from '../src/sim/track'
import { kmh, PARTS, priceOf, STAGES, STARTER_VALUE, tuned } from '../src/upgrades'

const track = buildTrack('upgrades')
const open = { ...track, width: 1e6 }
const start = (spec = CARS[0].spec) => {
  const p = pointAt(track, 20, 0)
  return createCar(p.x, p.z, p.heading, track, spec)
}

describe('upgrades', () => {
  it('each engine stage gives every car its own top speed, as in the plan', () => {
    const speeds = (id: string) => [0, 1, 2, 3].map((n) => kmh(tuned(carById(id), { engine: n })))
    expect(speeds('brute')).toEqual([281, 292, 303, 314])
    expect(speeds('vanta')).toEqual([259, 270, 280, 290])
    expect(speeds('volt')).toEqual([256, 266, 276, 286])
    expect(speeds('kite')).toEqual([238, 247, 257, 266])
  })

  it('prices follow the car, and the starter car is priced as if it cost 10,000', () => {
    expect(priceOf(carById('kite'), 'engine', 1)).toBe(900)
    expect(priceOf(carById('kite'), 'engine', 3)).toBe(3000)
    expect(priceOf(carById('vanta'), 'engine', 1)).toBe(STARTER_VALUE * 0.15)
    for (const car of CARS) for (const part of PARTS) for (let n = 1; n <= STAGES; n++) expect(priceOf(car, part.id, n)).toBeGreaterThan(0)
  })

  it('a fully upgraded car still rates between 0 and 1 on every bar', () => {
    const all = Object.fromEntries(PARTS.map((p) => [p.id, STAGES]))
    for (const car of CARS) {
      for (const v of Object.values(ratings(tuned(car, all)))) {
        expect(v).toBeGreaterThan(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('the engine upgrade is quicker in the physics, not just on paper', () => {
    const stock = start()
    const tunedCar = start(tuned(CARS[0], { engine: 3 }))
    for (let t = 0; t < 40; t += STEP) {
      stepCar(stock, { ...idle, throttle: 1 }, STEP, open)
      stepCar(tunedCar, { ...idle, throttle: 1 }, STEP, open)
    }
    expect(speedOf(tunedCar)).toBeGreaterThan(speedOf(stock) * 1.08)
  })

  it('armour takes less damage from the same wall', () => {
    const hit = (spec = CARS[0].spec) => {
      const car = start(spec)
      car.heading -= Math.PI / 2
      car.vx = Math.sin(car.heading) * 30
      car.vz = Math.cos(car.heading) * 30
      for (let t = 0; t < 2; t += STEP) stepCar(car, { ...idle, throttle: 1 }, STEP, track)
      return car.damage
    }
    expect(hit(tuned(CARS[0], { armour: 3 }))).toBeLessThan(hit() * 0.7)
  })

  it('a stage is bought in order, only for an owned car, and only with the coins for it', () => {
    const rich: Progress = { ...fresh(), cash: 100000 }
    expect(upgrade({ ...fresh(), cash: 100 }, 'vanta', 'engine')).toBeNull()
    expect(upgrade(rich, 'kite', 'engine')).toBeNull()
    let p = rich
    for (let n = 1; n <= STAGES; n++) {
      const next = upgrade(p, 'vanta', 'engine') as Progress
      expect(next.upgrades.vanta.engine).toBe(n)
      expect(next.cash).toBe(p.cash - priceOf(CARS[0], 'engine', n))
      p = next
    }
    expect(upgrade(p, 'vanta', 'engine')).toBeNull()
  })

  it('an old save gets empty upgrades and no daily streak', () => {
    const p = tidy({ cash: 500, owned: ['vanta'], won: { 'first-night': true } })
    expect(p.upgrades).toEqual({})
    expect(p.daily).toBeNull()
    expect(p.won['first-night']).toBe(true)
  })
})

describe('coins', () => {
  const quick = (changes: Partial<Run> = {}): Run => ({
    kind: 'race',
    laps: 3,
    finished: true,
    place: 1,
    heat: 1,
    nearMisses: 0,
    cleanLaps: 0,
    closeWin: false,
    daily: false,
    ...changes,
  })
  const today = '2026-11-21'

  it('a quick race pays 1,000 for a win, 500 for a podium and 200 for finishing, over three laps', () => {
    expect(settle(fresh(), quick(), today).total).toBe(1000)
    expect(settle(fresh(), quick({ place: 3 }), today).total).toBe(500)
    expect(settle(fresh(), quick({ place: 6 }), today).total).toBe(200)
    expect(settle(fresh(), quick({ finished: false, place: 6 }), today).total).toBe(0)
    // One lap pays a third, rounded to 50.
    expect(settle(fresh(), quick({ laps: 1 }), today).total).toBe(350)
  })

  it('skills pay on top: near misses, drift points and clean laps', () => {
    const paid = settle(fresh(), quick({ nearMisses: 3, points: 1234, cleanLaps: 2 }), today)
    expect(paid.total).toBe(1000 + 150 + 123 + 200)
    expect(paid.progress.cash).toBe(paid.total)
    expect(paid.lines.map((l) => l.label)).toEqual(['Win', '3 near misses', '1,234 drift points', '2 clean laps'])
  })

  it('a close win pays a fifth more', () => {
    expect(settle(fresh(), quick({ closeWin: true }), today).total).toBe(1200)
  })

  it('an escape pays by the heat, and busted pays nothing at all', () => {
    expect(settle(fresh(), quick({ kind: 'pursuit', escaped: true, heat: 3 }), today).total).toBe(3000)
    const busted = settle(fresh(), quick({ kind: 'pursuit', escaped: false, heat: 4, nearMisses: 5, daily: true }), today)
    expect(busted.total).toBe(0)
    expect(busted.progress.daily).toBeNull()
  })

  it('the first run of the day on the daily track pays a bonus that grows with the streak', () => {
    const first = settle(fresh(), quick({ daily: true }), today)
    expect(first.total).toBe(1000 + 1000)
    expect(first.progress.daily).toEqual({ day: today, streak: 1 })
    // A second run the same day gets no bonus.
    expect(settle(first.progress, quick({ daily: true }), today).total).toBe(1000)
    // The next day is day two in a row.
    const second = settle(first.progress, quick({ daily: true }), '2026-11-22')
    expect(second.total).toBe(1000 + 1250)
    expect(second.progress.daily?.streak).toBe(2)
    // Missing a day starts again.
    expect(settle(first.progress, quick({ daily: true }), '2026-11-23').progress.daily?.streak).toBe(1)
    // Seven days and on pays 2,500.
    const long = { ...fresh(), daily: { day: '2026-11-20', streak: 9 } }
    expect(settle(long, quick({ daily: true }), today).total).toBe(1000 + 2500)
  })

  it('a career event pays its reward, marks it won, and the skills still count', () => {
    const event = TIERS[0].events[0]
    const paid = settle(fresh(), quick({ nearMisses: 2 }), today, event)
    expect(paid.result?.won).toBe(true)
    expect(paid.total).toBe(event.reward + 100)
    expect(paid.progress.won[event.id]).toBe(true)
  })
})

describe('counting in the race', () => {
  it('laps without damage are counted as clean', () => {
    const race = new Race({ seed: 'clean', laps: 2, rivals: 0, autopilot: true })
    for (let t = 0; t < 300 && race.phase !== 'finished'; t += STEP) race.step()
    expect(race.player.lapTimes).toHaveLength(2)
    // The AI drives it without touching a wall.
    expect(race.player.car.damage).toBe(0)
    expect(race.cleanLaps).toBe(2)
  })

  it('a lap with a hit is not clean', () => {
    const race = new Race({ seed: 'dirty', laps: 2, rivals: 0, autopilot: true })
    let hit = false
    for (let t = 0; t < 300 && race.phase !== 'finished'; t += STEP) {
      race.step()
      // Halfway round the first lap, the car takes a knock.
      if (!hit && race.player.checkpoints === 8) {
        race.player.car.damage += 0.1
        hit = true
      }
    }
    expect(race.player.lapTimes).toHaveLength(2)
    expect(race.cleanLaps).toBe(1)
  })
})
