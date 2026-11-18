import { Color, type Group, MathUtils, Object3D, SpotLight, Vector3 } from 'three'
import { Sound } from './audio'
import { Input } from './input'
import { buildCity } from './render/city'
import { type CarModel, createCarModel } from './render/carModel'
import { Particles, Skids } from './render/effects'
import { spot } from './render/textures'
import { buildTrackMeshes } from './render/trackMesh'
import { type Quality, World } from './render/world'
import { CAR, forwardSpeed, speedOf } from './sim/car'
import { Race, type Racer, STEP } from './sim/race'

export type Mode = 'menu' | 'race' | 'paused' | 'results'
export type Kind = 'race' | 'trial'

export interface Settings {
  seed: string
  laps: number
  color: string
  quality: Quality
  sound: boolean
}

interface View {
  racer: Racer
  model: CarModel
  prev: { x: number; z: number; heading: number }
}

interface Ghost {
  time: number
  // t, x, z, heading, repeated.
  samples: number[]
}

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

export class Game {
  readonly world: World
  readonly input = new Input()
  readonly sound = new Sound()
  settings: Settings
  race!: Race
  mode: Mode = 'menu'
  kind: Kind = 'race'
  timeScale = 1
  onResults: (() => void) | null = null

  private readonly autopilot: boolean
  private readonly spotTexture = spot()
  private builtSeed = ''
  private scenery: Group[] = []
  private beacons: { opacity: number } | null = null
  private views: View[] = []
  private ghostModel: CarModel | null = null
  private ghost: Ghost | null = null
  private recording: number[] = []
  private readonly smoke: Particles
  private readonly sparks: Particles
  private readonly skids = new Skids()
  private readonly headlight: SpotLight
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
  camMode: 'chase' | 'hood' = 'chase'
  // Lets the screenshot script place the camera by hand.
  cameraOverride: ((camera: import('three').PerspectiveCamera) => void) | null = null
  private follow = 0
  private followTimer = 0
  private lastCount = 0
  private lapsSeen = 0
  private finishedAt = 0
  private driftScore = 0
  private driftQuiet = 0
  driftTotal = 0
  private wrongShown = false

  constructor(canvas: HTMLCanvasElement, settings: Settings, autopilot = false) {
    this.settings = settings
    this.autopilot = autopilot
    this.world = new World(canvas, settings.quality)
    this.sound.setEnabled(settings.sound)
    this.smoke = new Particles(900, this.spotTexture, '#c9cad6', { grow: 3.2 })
    this.sparks = new Particles(400, this.spotTexture, '#ffb347', { additive: true, gravity: 14, brightness: 3 })
    this.world.scene.add(this.smoke.points, this.sparks.points, this.skids.mesh)
    this.headlight = new SpotLight('#dfe9ff', 70, 90, 0.4, 0.6, 1)
    this.headlight.target = new Object3D()
    window.addEventListener('resize', () => this.world.resize())
    requestAnimationFrame(this.frame)
  }

  get player(): Racer {
    return this.race.player
  }

  // Builds the race, and the track and city meshes if the track changed.
  private setup(kind: Kind | 'attract') {
    const attract = kind === 'attract'
    this.race = new Race({
      seed: this.settings.seed,
      laps: attract ? 99 : this.settings.laps,
      rivals: kind === 'trial' ? 0 : 5,
      playerColor: this.settings.color,
      autopilot: attract || this.autopilot,
    })
    if (this.builtSeed !== this.settings.seed) {
      for (const g of this.scenery) this.world.scene.remove(g)
      const track = buildTrackMeshes(this.race.track)
      const city = buildCity(this.race.track)
      this.scenery = [track, city.group]
      this.beacons = city.beacons
      this.world.scene.add(track, city.group)
      this.builtSeed = this.settings.seed
    }
    for (const v of this.views) this.world.scene.remove(v.model.group)
    this.views = this.race.racers.map((racer) => {
      const model = createCarModel(racer.color, this.spotTexture)
      this.world.scene.add(model.group)
      return { racer, model, prev: { x: racer.car.x, z: racer.car.z, heading: racer.car.heading } }
    })
    this.headlight.removeFromParent()
    const playerModel = this.views[this.views.length - 1].model.group
    this.headlight.position.set(0, 0.8, 2.0)
    this.headlight.target.position.set(0, 0, 30)
    playerModel.add(this.headlight, this.headlight.target)
    this.skids.clear()
    this.acc = 0
    this.lastCount = 0
    this.lapsSeen = 0
    this.finishedAt = 0
    this.driftScore = 0
    this.driftTotal = 0
    this.recording = []
    this.wrongShown = false
    this.ghostModel?.group.removeFromParent()
    this.ghostModel = null
    this.ghost = null
    if (kind === 'trial') {
      this.ghost = loadGhost(this.settings.seed)
      this.ghostModel = createCarModel('#9fe8ff', this.spotTexture, true)
      this.ghostModel.group.visible = false
      this.world.scene.add(this.ghostModel.group)
    }
    // Put the camera behind the player straight away, not swooping in.
    this.camPos.set(0, 0, 0)
  }

