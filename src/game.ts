import { Color, type Group, MathUtils, type MeshStandardMaterial, Object3D, SpotLight, Vector3 } from 'three'
import { Sound } from './audio'
import type { EventKind, Outcome } from './career'
import { bumper, finishOrbit, heli, INTRO_SECONDS, intro, tv, tvCameras } from './cinema'
import { Input } from './input'
import { applyWeather, type Weather, weatherFor } from './render/atmosphere'
import { type CarModel, createCarModel, WheelBank } from './render/carModel'
import { buildCity, type City } from './render/city'
import { Particles, Rain, Skids, Trails } from './render/effects'
import { Garage } from './render/garage'
import { spot } from './render/textures'
import { buildTrackMeshes } from './render/trackMesh'
import { type Quality, World } from './render/world'
import { type Replay, Recorder } from './replay'
import { CAR, type CarState, forwardSpeed, speedOf } from './sim/car'
import { carById, CARS, type Shape } from './sim/cars'
import { Race, type Racer, STEP } from './sim/race'

export type Mode = 'menu' | 'garage' | 'intro' | 'race' | 'paused' | 'results' | 'replay'

// Everything needed to start an event, from the career or quick race.
export interface EventSpec {
  kind: EventKind
  title: string
  seed: string
  laps: number
  rivals: number
  skill: number
  traffic: number
  police?: number
  weather: Weather | 'auto'
  target?: number
  careerId?: string
}

export interface Settings {
  seed: string
  laps: number
  color: string
  car: string
  quality: Quality
  sound: boolean
  traffic: boolean
  weather: Weather | 'auto'
  kind: EventKind
}

interface View {
  car: CarState
  model: CarModel
  prev: { x: number; z: number; heading: number }
  racer: Racer | null
  police: boolean
  // Hit strength taken on each side so far, for parts coming off and
  // lights going out.
  dmg: { left: number; right: number; front: number; rear: number }
  wasBraking: boolean
}

interface Debris {
  mesh: import('three').Mesh
  vx: number
  vy: number
  vz: number
  spin: Vector3
  age: number
}

export type CameraMode = 'chase' | 'far' | 'hood' | 'bumper' | 'drone'
export const CAMERA_MODES: CameraMode[] = ['chase', 'far', 'hood', 'bumper', 'drone']
const CAMERA_NAMES: Record<CameraMode, string> = { chase: 'Chase', far: 'Far chase', hood: 'Bonnet', bumper: 'Bumper', drone: 'Drone' }

interface Ghost {
  time: number
  // t, x, z, heading, repeated.
  samples: number[]
}

export type ReplayCamera = 'tv' | 'chase' | 'heli' | 'bumper'
export const REPLAY_CAMERAS: ReplayCamera[] = ['tv', 'chase', 'heli', 'bumper']

const $ = (id: string) => document.getElementById(id) as HTMLElement

// Gear bands in m/s. Purely for the gauge and the engine note; the physics
// has no gearbox.
const GEARS = [0, 13, 24, 35, 46, 57, 1000]

export function gearOf(speed: number): { gear: number; rpm: number } {
  let g = 0
  while (g < GEARS.length - 2 && speed >= GEARS[g + 1]) g++
  const lo = GEARS[g]
  const hi = Math.min(GEARS[g + 1], CAR.topSpeed * CAR.nitroTop)
  return { gear: g + 1, rpm: 0.22 + 0.78 * Math.min(1, (speed - lo) / (hi - lo)) }
}

export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'none yet'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

const RIVAL_SHAPES: Shape[] = ['vanta', 'kite', 'brute', 'volt']

export class Game {
  readonly world: World
  readonly input = new Input()
  readonly sound = new Sound()
  readonly garage: Garage
  settings: Settings
  race!: Race
  event!: EventSpec
  weather: Weather = 'clear'
  mode: Mode = 'menu'
  timeScale = 1
  onResults: ((outcome: Outcome) => void) | null = null
  // Lets the screenshot script place the camera by hand.
  cameraOverride: ((camera: import('three').PerspectiveCamera) => void) | null = null
  camMode: CameraMode = 'chase'

  // Replay state, read by the replay controls.
  replay: Replay | null = null
  replayTime = 0
  replaySpeed = 1
  replayPlaying = true
  replayCamera: ReplayCamera = 'tv'
  replayFollow = 0

  private readonly autopilot: boolean
  private readonly spotTexture = spot()
  private builtSeed = ''
  private scenery: Group[] = []
  private materials: (City & { road: MeshStandardMaterial }) | null = null
  private readonly wheelBank = new WheelBank(200)
  private debris: Debris[] = []
  private readonly fire: Particles
  private readonly darkSmoke: Particles
  private nitroWas = false
  private nitroPulse = 0
  private bulletUntil = 0
  private throttleAt: number | null = null
  private lastThrottle = 0
  private shot = 0
  private shotTimer = 0
  private views: View[] = []
  private ghostModel: CarModel | null = null
  private ghost: Ghost | null = null
  private ghostRecording: number[] = []
  private recorder: Recorder | null = null
  private readonly smoke: Particles
  private readonly spray: Particles
  private readonly sparks: Particles
  private readonly skids = new Skids()
  private readonly trails = new Trails(64)
  private readonly rain = new Rain()
  private raining = false
  private readonly headlight: SpotLight
  private cameras: Vector3[] = []
  private acc = 0
  private last = performance.now()
  private time = 0
  private camPos = new Vector3()
  // Direction the chase camera looks along. Only this lags behind the car,
  // never the distance, so the car stays the same size on screen at speed.
  private camDir = new Vector3(0, 0, 1)
  private camLook = new Vector3()
  private fov = 62
  private shake = 0
  private follow = 0
  private introTime = 0
  private lastCount = 0
  private lapsSeen = 0
  private endAt = 0
  private slowUntil = 0
  private finishCamera = false
  private finishTime = 0
  private wrongShown = false
  private nextLightning = 8
  private thunderAt = 0

