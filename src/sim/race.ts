import { createDriver, drive, type Driver } from './ai'
import { CAR, type CarInput, type CarState, collideCars, createCar, forwardSpeed, idle, stepCar } from './car'
import { racingLine, type RacingLine } from './line'
import { createRng } from './rng'
import { buildTrack, locate, pointAt, type Track } from './track'

// One race: a track, a grid of cars, and the rules for laps and places.
//
// Lap counting works off distance along the track, not off position on the
// map. Each car keeps a running total of how far it has travelled along the
// centre line, forwards minus backwards. A lap counts only when that total
// passes every checkpoint in order, so driving backwards over the finish
// line or getting moved across the infield never earns one.

export const CHECKPOINTS = 16
export const STEP = 1 / 120

export interface Racer {
  id: number
  name: string
  color: string
  player: boolean
  car: CarState
  driver: Driver | null
  // Running distance along the track, metres. Starts negative on the grid.
  distance: number
  lastS: number
  checkpoints: number
  lapTimes: number[]
  lapStart: number
  finishTime: number | null
  wrongWay: number
}

export type Phase = 'countdown' | 'racing' | 'finished'

export interface RaceOptions {
  seed: string
  laps: number
  rivals: number
  playerColor?: string
  // The player's car is driven by the AI too. Used by the attract mode on
  // the title screen and by the browser tests.
  autopilot?: boolean
}

const RIVALS = [
  { name: 'Vesper', color: '#ff3d7f' },
  { name: 'Okafor', color: '#3df5ff' },
  { name: 'Lindqvist', color: '#ffb52e' },
  { name: 'Moreau', color: '#a66bff' },
  { name: 'Tanaka', color: '#5dff7a' },
  { name: 'Reyes', color: '#ff6a3d' },
  { name: 'Novak', color: '#e8e8f0' },
]

export class Race {
  readonly track: Track
  readonly line: RacingLine
  readonly laps: number
  readonly racers: Racer[] = []
  phase: Phase = 'countdown'
  // Seconds since the green light. Negative during the countdown.
  clock = -3
  finishOrder: number[] = []
  readonly checkpointGap: number
  private readonly autopilot: Driver | null
  private sinceFirstFinish = 0
  // The latest input for the player's car, set by the game each frame.
  playerInput: CarInput = idle

  constructor(options: RaceOptions) {
    this.track = buildTrack(options.seed)
    this.line = racingLine(this.track)
    this.laps = options.laps
    this.checkpointGap = this.track.length / CHECKPOINTS
    const rng = createRng(`grid/${options.seed}`)
    const count = options.rivals + 1
    // The player starts at the back of a two-wide grid.
    for (let k = 0; k < count; k++) {
      const player = k === count - 1
      const row = Math.floor(k / 2)
      const column = k % 2 === 0 ? -3.2 : 3.2
      const back = 10 + row * 9
      const at = pointAt(this.track, this.track.length - back, column)
      const rival = RIVALS[k % RIVALS.length]
      this.racers.push({
        id: k,
        name: player ? 'You' : rival.name,
        color: player ? options.playerColor ?? '#ffd23d' : rival.color,
        player,
        car: createCar(at.x, at.z, at.heading, this.track),
        // Rivals near the front of the grid are a little quicker.
        driver: player ? null : createDriver(0.9 + 0.08 * (1 - k / count) + 0.02 * rng()),
        distance: -back,
        lastS: this.track.length - back,
        checkpoints: 0,
        lapTimes: [],
        lapStart: 0,
        finishTime: null,
        wrongWay: 0,
      })
    }
    this.autopilot = options.autopilot ? createDriver(0.97) : null
  }

  get player(): Racer {
    return this.racers[this.racers.length - 1]
  }

  // Laps finished so far.
  lapsDone(racer: Racer): number {
    return racer.checkpoints === 0 ? 0 : Math.floor((racer.checkpoints - 1) / CHECKPOINTS)
  }

