import { describe, expect, it } from 'vitest'
import { ALL_EVENTS, buy, fresh, judge, record, TIERS, tierOpen, WINS_TO_UNLOCK } from '../src/career'
import { CARS } from '../src/sim/cars'
import { buildTrack } from '../src/sim/track'

describe('career', () => {
  it('every event id is unique and every event track builds', () => {
    expect(new Set(ALL_EVENTS.map((e) => e.id)).size).toBe(ALL_EVENTS.length)
    for (const e of ALL_EVENTS) expect(() => buildTrack(e.seed)).not.toThrow()
  })

  it('only a win counts in a race, and places below pay less', () => {
    const race = TIERS[0].events[0]
    const first = judge(race, { place: 1 }, false)
    const third = judge(race, { place: 3 }, false)
    expect(first.won).toBe(true)
    expect(third.won).toBe(false)
    expect(first.cash).toBe(race.reward)
    expect(third.cash).toBeLessThan(first.cash)
    expect(third.cash).toBeGreaterThan(0)
  })

  it('a repeat win pays a quarter', () => {
    const race = TIERS[0].events[0]
    expect(judge(race, { place: 1 }, true).cash).toBe(Math.round((race.reward * 0.25) / 50) * 50)
  })

  it('drift, pursuit and time attack are judged against their targets', () => {
    const drift = ALL_EVENTS.find((e) => e.kind === 'drift')!
    expect(judge(drift, { points: drift.target! }, false).won).toBe(true)
    expect(judge(drift, { points: drift.target! - 1 }, false).won).toBe(false)
    const pursuit = ALL_EVENTS.find((e) => e.kind === 'pursuit')!
    expect(judge(pursuit, { escaped: true }, false).won).toBe(true)
    expect(judge(pursuit, { escaped: false }, false).cash).toBe(0)
    const trial = ALL_EVENTS.find((e) => e.kind === 'trial')!
    expect(judge(trial, { bestLap: 40, referenceLap: 40 / trial.target! }, false).won).toBe(true)
    expect(judge(trial, { bestLap: 40.1, referenceLap: 40 / trial.target! }, false).won).toBe(false)
  })

  it('the next tier opens after enough wins', () => {
    let p = fresh()
    expect(tierOpen(p, 0)).toBe(true)
    expect(tierOpen(p, 1)).toBe(false)
    for (const e of TIERS[0].events.slice(0, WINS_TO_UNLOCK)) p = record(p, e, judge(e, { place: 1, points: 1e9, escaped: true }, false))
    expect(tierOpen(p, 1)).toBe(true)
    expect(tierOpen(p, 2)).toBe(false)
  })

  it('cars cost cash and can only be bought once', () => {
    const kite = CARS.find((c) => c.id === 'kite')!
    expect(buy(fresh(), kite.id)).toBeNull()
    const rich = { ...fresh(), cash: kite.price + 10 }
    const bought = buy(rich, kite.id)!
    expect(bought.cash).toBe(10)
    expect(bought.owned).toContain('kite')
    expect(buy(bought, kite.id)).toBeNull()
  })

  it('winning every event pays enough to buy every car', () => {
    const total = ALL_EVENTS.reduce((sum, e) => sum + e.reward, 0)
    const prices = CARS.reduce((sum, c) => sum + c.price, 0)
    expect(total).toBeGreaterThan(prices)
  })
})
