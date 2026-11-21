import { brakingAid, createDriver, drive, type Driver } from './ai'
import { CAR, type CarInput, type CarSpec, type CarState, collideCars, createCar, forwardSpeed, idle, speedOf, stepCar } from './car'
import { racingLine, type RacingLine } from './line'
import { createRng, type Rng } from './rng'
import { buildTrack, locate, pointAt, type Track } from './track'
import { HEAVY_SPEC, INTERCEPTOR_SPEC, POLICE_SPEC } from './cars'
import { chase, type CopRole } from './police'
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
  // Out of the race: knocked out of an elimination, wrecked, or busted.
  out: boolean
  // Why a car went out when it stays on the road afterwards: a wreck sits
  // where it stopped and a busted car stays with the police. Cars knocked
  // out of an elimination just leave.
  fate: 'wrecked' | 'busted' | null
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
  // away from the police. cop: the player drives a police car and busts the
  // racers before they finish.
  mode?: 'circuit' | 'elimination' | 'pursuit' | 'cop'
  // Police cars at the start of a pursuit. More join as the heat rises.
  police?: number
  // The player's two racer tools in a pursuit.
  tools?: ToolId[]
  // Names for the rivals in grid order, where an event gives them (a crew
  // leader's race).
  rivalNames?: string[]
  // Police in a race: a patrol car waits by the road and gives chase when
  // the player goes past it fast. Up to this many can be after the player
  // at once. Not used in a pursuit, which has its own police.
  patrols?: number
}

// Slipstream: close behind a rival, nearly in line with it, both above
// SLIP_SPEED. It fills the player's nitro while it lasts.
export const SLIP_RANGE = 18
export const SLIP_WIDTH = 1.6
export const SLIP_SPEED = 20
export const SLIP_NITRO = 0.06

export type RaceEvent =
  | { type: 'nearMiss' }
  | { type: 'slipstream' }
  | { type: 'cleanLap' }
  | { type: 'contact'; strength: number }
  | { type: 'driftBank'; points: number }
  | { type: 'driftLost' }
  | { type: 'eliminated'; id: number }
  | { type: 'copJoined' }
  | { type: 'heatUp'; heat: number }
  | { type: 'busted' }
  | { type: 'escaped' }
  | { type: 'spotted' }
  | { type: 'crashReported'; sent: boolean }
  | { type: 'lostPolice'; heat: number }
  | { type: 'wrecked'; id: number }
  // The player pushed a rival (id) or a patrol car (cop) into a wall hard
  // enough to wreck it.
  | { type: 'takedown'; id?: number; cop?: CarState }
  | { type: 'roadblock' }
  | { type: 'spikesAhead' }
  | { type: 'punctured' }
  | { type: 'heliJoined' }
  | { type: 'pulseLock' }
  | { type: 'pulsed' }
  | { type: 'tool'; id: ToolId }
  | { type: 'mineHit'; x: number; z: number }
  | { type: 'racerBusted'; id: number }
  | { type: 'backup' }
  | { type: 'noTarget' }

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

export const MAX_POLICE = 7
export const MAX_HEAT = 5
// Seconds of chase between heat levels.
export const HEAT_STEP = 40

// The kinds of police unit. Patrol cars from the start, heavy units from
// heat 3, interceptors at heat 5.
export type CopKind = 'patrol' | 'heavy' | 'interceptor'
const COP_SPECS: Record<CopKind, CarSpec> = { patrol: POLICE_SPEC, heavy: HEAVY_SPEC, interceptor: INTERCEPTOR_SPEC }
// Who joins as the heat reaches each level: a pair at heat 2, one to drive
// ahead and box the player in, a heavy unit at 3, another blocker at 4,
// called in ahead of the player, and two interceptors at 5.
const REINFORCEMENTS: Record<number, [CopKind, CopRole, 'ahead'?][]> = {
  2: [
    ['patrol', 'ram'],
    ['patrol', 'block'],
  ],
  3: [['heavy', 'ram']],
  4: [['patrol', 'block', 'ahead']],
  5: [
    ['interceptor', 'ram'],
    ['interceptor', 'ram'],
  ],
}
export const ESCAPE_DISTANCE = 300
// A waiting patrol car sees the player go past this close and this fast.
export const SPOT_RANGE = 30
export const SPOT_SPEED = 30
// In a race with police on, a crash is reported: a hit on a traffic car of
// CRASH_HIT or more on the contact scale (a hard ram), or a wall at
// CRASH_WALL m/s or more, which does real damage. A patrol car is sent in from CRASH_BEHIND metres back, out
// of sight. A crash during a chase brings the next heat level CRASH_HEAT
// seconds sooner.
export const CRASH_HIT = 5
export const CRASH_WALL = 10
export const CRASH_BEHIND = 220
export const CRASH_HEAT = 15
// A takedown: a car the player hit in the last TAKEDOWN_WINDOW seconds
// meets a barrier at more than TAKEDOWN_HIT m/s, about 45 km/h, straight
// into it.
export const TAKEDOWN_HIT = 12.5
export const TAKEDOWN_WINDOW = 1.5
// From heat 3 the police also set up on the road ahead of the player, out
// of sight: a roadblock of heavy units parked across the road with a gap
// left on one side, then a spike strip over one half of the road, and so
// on in turn. From heat 4 the gap in a roadblock can have spikes in it.
export const SETUP_HEAT = 3
export const SETUP_EVERY = 22
export const SETUP_AHEAD = 380
export const ROADBLOCK_GAP = 5.5
// A car parked sideways covers about this much of the road.
const CAR_ACROSS = 4.6
// What a spike strip leaves of the car: top speed and grip.
export const PUNCTURED = { topSpeed: 0.72, grip: 0.62 }
// From heat 4 in a pursuit a helicopter follows the player. Within
// HELI_SIGHT of it the spotlight keeps the player seen, and the escape
// meter fills at HELI_ESCAPE of its usual rate. It flies at HELI_SPEED, so
// a quick car can outrun it.
export const HELI_HEAT = 4
export const HELI_SPEED = 58
export const HELI_SIGHT = 120
export const HELI_ESCAPE = 0.35
// Interceptors carry a pulse. Lined up behind the player within
// PULSE_RANGE for PULSE_LOCK seconds, one fires and cuts the player's power
// for PULSE_STUN seconds, then needs PULSE_COOLDOWN seconds to charge.
export const PULSE_RANGE = 70
export const PULSE_LOCK = 1.5
export const PULSE_STUN = 1.4
export const PULSE_COOLDOWN = 8

