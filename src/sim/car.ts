import { locate, type Track } from './track'

// Arcade car physics on a flat plane. The car keeps a world-space velocity
// and a heading; grip pulls the sideways part of the velocity towards zero.
// Because the velocity is rotated into the new heading only through that
// grip, it lags behind when grip is low, and that lag is the drift.

export const CAR = {
  topSpeed: 72, // m/s, about 260 km/h
  engine: 16, // m/s² at a standstill, fading to zero at top speed
  brake: 26,
  reverseTop: 11,
  // Small enough that the car really gets close to its top speed.
  drag: 0.00015,
  roll: 0.35,
  wheelbase: 2.6,
  maxSteer: 0.55, // rad
  lateralLimit: 19, // m/s², the most sideways pull the tyres give
  grip: 9, // 1/s, how fast sideways velocity dies with full grip
  driftGrip: 1.4,
  yawResponse: 9,
  halfWidth: 1.0,
  radius: 2.1, // for car-to-car contact
  nitroBoost: 1.75,
  nitroTop: 1.22,
  nitroBurn: 0.3, // tank per second
}

// Barriers sit just outside the painted edge of the road.
export const barrierOffset = (track: Track) => track.width / 2 + 0.8

export interface CarInput {
  throttle: number
  brake: number
  // -1 is full left, +1 full right.
  steer: number
  handbrake: boolean
  nitro: boolean
}

export const idle: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }

export interface CarState {
  x: number
  z: number
  heading: number
  vx: number
  vz: number
  yawRate: number
  nitro: number
  nitroOn: boolean
  // Angle between where the car points and where it is going.
  slip: number
  drifting: boolean
  // Rises after the handbrake comes off, so grip returns over a moment.
  gripRecovery: number
  steer: number
  wheelSpin: number
  braking: boolean
  // Strength of the last barrier hit, for sparks and sound. Read and reset
  // by the renderer.
  impact: number
  hint: number
}

export function createCar(x: number, z: number, heading: number, track: Track): CarState {
  return {
    x,
    z,
    heading,
    vx: 0,
    vz: 0,
    yawRate: 0,
    nitro: 0.4,
    nitroOn: false,
    slip: 0,
    drifting: false,
    gripRecovery: 1,
    steer: 0,
    wheelSpin: 0,
    braking: false,
    impact: 0,
    hint: locate(track, x, z).i,
  }
}

export const forwardSpeed = (car: CarState) => car.vx * Math.sin(car.heading) + car.vz * Math.cos(car.heading)
export const speedOf = (car: CarState) => Math.hypot(car.vx, car.vz)

