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

// Braking help for the player: if the car is going faster than the racing
// line's speed a little way ahead, with some slack, it brakes for them and
// lifts the throttle. A player already braking hard is left alone.
export function brakingAid(car: CarState, input: CarInput, track: Track, line: RacingLine): CarInput {
  const speed = forwardSpeed(car)
  if (speed < 12 || input.brake > 0.5) return input
  const n = track.n
  let target = Infinity
  // Look about a second ahead.
  const reach = Math.round(Math.max(10, speed) / track.spacing)
  for (let k = 0; k <= reach; k += 2) target = Math.min(target, line.speed[(car.hint + k) % n])
  const over = speed - target * 1.08
  if (over <= 0) return input
  return { ...input, throttle: 0, brake: Math.max(input.brake, Math.min(1, 0.25 + over / 10)) }
}

export function createDriver(skill: number): Driver {
  return { skill, lane: 0, laneTarget: 0, laneTimer: 0 }
}

export function drive(car: CarState, driver: Driver, track: Track, line: RacingLine, others: CarState[], dt: number): CarInput {
  const n = track.n
  const i = car.hint
  const speed = Math.max(0, forwardSpeed(car))

  // Is the racing line blocked by a car close ahead, or one alongside that
  // we are in the middle of passing? If so, take a side and keep it until
  // the line is clear. Checking the line itself, not our current lane,
  // stops the car from drifting back into the one it is passing.
  driver.laneTimer -= dt
  if (driver.laneTimer <= 0) {
    const keep = Math.sign(driver.laneTarget)
    driver.laneTarget = 0
    const room = track.width / 2 - 2.2
    for (const other of others) {
      if (other === car) continue
      let gap = other.hint - i
      if (gap > n / 2) gap -= n
      if (gap < -n / 2) gap += n
      const metres = gap * track.spacing
      if (metres <= -7 || metres > 24) continue
      const theirs = (other.x - track.x[other.hint]) * track.nx[other.hint] + (other.z - track.z[other.hint]) * track.nz[other.hint]
      if (Math.abs(theirs - line.offset[i]) > 3.2 && keep === 0) continue
      const rightOk = theirs + 3.8 <= room
      const leftOk = theirs - 3.8 >= -room
      let side = keep !== 0 ? keep : theirs < 0 ? 1 : -1
      if (side > 0 && !rightOk) side = -1
      if (side < 0 && !leftOk) side = 1
      if (Math.abs(theirs - line.offset[i]) > 3.2) {
        // Already clear of it to one side: stay there while alongside.
        if (metres < -2) continue
        side = keep
      }
      driver.laneTarget = Math.max(-room, Math.min(room, theirs + side * 3.8)) - line.offset[i]
      driver.laneTimer = 0.5
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
