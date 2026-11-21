import { describe, expect, it } from 'vitest'
import { ALL_EVENTS, fresh, judge, leaderOpen, MEDAL_PAY, medalFor, type Progress, record, rewardCards, type Run, settle, takeCard, TIERS, WINS_TO_UNLOCK } from '../src/career'
import { Race } from '../src/sim/race'

const run = (changes: Partial<Run> = {}): Run => ({ kind: 'race', laps: 3, finished: true, place: 1, heat: 1, nearMisses: 0, cleanLaps: 0, closeWin: false, daily: false, ...changes })

describe('the crew ladder', () => {
  it('every tier is a crew with a leader, and every leader race is in the career', () => {
    for (const tier of TIERS) {
      expect(tier.crew.length).toBeGreaterThan(0)
      expect(tier.leader.rivals).toBe(1)
      expect(tier.leader.leader).toBeTruthy()
      expect(ALL_EVENTS).toContain(tier.leader)
    }
    expect(new Set(ALL_EVENTS.map((e) => e.id)).size).toBe(ALL_EVENTS.length)
  })

  it("a crew's leader races the player once three of its events are won", () => {
    let p = fresh()
    expect(leaderOpen(p, 0)).toBe(false)
    for (const e of TIERS[0].events.slice(0, WINS_TO_UNLOCK)) p = record(p, e, judge(e, { place: 1, points: 1e9, escaped: true }, false))
    expect(leaderOpen(p, 0)).toBe(true)
    expect(leaderOpen(p, 1)).toBe(false)
  })

  it('rival cars carry more upgrades the higher the tier', () => {
    const stages = TIERS.map((t) => Math.max(...t.events.map((e) => e.rivalStage ?? 0)))
    expect(stages).toEqual([0, 1, 2])
    expect(TIERS.map((t) => t.leader.rivalStage)).toEqual([1, 2, 3])
  })

  it("the leader's name is on the rival in the race", () => {
    const leader = TIERS[0].leader
    const race = new Race({ seed: leader.seed, laps: 1, rivals: 1, rivalNames: [leader.leader as string] })
    expect(race.racers[0].name).toBe(leader.leader)
  })
})

describe('medals', () => {
  const race = TIERS[0].events[0]
  const drift = TIERS[0].events.find((e) => e.kind === 'drift')!
  const trial = TIERS[1].events.find((e) => e.kind === 'trial')!
  const pursuit = TIERS[0].events.find((e) => e.kind === 'pursuit')!

  it('are given by place, points, time or escape, with a Skidline medal above gold', () => {
    expect(medalFor(race, { place: 3 })).toBe(1)
    expect(medalFor(race, { place: 2 })).toBe(2)
    expect(medalFor(race, { place: 1, bestLap: 50, referenceLap: 40 })).toBe(3)
    expect(medalFor(race, { place: 1, bestLap: 41, referenceLap: 40 })).toBe(4)
    expect(medalFor(drift, { points: drift.target! * 0.5 })).toBe(1)
    expect(medalFor(drift, { points: drift.target! * 1.5 })).toBe(4)
    expect(medalFor(trial, { bestLap: 40 * trial.target!, referenceLap: 40 })).toBe(3)
    expect(medalFor(trial, { bestLap: 41, referenceLap: 40 })).toBe(4)
    expect(medalFor(pursuit, { escaped: false, time: 70 })).toBe(1)
    expect(medalFor(pursuit, { escaped: true, heat: 3 })).toBe(4)
  })

  it('each medal pays once, the first time it is reached', () => {
    const medalPay = (p: ReturnType<typeof settle>) => p.lines.filter((l) => l.label.endsWith('medal')).reduce((a, l) => a + l.coins, 0)
    const first = settle(fresh(), run({ place: 2 }), '2026-11-21', race)
    expect(first.lines.map((l) => l.label)).toContain('Silver medal')
    expect(first.progress.medals[race.id]).toBe(2)
    expect(medalPay(first)).toBe(MEDAL_PAY[1] + MEDAL_PAY[2])
    // Silver again pays no medal; a win then pays only for gold.
    expect(medalPay(settle(first.progress, run({ place: 2 }), '2026-11-21', race))).toBe(0)
    const gold = settle(first.progress, run({ place: 1, bestLap: 99, referenceLap: 40 }), '2026-11-21', race)
    expect(medalPay(gold)).toBe(MEDAL_PAY[3])
  })
})

describe('reward cards', () => {
  it('offer coins, a free stage and a look, and only one can be taken', () => {
    const p: Progress = { ...fresh(), cash: 0 }
    const cards = rewardCards(p, 0, 'vanta')
    expect(cards.map((c) => c.kind)).toEqual(['coins', 'stage', 'look'])
    const coins = takeCard(p, cards[0], 'vanta', 'leader-street')
    expect(coins.cash).toBe(TIERS[0].leader.reward)
    expect(takeCard(coins, cards[1], 'vanta', 'leader-street')).toBe(coins)
    const stage = takeCard(p, cards[1], 'vanta', 'leader-street')
    expect(stage.upgrades.vanta.engine).toBe(1)
    const look = takeCard(p, cards[2], 'vanta', 'leader-street')
    expect(look.ownedLooks).toContain('glow:cyan')
  })
})