export function stepCar(car: CarState, input: CarInput, dt: number, track: Track) {
  const fx = Math.sin(car.heading)
  const fz = Math.cos(car.heading)
  // Right-hand vector when facing along (fx, fz) with y up.
  const rx = -fz
  const rz = fx
  let vf = car.vx * fx + car.vz * fz
  let vr = car.vx * rx + car.vz * rz

  // Nitro burns only while the car is actually rolling forwards.
  car.nitroOn = input.nitro && car.nitro > 0 && vf > 3 && input.throttle > 0
  if (car.nitroOn) car.nitro = Math.max(0, car.nitro - CAR.nitroBurn * dt)

  const top = CAR.topSpeed * (car.nitroOn ? CAR.nitroTop : 1)
  let accel = 0
  if (input.throttle > 0) {
    if (vf >= -0.5) accel += input.throttle * CAR.engine * (car.nitroOn ? CAR.nitroBoost : 1) * Math.max(0, 1 - vf / top)
    else accel += input.throttle * CAR.brake
  }
  car.braking = false
  if (input.brake > 0) {
    if (vf > 0.5) {
      accel -= input.brake * CAR.brake
      car.braking = true
    } else if (vf > -CAR.reverseTop) {
      accel -= input.brake * CAR.engine * 0.6
    }
  }
  if (input.handbrake) accel -= Math.sign(vf) * 5
  const resist = CAR.drag * vf * Math.abs(vf) + CAR.roll * Math.sign(vf)
  const next = vf + (accel - resist) * dt
  // Rolling resistance alone must not push the car backwards.
  vf = input.throttle === 0 && input.brake === 0 && Math.sign(next) !== Math.sign(vf) ? 0 : next
  vf = Math.max(vf, -CAR.reverseTop)

  // Steering: the yaw rate a bicycle model would give, capped by how much
  // sideways pull the tyres have at this speed. Lock eases off with speed.
  const speed = Math.abs(vf)
  const lock = CAR.maxSteer * (1 - 0.6 * Math.min(1, speed / CAR.topSpeed))
  car.steer += (input.steer * lock - car.steer) * Math.min(1, 12 * dt)
  const geometric = (vf * Math.tan(car.steer)) / CAR.wheelbase
  const cap = CAR.lateralLimit / Math.max(speed, 4)
  // A right turn turns the heading the negative way.
  let yawTarget = -Math.max(-cap, Math.min(cap, geometric))
  if (input.handbrake && speed > 10) yawTarget *= 1.7
  car.yawRate += (yawTarget - car.yawRate) * Math.min(1, CAR.yawResponse * dt)

  // Grip. The handbrake breaks it; holding throttle and steering into a
  // slide keeps it low, which is how a drift is held through a corner.
  if (input.handbrake) car.gripRecovery = 0
  else car.gripRecovery = Math.min(1, car.gripRecovery + dt / 0.7)
  const holding = car.drifting && input.throttle > 0.5 && Math.abs(input.steer) > 0.3
  const recovery = holding ? Math.min(car.gripRecovery, 0.3) : car.gripRecovery
  const grip = CAR.driftGrip + (CAR.grip - CAR.driftGrip) * recovery
  vr *= Math.exp(-grip * dt)

  car.vx = fx * vf + rx * vr
  car.vz = fz * vf + rz * vr
  car.heading += car.yawRate * dt
  car.x += car.vx * dt
  car.z += car.vz * dt

  car.slip = Math.atan2(Math.abs(vr), Math.max(Math.abs(vf), 0.1))
  car.drifting = car.slip > 0.16 && speed > 12
  // Sliding fills the tank, the harder the better, and a clean lap trickles
  // a little in too.
  if (car.drifting) car.nitro = Math.min(1, car.nitro + 0.2 * Math.min(1, car.slip / 0.45) * dt)
  else if (!car.nitroOn) car.nitro = Math.min(1, car.nitro + 0.008 * dt)
  car.wheelSpin += (vf / 0.34) * dt

  collideWithBarriers(car, track)
}

function collideWithBarriers(car: CarState, track: Track) {
  const where = locate(track, car.x, car.z, car.hint)
  car.hint = where.i
  const limit = barrierOffset(track) - CAR.halfWidth
  if (Math.abs(where.d) <= limit) return
  const side = Math.sign(where.d)
  const nx = track.nx[where.i] * side
  const nz = track.nz[where.i] * side
  // Push back inside the barrier.
  const over = Math.abs(where.d) - limit
  car.x -= nx * over
  car.z -= nz * over
  // Bounce off the part of the velocity going into the wall and scrub some
  // of the rest. A glancing touch costs little, a head-on hit a lot.
  const into = car.vx * nx + car.vz * nz
  if (into > 0) {
    car.vx -= 1.35 * into * nx
    car.vz -= 1.35 * into * nz
    const scrub = Math.max(0.6, 1 - 0.06 * into)
    car.vx *= scrub
    car.vz *= scrub
    car.impact = Math.max(car.impact, into)
    // Turn the nose away from the wall.
    car.yawRate *= 0.5
  }
}

// Pushes two overlapping cars apart and trades the part of their velocity
// along the line between them, like two equal masses with a soft bounce.
export function collideCars(a: CarState, b: CarState): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const dist = Math.hypot(dx, dz)
  const min = CAR.radius * 2
  if (dist >= min || dist === 0) return 0
  const ux = dx / dist
  const uz = dz / dist
  const push = (min - dist) / 2
  a.x -= ux * push
  a.z -= uz * push
  b.x += ux * push
  b.z += uz * push
  const closing = (a.vx - b.vx) * ux + (a.vz - b.vz) * uz
  if (closing <= 0) return 0
  const j = closing * 0.6
  a.vx -= j * ux
  a.vz -= j * uz
  b.vx += j * ux
  b.vz += j * uz
  return closing
}
