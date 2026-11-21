import { AdditiveBlending, Color, CylinderGeometry, PlaneGeometry, Sprite, SpriteMaterial, DoubleSide, type Group, Group as GroupObject, type Material, MathUtils, type Mesh, Mesh as MeshObject, MeshBasicMaterial, MeshStandardMaterial, Object3D, RingGeometry, SphereGeometry, SpotLight, Vector3 } from 'three'
import { type EngineKind, Sound } from './audio'
import { BUST_PAY, type EventKind, ESCAPE_PAY, type Outcome, TAKEDOWN_PAY } from './career'
import { bumper, finishOrbit, heli, INTRO_SECONDS, intro, tv, tvCameras } from './cinema'
import { Input } from './input'
import { applyWeather, isDay, type Weather, weatherFor } from './render/atmosphere'
import { type CarModel, createCarModel, WheelBank } from './render/carModel'
import { buildCity, type City } from './render/city'
import { buildLandscape } from './render/landscape'
import { Cockpit } from './render/cockpit'
import { Particles, Rain, Skids, Trails } from './render/effects'
import { barrierContact, Scrapes } from './render/marks'
import { Garage } from './render/garage'
import { type Looks, STOCK_LOOKS, styleCar } from './looks'
import { applyLivery } from './render/livery'
import { fitParts } from './render/parts'
import { buzz } from './touch'
import { type Fitted, type Tune, tuned } from './upgrades'
import { createHelicopter, type HelicopterModel } from './render/helicopter'
import { buildArrows, buildPuddles, buildSigns, Crowd, type Puddle } from './render/roadside'
import { type Lamps, Nightfall } from './render/nightfall'
import { setMist, setMistTime } from './render/mist'
import { Birds, type CarLike } from './render/birds'
import { bridgeSpot, buildBridge } from './render/bridge'
import { buildCarPark, type CarPark, carParkSpots } from './render/carPark'
import { disposeStrip, spikeStrip } from './render/spikes'
import { spot } from './render/textures'
import { buildTrackMeshes } from './render/trackMesh'
import { type Quality, World } from './render/world'
import { FrameSampler, type Level, type QualityMode } from './autoQuality'
import { type Replay, Recorder } from './replay'
import { NEAR_MISS_NITRO, type Run, RunRecorder, StartWatch } from './replay-check'
import { barrierOffset, CAR, type CarSpec, type CarState, driftTier, forwardSpeed, PHYSICS_VERSION, speedOf } from './sim/car'
import { carById, CARS, INTERCEPTOR_SPEC, type Shape } from './sim/cars'
import { type CopToolId, type Mine, Race, type Racer, type RacerToolId, SHOCK_RANGE, type SpikeStrip, STEP, type ToolId } from './sim/race'
import { onKerb } from './sim/kerbs'
import { locate, pointAt } from './sim/track'

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
  // Patrol cars that can chase the player in a race.
  patrols?: number
  weather: Weather | 'auto'
  target?: number
  careerId?: string
  // Career: the stage on the rivals' engines and tyres, and a crew
  // leader's name and car.
  rivalStage?: number
  leader?: string
  rivalCar?: string
  // Career: damage the player's car carries in from earlier events.
  startDamage?: number
  // Time trials: another driver's ghost from the leaderboard to race,
  // shown instead of your own best lap.
  ghost?: Ghost & { name: string; car: string }
}

export interface Settings {
  seed: string
  laps: number
  color: string
  car: string
  quality: Quality
  // Auto, or the level picked in Settings, and the render scale Auto set.
  qualityMode: QualityMode
  renderScale: number
  sound: boolean
  traffic: boolean
  // Patrol cars in quick races and eliminations.
  police: boolean
  // Driving aids: the brake-tap drift, braking for corners, and stability
  // control (off means the raw tyre model).
  driftAssist: boolean
  // Drift steering: classic, or guided within a band (see guided in car.ts).
  driftSteer: 'classic' | 'guided'
  brakeAssist: boolean
  stability: boolean
  // Phones: how to steer, and which side the steering goes.
  touchSteer: 'wheel' | 'arrows' | 'tilt'
  leftHanded: boolean
  // The two racer tools taken into a pursuit, and the two police tools
  // for playing the cop.
  tools: RacerToolId[]
  copTools: CopToolId[]
  weather: Weather | 'auto'
  kind: EventKind
}

interface View {
  car: CarState
  model: CarModel
  // How hot the brakes are, 0 to 1, and the glow at each wheel that shows
  // it; and for a patrol car, its light bar's glow on the road at night.
  brakeHeat: number
  brakeGlow: Sprite[]
  barPool: Mesh | null
  // A patrol car's light bar on the barriers either side of it at night,
  // on medium and high graphics.
  wallWash: Mesh[]
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

// Which engine each of the player's cars has.
const ENGINES: Partial<Record<Shape, EngineKind>> = { vanta: 'v12', kite: 'turbo4', brute: 'v8', volt: 'electric', kestrel: 'turbo4', finch: 'turbo4', marten: 'turbo4', granite: 'v8', moraine: 'v8' }

export type CameraMode = 'chase' | 'far' | 'cockpit' | 'hood' | 'bumper' | 'drone'
export const CAMERA_MODES: CameraMode[] = ['chase', 'far', 'cockpit', 'hood', 'bumper', 'drone']
const CAMERA_NAMES: Record<CameraMode, string> = { chase: 'Chase', far: 'Far chase', cockpit: 'Cockpit', hood: 'Bonnet', bumper: 'Bumper', drone: 'Drone' }

interface Ghost {
  time: number
  // t, x, z, heading, repeated.
  samples: number[]
  // The handling it was driven with (PHYSICS_VERSION).
  version?: number
}

export type ReplayCamera = 'tv' | 'chase' | 'heli' | 'bumper'
export const REPLAY_CAMERAS: ReplayCamera[] = ['tv', 'chase', 'heli', 'bumper']

const $ = (id: string) => document.getElementById(id) as HTMLElement

// Gear bands in m/s. Purely for the gauge and the engine note; the physics
// has no gearbox.
const GEARS = [0, 13, 24, 35, 46, 57, 1000]

export function gearOf(speed: number, spec: CarSpec = CAR): { gear: number; rpm: number } {
  let g = 0
  while (g < GEARS.length - 2 && speed >= GEARS[g + 1]) g++
  const lo = GEARS[g]
  const hi = Math.min(GEARS[g + 1], spec.topSpeed * spec.nitroTop)
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
  onRestart: (() => void) | null = null
  // Whether the phone controls are on screen, so the HUD can update them.
  private readonly touchShown = matchMedia('(pointer: coarse)').matches
  // The player's car with its upgrades. Set by the menus, which know the
  // save; until then a car drives as it left the factory.
  tune: (carId: string) => CarSpec = (carId) => carById(carId).spec
  // The looks on each of the player's cars, set by the menus too.
  looksFor: (carId: string) => Looks = () => STOCK_LOOKS
  // What the player's number plates say.
  plateText: () => string = () => 'SKIDLINE'
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
  // The night city (null by day), the road and the ground under it.
  private materials: { city: City | null; road: MeshStandardMaterial; ground: MeshStandardMaterial } | null = null
  private readonly wheelBank = new WheelBank(200)
  private debris: Debris[] = []
  // A model for each spike strip and mine on the road, the helicopter's,
  // and shockwave rings still spreading.
  private strips = new Map<SpikeStrip, Group>()
  private mines = new Map<Mine, Group>()
  private rings: { mesh: Mesh; age: number }[] = []
  private copter: HelicopterModel | null = null
  private toolsHtml = ''
  private readonly fire: Particles
  private readonly darkSmoke: Particles
  private nitroWas = false
  private boostWas = 0
  private nitroPulse = 0
  private bulletUntil = 0
  // The perfect start, and the inputs of a time trial for the leaderboard
  // (see replay-check.ts).
  private startWatch = new StartWatch()
  private run: RunRecorder | null = null
  private lastThrottle = 0
  private gearWas = 0
  // Where each other car was along the player's heading last frame, for
  // passby sounds.
  private passing = new Map<CarState, number>()
  private shot = 0
  private shotTimer = 0
  private views: View[] = []
  private ghostModel: CarModel | null = null
  private ghost: Ghost | null = null
  // Your own best lap on this track, which a new lap must beat to be saved.
  private ownBest: number | null = null
  private ghostRecording: number[] = []
  private recorder: Recorder | null = null
  private readonly smoke: Particles
  private readonly spray: Particles
  private readonly sparks: Particles
  // Sparks off the back wheels as a drift charges its boost: blue for the
  // small one, pink for the big one.
  private readonly driftSparks: [Particles, Particles]
  private readonly skids = new Skids()
  private readonly scrapes = new Scrapes()
  // The crowd at the start line, and how excited it is.
  private crowd: Crowd | null = null
  private crowdMood = 0
  // A dusk race falling to night, with its street lights and headlights.
  private nightfall: Nightfall | null = null
  // Flocks by the mountain road, and the cars that can startle them.
  private birds: Birds | null = null
  private readonly birdCars: CarLike[] = []
  // Spectators' cars parked near the start there, and the track, weather
  // and graphics they were built for (null to build them again).
  private carPark: CarPark | null = null
  private carParkFor: string | null = ''
  private readonly trails = new Trails(64)
  private readonly rain = new Rain()
  private raining = false
  // Puddles on this track, splashed through in the rain.
  private puddles: Puddle[] = []
  private puddleGroup: Group | null = null
  // Glass and bodywork shards from hard hits, and the brake glow sprite.
  private readonly shards: Particles
  private readonly brakeGlowMaterial: SpriteMaterial
  private readonly headlight: SpotLight
  private readonly cockpit = new Cockpit()
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
  // The flash over the view on a big hit, 0 to 1, and when the last began.
  private hitFlash = 0
  private hitFlashAt = -Infinity
  private hitFlashShown = 0
  private slipShownAt = -Infinity
  // How much of the followed car was on a kerb last frame, 0 to 1.
  private kerbBefore = 0
  private follow = 0
  private introTime = 0
  private lastCount = 0
  private lapsSeen = 0
  // How far the damage warnings have gone this race: 0, 1 or 2.
  private damageWarned = 0
  private boxedShown = false
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
    // The mountains' mist is for medium and high graphics.
    setMist(settings.quality !== 'low')
    if (settings.renderScale < 1) this.world.setScale(settings.renderScale)
    // The cockpit's rear-view mirror shows the road behind on high quality.
    this.world.beforeDraw = () => {
      if (this.world.quality === 'high') this.cockpit.renderMirror(this.world.renderer, this.world.scene)
    }
    this.garage = new Garage(this.world.environment, this.spotTexture)
    this.sound.setEnabled(settings.sound)
    this.smoke = new Particles(900, this.spotTexture, '#c9cad6', { grow: 3.2 })
    this.spray = new Particles(900, this.spotTexture, '#aab4d0', { grow: 2.4 })
    this.sparks = new Particles(400, this.spotTexture, '#ffb347', { additive: true, gravity: 14, brightness: 3 })
    this.shards = new Particles(300, this.spotTexture, '#cfd5df', { gravity: 16 })
    this.brakeGlowMaterial = new SpriteMaterial({ map: this.spotTexture, color: new Color('#ff6a1a').multiplyScalar(2.2), transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, toneMapped: false })
    this.fire = new Particles(300, this.spotTexture, '#ff7a2a', { additive: true, brightness: 3 })
    this.darkSmoke = new Particles(500, this.spotTexture, '#2c2c33', { grow: 2.4 })
    this.driftSparks = [
      new Particles(300, this.spotTexture, '#3fb8ff', { additive: true, gravity: 9, brightness: 3.5 }),
      new Particles(300, this.spotTexture, '#ff4fd8', { additive: true, gravity: 9, brightness: 3.5 }),
    ]
    this.world.scene.add(this.shards.points, this.smoke.points, this.spray.points, this.darkSmoke.points, this.sparks.points, this.fire.points, this.driftSparks[0].points, this.driftSparks[1].points, this.skids.mesh, this.scrapes.mesh, this.trails.mesh, this.rain.lines, this.wheelBank.tyres, this.wheelBank.rims)
    this.headlight = new SpotLight('#dfe9ff', 70, 90, 0.4, 0.6, 1)
    this.headlight.target = new Object3D()
    window.addEventListener('resize', () => this.world.resize())
    requestAnimationFrame(this.frame)
  }