// Racer tools: two are picked before a pursuit, and each can be used twice.
// The jammer hides the player from the helicopter and the interceptors'
// lock and stops the police setting up ahead, for JAMMER_TIME seconds. The
// shockwave shoves every car within SHOCK_RANGE away. The turbo is a big
// push for TURBO_TIME seconds. A mine dropped behind goes off under the
// first police car to come within MINE_RANGE once it is armed.
export type RacerToolId = 'jammer' | 'shockwave' | 'turbo' | 'mine'
export const TOOL_IDS: RacerToolId[] = ['jammer', 'shockwave', 'turbo', 'mine']
// Playing the cop, the tools are the police's own: a roadblock or a spike
// strip ahead of the leading racer, a helicopter that follows the leader
// for HELI_TOOL_TIME seconds dropping spikes in front of it, and a pulse
// that cuts the power of the racer ahead.
export type CopToolId = 'roadblock' | 'spikes' | 'helicopter' | 'pulse'
export const COP_TOOL_IDS: CopToolId[] = ['roadblock', 'spikes', 'helicopter', 'pulse']
export type ToolId = RacerToolId | CopToolId
export const HELI_TOOL_TIME = 20
export const HELI_DROP_EVERY = 6
export const COP_PULSE_RANGE = 90
export const COP_PULSE_STUN = 2
// Playing the cop: the racers get a head start of COP_HOLD seconds, a racer
// is busted when its damage is full or when it is held under 6 m/s with a
// police car within BOX_RANGE for BOX_TIME seconds, and the radio brings in
// a patrol car every BACKUP_EVERY seconds, up to BACKUP_MAX. Racers are
// less tough than usual, so a few good hits do it.
export const COP_HOLD = 3
export const BOX_RANGE = 9
export const BOX_TIME = 2
export const BACKUP_EVERY = 30
export const BACKUP_MAX = 3
export const RACER_TOUGHNESS = 0.55
export const TOOL_USES = 2
export const JAMMER_TIME = 8
export const SHOCK_RANGE = 18
export const SHOCK_PUSH = 18
export const TURBO_TIME = 2.5
export const MINE_RANGE = 3.4
export const MINE_ARM = 0.6
export const MINE_LIFE = 40
export const MINE_DAMAGE = 0.6

export interface Mine {
  x: number
  z: number
  armIn: number
  life: number
}

export interface Helicopter {
  x: number
  z: number
  heading: number
  seeing: boolean
}

// A spike strip: where it is along the lap, its offset from the centre line
// (positive to the right) and half its length across the road.
export interface SpikeStrip {
  s: number
  offset: number
  half: number
}