  constructor(canvas: HTMLCanvasElement, settings: Settings, autopilot = false) {
    this.settings = settings
    this.autopilot = autopilot
    this.world = new World(canvas, settings.quality)
    this.garage = new Garage(this.world.environment, this.spotTexture)
    this.sound.setEnabled(settings.sound)
    this.smoke = new Particles(900, this.spotTexture, '#c9cad6', { grow: 3.2 })
    this.spray = new Particles(900, this.spotTexture, '#aab4d0', { grow: 2.4 })
    this.sparks = new Particles(400, this.spotTexture, '#ffb347', { additive: true, gravity: 14, brightness: 3 })
    this.fire = new Particles(300, this.spotTexture, '#ff7a2a', { additive: true, brightness: 3 })
    this.darkSmoke = new Particles(500, this.spotTexture, '#2c2c33', { grow: 2.4 })
    this.world.scene.add(this.smoke.points, this.spray.points, this.darkSmoke.points, this.sparks.points, this.fire.points, this.skids.mesh, this.trails.mesh, this.rain.lines, this.wheelBank.tyres, this.wheelBank.rims)
    this.headlight = new SpotLight('#dfe9ff', 70, 90, 0.4, 0.6, 1)
    this.headlight.target = new Object3D()
    window.addEventListener('resize', () => this.world.resize())
    requestAnimationFrame(this.frame)
  }

  get player(): Racer {
    return this.race.player
  }

  // Builds the race and everything drawn for it. The city is only rebuilt
  // when the track changes.
  private setup(spec: EventSpec, attract: boolean) {
    this.event = spec
    const car = carById(this.settings.car)
    const rivalCars = Array.from({ length: spec.rivals }, (_, k) => CARS[(k + 1) % CARS.length])
    this.race = new Race({
      seed: spec.seed,
      laps: spec.kind === 'elimination' || spec.kind === 'pursuit' ? 99 : spec.laps,
      rivals: spec.rivals,
      skill: spec.skill,
      traffic: spec.traffic,
      police: spec.police,
      mode: spec.kind === 'elimination' ? 'elimination' : spec.kind === 'pursuit' ? 'pursuit' : 'circuit',
      playerColor: this.settings.color,
      playerSpec: car.spec,
      rivalSpecs: rivalCars.map((c) => c.spec),
      autopilot: attract || this.autopilot,
    })
    if (this.builtSeed !== spec.seed) {
      for (const g of this.scenery) this.world.scene.remove(g)
      const track = buildTrackMeshes(this.race.track)
      const city = buildCity(this.race.track)
      this.scenery = [track, city.group]
      this.materials = { ...city, road: track.userData.road }
      this.world.scene.add(track, city.group)
      this.cameras = tvCameras(this.race.track)
      this.builtSeed = spec.seed
    }
    this.weather = spec.weather === 'auto' ? weatherFor(spec.seed) : spec.weather
    const m = this.materials!
    const mirror = this.world.quality === 'high'
    if (mirror) this.world.scene.add(this.world.makeReflector())
    else if (this.world.reflector) this.world.scene.remove(this.world.reflector)
    this.raining = applyWeather(this.world, this.weather, m.road, m.facade, m.dome, m.ground, mirror)
    this.rain.lines.visible = this.raining
    m.moon.visible = this.weather === 'clear'
    m.sun.visible = this.weather === 'dusk'
    for (const beam of m.beams) beam.visible = this.weather !== 'dusk'
    this.sound.setRain(this.raining && !attract)

    for (const v of this.views) this.world.scene.remove(v.model.group)
    this.views = []
    this.wheelBank.clear()
    for (const d of this.debris) this.world.scene.remove(d.mesh)
    this.debris = []
    this.nitroWas = false
    this.nitroPulse = 0
    this.throttleAt = null
    this.race.racers.forEach((racer, k) => {
      const shape = racer.player ? car.shape : RIVAL_SHAPES[(k + 1) % RIVAL_SHAPES.length]
      this.addView(racer.car, createCarModel(racer.color, this.spotTexture, { shape, bank: this.wheelBank }), racer, false)
    })
    for (const t of this.race.traffic) this.addView(t.car, createCarModel(t.color, this.spotTexture, { shape: t.shape, glow: false, bank: this.wheelBank }), null, false)
    for (const cop of this.race.police) this.addView(cop, createCarModel('#14161c', this.spotTexture, { shape: 'police', glow: false, bank: this.wheelBank }), null, true)

    this.headlight.removeFromParent()
    const playerModel = this.views[this.race.racers.length - 1].model.group
    this.headlight.position.set(0, 0.8, 2.0)
    this.headlight.target.position.set(0, 0, 30)
    playerModel.add(this.headlight, this.headlight.target)

    this.skids.clear()
    this.trails.clear()
    this.acc = 0
    this.lastCount = 0
    this.lapsSeen = 0
    this.endAt = 0
    this.slowUntil = 0
    this.finishCamera = false
    this.timeScale = 1
    this.wrongShown = false
    this.replay = null
    this.recorder = attract ? null : new Recorder(this.allCars())
    this.ghostModel?.group.removeFromParent()
    this.ghostModel = null
    this.ghost = null
    this.ghostRecording = []
    if (spec.kind === 'trial') {
      this.ghost = loadGhost(spec.seed)
      this.ghostModel = createCarModel('#9fe8ff', this.spotTexture, { shape: car.shape, ghost: true })
      this.ghostModel.group.visible = false
      this.world.scene.add(this.ghostModel.group)
    }
    // Put the camera behind the player straight away, not swooping in.
    this.camPos.set(0, 0, 0)
  }

  private addView(car: CarState, model: CarModel, racer: Racer | null, police: boolean) {
    this.world.scene.add(model.group)
    this.views.push({ car, model, prev: { x: car.x, z: car.z, heading: car.heading }, racer, police, dmg: { left: 0, right: 0, front: 0, rear: 0 }, wasBraking: false })
  }

  // Racers, then traffic, then police: the same order the views use.
  private allCars(): CarState[] {
    return [...this.race.racers.map((r) => r.car), ...this.race.traffic.map((t) => t.car), ...this.race.police]
  }

  showMenu() {
    this.mode = 'menu'
    this.world.show(this.world.scene)
    this.setup({ kind: 'race', title: '', seed: this.settings.seed, laps: 99, rivals: 5, skill: 1, traffic: 8, weather: this.settings.weather }, true)
    // Run the attract race on a little so the cars are already moving.
    for (let t = 0; t < 9; t += STEP) this.race.step()
    this.snapViews()
    this.follow = 0
  }

