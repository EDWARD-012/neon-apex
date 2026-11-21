import { describe, expect, it } from 'vitest'
import { checkRun, MAX_STEPS, replay, type Run, RunRecorder, StartWatch } from '../src/replay-check'
import { createDriver, drive } from '../src/sim/ai'
import { carById } from '../src/sim/cars'
import { Race, STEP } from '../src/sim/race'
import { tuned } from '../src/upgrades'

// Drives a time trial the way the game does, with the AI standing in for
// the player's hands: the recorder rounds each step's input before the
// race uses it, and the perfect-start rule runs after each step.
function driveTrial(options: { seed?: string; laps?: number; car?: string; fitted?: Record<string, number>; resetAt?: number; startAt?: number; damage?: number } = {}) {
  const seed = options.seed ?? 'board-test'
  const laps = options.laps ?? 1
  const car = options.car ?? 'vanta'
  const fitted = options.fitted ?? {}
  const race = new Race({ seed, laps, rivals: 0, traffic: 0, mode: 'circuit', playerSpec: tuned(carById(car), fitted) })
  // A career event can start the car damaged, as the game does in setup.
  race.player.car.damage = options.damage ?? 0
  const recorder = new RunRecorder(seed, laps)
  const start = new StartWatch()
  const driver = createDriver(1)
  let steps = 0
  let perfect = false
  while (race.player.finishTime === null && steps < MAX_STEPS) {
    if (options.resetAt !== undefined && steps === options.resetAt && race.phase === 'racing') {
      race.reset(race.player)
      recorder.reset()
    }
    const hands = drive(race.player.car, driver, race.track, race.line, [], STEP)
    // Throttle down from this clock time in the countdown, if given.
    if (race.phase === 'countdown') hands.throttle = options.startAt !== undefined && race.clock >= options.startAt ? 1 : 0
    race.playerInput = hands
    race.playerInput = recorder.step(race)
    const before = race.phase
    race.step()
    if (start.after(race, before)) perfect = true
    race.events = []
    steps++
  }
  return { race, run: recorder.finish(race, car, fitted) as Run, perfect }
}

describe('checked leaderboard laps', () => {
  const { race, run } = driveTrial()

  it('records a finished trial compactly', () => {
    expect(race.player.finishTime).not.toBeNull()
    expect(run.best).toBe(Math.min(...race.player.lapTimes))
    const steps = run.inputs.filter((_, i) => i % 5 === 0).reduce((a, b) => a + b, 0)
    // Every step is in there, and the countdown collapses into one entry.
    expect(steps).toBeGreaterThan(3 / STEP)
    expect(run.inputs[0]).toBeGreaterThan(300)
  })

  it('records no -0, which JSON would turn into 0', () => {
    expect(run.inputs.some((v) => Object.is(v, -0))).toBe(false)
    expect(JSON.parse(JSON.stringify(run))).toEqual(run)
  })

  it('replays to exactly the same lap, as the server will', () => {
    const sent = JSON.parse(JSON.stringify(run))
    const checked = checkRun(sent)
    expect(checked).toEqual({ ok: true, run: sent, time: run.best })
  })

  it('refuses a lap faster than the inputs drive', () => {
    const checked = checkRun({ ...run, best: run.best - 2 })
    expect(checked.ok).toBe(false)
  })

  it('refuses inputs that do not finish the lap', () => {
    const idle = { ...run, inputs: [run.inputs.reduce((a, v, i) => (i % 5 === 0 ? a + v : a), 0), 0, 0, 0, 0] }
    expect(checkRun(idle).ok).toBe(false)
  })

  it('refuses another version of the physics, an unknown car or upgrade, and broken input', () => {
    expect(checkRun({ ...run, physics: run.physics - 1 }).ok).toBe(false)
    expect(checkRun({ ...run, car: 'rocket' }).ok).toBe(false)
    expect(checkRun({ ...run, fitted: { engine: 9 } }).ok).toBe(false)
    expect(checkRun({ ...run, fitted: { jetpack: 1 } }).ok).toBe(false)
    expect(checkRun({ ...run, seed: '../../etc' }).ok).toBe(false)
    expect(checkRun({ ...run, laps: 2 }).ok).toBe(false)
    expect(checkRun({ ...run, inputs: [1, 2, 3] }).ok).toBe(false)
    expect(checkRun({ ...run, inputs: [1, 5000, 0, 0, 0] }).ok).toBe(false)
    expect(checkRun({ ...run, inputs: [MAX_STEPS, 0, 0, 0, 0, 1, 0, 0, 0, 0] }).ok).toBe(false)
    expect(checkRun({ ...run, resets: [5, 2] }).ok).toBe(false)
    expect(checkRun(null).ok).toBe(false)
    expect(checkRun('run').ok).toBe(false)
  })

  it('replays upgrades and a reset onto the road', () => {
    const tunedRun = driveTrial({ seed: 'board-test-2', car: 'brute', fitted: { engine: 2, tyres: 1 }, resetAt: 2000 })
    expect(tunedRun.run.resets).toEqual([2000])
    const checked = checkRun(JSON.parse(JSON.stringify(tunedRun.run)))
    expect(checked.ok && checked.time).toBe(tunedRun.run.best)
  })

  it('starts the replay with the damage the car carried in', () => {
    const battered = driveTrial({ seed: 'board-test-4', damage: 0.5 })
    expect(battered.run.damage).toBe(0.5)
    expect(checkRun(JSON.parse(JSON.stringify(battered.run))).ok).toBe(true)
    expect(checkRun({ ...battered.run, damage: 0 }).ok).toBe(false)
    expect(checkRun({ ...battered.run, damage: 1 }).ok).toBe(false)
  })

  it('gives the perfect start in the replay too', () => {
    const quick = driveTrial({ seed: 'board-test-3', startAt: -0.3 })
    expect(quick.perfect).toBe(true)
    const replayed = replay(JSON.parse(JSON.stringify(quick.run)))
    expect(Math.min(...replayed.laps)).toBe(quick.run.best)
    const early = driveTrial({ seed: 'board-test-3', startAt: -2 })
    expect(early.perfect).toBe(false)
  })
})
