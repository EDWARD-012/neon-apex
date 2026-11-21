import { type CarInput, PHYSICS_VERSION } from './sim/car'
import { carById, CARS } from './sim/cars'
import { Race, STEP } from './sim/race'
import { type Fitted, PARTS, STAGES, tuned } from './upgrades'

// Checked laps for the leaderboards. In a time trial the game records the
// player's input for every physics step, and the server replays those
// inputs through the same simulation. Only the lap the server times itself
// goes on a board, so a lap time can't simply be typed in.
//
// Inputs are rounded to a thousandth before the browser's own simulation
// uses them, so both sides drive exactly the same numbers. What can still
// differ is the last digit of Math.sin and friends between browsers, which
// over a lap can move the time a little; TOLERANCE allows for that.
//
// This one file holds the recording, the replay and the check. It runs in
// the browser, and the build bundles it into api/_replay.js for the server.

export const RUN_FORMAT = 1
export { PHYSICS_VERSION }
// The server's ghost clean-up tells old daily and weekly tracks by these.
export { dailySeed, weeklySeed } from './sim/track'

// The longest run the server replays: 20 minutes of driving.
export const MAX_STEPS = Math.round((20 * 60) / STEP)

// How far the server's best lap may be from the browser's: a tenth of a
// second, or 1% of the lap if that is more.
export const TOLERANCE = { seconds: 0.1, share: 0.01 }

const FLAG = { handbrake: 1, nitro: 2, assist: 4, raw: 8, brakeHelp: 16 }
const ALL_FLAGS = 31

export interface Run {
  format: number
  physics: number
  seed: string
  laps: number
  car: string
  fitted: Fitted
  // Damage the car started with (a career event carries it in), 0 to 1.
  damage: number
  // Run-length encoded inputs, five numbers for each stretch of steps with
  // the same input: steps, throttle (0 to 1000), brake (0 to 1000), steer
  // (-1000 to 1000) and the flags above.
  inputs: number[]
  // Steps before which the car was put back on the road (R).
  resets: number[]
  // The best lap the browser timed, in seconds.
  best: number
}

// Adding 0 turns -0 into 0: JSON writes -0 as 0, and the browser must drive
// the same number the server reads back.
const round = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v * 1000))) + 0

function decode(throttle: number, brake: number, steer: number, flags: number): CarInput {
  return {
    throttle: throttle / 1000,
    brake: brake / 1000,
    steer: steer / 1000,
    handbrake: (flags & FLAG.handbrake) !== 0,
    nitro: (flags & FLAG.nitro) !== 0,
    assist: (flags & FLAG.assist) !== 0,
    raw: (flags & FLAG.raw) !== 0,
  }
}

// The perfect start: the throttle goes down in the last 0.45 seconds before
// the green light, not earlier, and stays down. It adds 30% of a tank of
// nitro. The game and the replay both use this, so they agree on it.
export class StartWatch {
  private throttleAt: number | null = null

  // Call once after every step, with the phase the race had before it.
  // True on the step that gives the bonus.
  after(race: Race, before: Race['phase']): boolean {
    if (race.phase === 'countdown' && race.playerInput.throttle > 0 && this.throttleAt === null) this.throttleAt = race.clock
    if (race.phase === 'countdown' && race.playerInput.throttle === 0) this.throttleAt = null
    if (before === 'countdown' && race.phase === 'racing' && this.throttleAt !== null && this.throttleAt > -0.45) {
      const car = race.player.car
      car.nitro = Math.min(1, car.nitro + 0.3)
      return true
    }
    return false
  }
}

// A near miss tops up the nitro by 15% in the game (see game.ts). Time
// trials have no traffic, but the replay applies it all the same.
export const NEAR_MISS_NITRO = 0.15

// Records a time trial, one call per physics step.
export class RunRecorder {
  private inputs: number[] = []
  private resets: number[] = []
  private steps = 0
  private stopped = false
  private damage = 0

  constructor(
    readonly seed: string,
    readonly laps: number,
  ) {}