  showGarage() {
    this.mode = 'garage'
    this.world.show(this.garage.scene)
    this.refreshGarage()
  }

  refreshGarage(carId = this.settings.car) {
    this.garage.show(carById(carId).shape, this.settings.color)
  }

  start(spec: EventSpec) {
    this.world.show(this.world.scene)
    this.setup(spec, false)
    this.mode = 'intro'
    this.introTime = 0
    this.input.take('any')
    this.sound.start()
  }

  skipIntro() {
    if (this.mode !== 'intro') return
    this.mode = 'race'
    this.camPos.set(0, 0, 0)
    $('intro').classList.add('hidden')
    $('hud').classList.remove('hidden')
  }

  setQuality(quality: Quality) {
    this.settings.quality = quality
    this.world.setQuality(quality)
  }

  // Advances the simulation without drawing, for the browser tests.
  fastForward(seconds: number) {
    this.skipIntro()
    for (let t = 0; t < seconds; t += STEP) this.tick()
    this.snapViews()
  }

  private snapViews() {
    for (const v of this.views) v.prev = { x: v.car.x, z: v.car.z, heading: v.car.heading }
  }

  private frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.time += dt
    if (this.mode === 'intro') {
      this.introTime += dt
      if (this.introTime >= INTRO_SECONDS || this.input.take('any')) this.skipIntro()
    }
    if (this.mode === 'race') this.keys()
    if (this.mode === 'race' || this.mode === 'results' || this.mode === 'menu') {
      if (this.mode === 'race') this.race.playerInput = this.input.read(dt)
      if (this.slowUntil > 0 && now > this.slowUntil) {
        this.slowUntil = 0
        this.timeScale = 1
      }
      const bullet = this.bulletUntil > now && this.slowUntil === 0 ? 0.45 : 1
      this.acc += dt * this.timeScale * bullet
      let steps = 0
      while (this.acc >= STEP && steps < 48) {
        this.tick()
        this.acc -= STEP
        steps++
      }
      if (steps >= 48) this.acc = 0
    }
    if (this.mode === 'replay' && this.replay) {
      if (this.replayPlaying) this.replayTime = Math.min(this.replay.duration, this.replayTime + dt * this.replaySpeed)
      this.replay.apply(this.replayTime)
      this.acc = 0
    }
    if (this.mode === 'garage') {
      this.garage.update(this.time, this.world.camera, window.innerWidth > 900)
      this.world.render()
    } else this.draw(this.mode === 'paused' ? 0 : dt)
    requestAnimationFrame(this.frame)
  }

  private keys() {
    if (this.input.take('pause')) this.pause()
    if (this.input.take('camera')) {
      this.camMode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.camMode) + 1) % CAMERA_MODES.length]
      this.camPos.set(0, 0, 0)
      popup(`Camera: ${CAMERA_NAMES[this.camMode]}`, 'cyan')
    }
    if (this.input.take('reset') && this.race.phase === 'racing') this.race.reset(this.player)
  }

  pause() {
    if (this.mode !== 'race') return
    this.mode = 'paused'
    $('pause').classList.remove('hidden')
  }

  resume() {
    if (this.mode !== 'paused') return
    this.mode = 'race'
    $('pause').classList.add('hidden')
  }

  startReplay() {
    if (!this.recorder) return
    this.replay = this.recorder.finish(-1)
    this.recorder = null
    this.mode = 'replay'
    // Start just before the green light.
    this.replayTime = 0
    this.replayPlaying = true
    this.replaySpeed = 1
    this.replayCamera = 'tv'
    this.replayFollow = this.race.racers.length - 1
    this.skids.clear()
    this.trails.clear()
  }

  // One fixed physics step plus the race events that come out of it.
  private tick() {
    for (const v of this.views) v.prev = { x: v.car.x, z: v.car.z, heading: v.car.heading }
    const before = this.race.phase
    const copsBefore = this.race.police.length
    this.race.step()
    // Patrol cars that joined the chase need a model.
    for (let k = copsBefore; k < this.race.police.length; k++) {
      const cop = this.race.police[k]
      this.addView(cop, createCarModel('#14161c', this.spotTexture, { shape: 'police', glow: false, bank: this.wheelBank }), null, true)
    }
    if (this.mode === 'menu') {
      this.race.events = []
      return
    }
    if (this.recorder && this.race.clock > -1) this.recorder.sample(this.race.clock)
    const race = this.race
    const player = this.player
    const now = performance.now()

    // Perfect start: the throttle goes down in the last moment before the
    // green light, not early.
    if (race.phase === 'countdown' && race.playerInput.throttle > 0 && this.throttleAt === null) this.throttleAt = race.clock
    if (race.phase === 'countdown' && race.playerInput.throttle === 0) this.throttleAt = null
    if (race.phase === 'countdown') {
      const count = Math.ceil(-race.clock)
      if (count !== this.lastCount && count <= 3) {
        this.lastCount = count
        flash(String(count))
        this.sound.beep(false)
      }
    }
    if (before === 'countdown' && race.phase === 'racing') {
      flash('Go')
      this.sound.beep(true)
      if (this.throttleAt !== null && this.throttleAt > -0.45) {
        player.car.nitro = Math.min(1, player.car.nitro + 0.3)
        popup('Perfect start', 'gold')
        this.nitroPulse = 0.6
      }
    }

    // Nitro lighting up: a pulse of light, a kick of the camera and a thump.
    if (player.car.nitroOn && !this.nitroWas) {
      this.nitroPulse = 1
      this.shake = Math.min(1, this.shake + 0.3)
      this.sound.ignite()
    }
    this.nitroWas = player.car.nitroOn

    // Lifting off at speed makes the exhaust pop.
    const throttle = race.playerInput.throttle
    if (this.lastThrottle > 0.5 && throttle === 0 && speedOf(player.car) > 30) this.backfire(this.views[race.racers.length - 1], true)
    this.lastThrottle = throttle

    for (const e of race.events) {
      if (e.type === 'nearMiss') {
        player.car.nitro = Math.min(1, player.car.nitro + 0.15)
        popup('Near miss', 'cyan')
        this.sound.whoosh()
        // A beat of slow motion as the car slips past.
        this.bulletUntil = now + 260
        this.nitroPulse = Math.max(this.nitroPulse, 0.3)
      } else if (e.type === 'driftBank') {
        popup(`+${e.points.toLocaleString('en')} drift`, 'gold')
      } else if (e.type === 'driftLost') {
        popup('Drift lost', 'red')
      } else if (e.type === 'eliminated') {
        const out = race.racers[e.id]
        if (out.player) flash('Eliminated', 'warn')
        else popup(`${out.name} is out`, 'red')
      } else if (e.type === 'copJoined') {
        popup(`Heat ${race.pursuit.heat}: another patrol car`, 'red')
      } else if (e.type === 'busted') {
        flash('Busted', 'warn')
      } else if (e.type === 'escaped') {
        flash('Escaped')
        this.slowMotion(now)
      } else if (e.type === 'contact') {
        this.shake = Math.min(1, this.shake + e.strength * 0.04)
      }
    }
    race.events = []

    // Ghost: record the current lap, 30 times a second.
    if (this.event.kind === 'trial' && player.checkpoints >= 1 && player.finishTime === null) {
      if (Math.round(race.clock / STEP) % 4 === 0) {
        this.ghostRecording.push(+(race.clock - player.lapStart).toFixed(3), +player.car.x.toFixed(2), +player.car.z.toFixed(2), +player.car.heading.toFixed(3))
      }
    }
    if (player.lapTimes.length > this.lapsSeen) {
      this.lapsSeen = player.lapTimes.length
      const lap = player.lapTimes[this.lapsSeen - 1]
      const more = this.event.kind === 'elimination' || this.lapsSeen < race.laps
      if (this.event.kind === 'trial' && (!this.ghost || lap < this.ghost.time)) {
        this.ghost = { time: lap, samples: this.ghostRecording }
        saveGhost(this.event.seed, this.ghost)
        if (more) flash(`New best ${formatTime(lap)}`, 'small')
      } else if (more && this.event.kind !== 'elimination') {
        flash(this.lapsSeen === race.laps - 1 ? 'Final lap' : `Lap ${formatTime(lap)}`, 'small')
      }
      this.ghostRecording = []
    }

    // How the event ends: crossing the line, being knocked out, or the
    // chase ending one way or the other.
    if (this.endAt === 0 && this.mode === 'race') {
      if (player.finishTime !== null) {
        const place = race.position(player)
        const label = this.event.kind === 'elimination' ? 'Last car running' : this.event.kind === 'race' ? `${ordinal(place)} place` : 'Finished'
        flash(label)
        race.bankDrift()
        this.slowMotion(now)
        this.endAt = now + 3200
      } else if (player.out || race.pursuit.outcome) {
        this.endAt = now + 2600
      }
    }
    if (this.mode === 'race' && this.endAt > 0 && now > this.endAt) this.showResults()
  }

  private slowMotion(now: number) {
    this.timeScale = 0.3
    this.slowUntil = now + 2400
    this.finishCamera = true
    this.finishTime = this.time
  }

  private showResults() {
    this.mode = 'results'
    this.finishCamera = false
    this.timeScale = 1
    const race = this.race
    const player = this.player
    this.onResults?.({
      place: race.position(player),
      points: race.drift.total,
      escaped: race.pursuit.outcome === 'escaped',
      bestLap: player.lapTimes.length ? Math.min(...player.lapTimes) : undefined,
      referenceLap: race.line.lapTime,
    })
  }

  private draw(dt: number) {
    const alpha = this.mode === 'replay' ? 1 : this.acc / STEP
    const cam = this.world.camera
    let trail = 0
    for (const v of this.views) {
      const car = v.car
      const g = v.model.group
      const hidden = v.racer?.out ?? false
      g.visible = !hidden
      if (hidden) continue
      g.position.set(MathUtils.lerp(v.prev.x, car.x, alpha), 0, MathUtils.lerp(v.prev.z, car.z, alpha))
      g.rotation.y = v.prev.heading + (car.heading - v.prev.heading) * alpha
      for (const wheel of v.model.wheels) wheel.rotation.x = car.wheelSpin
      for (const pivot of v.model.frontPivots) pivot.rotation.y = -car.steer
      const speed = forwardSpeed(car)
      // Body lean: roll out of the turn and pitch under braking.
      v.model.body.rotation.z = MathUtils.lerp(v.model.body.rotation.z, MathUtils.clamp(car.yawRate * speed * -0.0035, -0.07, 0.07), 0.2)
      v.model.body.rotation.x = MathUtils.lerp(v.model.body.rotation.x, car.braking ? 0.025 : 0, 0.15)
      v.model.tail.color.copy(TAIL).multiplyScalar(car.braking ? 5 : 1.6)
      for (const flame of v.model.flames) {
        flame.visible = car.nitroOn
        if (car.nitroOn) {
          const big = v.racer?.player ? this.nitroPulse * 1.4 : 0
          flame.scale.set(1 + big * 0.4, 1 + big * 0.4, 0.8 + Math.random() * 0.7 + big)
        }
      }
      if (this.mode !== 'replay' && car.hits.length) {
        for (let k = 0; k + 3 < car.hits.length; k += 4) this.damage(v, car.hits[k], car.hits[k + 1], car.hits[k + 2], car.hits[k + 3])
        car.hits.length = 0
      }
      // AI cars pop their exhausts when they brake hard from speed.
      if (!v.racer?.player && car.braking && !v.wasBraking && speed > 30 && v.model.exhausts.length && Math.random() < 0.6) this.backfire(v, false)
      v.wasBraking = car.braking
      if (v.model.siren) {
        const phase = Math.floor(this.time * 7) % 2
        v.model.siren.red.color.copy(RED).multiplyScalar(phase ? 5 : 0.4)
        v.model.siren.blue.color.copy(BLUE).multiplyScalar(phase ? 0.4 : 5)
      }
      // Tail light streaks once a car is properly moving.
      const c = Math.cos(g.rotation.y)
      const s = Math.sin(g.rotation.y)
      for (const [lx, ly, lz] of v.model.tailLights) {
        this.trails.push(trail++, g.position.x + lx * c + lz * s, ly, g.position.z - lx * s + lz * c, speed > 24 || car.nitroOn, car.nitroOn)
      }
      if (dt > 0) this.tyres(v, dt)
    }
    this.wheelBank.update()
    if (dt > 0) {
      this.smoke.update(dt)
      this.spray.update(dt)
      this.darkSmoke.update(dt)
      this.sparks.update(dt)
      this.fire.update(dt)
      this.updateDebris(dt)
    }
    this.nitroPulse *= Math.exp(-dt * 2.6)
    const city = this.materials
    if (city) {
      city.beacons.opacity = Math.sin(this.time * 3) > 0.6 ? 1 : 0.15
      for (const t of city.tickers) t.offset.x = (t.offset.x + dt * 0.06) % 1
      for (const beam of city.beams) {
        const p = beam.userData.phase as number
        beam.rotation.z = Math.sin(this.time * 0.17 + p) * 0.45
        beam.rotation.x = Math.cos(this.time * 0.13 + p) * 0.3
      }
    }

    if (this.ghostModel) {
      const sample = this.ghost && this.player.checkpoints >= 1 && this.player.finishTime === null && this.mode === 'race' ? ghostAt(this.ghost, this.race.clock - this.player.lapStart) : null
      this.ghostModel.group.visible = sample !== null
      if (sample) {
        this.ghostModel.group.position.set(sample[0], 0, sample[1])
        this.ghostModel.group.rotation.y = sample[2]
      }
    }

    this.camera(dt)
    this.trails.update(cam.position.x, cam.position.y, cam.position.z)
    if (this.raining) {
      this.rain.update(this.time, cam.position.x, cam.position.y, cam.position.z)
      this.lightning(dt)
    }
    if (this.mode === 'race' || this.mode === 'results' || this.mode === 'paused') this.hud()
    const followed = this.mode === 'replay' ? this.race.racers[this.replayFollow].car : this.player.car
    const { rpm } = gearOf(Math.abs(forwardSpeed(followed)))
    const active = this.mode === 'race' || this.mode === 'results' || this.mode === 'replay'
    const throttle = this.mode === 'race' ? this.race.playerInput.throttle : 0.5
    this.sound.update(rpm, throttle, followed.slip * (speedOf(followed) > 8 ? 1 : 0), followed.nitroOn, active && this.race.phase !== 'countdown' && this.replayPlaying)
    let nearest = Infinity
    for (const cop of this.race.police) nearest = Math.min(nearest, Math.hypot(cop.x - followed.x, cop.z - followed.z))
    this.sound.siren(active && this.race.police.length ? Math.max(0, 1 - nearest / 260) : 0)
    const boost = followed.nitroOn ? 0.85 : MathUtils.clamp((speedOf(followed) - 55) / 30, 0, 0.35)
    this.world.setSpeedEffect(this.mode === 'race' ? boost : this.mode === 'replay' ? boost * 0.6 : 0, this.mode === 'race' ? this.nitroPulse : 0)
    this.world.render()
  }

  // A hit on one car: dent the body, and past a point knock off the parts
  // on that side or put a headlight out.
  private damage(v: View, x: number, y: number, z: number, strength: number) {
    v.model.hit(x, y, z, strength)
    const side = Math.abs(x) > Math.abs(z) * 0.42 ? (x > 0 ? 'left' : 'right') : z > 0 ? 'front' : 'rear'
    v.dmg[side] += strength
    for (const part of v.model.loose) {
      if (part.side !== side || !part.mesh.parent || part.mesh.parent !== v.model.body) continue
      if (v.dmg[side] < (side === 'rear' ? 16 : 11)) continue
      this.detach(v, part.mesh)
    }
    if (side === 'front' && v.dmg.front > 14) {
      const head = v.model.heads[x > 0 ? 1 : 0]
      head.color.setScalar(0.02)
    }
    if (v.racer?.player && strength > 12 && this.mode === 'race') this.bulletUntil = performance.now() + 380
  }

  private detach(v: View, mesh: import('three').Mesh) {
    mesh.updateWorldMatrix(true, false)
    const world = mesh.matrixWorld.clone()
    v.model.body.remove(mesh)
    mesh.matrixAutoUpdate = true
    world.decompose(mesh.position, mesh.quaternion, mesh.scale)
    this.world.scene.add(mesh)
    const car = v.car
    this.debris.push({
      mesh,
      vx: car.vx * 0.55 + (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 3,
      vz: car.vz * 0.55 + (Math.random() - 0.5) * 4,
      spin: new Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
      age: 0,
    })
  }

  private updateDebris(dt: number) {
    for (const d of this.debris) {
      d.age += dt
      d.vy -= 9.8 * dt
      d.mesh.position.x += d.vx * dt
      d.mesh.position.y += d.vy * dt
      d.mesh.position.z += d.vz * dt
      d.mesh.rotation.x += d.spin.x * dt
      d.mesh.rotation.y += d.spin.y * dt
      d.mesh.rotation.z += d.spin.z * dt
      if (d.mesh.position.y < 0.06) {
        d.mesh.position.y = 0.06
        d.vy = Math.abs(d.vy) * 0.3
        d.vx *= 0.7
        d.vz *= 0.7
        d.spin.multiplyScalar(0.6)
      }
    }
    const gone = this.debris.filter((d) => d.age > 10)
    for (const d of gone) this.world.scene.remove(d.mesh)
    if (gone.length) this.debris = this.debris.filter((d) => d.age <= 10)
  }

  // Flames and a crackle from the exhausts.
  private backfire(v: View, loud: boolean) {
    const g = v.model.group
    const c = Math.cos(g.rotation.y)
    const s = Math.sin(g.rotation.y)
    const car = v.car
    // The electric car has no exhaust to pop.
    if (!v.model.exhausts.length) return
    for (const [lx, ly, lz] of v.model.exhausts) {
      const wx = g.position.x + lx * c + lz * s
      const wz = g.position.z - lx * s + lz * c
      const bx = -Math.sin(g.rotation.y)
      const bz = -Math.cos(g.rotation.y)
      for (let k = 0; k < 7; k++) {
        this.fire.emit(wx, ly, wz, car.vx + bx * (3 + Math.random() * 4), Math.random() * 0.6, car.vz + bz * (3 + Math.random() * 4), 0.1 + Math.random() * 0.12, 0.45 + Math.random() * 0.3)
      }
    }
    const cam = this.world.camera.position
    const near = Math.hypot(cam.x - car.x, cam.z - car.z) < 40
    if (loud || near) this.sound.pop(loud ? 1 : 0.5)
  }

  private lightning(dt: number) {
    this.nextLightning -= dt
    if (this.nextLightning <= 0) {
      this.world.flash = 1
      this.nextLightning = 9 + Math.random() * 14
      this.thunderAt = this.time + 0.8 + Math.random() * 1.6
      // A second, smaller flicker straight after the first.
      window.setTimeout(() => (this.world.flash = 0.6), 120)
    }
    if (this.thunderAt > 0 && this.time > this.thunderAt) {
      this.thunderAt = 0
      if (this.mode !== 'menu') this.sound.thunder()
    }
  }

  // Smoke, spray, skid marks and sparks for one car.
  private tyres(v: View, dt: number) {
    const car = v.car
    const fx = Math.sin(car.heading)
    const fz = Math.cos(car.heading)
    const speed = speedOf(car)
    const skidding = car.drifting || (car.braking && speed > 28)
    for (const side of [-1, 1]) {
      const wx = car.x - fx * 1.38 + -fz * 0.86 * side
      const wz = car.z - fz * 1.38 + fx * 0.86 * side
      if (v.racer) this.skids.mark(`${v.racer.id}${side}`, wx, wz, skidding && !this.raining)
      if (car.drifting) {
        const rate = Math.min(1, car.slip * 2) * 40 * dt
        for (let k = 0; k < rate; k++) {
          if (Math.random() > rate - k) break
          this.smoke.emit(wx, 0.4, wz, car.vx * 0.25 + (Math.random() - 0.5) * 2, 0.8 + Math.random(), car.vz * 0.25 + (Math.random() - 0.5) * 2, 1.4, 1.2)
        }
      }
      // Rain: a fine spray off the back wheels at speed.
      if (this.raining && speed > 15) {
        const rate = Math.min(1, speed / 60) * 30 * dt
        for (let k = 0; k < rate; k++) {
          if (Math.random() > rate - k) break
          this.spray.emit(wx, 0.3, wz, car.vx * 0.55 + (Math.random() - 0.5) * 3, 1 + Math.random() * 1.5, car.vz * 0.55 + (Math.random() - 0.5) * 3, 0.7, 0.8)
        }
      }
    }
    // A badly damaged car smokes from under the bonnet.
    if (car.damage > 0.45) {
      const rate = (car.damage - 0.45) * 40 * dt
      const hx = car.x + fx * (v.model.half.front - 0.7)
      const hz = car.z + fz * (v.model.half.front - 0.7)
      for (let k = 0; k < rate; k++) {
        if (Math.random() > rate - k) break
        this.darkSmoke.emit(hx, 0.95, hz, car.vx * 0.3 + (Math.random() - 0.5), 1.2 + Math.random(), car.vz * 0.3 + (Math.random() - 0.5), 1.6, 0.9)
      }
      if (car.damage > 0.85 && Math.random() < dt * 6) this.fire.emit(hx, 0.8, hz, car.vx * 0.5, 1.5, car.vz * 0.5, 0.25, 0.5)
    }
    if (car.impact > 1.5) {
      const n = Math.min(40, Math.round(car.impact * 4))
      for (let k = 0; k < n; k++) {
        this.sparks.emit(car.x, 0.6, car.z, (Math.random() - 0.5) * 16, 2 + Math.random() * 5, (Math.random() - 0.5) * 16, 0.4 + Math.random() * 0.3, 0.35)
      }
      if (v.racer?.player && this.mode === 'race') {
        this.sound.hit(car.impact)
        this.shake = Math.min(1, this.shake + car.impact * 0.06)
      }
    }
    car.impact = 0
  }

  private camera(dt: number) {
    const cam = this.world.camera
    if (this.cameraOverride) {
      this.cameraOverride(cam)
      return
    }
    if (this.mode === 'intro') {
      intro(this.race.track, this.player.car, this.introTime, cam)
      this.fov = cam.fov
      $('speedlines').style.opacity = '0'
      return
    }
    if (this.mode === 'replay') {
      const car = this.race.racers[this.replayFollow].car
      if (this.replayCamera === 'tv') tv(this.cameras, car, cam)
      else if (this.replayCamera === 'heli') heli(car, this.time, cam)
      else if (this.replayCamera === 'bumper') bumper(car, cam)
      else this.chase(this.views[this.replayFollow], dt)
      $('speedlines').style.opacity = '0'
      return
    }
    if (this.finishCamera) {
      finishOrbit(this.player.car, this.time - this.finishTime, cam)
      this.fov = cam.fov
      $('speedlines').style.opacity = '0'
      return
    }
    if (this.mode === 'menu') {
      // Tracking shots, cut every few seconds: low front three-quarter, side
      // on, high behind, and down at the rear wheel.
      this.shotTimer += dt
      if (this.shotTimer > 5.5) {
        this.shotTimer = 0
        this.shot = (this.shot + 1) % 4
        if (this.shot === 0) this.follow = (this.follow + 1) % this.race.racers.length
      }
      const g = this.views[this.follow].model.group
      const h = g.rotation.y
      const fx = Math.sin(h)
      const fz = Math.cos(h)
      const rx = -fz
      const rz = fx
      const drift = Math.sin(this.time * 0.4) * 0.8
      const p = g.position
      const shots: [number, number, number, number, number, number, number][] = [
        // camera forward, right, height; look forward, right, height; fov
        [7.5, 3.4 + drift, 0.85, 0, 0, 0.7, 42],
        [0.5, 6.2, 1.1 + drift * 0.3, 1, 0, 0.7, 40],
        [-12, 1.5, 6.5, 10, 0, 0, 52],
        [-4.8, -2.6 - drift * 0.4, 0.55, 3, 0, 0.6, 46],
      ]
      const [cf, cr, ch, lf, lr, lh, fov] = shots[this.shot]
      cam.position.set(p.x + fx * cf + rx * cr, ch, p.z + fz * cf + rz * cr)
      cam.lookAt(p.x + fx * lf + rx * lr, lh, p.z + fz * lf + rz * lr)
      cam.fov = fov
      cam.updateProjectionMatrix()
      this.camPos.copy(cam.position)
      $('speedlines').style.opacity = '0'
      return
    }
    this.chase(this.views[this.race.racers.length - 1], dt)
  }

  private chase(view: View, dt: number) {
    const cam = this.world.camera
    const g = view.model.group
    const car = view.car
    const speed = speedOf(car)
    const fx = Math.sin(g.rotation.y)
    const fz = Math.cos(g.rotation.y)
    let pos: Vector3
    let look: Vector3
    const mode = this.mode === 'replay' ? 'chase' : this.camMode
    const front = view.model.half.front
    if (this.mode === 'race' && this.input.holding('lookback')) {
      // Looking back over the boot at whatever is behind.
      pos = new Vector3(g.position.x + fx * 7, 2.3, g.position.z + fz * 7)
      look = new Vector3(g.position.x - fx * 8, 1, g.position.z - fz * 8)
      this.camPos.copy(pos)
      this.camLook.copy(look)
    } else if (mode === 'hood') {
      pos = new Vector3(g.position.x + fx * 0.2, 1.3, g.position.z + fz * 0.2)
      look = new Vector3(g.position.x + fx * 30, 1.0, g.position.z + fz * 30)
      this.camPos.copy(pos)
    } else if (mode === 'bumper') {
      pos = new Vector3(g.position.x + fx * (front + 0.1), 0.55, g.position.z + fz * (front + 0.1))
      look = new Vector3(g.position.x + fx * 30, 0.6, g.position.z + fz * 30)
      this.camPos.copy(pos)
      this.camLook.copy(look)
    } else if (mode === 'drone') {
      pos = new Vector3(g.position.x - fx * 13, 9, g.position.z - fz * 13)
      look = new Vector3(g.position.x + fx * 6, 0, g.position.z + fz * 6)
      this.camPos.copy(pos)
    } else {
      // Behind the car, looking partly along where it is going, so a drift
      // shows the car sideways on screen.
      const vx = speed > 3 ? car.vx / speed : fx
      const vz = speed > 3 ? car.vz / speed : fz
      const want = new Vector3(fx * 0.6 + vx * 0.4, 0, fz * 0.6 + vz * 0.4).normalize()
      if (this.camPos.lengthSq() === 0 || dt === 0) this.camDir.copy(want)
      else this.camDir.lerp(want, 1 - Math.exp(-dt * 5)).normalize()
      const far = mode === 'far'
      // Nitro pulls the camera back a little, so the car seems to leap away.
      const back = (far ? 10 : 6.6) + speed * (far ? 0.03 : 0.02) + this.nitroPulse * 1.6
      pos = new Vector3(g.position.x - this.camDir.x * back, (far ? 3.6 : 2.45) + speed * 0.006, g.position.z - this.camDir.z * back)
      this.camPos.copy(pos)
      look = new Vector3(g.position.x + fx * (far ? 10 : 6), 1.2, g.position.z + fz * (far ? 10 : 6))
    }
    const snap = this.camLook.lengthSq() === 0 || dt === 0
    this.camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 14))
    cam.position.copy(this.camPos)
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.5
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.5
      this.shake *= Math.exp(-dt * 6)
    }
    if (car.nitroOn) {
      cam.position.x += (Math.random() - 0.5) * 0.05
      cam.position.y += (Math.random() - 0.5) * 0.05
    }
    cam.lookAt(this.camLook)
    const fov = 60 + Math.min(14, speed * 0.17) + (car.nitroOn ? 7 : 0) + this.nitroPulse * 9
    this.fov += (fov - this.fov) * (dt > 0 ? 1 - Math.exp(-dt * 4) : 0)
    cam.fov = this.fov
    cam.updateProjectionMatrix()
    $('speedlines').style.opacity = String(MathUtils.clamp((speed - 50) / 25, 0, 0.6) + (car.nitroOn ? 0.35 : 0))
  }

  private hud() {
    const race = this.race
    const player = this.player
    const car = player.car
    const kind = this.event.kind
    const speed = Math.abs(forwardSpeed(car))
    const running = race.racers.filter((r) => !r.out).length
    $('place').textContent = String(race.position(player))
    $('field').textContent = String(kind === 'elimination' ? running : race.racers.length)
    $('place-row').classList.toggle('hidden', kind === 'drift' || kind === 'pursuit' || kind === 'trial')
    $('lap').textContent = kind === 'elimination' ? String(race.lapOf(player)) : `${race.lapOf(player)}/${race.laps}`
    $('lap-row').classList.toggle('hidden', kind === 'pursuit')
    const current = player.checkpoints >= 1 && player.finishTime === null ? race.clock - player.lapStart : player.checkpoints >= 1 ? player.lapTimes.at(-1) ?? 0 : 0
    $('lap-time').textContent = formatTime(Math.max(0, current))
    $('best-lap').textContent = player.lapTimes.length ? formatTime(Math.min(...player.lapTimes)) : 'none yet'
    $('ghost-row').classList.toggle('hidden', kind !== 'trial')
    $('ghost-time').textContent = this.ghost ? formatTime(this.ghost.time) : 'none yet'
    $('speed').textContent = String(Math.round(speed * 3.6))
    $('gear').textContent = String(gearOf(speed).gear)
    $('gauge-fill').style.strokeDashoffset = String(1 - Math.min(1, speed / (CAR.topSpeed * CAR.nitroTop)))
    $('nitro-fill').style.transform = `scaleX(${car.nitro})`
    $('nitro-row').classList.toggle('full', car.nitro > 0.98)
    const damage = $('damage-fill')
    damage.style.transform = `scaleX(${Math.max(0.02, car.damage)})`
    damage.dataset.level = car.damage > 0.7 ? 'high' : car.damage > 0.35 ? 'mid' : 'low'
    document.querySelector('.gauge')?.classList.toggle('boost', car.nitroOn)

    // The goal line under the place: what this event wants from the player.
    let goal = ''
    if (kind === 'drift') goal = `${race.drift.total.toLocaleString('en')} / ${(this.event.target ?? 0).toLocaleString('en')} drift points`
    else if (kind === 'elimination') goal = `${running} cars left. Last place is out at the end of each lap.`
    else if (kind === 'trial') goal = `Target lap ${formatTime(race.line.lapTime * (this.event.target ?? 1.12))}`
    else if (kind === 'pursuit') goal = `Heat ${race.pursuit.heat}. Get ${300} m clear of every patrol car.`
    $('goal').textContent = goal
    $('goal').classList.toggle('hidden', goal === '')
    $('pursuit').classList.toggle('hidden', kind !== 'pursuit')
    if (kind === 'pursuit') {
      $('busted-fill').style.transform = `scaleX(${race.pursuit.busted})`
      $('escape-fill').style.transform = `scaleX(${race.pursuit.escape})`
    }

    const drift = $('drift')
    if (race.drift.score >= 30) {
      drift.textContent = `${Math.round(race.drift.score).toLocaleString('en')} drift`
      drift.className = 'live'
    } else if (drift.className === 'live') drift.className = ''
    const wrong = player.wrongWay > 1 && player.finishTime === null && kind !== 'pursuit'
    if (wrong !== this.wrongShown) {
      this.wrongShown = wrong
      const banner = $('banner')
      if (wrong) {
        banner.textContent = 'Wrong way'
        banner.className = 'hold warn'
      } else banner.className = ''
    }
    this.minimap()
  }

  private mapScale = 0
  private mapSeed = ''
  private minimap() {
    const canvas = $('minimap') as HTMLCanvasElement
    const g = canvas.getContext('2d') as CanvasRenderingContext2D
    const track = this.race.track
    const size = canvas.width
    if (this.mapSeed !== this.builtSeed) {
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (let i = 0; i < track.n; i++) {
        minX = Math.min(minX, track.x[i])
        maxX = Math.max(maxX, track.x[i])
        minZ = Math.min(minZ, track.z[i])
        maxZ = Math.max(maxZ, track.z[i])
      }
      this.mapScale = (size * 0.62) / Math.max(maxX - minX, maxZ - minZ)
      this.mapSeed = this.builtSeed
    }
    const scale = this.mapScale
    // The map turns with the player so up is always forward.
    const heading = this.player.car.heading
    const px = this.player.car.x
    const pz = this.player.car.z
    const c = Math.cos(-heading)
    const s = Math.sin(-heading)
    const toMap = (x: number, z: number): [number, number] => {
      const dx = (x - px) * scale
      const dz = (z - pz) * scale
      // Facing +z means up on the map; the car's right (-x) is right on the map.
      return [size / 2 - (dx * c + dz * s), size / 2 - (-dx * s + dz * c)]
    }
    const dot = (x: number, z: number, r: number, color: string) => {
      const [mx, my] = toMap(x, z)
      g.fillStyle = color
      g.beginPath()
      g.arc(mx, my, r, 0, Math.PI * 2)
      g.fill()
    }
    g.clearRect(0, 0, size, size)
    g.save()
    g.beginPath()
    g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
    g.clip()
    g.lineJoin = 'round'
    g.beginPath()
    for (let i = 0; i <= track.n; i += 3) {
      const [x, y] = toMap(track.x[i % track.n], track.z[i % track.n])
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.closePath()
    g.strokeStyle = 'rgba(160,180,255,0.35)'
    g.lineWidth = 9
    g.stroke()
    g.strokeStyle = 'rgba(230,235,255,0.9)'
    g.lineWidth = 2.5
    g.stroke()
    const [sx, sy] = toMap(track.x[0], track.z[0])
    g.fillStyle = '#fff'
    g.fillRect(sx - 4, sy - 4, 8, 8)
    for (const t of this.race.traffic) dot(t.car.x, t.car.z, 3, 'rgba(200,200,210,0.6)')
    const flashOn = Math.floor(this.time * 6) % 2 === 0
    for (const cop of this.race.police) dot(cop.x, cop.z, 6, flashOn ? '#ff3040' : '#3060ff')
    for (const racer of this.race.racers) if (!racer.player && !racer.out) dot(racer.car.x, racer.car.z, 5, racer.color)
    g.fillStyle = this.settings.color
    g.beginPath()
    g.moveTo(size / 2, size / 2 - 9)
    g.lineTo(size / 2 + 6, size / 2 + 7)
    g.lineTo(size / 2 - 6, size / 2 + 7)
    g.closePath()
    g.fill()
    g.restore()
  }
}