  // The lap the racer is on, 1-based, capped at the race length.
  lapOf(racer: Racer): number {
    return Math.min(this.laps, this.lapsDone(racer) + 1)
  }

  // Places, best first: finishers by finishing order, the rest by distance.
  standings(): Racer[] {
    return this.racers.slice().sort((a, b) => {
      if (a.finishTime !== null || b.finishTime !== null) {
        if (a.finishTime === null) return 1
        if (b.finishTime === null) return -1
        return a.finishTime - b.finishTime
      }
      return b.distance - a.distance
    })
  }

  position(racer: Racer): number {
    return this.standings().indexOf(racer) + 1
  }

  step(dt = STEP) {
    this.clock += dt
    if (this.phase === 'countdown' && this.clock >= 0) this.phase = 'racing'
    const cars = this.racers.map((r) => r.car)
    for (const racer of this.racers) {
      let input = idle
      if (this.phase !== 'countdown') {
        if (racer.finishTime !== null && racer.driver === null && !this.autopilot) {
          // The player crossed the line: the car rolls to a stop.
          input = { ...idle, brake: 0.3 }
        } else if (racer.driver) input = drive(racer.car, racer.driver, this.track, this.line, cars, dt)
        else if (this.autopilot) input = drive(racer.car, this.autopilot, this.track, this.line, cars, dt)
        else input = this.playerInput
      }
      stepCar(racer.car, input, dt, this.track)
    }
    for (let a = 0; a < cars.length; a++) {
      for (let b = a + 1; b < cars.length; b++) collideCars(cars[a], cars[b])
    }
    for (const racer of this.racers) this.track_(racer, dt)
    if (this.finishOrder.length > 0) this.sinceFirstFinish += dt
    const everyone = this.finishOrder.length === this.racers.length
    const playerDone = this.player.finishTime !== null
    if (this.phase === 'racing' && (everyone || (playerDone && this.sinceFirstFinish > 25))) this.phase = 'finished'
  }

  // Updates distance, checkpoints and laps for one racer.
  private track_(racer: Racer, dt: number) {
    const { s } = locate(this.track, racer.car.x, racer.car.z, racer.car.hint)
    let ds = s - racer.lastS
    if (ds > this.track.length / 2) ds -= this.track.length
    if (ds < -this.track.length / 2) ds += this.track.length
    racer.lastS = s
    // A car cannot cover this much track in one physics step. Anything
    // bigger is a teleport and earns no distance.
    if (Math.abs(ds) > CAR.topSpeed * 2 * dt + 2) return
    racer.distance += ds
    racer.wrongWay = ds < -0.02 && forwardSpeed(racer.car) > 2 ? racer.wrongWay + dt : Math.max(0, racer.wrongWay - dt * 2)
    if (racer.finishTime !== null || this.phase !== 'racing') return
    while (racer.distance >= racer.checkpoints * this.checkpointGap) {
      racer.checkpoints++
      const crossedLine = (racer.checkpoints - 1) % CHECKPOINTS === 0
      if (!crossedLine) continue
      // The first crossing is the start of lap 1, every later one ends a lap.
      if (racer.checkpoints > 1) {
        racer.lapTimes.push(this.clock - racer.lapStart)
        if (racer.lapTimes.length >= this.laps) {
          racer.finishTime = this.clock
          this.finishOrder.push(racer.id)
          return
        }
      }
      racer.lapStart = this.clock
    }
  }

  // Moves a car back onto the centre of the road where it is, facing the
  // right way. For when the player gets stuck or turned round.
  reset(racer: Racer) {
    const where = locate(this.track, racer.car.x, racer.car.z, racer.car.hint)
    const at = pointAt(this.track, where.s, 0)
    Object.assign(racer.car, { x: at.x, z: at.z, heading: at.heading, vx: 0, vz: 0, yawRate: 0, gripRecovery: 1 })
  }
}
