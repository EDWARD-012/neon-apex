import { type Material, type Mesh, Vector3 } from 'three'
import { ENGINES, type Game, gearOf, type Settings } from './game'
import { applyWeather } from './render/atmosphere'
import { createCarModel, type CarModel, WheelBank } from './render/carModel'
import { setMistTime } from './render/mist'
import { buildRoadMap } from './render/roadMap'
import { spot } from './render/textures'
import { forwardSpeed, speedOf } from './sim/car'
import { carById } from './sim/cars'
import { STEP } from './sim/race'
import { buildGraph, type RoadGraph, whereOnGraph } from './sim/roads'
import { Roamer } from './sim/roam'
import { TEST_MAP } from './sim/testMap'

// Free roam on the open map's test map, a prototype opened only with ?roam
// in the address. The player's car drives the network by day with the
// normal speedo, gear, nitro, damage and map, and without race standings,
// laps or goals. Nothing here touches the races, the career or analytics.

const $ = (id: string) => document.getElementById(id) as HTMLElement

// Race-only parts of the HUD: the corners with standings, goals and tools
// on the left and laps and times on the right, and the pedals and drift
// score.
const HIDDEN = ['pedals', 'drift']

export class Roam {
  readonly graph: RoadGraph
  readonly roamer: Roamer
  private readonly model: CarModel
  private readonly bank = new WheelBank(8)
  private acc = 0
  private time = 0
  private far = false
  private readonly camPos = new Vector3()
  private readonly camDir = new Vector3(0, 0, 1)
  private readonly camLook = new Vector3()
  private fov = 62

  constructor(
    private readonly game: Game,
    private readonly settings: Settings,
  ) {
    const world = game.world
    this.graph = buildGraph(TEST_MAP)
    const map = buildRoadMap(this.graph)
    world.scene.add(map.group, this.bank.tyres, this.bank.rims)
    applyWeather(world, 'day', map.road, null, null, map.land.ground)
    const def = carById(settings.car)
    // On the Low Road, a little way out of the west junction.
    this.roamer = new Roamer(this.graph, def.spec, 0, 40)
    this.model = createCarModel(settings.color, spot(), { shape: def.shape, bank: this.bank })
    // By day: real shadows, and no headlight pools or underglow.
    this.model.group.traverse((o) => {
      if (o.userData.night) o.visible = false
      else if ((o as Mesh).isMesh && !((o as Mesh).material as Material).transparent) (o as Mesh).castShadow = true
    })
    world.scene.add(this.model.group)
    game.sound.setEngine(ENGINES[def.shape] ?? 'v12')
    $('hud').classList.remove('hidden')
    for (const id of HIDDEN) $(id).classList.add('hidden')
    for (const corner of document.querySelectorAll('.hud-left, .hud-right')) corner.classList.add('hidden')
    this.place()
  }

  frame(dt: number) {
    const game = this.game
    this.time += dt
    // The same driving aids as in a race.
    const input = { ...game.input.read(dt), assist: this.settings.driftAssist, raw: !this.settings.stability, band: this.settings.driftSteer === 'guided' }
    if (game.input.take('reset')) this.roamer.reset()
    if (game.input.take('camera')) {
      this.far = !this.far
      this.camPos.set(0, 0, 0)
    }
    this.acc += dt
    let steps = 0
    while (this.acc >= STEP && steps < 48) {
      this.roamer.step(input, STEP)
      this.acc -= STEP
      steps++
    }
    if (steps >= 48) this.acc = 0
    const car = this.roamer.car
    car.impact = 0
    this.place()
    this.camera(dt)
    const { gear, rpm } = gearOf(Math.abs(forwardSpeed(car)), car.spec)
    game.sound.update(rpm, input.throttle, car.slip * (speedOf(car) > 8 ? 1 : 0), car.nitroOn, true)
    this.hud(gear)
    game.world.followSun(car.x, car.z)
    setMistTime(this.time)
    game.world.render()
  }

  private place() {
    const car = this.roamer.car
    const g = this.model.group
    g.position.set(car.x, 0, car.z)
    g.rotation.y = car.heading
    for (const wheel of this.model.wheels) wheel.rotation.x = car.wheelSpin
    for (const pivot of this.model.frontPivots) pivot.rotation.y = -car.steer
    this.bank.update()
  }