const TAIL = new Color('#ff1a2e')
const RED = new Color('#ff2030')
const BLUE = new Color('#2050ff')

let flashTimer = 0
export function flash(text: string, extra = '') {
  const el = $('banner')
  el.textContent = text
  el.className = ''
  void el.offsetWidth
  el.className = `show ${extra}`
  window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => {
    if (el.className.startsWith('show')) el.className = ''
  }, 1200)
}

// Short messages that rise and fade at the side of the screen.
export function popup(text: string, tone: 'cyan' | 'gold' | 'red') {
  const box = $('popups')
  const el = document.createElement('div')
  el.className = `pop ${tone}`
  el.textContent = text
  box.prepend(el)
  window.setTimeout(() => el.remove(), 1600)
  while (box.children.length > 4) box.lastChild?.remove()
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${s}`
}

function ghostKey(seed: string) {
  return `neon-apex/ghost/${seed}`
}

function loadGhost(seed: string): Ghost | null {
  try {
    const raw = localStorage.getItem(ghostKey(seed))
    const ghost = raw ? (JSON.parse(raw) as Ghost) : null
    return ghost && Array.isArray(ghost.samples) && ghost.samples.length >= 8 ? ghost : null
  } catch {
    return null
  }
}

function saveGhost(seed: string, ghost: Ghost) {
  try {
    localStorage.setItem(ghostKey(seed), JSON.stringify(ghost))
  } catch {
    // Storage full or blocked: the ghost just will not be there next time.
  }
}

// Position of the ghost t seconds into its lap, or null outside the lap.
function ghostAt(ghost: Ghost, t: number): [number, number, number] | null {
  const s = ghost.samples
  const count = s.length / 4
  if (count < 2 || t < 0 || t > s[(count - 1) * 4]) return null
  let lo = 0
  let hi = count - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (s[mid * 4] <= t) lo = mid
    else hi = mid
  }
  const a = lo * 4
  const b = hi * 4
  const f = (t - s[a]) / (s[b] - s[a] || 1)
  return [s[a + 1] + (s[b + 1] - s[a + 1]) * f, s[a + 2] + (s[b + 2] - s[a + 2]) * f, s[a + 3] + (s[b + 3] - s[a + 3]) * f]
}
