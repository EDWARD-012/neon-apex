import { type CarInput, type CarState, createCar, forwardSpeed } from './car'
import { TRAFFIC_SPEC } from './cars'
import { between, createRng } from './rng'
import { pointAt, type Track } from './track'

// Civilian cars cruising round the circuit in two lanes. They keep to their
// lane, hold a steady speed and slow down behind anything in the way. They
// are obstacles, and passing one close at speed counts as a near miss.

export interface TrafficCar {
  car: CarState
  lane: number
  cruise: number
  color: string
  shape: 'sedan' | 'van'
}

const COLORS = ['#c9ccd6', '#7d8597', '#a33c3c', '#2f4f7a', '#d9c7a3', '#3c6b52', '#e0e0e0', '#565b66']
const LANE = 3.4

export function spawnTraffic(track: Track, count: number, seed: string): TrafficCar[] {
  const rng = createRng(`traffic/${seed}`)
  const cars: TrafficCar[] = []
  for (let k = 0; k < count; k++) {
    // Spread out round the lap, clear of the start grid.
    const s = track.length * (0.12 + (0.8 * (k + rng() * 0.5)) / count)
    const lane = k % 2 === 0 ? LANE : -LANE
    const at = pointAt(track, s, lane)
    const car = createCar(at.x, at.z, at.heading, track, TRAFFIC_SPEC)
    const cruise = between(rng, 20, 27)
    car.vx = Math.sin(at.heading) * cruise
    car.vz = Math.cos(at.heading) * cruise
    car.nitro = 0
    cars.push({ car, lane, cruise, color: COLORS[Math.floor(rng() * COLORS.length)], shape: rng() < 0.25 ? 'van' : 'sedan' })
  }
  return cars
}

export function driveTraffic(t: TrafficCar, track: Track, everyone: CarState[]): CarInput {
  const car = t.car
  const n = track.n
  const i = car.hint
  const speed = Math.max(0, forwardSpeed(car))
  const ahead = (i + Math.round((10 + speed * 0.5) / track.spacing)) % n
  const tx = track.x[ahead] + t.lane * track.nx[ahead]
  const tz = track.z[ahead] + t.lane * track.nz[ahead]
  const fx = Math.sin(car.heading)
  const fz = Math.cos(car.heading)
  const dx = tx - car.x
  const dz = tz - car.z
  const angle = Math.atan2(dx * -fz + dz * fx, Math.max(dx * fx + dz * fz, 0.1))

  // Slow for anything close ahead in the same lane.
  let target = t.cruise
  for (const other of everyone) {
    if (other === car) continue
    const gap = ((other.hint - i + n) % n) * track.spacing
    if (gap <= 0 || gap > 25) continue
    const side = (other.x - track.x[other.hint]) * track.nx[other.hint] + (other.z - track.z[other.hint]) * track.nz[other.hint]
    if (Math.abs(side - t.lane) < 2.4) target = Math.min(target, Math.max(0, forwardSpeed(other) - 2 + (gap - 12) * 0.4))
  }
  const diff = target - speed
  return {
    throttle: diff > 0 ? Math.min(1, diff * 0.4 + 0.2) : 0,
    brake: diff < -1 ? Math.min(1, -diff * 0.25) : 0,
    steer: Math.max(-1, Math.min(1, angle * 2.2)),
    handbrake: false,
    nitro: false,
  }
}