  // Rounds the input the race is about to drive with, records it, and
  // returns the rounded input for the race to use. Call just before each
  // step. Once the player has finished (or is out) it records nothing more.
  step(race: Race): CarInput {
    const input = race.playerInput
    if (this.stopped || race.player.finishTime !== null || race.player.out || this.steps >= MAX_STEPS) {
      this.stopped = true
      return input
    }
    if (this.steps === 0) this.damage = race.player.car.damage
    const t = round(input.throttle, 0, 1000)
    const b = round(input.brake, 0, 1000)
    const s = round(input.steer, -1000, 1000)
    const f = (input.handbrake ? FLAG.handbrake : 0) | (input.nitro ? FLAG.nitro : 0) | (input.assist ? FLAG.assist : 0) | (input.raw ? FLAG.raw : 0) | (race.brakeHelp ? FLAG.brakeHelp : 0)
    const n = this.inputs.length
    if (n >= 5 && this.inputs[n - 4] === t && this.inputs[n - 3] === b && this.inputs[n - 2] === s && this.inputs[n - 1] === f) this.inputs[n - 5]++
    else this.inputs.push(1, t, b, s, f)
    this.steps++
    return decode(t, b, s, f)
  }

  // The car was put back on the road before the next step.
  reset() {
    if (!this.stopped) this.resets.push(this.steps)
  }

  // The finished run, ready to send, or null if the laps weren't finished.
  finish(race: Race, car: string, fitted: Fitted = {}): Run | null {
    const laps = race.player.lapTimes
    if (race.player.finishTime === null || laps.length === 0) return null
    return {
      format: RUN_FORMAT,
      physics: PHYSICS_VERSION,
      seed: this.seed,
      laps: this.laps,
      car,
      fitted: { ...fitted },
      damage: this.damage,
      inputs: [...this.inputs],
      resets: [...this.resets],
      best: Math.min(...laps),
    }
  }
}

export interface Replayed {
  laps: number[]
  finished: boolean
  steps: number
}

// Drives the run again from the grid, as the game set it up for a time
// trial: no rivals, no traffic, no police. onStep, if given, sees the race
// after every step.
export function replay(run: Run, onStep?: (race: Race) => void): Replayed {
  const race = new Race({ seed: run.seed, laps: run.laps, rivals: 0, traffic: 0, mode: 'circuit', playerSpec: tuned(carById(run.car), run.fitted) })
  const start = new StartWatch()
  const player = race.player
  player.car.damage = run.damage
  let step = 0
  let r = 0
  for (let i = 0; i < run.inputs.length; i += 5) {
    const count = run.inputs[i]
    const flags = run.inputs[i + 4]
    const input = decode(run.inputs[i + 1], run.inputs[i + 2], run.inputs[i + 3], flags)
    for (let k = 0; k < count; k++) {
      while (r < run.resets.length && run.resets[r] === step) {
        if (race.phase === 'racing') race.reset(player)
        r++
      }
      race.brakeHelp = (flags & FLAG.brakeHelp) !== 0
      race.playerInput = input
      const before = race.phase
      race.step()
      start.after(race, before)
      for (const e of race.events) if (e.type === 'nearMiss') player.car.nitro = Math.min(1, player.car.nitro + NEAR_MISS_NITRO)
      race.events = []
      onStep?.(race)
      step++
    }
  }
  return { laps: [...player.lapTimes], finished: player.finishTime !== null, steps: step }
}

// Seeds the game makes ("night-2026-11-21", "week-2026-W47", "random-K2Q7M",
// "career-boulevard") and shared links use.
export const SEED = /^[A-Za-z0-9_-]{1,40}$/

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

