import { describe, expect, it } from 'vitest'
import { CAR, type CarInput, forwardSpeed, idle } from '../src/sim/car'
import { buildGraph, nearestWall, type RoadGraph, SAMPLE, whereOnGraph } from '../src/sim/roads'
import { Roamer } from '../src/sim/roam'
import { TEST_MAP } from '../src/sim/testMap'
import { STEP } from '../src/sim/race'

const graph = buildGraph(TEST_MAP)

// A leg of a route: a road, driven from its start or from its end.
interface Leg {
  road: number
  back: boolean
}

// Steers at a point a little way along the route and keeps to a speed the
// bends allow, like a careful driver.
function follow(r: Roamer, legs: Leg[], at: { leg: number }): CarInput {
  const car = r.car
  const leg = legs[at.leg]
  const road = graph.roads[leg.road]
  const place = whereOnGraph(graph, car.x, car.z)
  // Distance along this leg, in its direction of travel.
  const along = (s: number) => (leg.back ? road.length - s : s)
  let s = place && place.road === leg.road ? along(place.s) : 0
  // Into the junction at the end of this leg: on to the next one.
  if (s > road.length - graph.junctions[leg.back ? road.from : road.to].radius && at.leg < legs.length - 1) {
    at.leg++
    return follow(r, legs, at)
  }
  const speed = Math.max(0, forwardSpeed(car))
  const look = 8 + speed * 0.5
  s = Math.min(road.length, s + look)
  const i = Math.max(0, Math.min(road.n - 1, Math.round(along(s) / SAMPLE)))
  const fx = Math.sin(car.heading)
  const fz = Math.cos(car.heading)
  const dx = road.x[i] - car.x
  const dz = road.z[i] - car.z
  const angle = Math.atan2(dx * -fz + dz * fx, Math.max(dx * fx + dz * fz, 0.1))
  const steer = Math.max(-1, Math.min(1, angle * 2.4))
  const target = Math.abs(angle) > 0.5 ? 9 : Math.abs(angle) > 0.25 ? 16 : 24
  return { ...idle, throttle: speed < target ? 0.8 : 0, brake: speed > target + 4 ? 0.6 : 0, steer }
}

function pairs(g: RoadGraph) {
  const out: [number, number][] = []
  for (let a = 0; a < g.roads.length; a++) for (let b = a + 1; b < g.roads.length; b++) out.push([a, b])
  return out
}