const RIVALS = [
  { name: 'Vesper', color: '#d01f3c' },
  { name: 'Okafor', color: '#1d63d6' },
  { name: 'Lindqvist', color: '#f08a00' },
  { name: 'Moreau', color: '#7b3fd0' },
  { name: 'Tanaka', color: '#1f8a52' },
  { name: 'Reyes', color: '#e8e8ea' },
  { name: 'Novak', color: '#9aa1ad' },
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
  // The latest input for the player's car, set by the game each frame, and
  // whether the braking aid is on.
  playerInput: CarInput = idle
  brakeHelp = false
  readonly traffic: TrafficCar[]
  readonly mode: 'circuit' | 'elimination' | 'pursuit' | 'cop'
  readonly police: CarState[] = []
  pursuit: Pursuit = { busted: 0, escape: 0, heat: 1, outcome: null, sinceJoin: 0 }
  // Police in a race: how many can chase at once, the ones still waiting by
  // the road, whether any are after the player now, and the heat each time
  // the player lost them.
  readonly patrols: number
  readonly parked = new Set<CarState>()
  chasing = false
  readonly escapes: number[] = []
  // Patrol cars the player has wrecked, which stay where they stopped.
  readonly wreckedCops = new Set<CarState>()
  // What each police car is, and how it chases.
  readonly copKind = new Map<CarState, CopKind>()
  readonly copRole = new Map<CarState, CopRole>()
  // Takedowns so far: rivals, and the heat at each patrol car wrecked.
  readonly takedowns = { rivals: 0, cops: [] as number[] }
  // When the player last hit each car, for takedowns.
  private hitByPlayer = new Map<CarState, number>()
  // Heavy units parked across the road in the latest roadblock, spike
  // strips on the road, and whether the player's tyres are gone.
  readonly blockade: CarState[] = []
  spikes: SpikeStrip[] = []
  punctured = false
  private sinceSetup = 0
  private setups = 0
  // The helicopter over the pursuit, once the heat brings it.
  heli: Helicopter | null = null
  // Each interceptor's lock on the player (seconds) and its recharge.
  private pulses = new Map<CarState, { lock: number; cooldown: number }>()
  // The strongest lock on the player right now, 0 to 1, for the HUD.
  pulseLock = 0
  // The player's tools and the uses left of each, the jammer's seconds
  // left, and mines on the road.
  tools: { id: ToolId; left: number }[] = []
  jammed = 0
  mines: Mine[] = []
  private toolWait = 0
  // Playing the cop: racers busted so far, how long each has been boxed
  // in, cars with blown tyres, and the time left on the helicopter tool.
  busts = 0
  private boxed = new Map<Racer, number>()
  private blown = new Set<CarState>()
  private heliLeft = 0
  private sinceDrop = 0
  private backups = 0
  private setupRng: Rng
  // The player's drift: the slide in progress and everything banked.
  drift = { score: 0, total: 0, quiet: 0 }
  // Things that happened to the player since the game last looked.
  events: RaceEvent[] = []
  // Counts for the coins paid at the finish: near misses, and laps the
  // player drove without taking damage.
  nearMissCount = 0
  cleanLaps = 0
  // The player's damage when the current lap began.
  private lapDamage = 0
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
        name: player ? 'You' : options.rivalNames?.[k] ?? rival.name,
        color: player ? options.playerColor ?? '#f2a900' : rival.color,
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
        fate: null,
      })
    }
    this.autopilot = options.autopilot ? createDriver(0.97) : null
    this.setupRng = createRng(`setup/${options.seed}`)
    this.tools = (options.mode === 'pursuit' || options.mode === 'cop' ? options.tools ?? [] : []).slice(0, 2).map((id) => ({ id, left: TOOL_USES }))
    if (options.mode === 'cop') for (const r of this.racers) if (!r.player) r.car.spec = { ...r.car.spec, toughness: r.car.spec.toughness * RACER_TOUGHNESS }
    this.traffic = spawnTraffic(this.track, options.traffic ?? 0, options.seed)
    this.passing = this.traffic.map(() => ({ ahead: false, touched: -10 }))
    this.mode = options.mode ?? 'circuit'
    for (let k = 0; k < (this.mode === 'pursuit' ? options.police ?? 2 : 0); k++) this.addCop(55 + k * 45)
    this.patrols = this.mode === 'pursuit' ? 0 : options.patrols ?? 0
    // The first patrol car waits a little under halfway round the lap.
    if (this.patrols > 0) this.parkCop(this.track.length * 0.4)
  }

  // Every car on the road: racers still running or stopped where they went
  // out, then traffic, then police.
  get cars(): CarState[] {
    return [...this.racers.filter((r) => !r.out || r.fate).map((r) => r.car), ...this.traffic.map((t) => t.car), ...this.police]
  }

  // Parks a patrol car (a new one, or one that lost the player) at the edge
  // of the road near the given distance along the lap. It picks the
  // straightest spot close by and the side away from the racing line, and
  // sits outside the traffic lanes so traffic does not queue behind it.
  private parkCop(s: number, reuse?: CarState) {
    const track = this.track
    const n = track.n
    const near = Math.round((((s % track.length) + track.length) % track.length) / track.spacing)
    let best = near % n
    for (let k = -60; k <= 60; k++) {
      const j = (near + k + n) % n
      if (Math.abs(this.line.offset[j]) < Math.abs(this.line.offset[best])) best = j
    }
    const side = this.line.offset[best] > 0 ? -1 : 1
    const at = pointAt(track, best * track.spacing, side * (track.width / 2 - 0.5))
    const fresh = createCar(at.x, at.z, at.heading, track, COP_SPECS[(reuse && this.copKind.get(reuse)) || 'patrol'])
    fresh.nitro = 0
    if (reuse) Object.assign(reuse, fresh)
    else {
      this.police.push(fresh)
      this.copKind.set(fresh, 'patrol')
      this.copRole.set(fresh, 'ram')
    }
    this.parked.add(reuse ?? fresh)
  }

  // Rivals and patrol cars the player shoved into a wall at speed are
  // wrecked. Traffic is not: it is only in the way.
  private takedownCheck() {
    if (this.phase !== 'racing' || this.player.out) return
    const recent = (car: CarState) => car.wallHit > TAKEDOWN_HIT && this.clock - (this.hitByPlayer.get(car) ?? -99) < TAKEDOWN_WINDOW
    for (const racer of this.racers) {
      if (racer.player || racer.out || racer.finishTime !== null || !recent(racer.car)) continue
      racer.car.damage = 1
      if (this.mode === 'cop') {
        this.bust(racer)
        continue
      }
      this.knockOut(racer, 'wrecked')
      this.takedowns.rivals++
      this.events.push({ type: 'takedown', id: racer.id })
    }
    for (const cop of this.police) {
      if (this.parked.has(cop) || this.wreckedCops.has(cop) || this.blockade.includes(cop) || !recent(cop)) continue
      cop.damage = 1
      this.wreckedCops.add(cop)
      this.takedowns.cops.push(this.pursuit.heat)
      this.events.push({ type: 'takedown', cop })
    }
  }

  // Patrol cars still in the chase: not waiting by the road, not wrecked.
  get activeCops(): CarState[] {
    return this.police.filter((c) => !this.parked.has(c) && !this.wreckedCops.has(c) && !this.blockade.includes(c))
  }

  // Takes a car out of the race. A wrecked or busted car stays where it is.
  private knockOut(racer: Racer, fate: 'wrecked' | 'busted') {
    racer.out = true
    racer.fate = fate
    this.eliminated.push(racer.id)
    // In an elimination, the last car still running wins.
    const left = this.racers.filter((r) => !r.out)
    if (this.mode === 'elimination' && left.length === 1 && left[0].finishTime === null) {
      left[0].finishTime = this.clock
      this.finishOrder.push(left[0].id)
    }
  }

  // A police car on the road some distance behind the player.
  // A negative distance puts it ahead, called in to wait for the player.
  private addCop(behind: number, kind: CopKind = 'patrol', role: CopRole = 'ram') {
    const where = locate(this.track, this.player.car.x, this.player.car.z, this.player.car.hint)
    const at = pointAt(this.track, where.s - behind, this.police.length % 2 === 0 ? -3 : 3)
    const cop = createCar(at.x, at.z, at.heading, this.track, COP_SPECS[kind])
    cop.nitro = 0
    if (this.phase === 'racing') {
      const v = behind < 0 ? 10 : Math.max(20, forwardSpeed(this.player.car))
      cop.vx = Math.sin(at.heading) * v
      cop.vz = Math.cos(at.heading) * v
    }
    this.police.push(cop)
    this.copKind.set(cop, kind)
    this.copRole.set(cop, role)
  }

  // The heat goes up a level, and the units for that level join, as many
  // as fit under the limit of cars after the player at once.
  private heatUp(limit: number) {
    const p = this.pursuit
    p.sinceJoin = 0
    if (p.heat >= MAX_HEAT) return
    p.heat++
    this.events.push({ type: 'heatUp', heat: p.heat })
    ;(REINFORCEMENTS[p.heat] ?? []).forEach(([kind, role, ahead], k) => {
      if (this.activeCops.length >= limit) return
      this.addCop(ahead ? -260 : 220 + k * 30, kind, role)
      this.events.push({ type: 'copJoined' })
    })
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
    // The police hunt the player until the event is decided for them.
    const hunting = this.phase === 'racing' && !this.pursuit.outcome && this.player.finishTime === null && !this.player.out
    for (const cop of this.police) {
      // Wrecked cars and roadblocks stand still.
      const still = this.wreckedCops.has(cop) || this.blockade.includes(cop)
      const prey = this.mode === 'cop' ? this.preyFor(cop) : this.player.car
      const input = still ? (forwardSpeed(cop) > 1 ? { ...idle, brake: 1 } : idle) : (hunting || this.mode === 'cop') && prey && !this.parked.has(cop) ? chase(cop, prey, this.track, this.line, this.copRole.get(cop)) : idle
      stepCar(cop, input, dt, this.track)
    }
    for (const racer of this.racers) {
      if (racer.out && !racer.fate) continue
      let input = idle
      if (racer.fate) {
        // Wrecked or busted: the car brakes to a stop and stays there.
        input = forwardSpeed(racer.car) > 1 ? { ...idle, brake: 1 } : idle
      } else if (this.phase !== 'countdown') {
        if (racer.finishTime !== null && racer.driver === null && !this.autopilot) {
          // The player crossed the line: the car rolls to a stop.
          input = { ...idle, brake: 0.3 }
        } else if (this.pursuit.outcome) {
          input = { ...idle, brake: 0.4 }
        } else if (racer.driver) input = drive(racer.car, racer.driver, this.track, this.line, cars, dt)
        else if (this.autopilot) input = drive(racer.car, this.autopilot, this.track, this.line, cars, dt)
        else if (this.mode === 'cop' && this.clock < COP_HOLD) input = idle
        else input = this.brakeHelp ? brakingAid(racer.car, this.playerInput, this.track, this.line) : this.playerInput
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
          if (hit > 2) this.hitByPlayer.set(other, this.clock)
          if (hit >= CRASH_HIT && this.traffic.some((t) => t.car === other)) this.reportCrash()
          const k = this.traffic.findIndex((t) => t.car === other)
          if (k >= 0) this.passing[k].touched = this.clock
        }
      }
    }
    if (playerCar.wallHit >= CRASH_WALL) this.reportCrash()
    this.nearMisses()
    this.slipstream(dt)
    this.scoreDrift(dt)
    this.takedownCheck()
    // Too much damage wrecks the player's car and puts it out of the race.
    // In a pursuit the police get a wrecked car instead (see
    // updatePursuit). Rivals are not wrecked: they trade paint with each
    // other all race, and a field that thinned out on its own would make
    // races too easy.
    // The title screen's AI-driven car is not wrecked either.
    const me = this.player
    if (this.mode !== 'pursuit' && !this.autopilot && this.phase === 'racing' && !me.out && me.finishTime === null && me.car.damage >= 1) {
      this.knockOut(me, 'wrecked')
      this.events.push({ type: 'wrecked', id: me.id })
    }
    if (this.mode === 'pursuit') this.updatePursuit(dt)
    else if (this.mode === 'cop') this.updateCop(dt)
    else if (this.patrols > 0) this.updatePatrol(dt)
    this.checkSpikes()
    for (const racer of this.racers) if (!racer.out) this.track_(racer, dt)
    if (this.finishOrder.length > 0) this.sinceFirstFinish += dt
    const running = this.racers.filter((r) => !r.out)
    const everyone = running.every((r) => r.finishTime !== null)
    const playerDone = this.player.finishTime !== null || this.player.out
    if (this.phase === 'racing' && (everyone || (playerDone && this.sinceFirstFinish > 25))) this.phase = 'finished'
    if (this.phase === 'racing' && this.player.out) this.phase = 'finished'
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

  // The busted and escape meters for the patrol cars on the player's tail.
  // Busted fills while the player is slow with one close by, escape while
  // every one is far away along the road.
  private meters(dt: number, cops: CarState[]): 'busted' | 'escaped' | null {
    const p = this.pursuit
    const me = this.player.car
    const n = this.track.n
    let nearest = Infinity
    let alongNearest = Infinity
    for (const cop of cops) {
      nearest = Math.min(nearest, Math.hypot(cop.x - me.x, cop.z - me.z))
      const gap = ((me.hint - cop.hint + n) % n) * this.track.spacing
      alongNearest = Math.min(alongNearest, gap, this.track.length - gap)
    }
    const slow = Math.hypot(me.vx, me.vz) < 6
    if (slow && nearest < 14) p.busted = Math.min(1, p.busted + dt / 2.5)
    else p.busted = Math.max(0, p.busted - dt / 2)
    const seen = this.heli?.seeing ? HELI_ESCAPE : 1
    if (alongNearest > ESCAPE_DISTANCE) p.escape = Math.min(1, p.escape + (dt / 6) * seen)
    else p.escape = Math.max(0, p.escape - dt / 3)
    return p.busted >= 1 ? 'busted' : p.escape >= 1 ? 'escaped' : null
  }

  private updatePursuit(dt: number) {
    const p = this.pursuit
    if (this.phase !== 'racing' || p.outcome) return
    // A wrecked car is caught wherever it is.
    const wrecked = this.player.car.damage >= 1
    if (wrecked) p.busted = 1
    const result = wrecked ? 'busted' : this.meters(dt, this.activeCops)
    if (result === 'busted') {
      p.outcome = 'busted'
      this.events.push({ type: 'busted' })
    } else if (result === 'escaped') {
      p.outcome = 'escaped'
      this.events.push({ type: 'escaped' })
    }
    // Heat rises over time, and each level brings more police.
    p.sinceJoin += dt
    if (p.sinceJoin > HEAT_STEP) this.heatUp(MAX_POLICE)
    this.jammed = Math.max(0, this.jammed - dt)
    this.toolWait = Math.max(0, this.toolWait - dt)
    this.fly(dt)
    this.pulse(dt)
    this.updateMines(dt)
    if (p.heat >= SETUP_HEAT && !p.outcome && this.jammed === 0) {
      this.sinceSetup += dt
      if (this.sinceSetup >= SETUP_EVERY) {
        this.sinceSetup = 0
        this.setUp()
      }
    }
  }

  // The helicopter joins at HELI_HEAT, 300 m back, and flies at the point
  // the player will reach in a second.
  private fly(dt: number) {
    const me = this.player.car
    if (!this.heli) {
      if (this.pursuit.heat < HELI_HEAT) return
      const where = locate(this.track, me.x, me.z, me.hint)
      const at = pointAt(this.track, where.s - 300, 0)
      this.heli = { x: at.x, z: at.z, heading: at.heading, seeing: false }
      this.events.push({ type: 'heliJoined' })
    }
    const h = this.heli
    const dx = me.x + me.vx - h.x
    const dz = me.z + me.vz - h.z
    const d = Math.hypot(dx, dz)
    const move = Math.min(d, HELI_SPEED * dt)
    if (d > 0.01) {
      h.x += (dx / d) * move
      h.z += (dz / d) * move
      if (d > 2) h.heading = Math.atan2(dx, dz)
    }
    h.seeing = this.jammed === 0 && Math.hypot(me.x - h.x, me.z - h.z) < HELI_SIGHT
  }

  // Interceptors lock on from behind and fire a pulse that cuts the
  // player's power for a moment.
  private pulse(dt: number) {
    const me = this.player.car
    const n = this.track.n
    let strongest = 0
    for (const cop of this.activeCops) {
      if (this.copKind.get(cop) !== 'interceptor') continue
      const state = this.pulses.get(cop) ?? { lock: 0, cooldown: 0 }
      this.pulses.set(cop, state)
      state.cooldown = Math.max(0, state.cooldown - dt)
      const behind = ((me.hint - cop.hint + n) % n) * this.track.spacing
      const fx = Math.sin(cop.heading)
      const fz = Math.cos(cop.heading)
      const ax = me.x - cop.x
      const az = me.z - cop.z
      const lateral = Math.abs(ax * -fz + az * fx)
      const lined = this.jammed === 0 && behind > 5 && behind < PULSE_RANGE && lateral < 6 && ax * fx + az * fz > 0
      if (lined && state.cooldown === 0) {
        if (state.lock === 0) this.events.push({ type: 'pulseLock' })
        state.lock += dt
        if (state.lock >= PULSE_LOCK) {
          me.stunned = PULSE_STUN
          state.lock = 0
          state.cooldown = PULSE_COOLDOWN
          this.events.push({ type: 'pulsed' })
        }
      } else state.lock = Math.max(0, state.lock - dt * 2)
      strongest = Math.max(strongest, state.lock / PULSE_LOCK)
    }
    this.pulseLock = strongest
  }

  // Uses the tool in the given slot (0 or 1), if it has a use left. Returns
  // whether it went off.
  useTool(slot: number): boolean {
    const tool = this.tools[slot]
    const me = this.player.car
    if (!tool || tool.left <= 0 || this.toolWait > 0 || this.phase !== 'racing' || this.pursuit.outcome) return false
    if (this.mode === 'cop') {
      if (!this.copTool(tool.id as CopToolId)) {
        this.events.push({ type: 'noTarget' })
        return false
      }
      tool.left--
      this.toolWait = 1
      this.events.push({ type: 'tool', id: tool.id })
      return true
    }
    tool.left--
    this.toolWait = 1
    if (tool.id === 'jammer') {
      this.jammed = JAMMER_TIME
      if (this.heli) this.heli.seeing = false
      this.pulses.forEach((p) => (p.lock = 0))
      this.pulseLock = 0
    } else if (tool.id === 'turbo') {
      me.turbo = TURBO_TIME
    } else if (tool.id === 'mine') {
      this.mines.push({ x: me.x - Math.sin(me.heading) * 3.2, z: me.z - Math.cos(me.heading) * 3.2, armIn: MINE_ARM, life: MINE_LIFE })
    } else {
      for (const car of this.cars) {
        if (car === me) continue
        const dx = car.x - me.x
        const dz = car.z - me.z
        const d = Math.hypot(dx, dz)
        if (d >= SHOCK_RANGE || d < 0.01) continue
        const push = (SHOCK_PUSH * (1 - d / SHOCK_RANGE)) / car.spec.mass
        car.vx += (dx / d) * push
        car.vz += (dz / d) * push
        car.yawRate += (this.setupRng() - 0.5) * 2
        // A car the shockwave sends into a wall counts as the player's hit,
        // so it can be a takedown.
        this.hitByPlayer.set(car, this.clock)
      }
    }
    this.events.push({ type: 'tool', id: tool.id })
    return true
  }

  // The police tools when the player is the cop. Returns false when there is
  // nobody to use it on, so the use is not spent.
  private copTool(id: CopToolId): boolean {
    const me = this.player.car
    const leader = this.leadingRacer()
    if (!leader) return false
    if (id === 'roadblock') {
      const s = locate(this.track, leader.car.x, leader.car.z, leader.car.hint).s + 260
      this.placeRoadblock(s, this.setupRng() < 0.5 ? -1 : 1)
    } else if (id === 'spikes') {
      this.layOnLine(leader.car, 140)
    } else if (id === 'helicopter') {
      this.heli = { x: me.x, z: me.z, heading: me.heading, seeing: false }
      this.heliLeft = HELI_TOOL_TIME
      this.sinceDrop = HELI_DROP_EVERY - 1.5
    } else {
      // The pulse: the racer most nearly straight ahead within range.
      const fx = Math.sin(me.heading)
      const fz = Math.cos(me.heading)
      let target: CarState | null = null
      let best = Infinity
      for (const r of this.racers) {
        if (r.player || r.out || r.finishTime !== null) continue
        const dx = r.car.x - me.x
        const dz = r.car.z - me.z
        const d = Math.hypot(dx, dz)
        const ahead = (dx * fx + dz * fz) / Math.max(d, 0.01)
        if (d < COP_PULSE_RANGE && ahead > Math.cos(0.45) && d < best) {
          best = d
          target = r.car
        }
      }
      if (!target) return false
      target.stunned = COP_PULSE_STUN
    }
    return true
  }

  // Armed mines go off under the first police car to reach them.
  private updateMines(dt: number) {
    if (this.mines.length === 0) return
    this.mines = this.mines.filter((mine) => {
      mine.armIn = Math.max(0, mine.armIn - dt)
      mine.life -= dt
      if (mine.armIn > 0) return mine.life > 0
      const cop = this.activeCops.find((c) => Math.hypot(c.x - mine.x, c.z - mine.z) < MINE_RANGE)
      if (!cop) return mine.life > 0
      // Thrown sideways and badly hurt: often a wreck.
      const side = this.setupRng() < 0.5 ? -1 : 1
      cop.vx = cop.vx * 0.3 + Math.cos(cop.heading) * 14 * side
      cop.vz = cop.vz * 0.3 - Math.sin(cop.heading) * 14 * side
      cop.yawRate += side * 4
      cop.damage = Math.min(1, cop.damage + MINE_DAMAGE / cop.spec.toughness)
      this.events.push({ type: 'mineHit', x: mine.x, z: mine.z })
      if (cop.damage >= 1 && !this.wreckedCops.has(cop)) {
        this.wreckedCops.add(cop)
        this.takedowns.cops.push(this.pursuit.heat)
        this.events.push({ type: 'takedown', cop })
      }
      return false
    })
  }

  // The next roadblock or spike strip, out of sight ahead of the player.
  private setUp() {
    const me = this.player.car
    const s = locate(this.track, me.x, me.z, me.hint).s + SETUP_AHEAD
    const side = this.setupRng() < 0.5 ? -1 : 1
    const w = this.track.width
    if (this.setups++ % 2 === 0) {
      const gap = this.placeRoadblock(s, side)
      if (this.pursuit.heat >= 4 && this.setupRng() < 0.5) this.spikes.push({ s: s - 6, offset: gap.offset, half: gap.half })
      this.events.push({ type: 'roadblock' })
    } else {
      this.spikes.push({ s, offset: (side * w) / 4, half: w / 4 + 0.6 })
      this.events.push({ type: 'spikesAhead' })
    }
  }

  // Parks heavy units sideways across the road at s, from the barrier on
  // one side, leaving a gap at least ROADBLOCK_GAP wide on the given side.
  // The cars of the last roadblock are moved here rather than new ones
  // made. Traffic close by is moved on so it does not queue in the gap.
  // Returns the gap's centre offset and half width.
  private placeRoadblock(s: number, side: number): { offset: number; half: number } {
    const track = this.track
    const w = track.width
    const count = Math.max(1, Math.floor((w - ROADBLOCK_GAP) / CAR_ACROSS))
    for (let k = 0; k < count; k++) {
      const offset = -side * (w / 2) + side * CAR_ACROSS * (k + 0.5)
      const at = pointAt(track, s + (k % 2) * 1.5, offset)
      const turn = Math.PI / 2 + (this.setupRng() - 0.5) * 0.3
      const fresh = createCar(at.x, at.z, at.heading + turn, track, HEAVY_SPEC)
      fresh.nitro = 0
      let car = this.blockade[k]
      if (car) {
        Object.assign(car, fresh)
        this.wreckedCops.delete(car)
      } else {
        car = fresh
        this.blockade.push(car)
        this.police.push(car)
        this.copKind.set(car, 'heavy')
        this.copRole.set(car, 'ram')
      }
    }
    for (const t of this.traffic) {
      const at = locate(track, t.car.x, t.car.z, t.car.hint).s
      let gap = at - s
      if (gap > track.length / 2) gap -= track.length
      if (gap < -track.length / 2) gap += track.length
      if (Math.abs(gap) < 80) {
        const p = pointAt(track, s + 160 + Math.abs(gap), t.lane)
        const v = Math.max(t.cruise, forwardSpeed(t.car))
        Object.assign(t.car, { x: p.x, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * v, vz: Math.cos(p.heading) * v, yawRate: 0, hint: locate(track, p.x, p.z).i })
      }
    }
    const edge = -side * (w / 2) + side * CAR_ACROSS * count
    const half = (w / 2 - side * edge) / 2
    return { offset: side * (w / 2 - half), half }
  }

  // Spike strips: the player's car over one loses its tyres for the rest of
  // the event. Strips well behind the player are picked up.
  private checkSpikes() {
    if (this.spikes.length === 0) return
    const L = this.track.length
    // Spikes are for the player, or for the racers when the player is the cop.
    const cars = this.mode === 'cop' ? this.racers.filter((r) => !r.player && !r.out).map((r) => r.car) : [this.player.car]
    const where = cars.map((car) => locate(this.track, car.x, car.z, car.hint))
    // A strip is picked up once every car it was laid for is well past it.
    this.spikes = this.spikes.filter((strip) => {
      let keep = false
      cars.forEach((car, k) => {
        let ds = where[k].s - strip.s
        if (ds > L / 2) ds -= L
        if (ds < -L / 2) ds += L
        if (!this.blown.has(car) && Math.abs(ds) < 1.6 && Math.abs(where[k].d - strip.offset) < strip.half + car.spec.halfWidth) {
          this.blown.add(car)
          car.spec = { ...car.spec, topSpeed: car.spec.topSpeed * PUNCTURED.topSpeed, lateralLimit: car.spec.lateralLimit * PUNCTURED.grip, grip: car.spec.grip * PUNCTURED.grip }
          if (car === this.player.car) this.punctured = true
          this.events.push({ type: 'punctured' })
        }
        if (ds < 80) keep = true
      })
      return keep
    })
  }

  // Playing the cop: racers are busted by damage or by being boxed in,
  // backup arrives on the radio, the helicopter tool flies over the
  // leader, and the event ends when no racer is left on the road.
  private updateCop(dt: number) {
    if (this.phase !== 'racing') return
    const me = this.player.car
    this.toolWait = Math.max(0, this.toolWait - dt)
    for (const racer of this.racers) {
      if (racer.player || racer.out || racer.finishTime !== null) continue
      if (racer.car.damage >= 1) {
        this.bust(racer)
        continue
      }
      const slow = speedOf(racer.car) < 6
      const near = [me, ...this.activeCops].some((c) => Math.hypot(c.x - racer.car.x, c.z - racer.car.z) < BOX_RANGE)
      const t = slow && near ? (this.boxed.get(racer) ?? 0) + dt : 0
      this.boxed.set(racer, t)
      if (t >= BOX_TIME) this.bust(racer)
    }
    // Backup on the radio.
    if (this.backups < BACKUP_MAX && this.clock >= BACKUP_EVERY * (this.backups + 1)) {
      this.backups++
      this.addCop(60, 'patrol', 'ram')
      this.events.push({ type: 'backup' })
    }
    // The helicopter tool: over the leader, dropping spikes ahead of it.
    if (this.heliLeft > 0) {
      this.heliLeft = Math.max(0, this.heliLeft - dt)
      this.sinceDrop += dt
      const leader = this.leadingRacer()
      if (leader) {
        this.flyOver(leader.car, dt)
        if (this.sinceDrop >= HELI_DROP_EVERY) {
          this.sinceDrop = 0
          this.layOnLine(leader.car, 120)
        }
      }
      if (this.heliLeft === 0) this.heli = null
    }
    if (this.racers.every((r) => r.player || r.out || r.finishTime !== null)) {
      this.player.finishTime = this.clock
      this.finishOrder.push(this.player.id)
      this.phase = 'finished'
    }
  }

  private bust(racer: Racer) {
    this.knockOut(racer, 'busted')
    this.busts++
    this.events.push({ type: 'racerBusted', id: racer.id })
  }

  // The racer furthest round the lap still on the road.
  leadingRacer(): Racer | null {
    let best: Racer | null = null
    for (const r of this.racers) if (!r.player && !r.out && r.finishTime === null && (!best || r.distance > best.distance)) best = r
    return best
  }

  // For a backup car: the racer still on the road nearest ahead of it.
  private preyFor(cop: CarState): CarState | null {
    const n = this.track.n
    let best: CarState | null = null
    let bestGap = Infinity
    for (const r of this.racers) {
      if (r.player || r.out || r.finishTime !== null) continue
      const gap = ((r.car.hint - cop.hint + n) % n) * this.track.spacing
      if (gap < bestGap) {
        bestGap = gap
        best = r.car
      }
    }
    return best
  }

  // A spike strip across the racing line, the given distance ahead of a car.
  private layOnLine(car: CarState, ahead: number) {
    const s = locate(this.track, car.x, car.z, car.hint).s + ahead
    const i = Math.round((((s % this.track.length) + this.track.length) % this.track.length) / this.track.spacing) % this.track.n
    this.spikes.push({ s, offset: this.line.offset[i], half: 3.2 })
  }

  // The helicopter towards a point a second ahead of the given car.
  private flyOver(car: CarState, dt: number) {
    const h = this.heli
    if (!h) return
    const dx = car.x + car.vx - h.x
    const dz = car.z + car.vz - h.z
    const d = Math.hypot(dx, dz)
    const move = Math.min(d, HELI_SPEED * 1.4 * dt)
    if (d > 0.01) {
      h.x += (dx / d) * move
      h.z += (dz / d) * move
      if (d > 2) h.heading = Math.atan2(dx, dz)
    }
    h.seeing = d < HELI_SIGHT
  }

  // Police in a race. A waiting patrol car that sees the player go past
  // fast joins the chase. Busted puts the player out of the race. Getting
  // 300 m clear for long enough loses them, and they go back to waiting by
  // the road further on. While the chase lasts, the heat rises and more
  // patrol cars join, up to the race's limit.
  // A crash in a race with police on. With nobody after the player yet, a
  // patrol car is sent in from behind, out of sight: one that was waiting by
  // the road if there is one, or a new one within the race's limit. During
  // a chase, the heat climbs sooner instead. One report per crash: hits in
  // the same second count once.
  private lastCrash = -Infinity
  private reportCrash() {
    if (this.mode !== 'circuit' && this.mode !== 'elimination') return
    if (this.patrols === 0 || this.phase !== 'racing' || this.player.out || this.player.finishTime !== null) return
    if (this.clock - this.lastCrash < 1) return
    this.lastCrash = this.clock
    const p = this.pursuit
    if (this.chasing) {
      p.sinceJoin += CRASH_HEAT
      this.events.push({ type: 'crashReported', sent: false })
      return
    }
    const me = this.player.car
    const where = locate(this.track, me.x, me.z, me.hint)
    const parked = [...this.parked][0]
    if (parked) {
      const at = pointAt(this.track, where.s - CRASH_BEHIND, 3)
      const fresh = createCar(at.x, at.z, at.heading, this.track, parked.spec)
      fresh.nitro = 0
      const v = Math.max(20, forwardSpeed(me))
      fresh.vx = Math.sin(at.heading) * v
      fresh.vz = Math.cos(at.heading) * v
      Object.assign(parked, fresh)
      this.parked.delete(parked)
    } else if (this.activeCops.length < this.patrols) this.addCop(CRASH_BEHIND)
    else return
    Object.assign(p, { busted: 0, escape: 0, heat: 1, sinceJoin: 0 })
    this.chasing = true
    this.events.push({ type: 'crashReported', sent: true })
  }

  private updatePatrol(dt: number) {
    const me = this.player.car
    if (this.phase !== 'racing' || this.player.out || this.player.finishTime !== null) return
    const p = this.pursuit
    if (speedOf(me) > SPOT_SPEED) {
      for (const cop of this.parked) {
        if (Math.hypot(cop.x - me.x, cop.z - me.z) > SPOT_RANGE) continue
        this.parked.delete(cop)
        if (!this.chasing) Object.assign(p, { busted: 0, escape: 0, heat: 1, sinceJoin: 0 })
        this.chasing = true
        this.events.push({ type: 'spotted' })
      }
    }
    if (!this.chasing) return
    const cops = this.activeCops
    this.pulse(dt)
    // Every chasing car wrecked: the chase is over, as if they were lost.
    const result = cops.length === 0 ? 'escaped' : this.meters(dt, cops)
    if (result === 'busted') {
      this.knockOut(this.player, 'busted')
      this.events.push({ type: 'busted' })
    } else if (result === 'escaped') {
      this.escapes.push(p.heat)
      this.events.push({ type: 'lostPolice', heat: p.heat })
      this.chasing = false
      const s = locate(this.track, me.x, me.z, me.hint).s
      cops.forEach((cop, k) => this.parkCop(s + 700 + 450 * k, cop))
      Object.assign(p, { busted: 0, escape: 0, heat: 1, sinceJoin: 0 })
    } else {
      p.sinceJoin += dt
      if (p.sinceJoin > HEAT_STEP) this.heatUp(this.patrols)
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

  // Whether the player is in a rival's slipstream.
  slipping = false
  private slipstream(dt: number) {
    const me = this.player.car
    let found = false
    if (this.phase === 'racing' && this.player.finishTime === null && !this.player.out && speedOf(me) > SLIP_SPEED) {
      for (const racer of this.racers) {
        const c = racer.car
        if (racer.player || racer.out || speedOf(c) < SLIP_SPEED) continue
        const fx = Math.sin(c.heading)
        const fz = Math.cos(c.heading)
        const dx = me.x - c.x
        const dz = me.z - c.z
        const behind = -(dx * fx + dz * fz)
        const side = Math.abs(dx * fz - dz * fx)
        if (behind > 3 && behind < SLIP_RANGE && side < SLIP_WIDTH) {
          found = true
          break
        }
      }
    }
    if (found) me.nitro = Math.min(1, me.nitro + SLIP_NITRO * dt)
    if (found && !this.slipping) this.events.push({ type: 'slipstream' })
    this.slipping = found
  }

  // A near miss: the player goes from behind a traffic car to ahead of it,
  // close alongside, clearly faster, and without having touched it.
  private nearMisses() {
    if (this.phase !== 'racing' || this.traffic.length === 0 || this.player.finishTime !== null || this.player.out) return
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
        if (side < 4.2 && speed - forwardSpeed(t.car) > 6 && this.clock - state.touched > 0.6) {
          this.nearMissCount++
          this.events.push({ type: 'nearMiss' })
        }
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
        if (racer.player) {
          if (racer.car.damage <= this.lapDamage) {
            this.cleanLaps++
            this.events.push({ type: 'cleanLap' })
          }
          this.lapDamage = racer.car.damage
        }
        if (this.mode === 'elimination' && racer.lapTimes.length > this.lapsLed) {
          this.lapsLed = racer.lapTimes.length
          this.eliminateLast()
          if (racer.finishTime !== null) return
        }
        // Playing the cop, only the racers have a finish line.
        if (this.mode !== 'elimination' && !(this.mode === 'cop' && racer.player) && racer.lapTimes.length >= this.laps) {
          racer.finishTime = this.clock
          this.finishOrder.push(racer.id)
          return
        }
      }
      racer.lapStart = this.clock
      if (racer.player) this.lapDamage = racer.car.damage
    }
  }

  // Moves a car back onto the centre of the road where it is, facing the
  // right way. For when the player gets stuck or turned round.
  reset(racer: Racer) {
    const where = locate(this.track, racer.car.x, racer.car.z, racer.car.hint)
    const at = pointAt(this.track, where.s, 0)
    Object.assign(racer.car, { x: at.x, z: at.z, heading: at.heading, vx: 0, vz: 0, yawRate: 0, gripRecovery: 1, driftDir: 0, driftAngle: 0 })
  }
}
