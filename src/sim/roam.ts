import { type CarInput, type CarSpec, type CarState, createCar, stepCar } from './car'
import { aimWallTrack, type RoadGraph, SAMPLE, wallTrack, whereOnGraph } from './roads'
import { heading, type Track, wrapAngle } from './track'

// Driving on a road network. The car itself is the race code's, stepped
// the same way; only its barrier is different: before each step the stand-in
// track is pointed at the wall nearest the car (see aimWallTrack).

export class Roamer {
  readonly car: CarState
  private readonly wall: Track

  constructor(
    readonly graph: RoadGraph,
    spec: CarSpec,
    road = 0,
    s = 0,
  ) {
    this.wall = wallTrack()
    const at = this.spot(road, s)
    aimWallTrack(this.wall, graph, at.x, at.z)
    this.car = createCar(at.x, at.z, at.heading, this.wall, spec)
  }

  step(input: CarInput, dt: number) {
    aimWallTrack(this.wall, this.graph, this.car.x, this.car.z)
    stepCar(this.car, input, dt, this.wall)
  }

  // A place on a road's centre line, s metres along it, facing along it
  // (or back the other way).
  spot(road: number, s: number, back = false) {
    const r = this.graph.roads[road]
    const i = Math.max(0, Math.min(r.n - 1, Math.round(s / SAMPLE)))
    const h = heading(r.tx[i], r.tz[i])
    return { x: r.x[i], z: r.z[i], heading: back ? wrapAngle(h + Math.PI) : h }
  }

  // Back on the road, stopped: on the centre line of the nearest road,
  // facing whichever way along it is closer to the way the car faced, and
  // out of any junction.
  reset() {
    const car = this.car
    const place = whereOnGraph(this.graph, car.x, car.z)
    if (!place) return
    const road = this.graph.roads[place.road]
    const s = Math.max(road.start + 4, Math.min(road.end - 4, place.s))
    const ahead = this.spot(place.road, s)
    const back = Math.abs(wrapAngle(ahead.heading - car.heading)) > Math.PI / 2
    const at = this.spot(place.road, s, back)
    car.x = at.x
    car.z = at.z
    car.heading = at.heading
    car.vx = 0
    car.vz = 0
    car.yawRate = 0
    car.steer = 0
    car.driftDir = 0
    car.driftAngle = 0
  }
}