  get player(): Racer {
    return this.race.player
  }

  // The finished time trial's inputs for the leaderboard, or null if this
  // event wasn't a finished trial. The car's id and upgrades come from the
  // caller, which chose them.
  lapRun(car: string, fitted: Fitted = {}, tune?: Tune): Run | null {
    return this.run?.finish(this.race, car, fitted, tune) ?? null
  }

  // Compiles the shaders of what is on screen before the loading screen
  // goes, so the first frame does not stall.
  async warmUp() {
    try {
      await this.world.renderer.compileAsync(this.world.scene, this.world.camera)
    } catch {
      // The first frame compiles them instead.
    }
  }

  // Builds the race and everything drawn for it. The city is only rebuilt
  // when the track changes.
  private setup(spec: EventSpec, attract: boolean) {
    this.event = spec
    this.sampler.reset()
    const car = carById(this.settings.car)
    this.sound.setEngine(ENGINES[car.shape] ?? 'v12')
    const rivalCars = Array.from({ length: spec.rivals }, (_, k) => (spec.rivalCar ? carById(spec.rivalCar) : CARS[(k + 1) % CARS.length]))
    const stage = spec.rivalStage ?? 0
    this.race = new Race({
      seed: spec.seed,
      laps: spec.kind === 'elimination' || spec.kind === 'pursuit' ? 99 : spec.laps,
      rivals: spec.rivals,
      skill: spec.skill,
      traffic: spec.traffic,
      police: spec.police,
      // No patrol cars for the AI-driven car of the title screen and tests.
      patrols: attract || this.autopilot ? 0 : spec.patrols,
      mode: spec.kind === 'elimination' ? 'elimination' : spec.kind === 'pursuit' ? 'pursuit' : spec.kind === 'cop' ? 'cop' : 'circuit',
      playerColor: this.settings.color,
      // Playing the cop, the player drives an interceptor.
      playerSpec: spec.kind === 'cop' ? INTERCEPTOR_SPEC : this.tune(car.id),
      rivalSpecs: rivalCars.map((c) => (stage > 0 ? tuned(c, { engine: stage, tyres: stage }) : c.spec)),
      rivalNames: spec.leader ? [spec.leader] : undefined,
      autopilot: attract || this.autopilot,
      tools: spec.kind === 'pursuit' ? this.settings.tools : spec.kind === 'cop' ? this.settings.copTools : undefined,
    })
    this.race.brakeHelp = this.settings.brakeAssist
    if (!attract && spec.startDamage) this.race.player.car.damage = spec.startDamage
    this.weather = spec.weather === 'auto' ? weatherFor(spec.seed) : spec.weather
    const day = isDay(this.weather)
    const look = `${spec.seed}/${day ? 'day' : 'night'}`
    if (this.builtSeed !== look) {
      for (const g of this.scenery) this.world.scene.remove(g)
      const track = buildTrackMeshes(this.race.track, day)
      if (day) {
        // On the mountain road, an overpass on the straightest stretch.
        // Trees and boulders keep off it and off the verges where
        // spectators park.
        const place = bridgeSpot(this.race.track)
        const bridge = place ? buildBridge(this.race.track, place, this.world.quality !== 'low') : null
        const parking = carParkSpots(this.race.track, spec.seed, 12).map((p) => ({ x: p.x, z: p.z, r: 3.5 }))
        const land = buildLandscape(this.race.track, [...(bridge?.clear ?? []), ...parking])
        this.scenery = bridge ? [track, land.group, bridge.group] : [track, land.group]
        this.materials = { city: null, road: track.userData.road, ground: land.ground }
      } else {
        const city = buildCity(this.race.track)
        this.scenery = [track, city.group]
        this.materials = { city, road: track.userData.road, ground: city.ground }
      }
      // Chevrons at the sharp corners and arrows on the road before them,
      // the puddles shown when it rains, and on the mountain road a crowd
      // at the start line, half as many on low graphics. (In the city the
      // start wall has the harbour behind it.)
      const roadside = buildPuddles(this.race.track, spec.seed)
      this.puddles = roadside.puddles
      this.puddleGroup = roadside.group
      this.crowd = day ? new Crowd(this.race.track, barrierOffset(this.race.track), spec.seed, this.world.quality !== 'low') : null
      // Birds by the road there too, fewer on low graphics.
      this.birds = day ? new Birds(this.race.track, spec.seed, this.world.quality !== 'low') : null
      this.scenery.push(buildSigns(this.race.track), buildArrows(this.race.track), roadside.group)
      if (this.crowd) this.scenery.push(this.crowd.group)
      if (this.birds) this.scenery.push(this.birds.group)
      this.world.scene.add(...this.scenery)
      this.cameras = tvCameras(this.race.track)
      this.builtSeed = look
    }
    this.birds?.reset()
    // The parked cars need the car models, which a race waits for but the
    // title screen may not have yet; until they are all in, try again on
    // the next start. None on low graphics.
    const parkFor = day && this.world.quality !== 'low' ? `${look}/${this.world.quality}` : ''
    if (this.carParkFor !== parkFor) {
      if (this.carPark) {
        this.world.scene.remove(this.carPark.group)
        this.carPark.dispose()
      }
      this.carPark = parkFor ? buildCarPark(this.race.track, spec.seed, this.world.quality === 'high' ? 12 : 7, this.spotTexture) : null
      if (this.carPark) this.world.scene.add(this.carPark.group)
      this.carParkFor = !this.carPark || this.carPark.complete ? parkFor : null
    }
    const m = this.materials!
    // The wet-street mirror is a night thing; by day the road is dry.
    const mirror = this.world.quality === 'high' && !day
    if (mirror) this.world.scene.add(this.world.makeReflector())
    else if (this.world.reflector) this.world.scene.remove(this.world.reflector)
    this.raining = applyWeather(this.world, this.weather, m.road, m.city?.facade ?? null, m.city?.dome ?? null, m.ground, mirror)
    this.rain.lines.visible = this.raining
    if (this.puddleGroup) this.puddleGroup.visible = this.raining
    // A dusk race in the city falls to night as it goes; every other night
    // race has all its street lights on from the start.
    this.nightfall = null
    const lamps = (this.scenery[0]?.userData.lamps ?? null) as Lamps | null
    if (lamps) Nightfall.allLit(lamps)
    if (m.city) {
      const sky = { sun: m.city.sun, moon: m.city.moon, beams: m.city.beams }
      Nightfall.restore(sky)
      m.city.moon.visible = this.weather === 'clear'
      m.city.sun.visible = this.weather === 'dusk'
      for (const beam of m.city.beams) beam.visible = this.weather !== 'dusk'
      if (this.weather === 'dusk') this.nightfall = new Nightfall(lamps, sky, spec.seed)
    }
    this.headlight.visible = !day
    this.trails.mesh.visible = !day
    this.sound.setRain(this.raining && !attract)

    for (const v of this.views) this.world.scene.remove(v.model.group)
    this.views = []
    this.wheelBank.clear()
    for (const d of this.debris) this.world.scene.remove(d.mesh)
    this.debris = []
    for (const g of this.strips.values()) {
      this.world.scene.remove(g)
      disposeStrip(g)
    }
    this.strips.clear()
    if (this.copter) this.world.scene.remove(this.copter.group, this.copter.beam, this.copter.light.target)
    for (const g of this.mines.values()) this.world.scene.remove(g)
    this.mines.clear()
    for (const r of this.rings) this.world.scene.remove(r.mesh)
    this.rings = []
    this.nitroWas = false
    this.boostWas = 0
    this.gearWas = 0
    this.passing.clear()
    this.nitroPulse = 0
    this.startWatch = new StartWatch()
    this.run = spec.kind === 'trial' && !attract && !this.autopilot ? new RunRecorder(spec.seed, spec.laps) : null
    const cop = spec.kind === 'cop'
    this.race.racers.forEach((racer, k) => {
      if (racer.player && cop) {
        this.addView(racer.car, createCarModel('#14161c', this.spotTexture, { shape: 'police-fast', glow: false, bank: this.wheelBank }), racer, true)
        return
      }
      const shape = racer.player ? car.shape : RIVAL_SHAPES[(k + 1) % RIVAL_SHAPES.length]
      const model = createCarModel(racer.color, this.spotTexture, { shape, bank: this.wheelBank })
      if (racer.player) {
        const looks = this.looksFor(car.id)
        styleCar(model, looks, racer.color)
        applyLivery(model, looks, this.plateText(), shape)
        fitParts(model, looks)
      }
      this.addView(racer.car, model, racer, false)
    })
    this.race.traffic.forEach((t, k) => this.addView(t.car, createCarModel(t.color, this.spotTexture, { shape: t.shape, glow: false, bank: this.wheelBank, variant: k }), null, false))
    for (const cop of this.race.police) this.addView(cop, createCarModel('#14161c', this.spotTexture, { shape: copShape(this.race, cop), glow: false, bank: this.wheelBank }), null, true)

    // By day the cars cast real shadows, and the headlight pools and
    // underglow that only make sense in the dark are hidden.
    for (const v of this.views) {
      v.model.group.traverse((o) => {
        if (o.userData.night) o.visible = !day
        else if ((o as Mesh).isMesh && !((o as Mesh).material as Material).transparent) (o as Mesh).castShadow = day
      })
    }
    this.wheelBank.tyres.castShadow = day
    this.wheelBank.rims.castShadow = day
    this.headlight.removeFromParent()
    const playerModel = this.views[this.race.racers.length - 1].model.group
    this.cockpit.group.removeFromParent()
    // The cabin of the car being driven: its colours and its driving side.
    this.cockpit.setCar(spec.kind === 'cop' ? 'police-fast' : car.shape, spec.kind === 'cop' ? '#0e1116' : this.settings.color)
    this.views[this.race.racers.length - 1].model.body.add(this.cockpit.group)
    this.headlight.position.set(0, 0.8, 2.0)
    this.headlight.target.position.set(0, 0, 30)
    playerModel.add(this.headlight, this.headlight.target)
    // Falling to night, every car's lights (and the player's real
    // headlight, and the light trails) come on as it gets dark.
    if (this.nightfall) {
      for (const v of this.views) {
        const parts: Object3D[] = []
        v.model.group.traverse((o) => {
          if (o.userData.night) parts.push(o)
        })
        if (v.racer?.player) parts.push(this.headlight)
        this.nightfall.addCar(parts)
      }
      this.nightfall.addCar([this.trails.mesh])
      if (m.city) this.nightfall.update(this.race.clock, this.world, m.road, m.city.facade, m.city.dome)
    }

    this.skids.clear()
    this.scrapes.clear()
    this.trails.clear()
    this.acc = 0
    this.lastCount = 0
    this.lapsSeen = 0
    this.damageWarned = 0
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
      const own = loadGhost(spec.seed)
      this.ownBest = own?.time ?? null
      this.ghost = spec.ghost ?? own
      this.ghostModel = createCarModel('#9fe8ff', this.spotTexture, { shape: (spec.ghost ? carById(spec.ghost.car) : car).shape, ghost: true })
      this.ghostModel.group.visible = false
      this.world.scene.add(this.ghostModel.group)
    }
    // Put the camera behind the player straight away, not swooping in.
    this.camPos.set(0, 0, 0)
  }

  private addView(car: CarState, model: CarModel, racer: Racer | null, police: boolean) {
    this.world.scene.add(model.group)
    // A soft orange glow at each wheel, for brakes worked hard.
    const brakeGlow = model.wheels.map((slot) => {
      const s = new Sprite(this.brakeGlowMaterial)
      s.scale.setScalar(0.55)
      s.visible = false
      slot.add(s)
      return s
    })
    // A patrol car's light bar washing the road red and blue at night.
    let barPool: Mesh | null = null
    if (model.siren) {
      barPool = new MeshObject(new PlaneGeometry(9, 9).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: this.spotTexture, color: '#000000', transparent: true, blending: AdditiveBlending, depthWrite: false }))
      barPool.position.y = 0.06
      barPool.userData.night = true
      barPool.visible = !isDay(this.weather)
      model.group.add(barPool)
    }
    // ...and on the barriers either side, where it is close enough to reach.
    const wallWash: Mesh[] = []
    if (model.siren && this.world.quality !== 'low') {
      for (let k = 0; k < 2; k++) {
        const wash = new MeshObject(new PlaneGeometry(10, 2.2), new MeshBasicMaterial({ map: this.spotTexture, color: '#000000', transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }))
        wash.visible = false
        model.group.add(wash)
        wallWash.push(wash)
      }
    }
    this.views.push({ car, model, prev: { x: car.x, z: car.z, heading: car.heading }, racer, police, dmg: { left: 0, right: 0, front: 0, rear: 0 }, wasBraking: false, brakeHeat: 0, brakeGlow, barPool, wallWash })
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

  // Photo mode in the garage: the camera starts where the show camera was,
  // then turns and zooms with the player's drags.
  enterPhoto() {
    const cam = this.world.camera.position
    this.garage.photo = { yaw: Math.atan2(cam.x, cam.z), pitch: 0.22, dist: 7.4 }
  }

  leavePhoto() {
    this.garage.photo = null
  }

  orbit(dx: number, dy: number) {
    const p = this.garage.photo
    if (!p) return
    p.yaw -= dx * 0.006
    p.pitch = MathUtils.clamp(p.pitch + dy * 0.004, 0.02, 1.2)
  }

  zoom(factor: number) {
    const p = this.garage.photo
    if (p) p.dist = MathUtils.clamp(p.dist * factor, 4.2, 12)
  }

  // A picture of the frame as it is drawn now, with the game's name and the
  // car's in a corner. It is drawn and copied in one go, so the picture is
  // there even though the canvas doesn't keep its frames.
  snapshot(caption: string): Promise<Blob | null> {
    this.garage.update(this.time, this.world.camera, false)
    this.world.render()
    const view = this.world.renderer.domElement
    const out = document.createElement('canvas')
    out.width = view.width
    out.height = view.height
    const g = out.getContext('2d') as CanvasRenderingContext2D
    g.drawImage(view, 0, 0)
    const size = Math.round(out.height * 0.035)
    g.font = `italic 700 ${size}px "Chakra Petch", sans-serif`
    g.textAlign = 'right'
    g.textBaseline = 'bottom'
    g.shadowColor = 'rgba(0,0,0,0.6)'
    g.shadowBlur = size * 0.4
    g.fillStyle = 'rgba(255,255,255,0.92)'
    g.fillText('SKIDLINE', out.width - size, out.height - size)
    g.font = `600 ${Math.round(size * 0.55)}px "Chakra Petch", sans-serif`
    g.fillStyle = 'rgba(255,255,255,0.75)'
    g.fillText(caption, out.width - size, out.height - size * 2.15)
    return new Promise((done) => out.toBlob((b) => done(b), 'image/png'))
  }

  restyleGarage(looks: Looks) {
    this.garage.restyle(looks)
  }

  refreshGarage(carId = this.settings.car, looks = this.looksFor(carId)) {
    this.garage.show(carById(carId).shape, this.settings.color, looks, this.plateText())
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

  // Automatic quality: off in the browser tests unless asked for, so a slow
  // test machine does not change what the tests draw.
  autoQuality = true
  onQualityChange: (() => void) | null = null
  private sampler = new FrameSampler()

  // Settings: Auto starts again from the device's default at full size;
  // High and Low are kept as picked.
  setQualityMode(mode: QualityMode, deviceDefault: Quality) {
    this.settings.qualityMode = mode
    this.settings.renderScale = 1
    this.world.setScale(1)
    this.setQuality(mode === 'auto' ? deviceDefault : mode)
  }

  private autoLevel(next: Level) {
    if (next.quality !== this.settings.quality) this.setQuality(next.quality)
    if (next.scale !== this.settings.renderScale) {
      this.settings.renderScale = next.scale
      this.world.setScale(next.scale)
    }
    popup('Graphics lowered to keep the race smooth', 'cyan')
    this.onQualityChange?.()
  }

  setQuality(quality: Quality) {
    this.settings.quality = quality
    this.world.setQuality(quality)
    setMist(quality !== 'low')
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
    const raw = now - this.last
    const dt = Math.min(0.1, raw / 1000)
    this.last = now
    // Automatic quality times the frames of each race once it is moving.
    if (this.autoQuality && this.settings.qualityMode === 'auto' && this.mode === 'race' && this.race.phase === 'racing' && this.race.clock > 1 && document.visibilityState === 'visible') {
      const next = this.sampler.add(raw, { quality: this.settings.quality, scale: this.settings.renderScale })
      if (next) this.autoLevel(next)
    }
    this.time += dt
    if (this.mode === 'intro') {
      this.introTime += dt
      if (this.introTime >= INTRO_SECONDS || this.input.take('any')) this.skipIntro()
    }
    if (this.mode === 'race') this.keys()
    if (this.mode === 'race' || this.mode === 'results' || this.mode === 'menu') {
      if (this.mode === 'race') this.race.playerInput = { ...this.input.read(dt), assist: this.settings.driftAssist, raw: !this.settings.stability, band: this.settings.driftSteer === 'guided' }
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
    if (this.input.take('reset') && this.race.phase === 'racing') {
      this.race.reset(this.player)
      this.run?.reset()
    }
    // Quick restart: one key, the event starts again from the grid.
    if (this.input.take('restart')) this.onRestart?.()
    if (this.input.take('tool1')) this.race.useTool(0)
    if (this.input.take('tool2')) this.race.useTool(1)
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
    this.birds?.reset()
    // Start just before the green light.
    this.replayTime = 0
    this.replayPlaying = true
    this.replaySpeed = 1
    this.replayCamera = 'tv'
    this.replayFollow = this.race.racers.length - 1
    this.skids.clear()
    this.scrapes.clear()
    this.trails.clear()
  }

  // One fixed physics step plus the race events that come out of it.
  private tick() {
    for (const v of this.views) v.prev = { x: v.car.x, z: v.car.z, heading: v.car.heading }
    const before = this.race.phase
    const copsBefore = this.race.police.length
    if (this.run && this.mode !== 'menu') this.race.playerInput = this.run.step(this.race)
    this.race.step()
    // Patrol cars that joined the chase need a model.
    for (let k = copsBefore; k < this.race.police.length; k++) {
      const cop = this.race.police[k]
      this.addView(cop, createCarModel('#14161c', this.spotTexture, { shape: copShape(this.race, cop), glow: false, bank: this.wheelBank }), null, true)
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
    // green light, not early. The rule is in StartWatch, which the
    // leaderboard's replay runs too.
    const perfect = this.startWatch.after(race, before)
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
      if (perfect) {
        popup('Perfect start', 'gold')
        this.nitroPulse = 0.6
      }
    }

    // Nitro lighting up: a pulse of light, a kick of the camera and a thump.
    if (player.car.nitroOn && !this.nitroWas) {
      this.nitroPulse = 1
      this.shake = Math.min(1, this.shake + 0.3)
      this.sound.ignite()
      buzz(20)
    }
    this.nitroWas = player.car.nitroOn

    // A drift boost going off: a smaller kick than the nitro.
    if (player.car.boost > this.boostWas + 0.05) {
      this.nitroPulse = Math.max(this.nitroPulse, 0.6)
      this.shake = Math.min(1, this.shake + 0.15)
      this.sound.ignite()
      this.backfire(this.views[race.racers.length - 1], true)
      popup(player.car.boost > 1 ? 'Big drift boost' : 'Drift boost', 'cyan')
    }
    this.boostWas = player.car.boost

    // Lifting off at speed makes the exhaust pop, and a turbo flutter.
    const throttle = race.playerInput.throttle
    if (this.lastThrottle > 0.5 && throttle === 0 && speedOf(player.car) > 30) {
      this.backfire(this.views[race.racers.length - 1], true)
      this.sound.flutter()
    }
    this.lastThrottle = throttle

    // A pop on each upshift under power.
    const gear = gearOf(Math.abs(forwardSpeed(player.car)), player.car.spec).gear
    if (gear > this.gearWas && throttle > 0.5 && this.gearWas > 0) this.sound.pop(0.35)
    this.gearWas = gear

    // A rush of air as another car goes past close by, louder the faster it
    // passes.
    const fx = Math.sin(player.car.heading)
    const fz = Math.cos(player.car.heading)
    for (const other of race.cars) {
      if (other === player.car) continue
      const dx = other.x - player.car.x
      const dz = other.z - player.car.z
      const along = dx * fx + dz * fz
      const before = this.passing.get(other)
      this.passing.set(other, along)
      if (before === undefined || Math.sign(before) === Math.sign(along) || Math.abs(dx * fz - dz * fx) > 6) continue
      const relative = Math.hypot(other.vx - player.car.vx, other.vz - player.car.vz)
      if (relative > 8) this.sound.passby(Math.min(1, relative / 30))
    }

    for (const e of race.events) {
      if (e.type === 'nearMiss') {
        player.car.nitro = Math.min(1, player.car.nitro + NEAR_MISS_NITRO)
        popup('Near miss +50', 'cyan')
        this.sound.whoosh()
        // A beat of slow motion as the car slips past.
        this.bulletUntil = now + 260
        this.nitroPulse = Math.max(this.nitroPulse, 0.3)
      } else if (e.type === 'slipstream') {
        // Once in a while, not every time the car tucks in again.
        if (now - this.slipShownAt > 6000) {
          popup('Slipstream', 'cyan')
          this.slipShownAt = now
        }
      } else if (e.type === 'cleanLap') {
        popup('Clean lap +100', 'gold')
      } else if (e.type === 'driftBank') {
        popup(`+${e.points.toLocaleString('en')} drift`, 'gold')
      } else if (e.type === 'driftLost') {
        popup('Drift lost', 'red')
      } else if (e.type === 'eliminated') {
        const out = race.racers[e.id]
        if (out.player) flash('Eliminated', 'warn')
        else popup(`${out.name} is out`, 'red')
      } else if (e.type === 'crashReported') {
        if (e.sent) flash('Crash reported: police on the way', 'warn')
        else popup('Another crash: the heat is rising', 'red')
      } else if (e.type === 'spotted') {
        flash('Police on your tail', 'warn')
        this.shake = Math.min(1, this.shake + 0.2)
      } else if (e.type === 'lostPolice') {
        flash('Lost them')
        popup(`Lost the police +${(ESCAPE_PAY * e.heat).toLocaleString('en')}`, 'gold')
      } else if (e.type === 'takedown') {
        buzz([40, 30, 60])
        const car = e.cop ?? race.racers[e.id ?? 0].car
        this.wreckBurst(car)
        flash('Takedown')
        popup(e.cop ? `Patrol car wrecked +${(TAKEDOWN_PAY.cop * race.pursuit.heat).toLocaleString('en')}` : `${race.racers[e.id ?? 0].name} wrecked +${TAKEDOWN_PAY.rival}`, 'gold')
        this.shake = Math.min(1, this.shake + 0.5)
        // A beat of slow motion to watch it.
        this.bulletUntil = now + 900
      } else if (e.type === 'wrecked') {
        const out = race.racers[e.id]
        this.wreckBurst(out.car)
        if (out.player) {
          flash('Wrecked', 'warn')
          this.shake = 1
          this.slowMotion(now)
        } else popup(`${out.name} is wrecked`, 'red')
      } else if (e.type === 'heatUp') {
        popup(`Heat ${e.heat}: ${HEAT_NEWS[e.heat] ?? 'more police'}`, 'red')
      } else if (e.type === 'copJoined') {
        // The heat message covers it.
      } else if (e.type === 'busted') {
        flash('Busted', 'warn')
        // The camera circles the arrest.
        this.slowMotion(now)
      } else if (e.type === 'escaped') {
        flash('Escaped')
        this.slowMotion(now)
      } else if (e.type === 'roadblock') {
        popup('Roadblock ahead: find the gap', 'red')
      } else if (e.type === 'spikesAhead') {
        popup('Spike strip ahead: keep to the clear side', 'red')
      } else if (e.type === 'tool') {
        const me = race.player.car
        popup(TOOL_INFO[e.id].used, 'cyan')
        if (e.id === 'shockwave') {
          const ring = shockRing()
          ring.position.set(me.x, 0.4, me.z)
          this.world.scene.add(ring)
          this.rings.push({ mesh: ring, age: 0 })
          this.sound.hit(8)
          this.shake = Math.min(1, this.shake + 0.4)
        } else if (e.id === 'turbo') this.sound.ignite()
        else this.sound.beep(false)
      } else if (e.type === 'mineHit') {
        this.wreckBurst({ x: e.x, z: e.z, vx: 0, vz: 0 } as CarState)
        this.shake = Math.min(1, this.shake + 0.5)
      } else if (e.type === 'racerBusted') {
        const r = race.racers[e.id]
        flash(`${r.name} busted`)
        popup(`Bust +${BUST_PAY.toLocaleString('en')}`, 'gold')
        this.shake = Math.min(1, this.shake + 0.3)
        this.bulletUntil = now + 700
      } else if (e.type === 'backup') {
        popup('Backup on the way: a patrol car joins', 'cyan')
      } else if (e.type === 'noTarget') {
        popup('No racer in range', 'red')
      } else if (e.type === 'heliJoined') {
        popup('Helicopter overhead: outrun the searchlight', 'red')
      } else if (e.type === 'pulseLock') {
        popup('Interceptor locking on', 'red')
        this.sound.beep(true)
      } else if (e.type === 'pulsed') {
        flash('Pulse: power cut', 'warn')
        this.sound.hit(6)
        this.shake = Math.min(1, this.shake + 0.35)
      } else if (e.type === 'punctured') {
        flash('Tyres blown', 'warn')
        this.sound.hit(9)
        this.shake = Math.min(1, this.shake + 0.45)
      } else if (e.type === 'contact') {
        this.shake = Math.min(1, this.shake + e.strength * 0.04)
      }
    }
    race.events = []

    // Warn as the damage builds, once for each step in a race.
    const dmg = player.car.damage
    if (this.damageWarned < 1 && dmg > 0.6) {
      this.damageWarned = 1
      popup('Heavy damage', 'red')
    }
    if (this.damageWarned < 2 && dmg > 0.85 && dmg < 1) {
      this.damageWarned = 2
      flash('One more big hit wrecks the car', 'small')
    }

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
      if (this.event.kind === 'trial' && (this.ownBest === null || lap < this.ownBest)) {
        const mine = { time: lap, samples: this.ghostRecording }
        saveGhost(this.event.seed, mine)
        this.ownBest = lap
        // Racing someone else's ghost, theirs stays on the road.
        if (!this.event.ghost) this.ghost = mine
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
      time: Math.max(0, race.clock),
      busts: race.busts,
      racers: race.racers.length - 1,
    })
  }

  // Adds a model for each new spike strip and takes away the ones the race
  // has picked up.
  private syncStrips() {
    const live = new Set(this.race.spikes)
    for (const [strip, g] of this.strips) {
      if (live.has(strip)) continue
      this.world.scene.remove(g)
      disposeStrip(g)
      this.strips.delete(strip)
    }
    for (const strip of live) {
      if (this.strips.has(strip)) continue
      const g = spikeStrip(strip.half * 2)
      const at = pointAt(this.race.track, strip.s, strip.offset)
      g.position.set(at.x, 0, at.z)
      g.rotation.y = at.heading
      this.world.scene.add(g)
      this.strips.set(strip, g)
    }
  }

  // The helicopter hangs over the chase, its searchlight on the player.
  private drawCopter(dt: number) {
    const h = this.race.heli
    const c = this.copter
    if (!h) {
      if (c?.group.parent) this.world.scene.remove(c.group, c.beam, c.light.target)
      return
    }
    if (!c) {
      this.copter = createHelicopter()
      this.copter.group.remove(this.copter.beam)
    }
    const m = this.copter as HelicopterModel
    if (!m.group.parent) this.world.scene.add(m.group, m.beam, m.light.target)
    m.group.position.set(h.x, 34 + Math.sin(this.time * 1.3) * 0.6, h.z)
    m.group.rotation.set(0.1, h.heading, Math.sin(this.time * 0.7) * 0.05, 'YXZ')
    m.rotor.rotation.y += dt * 38
    m.tail.rotation.x += dt * 60
    const blink = Math.floor(this.time * 4) % 2 === 0
    m.beacon.color.set(blink ? '#ff2030' : '#2050ff')
    m.beacon.intensity = 12
    // Playing the cop, the light is on the leading racer.
    const me = (this.event.kind === 'cop' ? this.race.leadingRacer()?.car : null) ?? this.race.player.car
    m.light.target.position.set(me.x, 0, me.z)
    const day = isDay(this.weather)
    m.light.intensity = h.seeing && !day ? 220 : 0
    const from = m.group.localToWorld(m.light.position.clone())
    const to = new Vector3(me.x, 0, me.z).sub(from)
    const length = to.length()
    m.beam.visible = h.seeing
    m.beam.position.copy(from)
    m.beam.scale.set(length * 0.09, length, length * 0.09)
    m.beam.quaternion.setFromUnitVectors(DOWN, to.normalize())
    ;(m.beam.material as MeshStandardMaterial).opacity = day ? 0.015 : 0.05
  }

  // Mines blink on the road; shockwave rings spread and fade.
  private drawTools(dt: number) {
    const live = new Set(this.race.mines)
    for (const [mine, g] of this.mines) {
      if (live.has(mine)) continue
      this.world.scene.remove(g)
      this.mines.delete(mine)
    }
    for (const mine of live) {
      let g = this.mines.get(mine)
      if (!g) {
        g = mineModel()
        g.position.set(mine.x, 0, mine.z)
        this.world.scene.add(g)
        this.mines.set(mine, g)
      }
      const led = g.children[1] as Mesh
      ;(led.material as MeshStandardMaterial).color.set(mine.armIn > 0 || Math.floor(this.time * 3) % 2 === 0 ? '#ff2030' : '#3a0508')
    }
    this.rings = this.rings.filter((r) => {
      r.age += dt
      const k = r.age / 0.4
      r.mesh.scale.setScalar(1 + k * SHOCK_RANGE)
      ;(r.mesh.material as MeshStandardMaterial).opacity = Math.max(0, 0.8 * (1 - k))
      if (k < 1) return true
      this.world.scene.remove(r.mesh)
      return false
    })
  }

  // Per car each frame: brakes that glow after hard braking at speed and
  // cool slowly, and a splash through standing water in the rain.
  private extras(v: View, dt: number) {
    const car = v.car
    const speed = speedOf(car)
    v.brakeHeat = Math.max(0, Math.min(1, v.brakeHeat + dt * (car.braking && speed > 12 ? 0.9 : -0.3)))
    for (const s of v.brakeGlow) {
      s.visible = v.brakeHeat > 0.05
      if (s.visible) s.scale.setScalar(0.3 + 0.55 * v.brakeHeat)
    }
    if (!this.raining || speed < 10 || this.puddles.length === 0) return
    for (const p of this.puddles) {
      if (Math.abs(p.x - car.x) > 2.2 || Math.abs(p.z - car.z) > 2.2) continue
      const n = Math.round(Math.min(24, speed * 0.5) * (this.world.quality === 'low' ? 0.5 : 1))
      for (let k = 0; k < n; k++) {
        if (Math.random() > 0.35) continue
        const a = Math.random() * Math.PI * 2
        this.spray.emit(car.x, 0.2, car.z, car.vx * 0.35 + Math.cos(a) * 3, 2 + Math.random() * 3, car.vz * 0.35 + Math.sin(a) * 3, 0.6, 1.1)
      }
      break
    }
  }

  private draw(dt: number) {
    this.syncStrips()
    this.drawCopter(dt)
    this.drawTools(dt)
    // Blown tyres: the rims throw sparks off the road.
    const me = this.race.player.car
    if (this.race.punctured && (this.mode === 'race' || this.mode === 'results') && speedOf(me) > 4) {
      const fx = Math.sin(me.heading)
      const fz = Math.cos(me.heading)
      for (const side of [-1, 1]) {
        if (Math.random() > 0.7) continue
        const x = me.x - fx * 1.3 - fz * side * 0.85
        const z = me.z - fz * 1.3 + fx * side * 0.85
        this.sparks.emit(x, 0.12, z, me.vx * 0.6 + (Math.random() - 0.5) * 4, 1 + Math.random() * 2.5, me.vz * 0.6 + (Math.random() - 0.5) * 4, 0.25, 0.3)
      }
    }
    const alpha = this.mode === 'replay' ? 1 : this.acc / STEP
    const cam = this.world.camera
    let trail = 0
    for (const v of this.views) {
      const car = v.car
      const g = v.model.group
      // Cars knocked out of an elimination leave; wrecks stay.
      const hidden = Boolean(v.racer?.out && !v.racer.fate)
      g.visible = !hidden
      if (hidden) continue
      // A patrol car sent back to wait further on jumps there in one step:
      // no sliding across the map in between.
      const jumped = Math.hypot(car.x - v.prev.x, car.z - v.prev.z) > 40
      const t = jumped ? 1 : alpha
      g.position.set(MathUtils.lerp(v.prev.x, car.x, t), 0, MathUtils.lerp(v.prev.z, car.z, t))
      g.rotation.y = v.prev.heading + (car.heading - v.prev.heading) * t
      for (const wheel of v.model.wheels) wheel.rotation.x = car.wheelSpin
      for (const pivot of v.model.frontPivots) pivot.rotation.y = -car.steer
      const speed = forwardSpeed(car)
      // Body lean: roll out of the turn and pitch under braking.
      v.model.body.rotation.z = MathUtils.lerp(v.model.body.rotation.z, MathUtils.clamp(car.yawRate * speed * -0.0035, -0.07, 0.07), 0.2)
      v.model.body.rotation.x = MathUtils.lerp(v.model.body.rotation.x, car.braking ? 0.025 : 0, 0.15)
      v.model.tail.color.copy(TAIL).multiplyScalar(car.braking ? 5 : 1.6)
      const burning = car.nitroOn || car.turbo > 0
      for (const flame of v.model.flames) {
        flame.visible = burning
        if (burning) {
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
        // A patrol car waiting by the road keeps its lights low until it
        // sees someone.
        const phase = Math.floor(this.time * 7) % 2
        const on = this.race.wreckedCops.has(car) ? 0 : this.race.parked.has(car) ? 0.25 : 1
        v.model.siren.red.color.copy(RED).multiplyScalar((phase ? 5 : 0.4) * on)
        v.model.siren.blue.color.copy(BLUE).multiplyScalar((phase ? 0.4 : 5) * on)
        // The light bar's colour on the road around the car.
        if (v.barPool) (v.barPool.material as MeshBasicMaterial).color.copy(phase ? RED : BLUE).multiplyScalar(0.55 * on)
        if (v.wallWash.length) this.washWalls(v, phase ? RED : BLUE, on)
      }
      // Tail light streaks once a car is properly moving.
      const c = Math.cos(g.rotation.y)
      const s = Math.sin(g.rotation.y)
      for (const [lx, ly, lz] of v.model.tailLights) {
        this.trails.push(trail++, g.position.x + lx * c + lz * s, ly, g.position.z - lx * s + lz * c, speed > 24 || car.nitroOn, car.nitroOn)
      }
      if (dt > 0) {
        this.tyres(v, dt)
        this.extras(v, dt)
      }
    }
    this.wheelBank.update()
    // The crowd jumps through the countdown and the first seconds, and
    // again whenever a racer comes past the line.
    if (this.crowd) {
      const race = this.race
      let near = Infinity
      for (const r of race.racers) near = Math.min(near, Math.hypot(r.car.x - race.track.x[0], r.car.z - race.track.z[0]))
      const mood = race.clock < 5 ? 1 : MathUtils.clamp(1 - (near - 15) / 30, 0, 0.8)
      this.crowdMood += (mood - this.crowdMood) * Math.min(1, dt * 3)
      this.crowd.update(this.time, this.crowdMood)
    }
    if (this.birds && dt > 0) {
      this.birdCars.length = 0
      for (const r of this.race.racers) this.birdCars.push(r.car)
      for (const cop of this.race.police) this.birdCars.push(cop)
      this.birds.update(dt, this.time, this.birdCars, cam.position.x, cam.position.z)
    }
    if (dt > 0) {
      this.smoke.update(dt)
      this.spray.update(dt)
      this.darkSmoke.update(dt)
      this.sparks.update(dt)
      this.shards.update(dt)
      for (const p of this.driftSparks) p.update(dt)
      this.fire.update(dt)
      this.updateDebris(dt)
    }
    this.nitroPulse *= Math.exp(-dt * 2.6)
    setMistTime(this.time)
    const city = this.materials?.city
    if (this.world.day) this.world.followSun(this.player.car.x, this.player.car.z)
    if (city && this.nightfall && this.materials) this.nightfall.update(this.mode === 'replay' ? this.replayTime : this.race.clock, this.world, this.materials.road, city.facade, city.dome)
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
    this.hitFlash = this.mode === 'race' ? this.hitFlash * Math.exp(-dt * 9) : 0
    const shown = this.hitFlash < 0.01 ? 0 : Math.round(this.hitFlash * 100) / 100
    if (shown !== this.hitFlashShown) {
      this.hitFlashShown = shown
      $('hit-flash').style.opacity = String(shown)
    }
    this.trails.update(cam.position.x, cam.position.y, cam.position.z)
    if (this.raining) {
      this.rain.update(this.time, cam.position.x, cam.position.y, cam.position.z)
      this.lightning(dt)
    }
    if (this.mode === 'race' || this.mode === 'results' || this.mode === 'paused') this.hud()
    const followed = this.mode === 'replay' ? this.race.racers[this.replayFollow].car : this.player.car
    const { rpm } = gearOf(Math.abs(forwardSpeed(followed)), followed.spec)
    const active = this.mode === 'race' || this.mode === 'results' || this.mode === 'replay'
    const throttle = this.mode === 'race' ? this.race.playerInput.throttle : 0.5
    this.sound.update(rpm, throttle, followed.slip * (speedOf(followed) > 8 ? 1 : 0), followed.nitroOn, active && this.race.phase !== 'countdown' && this.replayPlaying)
    // The siren of the nearest patrol car, bent in pitch by how fast it is
    // closing: a Doppler shift, exaggerated threefold so it reads.
    let nearest = Infinity
    let closing = 0
    for (const cop of this.race.activeCops) {
      const dx = followed.x - cop.x
      const dz = followed.z - cop.z
      const d = Math.hypot(dx, dz)
      if (d >= nearest) continue
      nearest = d
      closing = ((cop.vx - followed.vx) * dx + (cop.vz - followed.vz) * dz) / Math.max(d, 1)
    }
    // Playing the cop, the player's own siren is on.
    const own = active && this.event.kind === 'cop' && this.mode !== 'replay' ? 0.4 : 0
    this.sound.siren(Math.max(own, active && nearest < Infinity ? Math.max(0, 1 - nearest / 260) : 0), own > 0 ? 1 : MathUtils.clamp(1 + (closing / 343) * 3, 0.75, 1.35))
    const moving = active && this.race.phase !== 'countdown' && this.replayPlaying
    this.sound.wind(speedOf(followed), moving)
    // Kerbs rumble under the tyres, chopped faster the faster the car goes,
    // with a slight shake and, on a phone, a tap as the car gets on one.
    const speed = speedOf(followed)
    const where = locate(this.race.track, followed.x, followed.z, followed.hint)
    const kerb = moving ? onKerb(this.race.track, where.i, where.d) * MathUtils.clamp(speed / 20, 0, 1) : 0
    this.sound.rumble(kerb, speed / (2 * this.race.track.spacing))
    if (this.mode === 'race') {
      this.shake = Math.max(this.shake, kerb * 0.1)
      if (kerb > 0.3 && this.kerbBefore <= 0.3) buzz(12)
    }
    this.kerbBefore = kerb
    // Tyres hiss on a wet road.
    this.sound.spray(moving && this.raining ? Math.min(1, speed / 60) : 0)
    const heli = this.race.heli
    this.sound.rotor(active && heli && this.mode !== 'replay' ? Math.max(0, 1 - Math.hypot(heli.x - followed.x, heli.z - followed.z) / 400) : 0)
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
  // A car wrecked: a burst of fire, sparks and black smoke. It keeps
  // burning afterwards, as any car past 85% damage does.
  private wreckBurst(car: CarState) {
    for (let k = 0; k < 50; k++) {
      const a = Math.random() * Math.PI * 2
      const v = 4 + Math.random() * 10
      const cx = Math.cos(a)
      const cz = Math.sin(a)
      this.fire.emit(car.x, 0.9, car.z, cx * v * 0.5 + car.vx * 0.3, 2 + Math.random() * 5, cz * v * 0.5 + car.vz * 0.3, 0.5 + Math.random() * 0.6, 0.6 + Math.random() * 0.5)
      this.sparks.emit(car.x, 0.7, car.z, cx * v * 1.6, 3 + Math.random() * 7, cz * v * 1.6, 0.3, 0.5)
      if (k % 2 === 0) this.darkSmoke.emit(car.x, 1.2, car.z, cx * 1.5, 2 + Math.random() * 2, cz * 1.5, 2.2, 1.6)
    }
    this.sound.hit(14)
  }

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

  // A patrol car's light bar on the barriers either side of it at night,
  // fading with the distance to each.
  private washWalls(v: View, colour: Color, on: number) {
    const night = !isDay(this.weather)
    const track = this.race.track
    const car = v.car
    const where = locate(track, car.x, car.z, car.hint)
    const wall = barrierOffset(track)
    const g = v.model.group
    const ry = g.rotation.y
    const facing = Math.atan2(-track.tz[where.i], track.tx[where.i])
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1
      const wash = v.wallWash[k]
      const gap = wall - side * where.d
      const strength = night ? Math.max(0, 1 - gap / 8) * on : 0
      wash.visible = strength > 0.02
      if (!wash.visible) continue
      // The wash rides in the car's group, so it is placed in the group's
      // own frame: the point on the barrier beside the car, turned to lie
      // along it.
      const dx = car.x + track.nx[where.i] * side * (gap - 0.03) - g.position.x
      const dz = car.z + track.nz[where.i] * side * (gap - 0.03) - g.position.z
      wash.position.set(dx * Math.cos(ry) - dz * Math.sin(ry), 0.75 - g.position.y, dx * Math.sin(ry) + dz * Math.cos(ry))
      wash.rotation.set(0, facing - ry, 0)
      ;(wash.material as MeshBasicMaterial).color.copy(colour).multiplyScalar(0.7 * strength)
    }
  }

  // Scrapes on the barrier where a car grinds along it: on the steel rail
  // by day, on the wall in the city.
  private scrape(v: View, speed: number) {
    const car = v.car
    const at = barrierContact(this.race.track, car.x, car.z, car.hint, car.spec.halfWidth, speed)
    const day = isDay(this.weather)
    this.scrapes.mark(String(this.views.indexOf(v)), at, day ? 0.6 : 0.3, day ? 0.76 : 0.52, v.racer?.color ?? (v.police ? '#e6e8ec' : '#6a6e76'))
  }

  // Smoke, spray, skid marks and sparks for one car.
  private tyres(v: View, dt: number) {
    const car = v.car
    const fx = Math.sin(car.heading)
    const fz = Math.cos(car.heading)
    const speed = speedOf(car)
    this.scrape(v, speed)
    const skidding = car.drifting || (car.braking && speed > 28)
    for (const side of [-1, 1]) {
      const wx = car.x - fx * 1.38 + -fz * 0.86 * side
      const wz = car.z - fz * 1.38 + fx * 0.86 * side
      if (v.racer) this.skids.mark(`${v.racer.id}${side}`, wx, wz, skidding && !this.raining)
      // A drift charging its boost throws coloured sparks.
      const tier = car.drifting ? driftTier(car.driftCharge) : 0
      if (tier > 0) {
        const rate = 26 * dt
        for (let k = 0; k < rate; k++) {
          if (Math.random() > rate - k) break
          this.driftSparks[tier - 1].emit(wx, 0.15, wz, car.vx * 0.3 + (Math.random() - 0.5) * 5, 1 + Math.random() * 3, car.vz * 0.3 + (Math.random() - 0.5) * 5, 0.22, 0.35)
        }
      }
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
      // A hard hit throws bits of glass and trim, fewer on low graphics.
      if (car.impact > 6) {
        const bits = Math.round(Math.min(30, car.impact * 2) * (this.world.quality === 'low' ? 0.4 : 1))
        for (let k = 0; k < bits; k++) this.shards.emit(car.x, 0.7, car.z, car.vx * 0.3 + (Math.random() - 0.5) * 10, 2 + Math.random() * 4, car.vz * 0.3 + (Math.random() - 0.5) * 10, 0.9 + Math.random() * 0.6, 0.12)
      }
      if (v.racer?.player && this.mode === 'race') {
        this.sound.hit(car.impact)
        this.shake = Math.min(1, this.shake + car.impact * 0.06)
        if (car.impact > 6) buzz(Math.min(80, Math.round(car.impact * 4)))
        // A big hit flashes the view, never more than twice a second. On
        // medium and high graphics the scene's own light jumps with it.
        if (car.impact > 6 && this.time - this.hitFlashAt > 0.5) {
          this.hitFlash = Math.max(this.hitFlash, Math.min(1, (car.impact - 4) / 10))
          this.hitFlashAt = this.time
          if (this.world.quality !== 'low') this.world.flash = Math.max(this.world.flash, this.hitFlash * 0.06)
        }
      }
    }
    car.impact = 0
  }

  private camera(dt: number) {
    const cam = this.world.camera
    // Every camera but the driving ones sees the car from outside.
    if (this.mode !== 'race' || this.finishCamera) this.leaveCockpit()
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

  // Puts the player's car back together and the cabin lights back to
  // normal when a camera outside the car takes over.
  private leaveCockpit() {
    if (!this.cockpit.group.visible) return
    this.cockpit.group.visible = false
    const view = this.views[this.race.racers.length - 1]
    if (view) for (const part of view.model.body.children) if (part !== this.cockpit.group) part.visible = true
    this.world.setInterior(false)
    $('cabin-shade').classList.remove('on')
  }

  // The driver's head in the cockpit view, from the car's acceleration:
  // side and forward in metres along the car, up for the road's shake, and
  // a slight roll.
  private readonly head = { side: 0, forward: 0, up: 0, roll: 0, vx: 0, vz: 0, primed: false }

  private headMotion(car: CarState, fx: number, fz: number, speed: number, dt: number) {
    const h = this.head
    if (!h.primed || dt <= 0) {
      h.vx = car.vx
      h.vz = car.vz
      h.primed = true
      return h
    }
    const ax = (car.vx - h.vx) / dt
    const az = (car.vz - h.vz) / dt
    h.vx = car.vx
    h.vz = car.vz
    const lateral = ax * -fz + az * fx
    const along = ax * fx + az * fz
    const k = 1 - Math.exp(-dt * 6)
    h.side += (MathUtils.clamp(-lateral * 0.0028, -0.035, 0.035) - h.side) * k
    h.forward += (MathUtils.clamp(-along * 0.0025, -0.03, 0.03) - h.forward) * k
    h.roll += (MathUtils.clamp(lateral * 0.0025, -0.035, 0.035) - h.roll) * k
    const shake = Math.min(1, speed / 70) * 0.0012
    h.up = shake * (Math.sin(this.time * 31) + 0.6 * Math.sin(this.time * 47 + 1.3))
    return h
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
    } else if (mode === 'cockpit') {
      // The driver's eye, inside the car, with the head moving as a body
      // does: pushed outward in a corner, forward under braking, a fine
      // shake from the road at speed, and the eyes going a little into the
      // turn.
      const rx = -fz
      const rz = fx
      const eye = this.cockpit.driver
      const head = this.headMotion(car, fx, fz, speed, dt)
      const across = eye.x - head.side
      const ahead = eye.z + head.forward
      pos = new Vector3(g.position.x + fx * ahead - rx * across, eye.y + head.up, g.position.z + fz * ahead - rz * across)
      look = new Vector3(pos.x + fx * 25 + rx * car.steer * 3.2, eye.y - 0.35 + head.up, pos.z + fz * 25 + rz * car.steer * 3.2)
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
    // Inside the car the view is wider and the speed widening smaller, as
    // a driver's eye sees it.
    const inside = mode === 'cockpit' && !(this.mode === 'race' && this.input.holding('lookback'))
    if (inside) cam.rotateZ(this.head.roll)
    this.cockpit.group.visible = inside && view.racer?.player === true
    // From the driver's seat, the car's own outside shell (and a model's
    // own interior) would sit in front of the cockpit; hide it there.
    for (const part of view.model.body.children) if (part !== this.cockpit.group) part.visible = !this.cockpit.group.visible
    this.world.setInterior(this.cockpit.group.visible)
    $('cabin-shade').classList.toggle('on', this.cockpit.group.visible)
    // The pedal overlay is for the bonnet and bumper views; the cockpit has
    // its own dials and wheel, so there the speedo panel goes and the map
    // gets smaller.
    const firstPerson = this.mode === 'race' && !inside && (mode === 'hood' || mode === 'bumper')
    $('pedals').classList.toggle('hidden', !firstPerson)
    $('hud').classList.toggle('cockpit-view', inside && this.mode === 'race')
    if (inside) {
      const kmh = Math.abs(forwardSpeed(car)) * 3.6
      const { gear, rpm } = gearOf(Math.abs(forwardSpeed(car)), car.spec)
      this.cockpit.update(car.steer, kmh, rpm, gear, car.nitro, car.damage, performance.now(), this.world.camera.aspect, $('minimap') as HTMLCanvasElement)
    }
    // Inside the car, a wide phone screen gets a narrower view: 70 degrees
    // there stretched the edges and made the wheel look huge.
    const cockpitFov = this.world.camera.aspect > 1.9 ? 60 : 70
    const fov = (inside ? cockpitFov : 60) + Math.min(inside ? 6 : 14, speed * (inside ? 0.08 : 0.17)) + (car.nitroOn ? 7 : 0) + this.nitroPulse * 9
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
    $('place-row').classList.toggle('hidden', kind === 'drift' || kind === 'pursuit' || kind === 'trial' || kind === 'cop')
    $('lap').textContent = kind === 'elimination' ? String(race.lapOf(player)) : `${race.lapOf(player)}/${race.laps}`
    $('lap-row').classList.toggle('hidden', kind === 'pursuit' || kind === 'cop')
    $('race-time').textContent = formatTime(Math.max(0, player.finishTime ?? race.clock))
    // Progress through the whole race, for events with a set number of laps.
    const laps = kind === 'race' || kind === 'drift' || kind === 'trial'
    $('progress').classList.toggle('hidden', !laps)
    if (laps) $('progress-fill').style.transform = `scaleX(${MathUtils.clamp(player.distance / (race.laps * race.track.length), 0, 1).toFixed(3)})`
    $('area').textContent = isDay(this.weather) ? 'Mountain road' : 'City streets'
    if (performance.now() - this.boardAt > 250) {
      this.boardAt = performance.now()
      this.board()
    }
    const current = player.checkpoints >= 1 && player.finishTime === null ? race.clock - player.lapStart : player.checkpoints >= 1 ? player.lapTimes.at(-1) ?? 0 : 0
    $('lap-time').textContent = formatTime(Math.max(0, current))
    $('best-lap').textContent = player.lapTimes.length ? formatTime(Math.min(...player.lapTimes)) : 'none yet'
    $('ghost-row').classList.toggle('hidden', kind !== 'trial')
    $('ghost-time').textContent = this.ghost ? `${formatTime(this.ghost.time)}${this.event.ghost ? ` ${this.event.ghost.name}` : ''}` : 'none yet'
    $('speed').textContent = String(Math.round(speed * 3.6))
    $('gear').textContent = String(gearOf(speed, car.spec).gear)
    $('gauge-fill').style.strokeDashoffset = String(1 - Math.min(1, speed / (car.spec.topSpeed * car.spec.nitroTop)))
    $('nitro-fill').style.transform = `scaleX(${car.nitro})`
    // The phone's Nitro ring, Drift tier colour and the gas pedal's glow.
    if (this.touchShown) {
      $('touch-nitro').style.setProperty('--tank', car.nitro.toFixed(2))
      const tier = car.driftDir !== 0 || car.drifting ? driftTier(car.driftCharge) : 0
      $('touch-drift').dataset.tier = String(tier)
      $('touch-pedals').style.setProperty('--revs', gearOf(Math.abs(forwardSpeed(car)), car.spec).rpm.toFixed(2))
    }
    // Driver inputs, shown in the first-person views.
    const input = this.race.playerInput
    $('pedal-gas').style.setProperty('--press', input.throttle.toFixed(2))
    $('pedal-brake').style.setProperty('--press', Math.max(input.brake, input.handbrake ? 0.6 : 0).toFixed(2))
    $('wheel-icon').style.transform = `rotate(${(car.steer * 6 * 180) / Math.PI}deg)`
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
    else if (kind === 'pursuit') goal = `Heat ${race.pursuit.heat}. Get ${300} m clear of every patrol car.${race.heli?.seeing ? ' The helicopter has you in its light.' : ''}${race.pulseLock > 0 ? ' Interceptor locking on!' : ''}`
    else if (kind === 'cop') {
      // The racer to go after: the nearest one ahead, with its damage.
      const left = race.racers.filter((r) => !r.player && !r.out && r.finishTime === null)
      const fx = Math.sin(car.heading)
      const fz = Math.cos(car.heading)
      const ahead = left.map((r) => ({ r, d: Math.hypot(r.car.x - car.x, r.car.z - car.z), front: (r.car.x - car.x) * fx + (r.car.z - car.z) * fz })).filter((t) => t.front > 0).sort((a, b) => a.d - b.d)[0]
      const leader = race.leadingRacer()
      goal = `Busted ${race.busts} of ${race.racers.length - 1}.${leader ? ` Leader on lap ${Math.min(race.laps, race.lapOf(leader))} of ${race.laps}.` : ''}${ahead ? ` ${ahead.r.name} ${Math.round(ahead.d)} m ahead, damage ${Math.round(ahead.r.car.damage * 100)}%.` : ''}${race.clock < 3 ? ' The racers have a head start.' : ''}`
    }
    // Police after the player in a race: the same meters as a pursuit.
    const chased = kind === 'pursuit' || race.chasing
    if (race.chasing) goal = `Police on you, heat ${race.pursuit.heat}. Get ${300} m clear to lose them.`
    $('goal').textContent = goal
    $('goal').classList.toggle('hidden', goal === '')
    $('pursuit').classList.toggle('hidden', !chased)
    // The racer tools: which key, uses left, and the jammer's time.
    const tools = race.tools
    $('tools-hud').classList.toggle('hidden', tools.length === 0)
    $('touch-tools').classList.toggle('hidden', tools.length === 0 || this.mode !== 'race')
    if (tools.length) {
      const html = tools
        .map((t, k) => {
          const extra = t.id === 'jammer' && race.jammed > 0 ? ` ${Math.ceil(race.jammed)} s` : ''
          return `<span class="tool${t.left === 0 ? ' spent' : ''}"><kbd>${k + 1}</kbd>${TOOL_INFO[t.id].name}${extra} <i>${'●'.repeat(t.left)}${'○'.repeat(2 - t.left)}</i></span>`
        })
        .join('')
      if (html !== this.toolsHtml) {
        this.toolsHtml = html
        $('tools-hud').innerHTML = html
        tools.forEach((t, k) => ($(`touch-tool-${k + 1}`).textContent = `${TOOL_INFO[t.id].name} ${'●'.repeat(t.left)}${'○'.repeat(2 - t.left)}`))
      }
    }
    // A warning while the busted meter fills: keep moving.
    const boxed = chased && race.pursuit.busted > 0.3 && !race.pursuit.outcome && !player.out
    if (boxed !== this.boxedShown) {
      this.boxedShown = boxed
      const banner = $('banner')
      if (boxed) {
        banner.textContent = 'Boxed in: keep moving'
        banner.className = 'hold warn'
      } else if (banner.textContent?.startsWith('Boxed')) banner.className = ''
    }
    if (chased) {
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

  // Standings with the gap to each rival, in seconds at the player's
  // speed: + for a car ahead, - for one behind. The board shows the cars
  // round the player; phones show only the nearest (the rest are marked
  // far and hidden there).
  private boardAt = 0
  private board() {
    const race = this.race
    const box = $('board')
    const show = race.racers.length > 1 && (this.event.kind === 'race' || this.event.kind === 'elimination')
    box.classList.toggle('hidden', !show)
    if (!show) return
    const order = race.standings()
    const me = this.player
    const at = order.indexOf(me)
    const speed = Math.max(15, speedOf(me.car))
    const from = MathUtils.clamp(at - 2, 0, Math.max(0, order.length - 5))
    box.innerHTML = order
      .slice(from, from + 5)
      .map((r, k) => {
        const place = from + k + 1
        const near = Math.abs(from + k - at) <= 1
        let gap = ''
        if (r.out) gap = r.fate ?? 'out'
        else if (r !== me) {
          const seconds = (r.distance - me.distance) / speed
          const level = Math.abs(seconds) < 0.05
          gap = `<span class="gap ${level ? '' : seconds > 0 ? 'ahead' : 'behind'}">${level ? '' : seconds > 0 ? '+' : '-'}${Math.abs(seconds).toFixed(1)}</span>`
        }
        return `<li class="${r === me ? 'you' : ''}${near ? '' : ' far'}"><b>${place}</b><span>${r.name}</span>${gap}</li>`
      })
      .join('')
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

// What each heat level brings, for the message when it arrives.
const HEAT_NEWS: Record<number, string> = { 2: 'patrol cars in pairs', 3: 'a heavy unit, roadblocks and spikes', 4: 'a helicopter, and units called ahead', 5: 'interceptors with a power-cutting pulse' }
// The racer tools: their names, and what the popup says when one is used.
export const TOOL_INFO: Record<ToolId, { name: string; does: string; used: string }> = {
  jammer: { name: 'Jammer', does: 'Hides you from the helicopter and the interceptors\' lock, and stops roadblocks and spikes being set up, for 8 seconds.', used: 'Jammer on: they cannot see you' },
  shockwave: { name: 'Shockwave', does: 'Throws every car within 18 m away from you. A police car it sends into a wall is a takedown.', used: 'Shockwave' },
  turbo: { name: 'Turbo', does: 'A big push for 2.5 seconds, up to a quarter past your top speed.', used: 'Turbo' },
  mine: { name: 'Mine', does: 'Dropped behind you, it goes off under the first police car to reach it and can wreck it.', used: 'Mine dropped' },
  roadblock: { name: 'Roadblock', does: 'Two heavy units park across the road 260 m ahead of the leading racer, with a gap on one side.', used: 'Roadblock going up ahead of the leader' },
  spikes: { name: 'Spike strip', does: 'A strip across the racing line 140 m ahead of the leading racer. Blown tyres cost a racer 28% of its top speed.', used: 'Spike strip laid ahead of the leader' },
  helicopter: { name: 'Helicopter', does: 'For 20 seconds it follows the leading racer and drops a spike strip in front of it every 6 seconds.', used: 'Helicopter on the leader' },
  pulse: { name: 'Pulse', does: 'Cuts the power of the racer most nearly straight ahead within 90 m for 2 seconds.', used: 'Pulse fired' },
}

// A ring of light for the shockwave, flat on the road.
function shockRing(): Mesh {
  const ring = new MeshObject(new RingGeometry(0.85, 1, 48), new MeshBasicMaterial({ color: '#7ff7ff', transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }))
  ring.rotation.x = -Math.PI / 2
  return ring
}

// A mine: a dark disc with a red light on top that blinks once armed.
function mineModel(): Group {
  const g = new GroupObject()
  const disc = new MeshObject(new CylinderGeometry(0.34, 0.38, 0.12, 20), new MeshStandardMaterial({ color: '#22252b', metalness: 0.7, roughness: 0.4 }))
  disc.position.y = 0.06
  const led = new MeshObject(new SphereGeometry(0.06, 10, 8), new MeshBasicMaterial({ color: '#ff2030' }))
  led.position.y = 0.15
  g.add(disc, led)
  return g
}

// The searchlight beam is a cone built pointing down.
const DOWN = new Vector3(0, -1, 0)

// The model for a police car, by the kind of unit.
function copShape(race: Race, cop: CarState): 'police' | 'police-heavy' | 'police-fast' {
  const kind = race.copKind.get(cop)
  return kind === 'heavy' ? 'police-heavy' : kind === 'interceptor' ? 'police-fast' : 'police'
}

function ghostKey(seed: string) {
  return `neon-apex/ghost/${seed}`
}

function loadGhost(seed: string): Ghost | null {
  try {
    const raw = localStorage.getItem(ghostKey(seed))
    const ghost = raw ? (JSON.parse(raw) as Ghost) : null
    // A ghost from older handling is dropped: it could not be matched.
    return ghost && ghost.version === PHYSICS_VERSION && Array.isArray(ghost.samples) && ghost.samples.length >= 8 ? ghost : null
  } catch {
    return null
  }
}

function saveGhost(seed: string, ghost: Ghost) {
  try {
    localStorage.setItem(ghostKey(seed), JSON.stringify({ ...ghost, version: PHYSICS_VERSION }))
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
