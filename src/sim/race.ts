import { createDriver, drive, type Driver } from './ai'
import { CAR, type CarInput, type CarSpec, type CarState, collideCars, createCar, forwardSpeed, idle, stepCar } from './car'
import { racingLine, type RacingLine } from './line'
import { createRng } from './rng'
import { buildTrack, locate, pointAt, type Track } from './track'
import { POLICE_SPEC } from './cars'
import { chase } from './police'
import { driveTraffic, spawnTraffic, type TrafficCar } from './traffic'

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
  // Knocked out of an elimination race.
  out: boolean
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
  // Civilian cars on the circuit.
  traffic?: number
  playerSpec?: CarSpec
  // Handling for each rival, in grid order. Missing ones use the default.
  rivalSpecs?: CarSpec[]
  // Multiplies every rival's speed along the line. 1 is the default field.
  skill?: number
  // circuit: laps decide it. elimination: last place is out every time the
  // leader finishes a lap, last car running wins. pursuit: no laps, get
  // away from the police.
  mode?: 'circuit' | 'elimination' | 'pursuit'
  // Police cars at the start of a pursuit. More join as the heat rises.
  police?: number
}

export type RaceEvent =
  | { type: 'nearMiss' }
  | { type: 'contact'; strength: number }
  | { type: 'driftBank'; points: number }
  | { type: 'driftLost' }
  | { type: 'eliminated'; id: number }
  | { type: 'copJoined' }
  | { type: 'busted' }
  | { type: 'escaped' }

export interface Pursuit {
  // Both run 0 to 1. Busted fills while the player is slow with a patrol
  // car close by; escape fills while every patrol car is far away.
  busted: number
  escape: number
  heat: number
  outcome: 'busted' | 'escaped' | null
  // Seconds since the last patrol car joined.
  sinceJoin: number
}