// What a run must look like before it is worth replaying. Returns the
// reason it isn't, or null.
function problem(r: Record<string, unknown>): string | null {
  if (r.format !== RUN_FORMAT) return 'That run is in a format this server does not read.'
  if (r.physics !== PHYSICS_VERSION) return 'That lap was driven on an older version of the game. Reload the page to race on the new one.'
  if (typeof r.seed !== 'string' || !SEED.test(r.seed)) return 'There is no board for that track.'
  if (r.laps !== 1 && r.laps !== 3 && r.laps !== 5) return 'Time trials are 1, 3 or 5 laps.'
  if (typeof r.car !== 'string' || !CARS.some((c) => c.id === r.car)) return 'Unknown car.'
  const fitted = r.fitted
  if (!fitted || typeof fitted !== 'object' || Array.isArray(fitted)) return 'Unknown upgrades.'
  for (const [part, stage] of Object.entries(fitted)) {
    if (!PARTS.some((p) => p.id === part) || !isInt(stage, 0, STAGES)) return 'Unknown upgrades.'
  }
  if (typeof r.damage !== 'number' || !Number.isFinite(r.damage) || r.damage < 0 || r.damage >= 1) return 'Unknown damage.'
  if (typeof r.best !== 'number' || !Number.isFinite(r.best) || r.best <= 0) return 'No lap time.'
  const inputs = r.inputs
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length % 5 !== 0) return 'The inputs are missing or broken.'
  let steps = 0
  for (let i = 0; i < inputs.length; i += 5) {
    if (!isInt(inputs[i], 1, MAX_STEPS) || !isInt(inputs[i + 1], 0, 1000) || !isInt(inputs[i + 2], 0, 1000) || !isInt(inputs[i + 3], -1000, 1000) || !isInt(inputs[i + 4], 0, ALL_FLAGS)) {
      return 'The inputs are missing or broken.'
    }
    steps += inputs[i]
  }
  if (steps > MAX_STEPS) return 'That run is longer than a time trial can be.'
  const resets = r.resets
  if (!Array.isArray(resets) || resets.length > 1000) return 'The inputs are missing or broken.'
  let last = -1
  for (const s of resets) {
    if (!isInt(s, 0, steps) || s < last) return 'The inputs are missing or broken.'
    last = s
  }
  return null
}

export type Checked = { ok: true; run: Run; time: number } | { ok: false; error: string }

// Checks a run sent by the browser: its shape, then a full replay. The time
// that counts is the replay's own best lap.
export function checkRun(raw: unknown): Checked {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'No run was sent.' }
  const error = problem(raw as Record<string, unknown>)
  if (error) return { ok: false, error }
  const run = raw as Run
  const result = replay(run)
  if (!result.finished || result.laps.length === 0) return { ok: false, error: 'The replay of this run did not finish the laps, so it was not counted.' }
  const time = Math.min(...result.laps)
  if (Math.abs(time - run.best) > Math.max(TOLERANCE.seconds, TOLERANCE.share * run.best)) {
    return { ok: false, error: `The replay timed this lap at ${time.toFixed(2)} s, not ${run.best.toFixed(2)} s, so it was not counted.` }
  }
  return { ok: true, run, time }
}

export interface GhostLap {
  // The lap time, in seconds.
  time: number
  // t, x, z, heading, repeated, 30 times a second through the lap, the
  // same as the ghosts the game records in a time trial.
  samples: number[]
}

// The best lap of a run, as a ghost to race. The run is replayed here in
// the browser, the same replay the server checked it with, and the car's
// place is sampled every fourth step through each lap.
export function ghostOf(run: Run): GhostLap | null {
  let best: GhostLap | null = null
  let lap: number[] = []
  let laps = 0
  replay(run, (race) => {
    const player = race.player
    if (player.lapTimes.length > laps) {
      laps = player.lapTimes.length
      const time = player.lapTimes[laps - 1]
      if (lap.length >= 8 && (!best || time < best.time)) best = { time, samples: lap }
      lap = []
    }
    if (player.checkpoints >= 1 && player.finishTime === null && Math.round(race.clock / STEP) % 4 === 0) {
      lap.push(+(race.clock - player.lapStart).toFixed(3), +player.car.x.toFixed(2), +player.car.z.toFixed(2), +player.car.heading.toFixed(3))
    }
  })
  return best
}