  // Behind the car, looking partly along where it is going, as the race
  // chase camera does; the camera key pulls it further back.
  private camera(dt: number) {
    const cam = this.game.world.camera
    const car = this.roamer.car
    const speed = speedOf(car)
    const fx = Math.sin(car.heading)
    const fz = Math.cos(car.heading)
    const vx = speed > 3 ? car.vx / speed : fx
    const vz = speed > 3 ? car.vz / speed : fz
    const want = new Vector3(fx * 0.6 + vx * 0.4, 0, fz * 0.6 + vz * 0.4).normalize()
    if (this.camPos.lengthSq() === 0) this.camDir.copy(want)
    else this.camDir.lerp(want, 1 - Math.exp(-dt * 5)).normalize()
    const back = (this.far ? 10 : 6.6) + speed * (this.far ? 0.03 : 0.02)
    this.camPos.set(car.x - this.camDir.x * back, (this.far ? 3.6 : 2.45) + speed * 0.006, car.z - this.camDir.z * back)
    const look = new Vector3(car.x + fx * (this.far ? 10 : 6), 1.2, car.z + fz * (this.far ? 10 : 6))
    this.camLook.lerp(look, this.camLook.lengthSq() === 0 ? 1 : 1 - Math.exp(-dt * 14))
    cam.position.copy(this.camPos)
    cam.lookAt(this.camLook)
    const fov = 60 + Math.min(14, speed * 0.17) + (car.nitroOn ? 7 : 0)
    this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 4))
    cam.fov = this.fov
    cam.updateProjectionMatrix()
  }

  private hud(gear: number) {
    const car = this.roamer.car
    const speed = speedOf(car)
    $('speed').textContent = String(Math.round(speed * 3.6))
    $('gear').textContent = String(gear)
    $('gauge-fill').style.strokeDashoffset = String(1 - Math.min(1, speed / (car.spec.topSpeed * car.spec.nitroTop)))
    $('nitro-fill').style.transform = `scaleX(${car.nitro})`
    $('nitro-row').classList.toggle('full', car.nitro > 0.98)
    const damage = $('damage-fill')
    damage.style.transform = `scaleX(${Math.max(0.02, car.damage)})`
    damage.dataset.level = car.damage > 0.7 ? 'high' : car.damage > 0.35 ? 'mid' : 'low'
    document.querySelector('.gauge')?.classList.toggle('boost', car.nitroOn)
    // Where you are: the road, or the junction.
    const place = whereOnGraph(this.graph, car.x, car.z)
    const name = !place ? this.graph.name : place.junction >= 0 ? `${this.graph.junctions[place.junction].id} junction` : this.graph.roads[place.road].name
    if ($('area').textContent !== name) $('area').textContent = name
    this.minimap()
  }

  // Every road, turning with the car so up is always ahead.
  private minimap() {
    const canvas = $('minimap') as HTMLCanvasElement
    const g = canvas.getContext('2d') as CanvasRenderingContext2D
    const size = canvas.width
    const car = this.roamer.car
    const scale = size / 420
    const c = Math.cos(-car.heading)
    const s = Math.sin(-car.heading)
    const toMap = (x: number, z: number): [number, number] => {
      const dx = (x - car.x) * scale
      const dz = (z - car.z) * scale
      return [size / 2 - (dx * c + dz * s), size / 2 - (-dx * s + dz * c)]
    }
    g.clearRect(0, 0, size, size)
    g.save()
    g.beginPath()
    g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
    g.clip()
    g.lineJoin = 'round'
    g.lineCap = 'round'
    for (const [width, colour] of [
      [9, 'rgba(160,180,255,0.35)'],
      [2.5, 'rgba(230,235,255,0.9)'],
    ] as const) {
      g.lineWidth = width
      g.strokeStyle = colour
      for (const road of this.graph.roads) {
        g.beginPath()
        for (let i = 0; i < road.n; i += 3) {
          const [x, y] = toMap(road.x[i], road.z[i])
          if (i === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        const [x, y] = toMap(road.x[road.n - 1], road.z[road.n - 1])
        g.lineTo(x, y)
        g.stroke()
      }
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

export function startRoam(game: Game, settings: Settings): Roam {
  const roam = new Roam(game, settings)
  game.takeover = (dt) => roam.frame(dt)
  return roam
}