export const MAX_POLICE = 4
export const ESCAPE_DISTANCE = 300

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
  readonly traffic: TrafficCar[]
  readonly mode: 'circuit' | 'elimination' | 'pursuit'
  readonly police: CarState[] = []
  pursuit: Pursuit = { busted: 0, escape: 0, heat: 1, outcome: null, sinceJoin: 0 }
  // The player's drift: the slide in progress and everything banked.
  drift = { score: 0, total: 0, quiet: 0 }
  // Things that happened to the player since the game last looked.
  events: RaceEvent[] = []
  // Per traffic car: which side of it the player was on last step, and when
  // the player last touched it.
  private passing: { ahead: boolean; touched: number }[] = []

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
        car: createCar(at.x, at.z, at.heading, this.track, player ? options.playerSpec ?? CAR : options.rivalSpecs?.[k] ?? CAR),
        // Rivals near the front of the grid are a little quicker.
        driver: player ? null : createDriver((0.9 + 0.08 * (1 - k / count) + 0.02 * rng()) * (options.skill ?? 1)),
        distance: -back,
        lastS: this.track.length - back,
        checkpoints: 0,
        lapTimes: [],
        lapStart: 0,
        finishTime: null,
        wrongWay: 0,
        out: false,
      })
    }
    this.autopilot = options.autopilot ? createDriver(0.97) : null
    this.traffic = spawnTraffic(this.track, options.traffic ?? 0, options.seed)
    this.passing = this.traffic.map(() => ({ ahead: false, touched: -10 }))
    this.mode = options.mode ?? 'circuit'
    for (let k = 0; k < (this.mode === 'pursuit' ? options.police ?? 2 : 0); k++) this.addCop(55 + k * 45)
  }

  // Every car on the road: racers still running, then traffic, then police.
  get cars(): CarState[] {
    return [...this.racers.filter((r) => !r.out).map((r) => r.car), ...this.traffic.map((t) => t.car), ...this.police]
  }

  // A patrol car on the road some distance behind the player.
  private addCop(behind: number) {
    const where = locate(this.track, this.player.car.x, this.player.car.z, this.player.car.hint)
    const at = pointAt(this.track, where.s - behind, this.police.length % 2 === 0 ? -3 : 3)
    const cop = createCar(at.x, at.z, at.heading, this.track, POLICE_SPEC)
    cop.nitro = 0
    if (this.phase === 'racing') {
      const v = Math.max(20, forwardSpeed(this.player.car))
      cop.vx = Math.sin(at.heading) * v
      cop.vz = Math.cos(at.heading) * v
    }
    this.police.push(cop)
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

  // Places, best first: finishers by finishing order, then the cars still
  // running by distance, then knocked-out cars, the latest out first.
  standings(): Racer[] {
    return this.racers.slice().sort((a, b) => {
      if (a.out || b.out) {
        if (!a.out) return -1
        if (!b.out) return 1
        return this.eliminated.indexOf(b.id) - this.eliminated.indexOf(a.id)
      }
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
    const cars = this.cars
    for (const t of this.traffic) stepCar(t.car, driveTraffic(t, this.track, cars), dt, this.track)
    for (const cop of this.police) stepCar(cop, this.phase === 'racing' && !this.pursuit.outcome ? chase(cop, this.player.car, this.track, this.line) : idle, dt, this.track)
    for (const racer of this.racers) {
      if (racer.out) continue
      let input = idle
      if (this.phase !== 'countdown') {
        if (racer.finishTime !== null && racer.driver === null && !this.autopilot) {
          // The player crossed the line: the car rolls to a stop.
          input = { ...idle, brake: 0.3 }
        } else if (this.pursuit.outcome) {
          input = { ...idle, brake: 0.4 }
        } else if (racer.driver) input = drive(racer.car, racer.driver, this.track, this.line, cars, dt)
        else if (this.autopilot) input = drive(racer.car, this.autopilot, this.track, this.line, cars, dt)
        else input = this.playerInput
      }
      stepCar(racer.car, input, dt, this.track)
    }
    const playerCar = this.player.car
    for (let a = 0; a < cars.length; a++) {
      for (let b = a + 1; b < cars.length; b++) {
        const hit = collideCars(cars[a], cars[b])
        if (hit > 0 && (cars[a] === playerCar || cars[b] === playerCar)) {
          if (hit > 2) this.events.push({ type: 'contact', strength: hit })
          if (hit > 4 && this.drift.score > 0) {
            this.drift.score = 0
            this.events.push({ type: 'driftLost' })
          }
          const other = cars[a] === playerCar ? cars[b] : cars[a]
          const k = this.traffic.findIndex((t) => t.car === other)
          if (k >= 0) this.passing[k].touched = this.clock
        }
      }
    }
    this.nearMisses()
    this.scoreDrift(dt)
    if (this.mode === 'pursuit') this.updatePursuit(dt)
    for (const racer of this.racers) if (!racer.out) this.track_(racer, dt)
    if (this.finishOrder.length > 0) this.sinceFirstFinish += dt
    const running = this.racers.filter((r) => !r.out)
    const everyone = running.every((r) => r.finishTime !== null)
    const playerDone = this.player.finishTime !== null || this.player.out
    if (this.phase === 'racing' && (everyone || (playerDone && this.sinceFirstFinish > 25))) this.phase = 'finished'
    if (this.phase === 'racing' && this.player.out && this.mode === 'elimination') this.phase = 'finished'
    if (this.phase === 'racing' && this.pursuit.outcome) this.phase = 'finished'
  }

  // Drift points for the player: speed times slip angle, held together while
  // the slide lasts and banked when it ends. A hard hit loses the slide.
  private scoreDrift(dt: number) {
    const player = this.player
    const car = player.car
    const d = this.drift
    if (this.phase === 'racing' && car.drifting && player.finishTime === null && !player.out) {
      d.score += Math.hypot(car.vx, car.vz) * car.slip * dt * 9
      d.quiet = 0
    } else if (d.score > 0) {
      d.quiet += dt
      if (d.quiet > 0.45 || player.finishTime !== null) this.bankDrift()
    }
  }

  bankDrift() {
    const d = this.drift
    if (d.score >= 30) {
      d.total += Math.round(d.score)
      this.events.push({ type: 'driftBank', points: Math.round(d.score) })
    }
    d.score = 0
  }

  private updatePursuit(dt: number) {
    const p = this.pursuit
    if (this.phase !== 'racing' || p.outcome) return
    const me = this.player.car
    const n = this.track.n
    let nearest = Infinity
    let alongNearest = Infinity
    for (const cop of this.police) {
      nearest = Math.min(nearest, Math.hypot(cop.x - me.x, cop.z - me.z))
      const gap = ((me.hint - cop.hint + n) % n) * this.track.spacing
      alongNearest = Math.min(alongNearest, gap, this.track.length - gap)
    }
    const slow = Math.hypot(me.vx, me.vz) < 6
    if (slow && nearest < 14) p.busted = Math.min(1, p.busted + dt / 2.5)
    else p.busted = Math.max(0, p.busted - dt / 2)
    if (alongNearest > ESCAPE_DISTANCE) p.escape = Math.min(1, p.escape + dt / 6)
    else p.escape = Math.max(0, p.escape - dt / 3)
    if (p.busted >= 1) {
      p.outcome = 'busted'
      this.events.push({ type: 'busted' })
    } else if (p.escape >= 1) {
      p.outcome = 'escaped'
      this.events.push({ type: 'escaped' })
    }
    // Heat rises over time, and each level brings one more patrol car.
    p.sinceJoin += dt
    if (p.sinceJoin > 40 && this.police.length < MAX_POLICE) {
      p.sinceJoin = 0
      p.heat++
      this.addCop(220)
      this.events.push({ type: 'copJoined' })
    }
  }

  // Knocks out the last car still running. Called when the leader finishes
  // a lap in an elimination race.
  private eliminateLast() {
    const running = this.racers.filter((r) => !r.out && r.finishTime === null)
    if (running.length <= 1) return
    const last = running.reduce((a, b) => (b.distance < a.distance ? b : a))
    last.out = true
    this.eliminated.push(last.id)
    this.events.push({ type: 'eliminated', id: last.id })
    const left = this.racers.filter((r) => !r.out)
    if (left.length === 1 && left[0].finishTime === null) {
      left[0].finishTime = this.clock
      this.finishOrder.push(left[0].id)
    }
  }

  // Ids knocked out, in order.
  readonly eliminated: number[] = []
  private lapsLed = 0

  // A near miss: the player goes from behind a traffic car to ahead of it,
  // close alongside, clearly faster, and without having touched it.
  private nearMisses() {
    if (this.phase !== 'racing' || this.traffic.length === 0) return
    const player = this.player.car
    const n = this.track.n
    const speed = forwardSpeed(player)
    this.traffic.forEach((t, k) => {
      let gap = player.hint - t.car.hint
      if (gap > n / 2) gap -= n
      if (gap < -n / 2) gap += n
      const state = this.passing[k]
      // A sample of slack either way, so two cars on the same sample do not
      // count as passing back and forth.
      const ahead = gap >= 1 ? true : gap <= -1 ? false : state.ahead
      if (ahead && !state.ahead && Math.abs(gap) < 8) {
        const side = Math.hypot(player.x - t.car.x, player.z - t.car.z)
        if (side < 4.2 && speed - forwardSpeed(t.car) > 6 && this.clock - state.touched > 0.6) this.events.push({ type: 'nearMiss' })
      }
      state.ahead = ahead
    })
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
        if (this.mode === 'elimination' && racer.lapTimes.length > this.lapsLed) {
          this.lapsLed = racer.lapTimes.length
          this.eliminateLast()
          if (racer.finishTime !== null) return
        }
        if (this.mode !== 'elimination' && racer.lapTimes.length >= this.laps) {
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