  showMenu() {
    this.mode = 'menu'
    this.kind = 'race'
    this.setup('attract')
    // Run the attract race on a little so the cars are already moving.
    for (let t = 0; t < 9; t += STEP) this.race.step()
    this.snapViews()
    this.follow = 0
  }

  start(kind: Kind) {
    this.kind = kind
    this.setup(kind)
    this.mode = 'race'
    this.sound.start()
  }

  setQuality(quality: Quality) {
    this.settings.quality = quality
    this.world.setQuality(quality)
  }

  // Advances the simulation without drawing, for the browser tests.
  fastForward(seconds: number) {
    for (let t = 0; t < seconds; t += STEP) this.tick()
    this.snapViews()
  }

  private snapViews() {
    for (const v of this.views) v.prev = { x: v.racer.car.x, z: v.racer.car.z, heading: v.racer.car.heading }
  }

  private frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.time += dt
    if (this.mode === 'race') this.keys()
    if (this.mode !== 'paused') {
      if (this.mode === 'race') this.race.playerInput = this.input.read(dt)
      this.acc += dt * this.timeScale
      let steps = 0
      while (this.acc >= STEP && steps < 48) {
        this.tick()
        this.acc -= STEP
        steps++
      }
      if (steps >= 48) this.acc = 0
    }
    this.draw(this.mode === 'paused' ? 0 : dt)
    requestAnimationFrame(this.frame)
  }

  private keys() {
    if (this.input.take('pause')) this.pause()
    if (this.input.take('camera')) this.camMode = this.camMode === 'chase' ? 'hood' : 'chase'
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

  // One fixed physics step plus the race events that come out of it.
  private tick() {
    for (const v of this.views) v.prev = { x: v.racer.car.x, z: v.racer.car.z, heading: v.racer.car.heading }
    const before = this.race.phase
    this.race.step()
    if (this.mode === 'menu') return
    const race = this.race
    const player = this.player

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
    }

    // Ghost: record the current lap, 30 times a second.
    if (this.kind === 'trial' && player.checkpoints >= 1 && player.finishTime === null) {
      if (Math.round(race.clock / STEP) % 4 === 0) {
        this.recording.push(+(race.clock - player.lapStart).toFixed(3), +player.car.x.toFixed(2), +player.car.z.toFixed(2), +player.car.heading.toFixed(3))
      }
    }

    if (player.lapTimes.length > this.lapsSeen) {
      this.lapsSeen = player.lapTimes.length
      const lap = player.lapTimes[this.lapsSeen - 1]
      if (this.kind === 'trial' && (!this.ghost || lap < this.ghost.time)) {
        this.ghost = { time: lap, samples: this.recording }
        saveGhost(this.settings.seed, this.ghost)
        if (this.lapsSeen < race.laps) flash(`New best ${formatTime(lap)}`, 'small')
      } else if (this.lapsSeen < race.laps) {
        flash(this.lapsSeen === race.laps - 1 ? 'Final lap' : `Lap ${formatTime(lap)}`, 'small')
      }
      this.recording = []
    }
    if (player.finishTime !== null && this.finishedAt === 0) {
      this.finishedAt = this.time
      const place = race.position(player)
      flash(this.kind === 'trial' ? 'Finished' : `${ordinal(place)} place`)
      this.bankDrift()
    }
    if (this.mode === 'race' && this.finishedAt > 0 && this.time - this.finishedAt > 3) {
      this.mode = 'results'
      this.onResults?.()
    }

    // Drift points for the player: speed times slip angle, held together
    // while the slide lasts, banked when it ends, lost on a hard hit.
    const car = player.car
    if (car.impact > 4 && this.driftScore > 0) {
      this.driftScore = 0
      $('drift').className = ''
    }
    if (race.phase === 'racing' && car.drifting && player.finishTime === null) {
      this.driftScore += speedOf(car) * car.slip * STEP * 9
      this.driftQuiet = 0
    } else if (this.driftScore > 0) {
      this.driftQuiet += STEP
      if (this.driftQuiet > 0.45) this.bankDrift()
    }
  }

  private bankDrift() {
    if (this.driftScore < 30) {
      this.driftScore = 0
      $('drift').className = ''
      return
    }
    this.driftTotal += Math.round(this.driftScore)
    const el = $('drift')
    el.textContent = `+${Math.round(this.driftScore).toLocaleString('en')} drift`
    el.className = ''
    void el.offsetWidth
    el.className = 'bank'
    this.driftScore = 0
  }

  private draw(dt: number) {
    const alpha = this.acc / STEP
    const race = this.race
    for (const v of this.views) {
      const car = v.racer.car
      const g = v.model.group
      g.position.set(MathUtils.lerp(v.prev.x, car.x, alpha), 0, MathUtils.lerp(v.prev.z, car.z, alpha))
      g.rotation.y = v.prev.heading + (car.heading - v.prev.heading) * alpha
      for (const wheel of v.model.wheels) wheel.rotation.x = car.wheelSpin
      for (const pivot of v.model.frontPivots) pivot.rotation.y = -car.steer
      const speed = forwardSpeed(car)
      // Body lean: roll out of the turn and pitch under braking.
      v.model.body.rotation.z = MathUtils.lerp(v.model.body.rotation.z, MathUtils.clamp(car.yawRate * speed * -0.0035, -0.07, 0.07), 0.2)
      v.model.body.rotation.x = MathUtils.lerp(v.model.body.rotation.x, car.braking ? 0.025 : 0, 0.15)
      v.model.tail.color.setScalar(0).add(new Color('#ff1a2e').multiplyScalar(car.braking ? 5 : 1.6))
      for (const flame of v.model.flames) {
        flame.visible = car.nitroOn
        if (car.nitroOn) flame.scale.set(1, 1, 0.7 + Math.random() * 0.6)
      }
      if (dt > 0) this.tyres(v, dt)
    }
    if (dt > 0) {
      this.smoke.update(dt)
      this.sparks.update(dt)
    }
    if (this.beacons) this.beacons.opacity = Math.sin(this.time * 3) > 0.6 ? 1 : 0.15

    if (this.ghostModel) {
      const sample = this.ghost && this.player.checkpoints >= 1 && this.player.finishTime === null ? ghostAt(this.ghost, race.clock - this.player.lapStart) : null
      this.ghostModel.group.visible = sample !== null
      if (sample) {
        this.ghostModel.group.position.set(sample[0], 0, sample[1])
        this.ghostModel.group.rotation.y = sample[2]
      }
    }

    this.camera(dt)
    if (this.mode !== 'menu') this.hud()
    const player = this.player.car
    const { rpm } = gearOf(Math.abs(forwardSpeed(player)))
    const active = this.mode === 'race' || this.mode === 'results'
    this.sound.update(rpm, this.mode === 'race' ? race.playerInput.throttle : 0.3, player.slip * (speedOf(player) > 8 ? 1 : 0), player.nitroOn, active && race.phase !== 'countdown')
    this.world.render()
  }

  // Smoke, skid marks and sparks for one car.
  private tyres(v: View, dt: number) {
    const car = v.racer.car
    const fx = Math.sin(car.heading)
    const fz = Math.cos(car.heading)
    const speed = speedOf(car)
    const skidding = car.drifting || (car.braking && speed > 28)
    for (const side of [-1, 1]) {
      const wx = car.x - fx * 1.38 + -fz * 0.86 * side
      const wz = car.z - fz * 1.38 + fx * 0.86 * side
      this.skids.mark(`${v.racer.id}${side}`, wx, wz, skidding)
      if (car.drifting) {
        const rate = Math.min(1, car.slip * 2) * 40 * dt
        for (let k = 0; k < rate; k++) {
          if (Math.random() > rate - k) break
          this.smoke.emit(wx, 0.4, wz, car.vx * 0.25 + (Math.random() - 0.5) * 2, 0.8 + Math.random(), car.vz * 0.25 + (Math.random() - 0.5) * 2, 1.4, 1.2)
        }
      }
    }
    if (car.impact > 1.5) {
      const n = Math.min(40, Math.round(car.impact * 4))
      for (let k = 0; k < n; k++) {
        this.sparks.emit(car.x, 0.6, car.z, (Math.random() - 0.5) * 16, 2 + Math.random() * 5, (Math.random() - 0.5) * 16, 0.4 + Math.random() * 0.3, 0.35)
      }
      if (v.racer.player) {
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
    let target: Racer = this.player
    if (this.mode === 'menu') {
      this.followTimer += dt
      if (this.followTimer > 7) {
        this.followTimer = 0
        this.follow = (this.follow + 1) % this.race.racers.length
      }
      target = this.race.racers[this.follow]
    }
    const view = this.views[target.id]
    const g = view.model.group
    const car = target.car
    const speed = speedOf(car)
    const fx = Math.sin(g.rotation.y)
    const fz = Math.cos(g.rotation.y)
    let pos: Vector3
    let look: Vector3
    if (this.mode === 'menu') {
      // Slow orbit round whichever car is being watched.
      const a = this.time * 0.18
      pos = new Vector3(g.position.x + Math.sin(a) * 10, 2.6 + Math.sin(this.time * 0.3) * 0.8, g.position.z + Math.cos(a) * 10)
      look = new Vector3(g.position.x, 0.9, g.position.z)
    } else if (this.camMode === 'hood') {
      pos = new Vector3(g.position.x + fx * 0.2, 1.3, g.position.z + fz * 0.2)
      look = new Vector3(g.position.x + fx * 30, 1.0, g.position.z + fz * 30)
    } else {
      // Behind the car, looking partly along where it is going, so a drift
      // shows the car sideways on screen.
      const vx = speed > 3 ? car.vx / speed : fx
      const vz = speed > 3 ? car.vz / speed : fz
      const want = new Vector3(fx * 0.6 + vx * 0.4, 0, fz * 0.6 + vz * 0.4).normalize()
      if (this.camPos.lengthSq() === 0 || dt === 0) this.camDir.copy(want)
      else this.camDir.lerp(want, 1 - Math.exp(-dt * 5)).normalize()
      const back = 6.6 + speed * 0.02
      const out = new Vector3(g.position.x - this.camDir.x * back, 2.45 + speed * 0.006, g.position.z - this.camDir.z * back)
      this.camPos.copy(out)
      pos = out
      look = new Vector3(g.position.x + fx * 6, 1.2, g.position.z + fz * 6)
    }
    const snap = this.camPos.lengthSq() === 0 || dt === 0
    const k = snap ? 1 : 1 - Math.exp(-dt * (this.mode === 'menu' ? 3 : 9))
    this.camPos.lerp(pos, k)
    this.camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 14))
    cam.position.copy(this.camPos)
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.5
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.5
      this.shake *= Math.exp(-dt * 6)
    }
    if (car.nitroOn && this.mode !== 'menu') {
      cam.position.x += (Math.random() - 0.5) * 0.05
      cam.position.y += (Math.random() - 0.5) * 0.05
    }
    cam.lookAt(this.camLook)
    const fov = this.mode === 'menu' ? 50 : 60 + Math.min(14, speed * 0.17) + (car.nitroOn ? 7 : 0)
    this.fov += (fov - this.fov) * (dt > 0 ? 1 - Math.exp(-dt * 4) : 0)
    cam.fov = this.fov
    cam.updateProjectionMatrix()
    $('speedlines').style.opacity = this.mode === 'menu' ? '0' : String(MathUtils.clamp((speed - 50) / 25, 0, 0.6) + (car.nitroOn ? 0.35 : 0))
  }

  private hud() {
    const race = this.race
    const player = this.player
    const car = player.car
    const speed = Math.abs(forwardSpeed(car))
    $('place').textContent = String(race.position(player))
    $('field').textContent = String(race.racers.length)
    $('lap').textContent = `${race.lapOf(player)}/${race.laps}`
    const current = player.checkpoints >= 1 && player.finishTime === null ? race.clock - player.lapStart : player.checkpoints >= 1 ? player.lapTimes.at(-1) ?? 0 : 0
    $('lap-time').textContent = formatTime(Math.max(0, current))
    $('best-lap').textContent = player.lapTimes.length ? formatTime(Math.min(...player.lapTimes)) : 'none yet'
    $('ghost-row').classList.toggle('hidden', this.kind !== 'trial')
    $('ghost-time').textContent = this.ghost ? formatTime(this.ghost.time) : 'none yet'
    $('speed').textContent = String(Math.round(speed * 3.6))
    const { gear } = gearOf(speed)
    $('gear').textContent = String(gear)
    $('gauge-fill').style.strokeDashoffset = String(1 - Math.min(1, speed / (CAR.topSpeed * CAR.nitroTop)))
    $('nitro-fill').style.transform = `scaleX(${car.nitro})`
    document.querySelector('.gauge')?.classList.toggle('boost', car.nitroOn)
    const drift = $('drift')
    if (this.driftScore >= 30) {
      drift.textContent = `${Math.round(this.driftScore).toLocaleString('en')} drift`
      drift.className = 'live'
    }
    const wrong = player.wrongWay > 1 && player.finishTime === null
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
    const toMap = (x: number, z: number): [number, number] => {
      const dx = (x - px) * scale
      const dz = (z - pz) * scale
      const c = Math.cos(-heading)
      const s = Math.sin(-heading)
      // Facing +z means up on the map; the car's right (-x) is right on the map.
      const rx = -(dx * c + dz * s)
      const ry = -(-dx * s + dz * c)
      return [size / 2 + rx, size / 2 + ry]
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
    for (const racer of this.race.racers) {
      if (racer.player) continue
      const [x, y] = toMap(racer.car.x, racer.car.z)
      g.fillStyle = racer.color
      g.beginPath()
      g.arc(x, y, 5, 0, Math.PI * 2)
      g.fill()
    }
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
