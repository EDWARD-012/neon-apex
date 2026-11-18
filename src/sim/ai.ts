import { CAR, type CarInput, type CarState, forwardSpeed } from './car'
import type { RacingLine } from './line'
import type { Track } from './track'

// An AI driver follows the racing line with pure pursuit steering and the
// line's speed profile for throttle and brake. Skill scales the target speed;
// the lane offset lets it move off the line to get round a slower car.

export interface Driver {
  skill: number
  lane: number
  laneTarget: number
  laneTimer: number
}

export function createDriver(skill: number): Driver {
  return { skill, lane: 0, laneTarget: 0, laneTimer: 0 }
}

export function drive(car: CarState, driver: Driver, track: Track, line: RacingLine, others: CarState[], dt: number): CarInput {
  const n = track.n
  const i = car.hint
  const speed = Math.max(0, forwardSpeed(car))

  // Look for a car close ahead in our lane and pick a side to pass on.
  driver.laneTimer -= dt
  if (driver.laneTimer <= 0) {
    driver.laneTarget = 0
    for (const other of others) {
      if (other === car) continue
      const ahead = ((other.hint - i + n) % n) * track.spacing
      if (ahead <= 0 || ahead > 22) continue
      const theirs = (other.x - track.x[other.hint]) * track.nx[other.hint] + (other.z - track.z[other.hint]) * track.nz[other.hint]
      const ours = line.offset[i] + driver.lane
      if (Math.abs(theirs - ours) > 3) continue
      const room = track.width / 2 - 2.2
      const goRight = theirs < 0 ? theirs + 3.6 <= room : theirs - 3.6 < -room
      driver.laneTarget = Math.max(-room, Math.min(room, theirs + (goRight ? 3.6 : -3.6))) - line.offset[i]
      driver.laneTimer = 1.2
      break
    }
  }
  driver.lane += (driver.laneTarget - driver.lane) * Math.min(1, 1.5 * dt)

  // Pure pursuit towards a point on the line some way ahead.
  const lookahead = 7 + 0.42 * speed
  const j = (i + Math.round(lookahead / track.spacing)) % n
  const bound = track.width / 2 - 1.6
  const off = Math.max(-bound, Math.min(bound, line.offset[j] + driver.lane))
  const tx = track.x[j] + off * track.nx[j]
  const tz = track.z[j] + off * track.nz[j]
  const fx = Math.sin(car.heading)
  const fz = Math.cos(car.heading)
  const dx = tx - car.x
  const dz = tz - car.z
  const forward = dx * fx + dz * fz
  const right = dx * -fz + dz * fx
  const angle = Math.atan2(right, Math.max(forward, 0.1))
  const steer = Math.max(-1, Math.min(1, angle * 2.4))

  // Target speed: what the profile asks for a short way ahead, so the car
  // starts braking slightly early rather than late.
  const lead = (i + Math.round((speed * 0.35) / track.spacing)) % n
  const target = Math.min(line.speed[i], line.speed[lead]) * driver.skill
  const gap = target - speed
  const throttle = gap > 0 ? Math.min(1, gap * 0.5 + 0.3) : 0
  const brake = gap < -1 ? Math.min(1, -gap * 0.3) : 0

  // Nitro on a long fast stretch ahead.
  let clear = true
  for (let k = 0; k < 60 && clear; k += 4) clear = line.speed[(i + k) % n] > CAR.topSpeed * 0.92
  const nitro = clear && car.nitro > 0.25 && speed > 30

  return { throttle, brake, steer, handbrake: false, nitro }
}