describe('the road network and the test map', () => {
  it('builds junctions big enough for their roads, and no two roads come together between junctions', () => {
    expect(graph.junctions).toHaveLength(7)
    expect(graph.roads).toHaveLength(10)
    for (const road of graph.roads) {
      expect(road.end - road.start).toBeGreaterThan(100)
      expect(road.width).toBe(road.lanes * 2 * 3.5 + 2)
    }
    for (const [a, b] of pairs(graph)) {
      const ra = graph.roads[a]
      const rb = graph.roads[b]
      let closest = Infinity
      for (let i = Math.ceil(ra.start / SAMPLE); i <= ra.end / SAMPLE; i += 2) {
        for (let k = Math.ceil(rb.start / SAMPLE); k <= rb.end / SAMPLE; k += 2) closest = Math.min(closest, Math.hypot(ra.x[i] - rb.x[k], ra.z[i] - rb.z[k]))
      }
      expect(closest, `${ra.name} and ${rb.name}`).toBeGreaterThan(ra.barrier + rb.barrier)
    }
  })

  it('has barriers all round: anywhere on the tarmac is inside them, facing out', () => {
    for (const road of graph.roads) {
      for (let i = Math.ceil(road.start / SAMPLE); i <= road.end / SAMPLE; i += 5) {
        for (const d of [-road.width / 2, 0, road.width / 2]) {
          const x = road.x[i] + road.nx[i] * d
          const z = road.z[i] + road.nz[i] * d
          const wall = nearestWall(graph, x, z)
          expect(wall).not.toBeNull()
          expect(wall!.distance).toBeGreaterThan(0.5)
          // Into the wall is away from the point.
          expect((wall!.x - x) * wall!.nx + (wall!.z - z) * wall!.nz).toBeGreaterThan(0)
        }
      }
    }
    // The middle of each junction is open all round. (Near its edge, the
    // ground between two roads can come in a little where a road bends.)
    for (const j of graph.junctions) {
      for (let a = 0; a < Math.PI * 2; a += 0.3) {
        const x = j.x + Math.cos(a) * j.radius * 0.7
        const z = j.z + Math.sin(a) * j.radius * 0.7
        expect(nearestWall(graph, x, z)!.distance, j.id).toBeGreaterThan(0)
      }
    }
  })

  it('knows where a point is: which road, how far along and across, and which junction', () => {
    const road = graph.roads[3]
    const i = Math.round(road.n / 2)
    const place = whereOnGraph(graph, road.x[i] + road.nx[i] * 2, road.z[i] + road.nz[i] * 2)!
    expect(place.road).toBe(3)
    expect(place.s).toBeCloseTo(i * SAMPLE, 0)
    expect(place.d).toBeCloseTo(2, 1)
    expect(place.junction).toBe(-1)
    const square = graph.junctions.findIndex((j) => j.id === 'square')
    expect(whereOnGraph(graph, graph.junctions[square].x + 1, graph.junctions[square].z)!.junction).toBe(square)
  })

  it('drives a loop of five roads through four junctions without hitting a barrier', () => {
    const id = (name: string) => graph.roads.findIndex((r) => r.name === name)
    // Low Road, River Road, Station Road, then back round by Mill Lane and
    // West Road: market, bridge and square are junctions with three or more
    // roads.
    const legs: Leg[] = [
      { road: id('Low Road'), back: false },
      { road: id('River Road'), back: false },
      { road: id('Station Road'), back: false },
      { road: id('Mill Lane'), back: false },
      { road: id('West Road'), back: false },
    ]
    const r = new Roamer(graph, CAR, legs[0].road, 30)
    const at = { leg: 0 }
    let worst = Infinity
    let hardest = 0
    let t = 0
    for (; t < 300 && !(at.leg === legs.length - 1 && whereOnGraph(graph, r.car.x, r.car.z)!.s > graph.roads[legs[4].road].length - 40); t += STEP) {
      r.step(follow(r, legs, at), STEP)
      worst = Math.min(worst, nearestWall(graph, r.car.x, r.car.z)?.distance ?? Infinity)
      hardest = Math.max(hardest, r.car.wallHit)
    }
    expect(at.leg).toBe(legs.length - 1)
    expect(t).toBeLessThan(300)
    // Never through a barrier, and no real hits on the way.
    expect(worst).toBeGreaterThan(0)
    expect(hardest).toBeLessThan(3)
  })

  it('never lets a car through a barrier, however it is driven', () => {
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    let worst = Infinity
    for (let road = 0; road < graph.roads.length; road++) {
      const r = new Roamer(graph, CAR, road, 60)
      let steer = 0
      for (let k = 0; k < 60 / STEP; k++) {
        // Flat out, the wheel swung from lock to lock every so often, and
        // now and then a handbrake.
        if (k % 90 === 0) steer = random() * 2 - 1
        r.step({ ...idle, throttle: 1, steer, handbrake: random() < 0.01, nitro: random() < 0.3 }, STEP)
        worst = Math.min(worst, nearestWall(graph, r.car.x, r.car.z)?.distance ?? Infinity)
      }
    }
    expect(worst).toBeGreaterThan(-0.05)
  })

  it('stops a car driven into the barrier, with the same bounce and damage as on a race track', () => {
    const r = new Roamer(graph, CAR, 0, 120)
    const road = graph.roads[0]
    const i = Math.round(120 / SAMPLE)
    // Turned to hit the right-hand barrier at about 45 degrees, at 30 m/s.
    r.car.heading = Math.atan2(road.tx[i] + road.nx[i], road.tz[i] + road.nz[i])
    r.car.vx = Math.sin(r.car.heading) * 30
    r.car.vz = Math.cos(r.car.heading) * 30
    let impact = 0
    for (let k = 0; k < 120; k++) {
      r.step(idle, STEP)
      impact = Math.max(impact, r.car.wallHit)
      expect(nearestWall(graph, r.car.x, r.car.z)!.distance).toBeGreaterThan(0)
    }
    expect(impact).toBeGreaterThan(10)
    expect(r.car.damage).toBeGreaterThan(0)
  })

  it('puts a car back on the road, facing along it, after it is reset', () => {
    const r = new Roamer(graph, CAR, 1, 200)
    r.car.x += 4
    r.car.heading += 2.6
    r.car.vx = 5
    r.reset()
    const place = whereOnGraph(graph, r.car.x, r.car.z)!
    expect(Math.abs(place.d)).toBeLessThan(0.5)
    expect(r.car.vx).toBe(0)
  })
})
